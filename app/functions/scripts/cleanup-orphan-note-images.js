'use strict';

const { applicationDefault, deleteApp, initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');

const STORAGE_PREFIX = 'notes/';
const DEFAULT_MIN_AGE_HOURS = 24;
const DEFAULT_MAX_DELETE = 1000;
const DELETE_CONCURRENCY = 20;

const readArg = (args, name) => {
  const prefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const parsePositiveNumber = (value, fallback, label) => {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative number.`);
  }
  return parsed;
};

const liveNoteKey = (path) => {
  const parts = path.split('/');
  if (
    parts.length !== 6 ||
    parts[0] !== 'users' ||
    parts[2] !== 'classes' ||
    parts[4] !== 'notes'
  ) {
    return null;
  }
  return `${parts[1]}/${parts[5]}`;
};

const storageNoteKey = (name) => {
  const parts = name.split('/');
  if (parts.length < 4 || parts[0] !== 'notes' || !parts[1] || !parts[2]) return null;
  return `${parts[1]}/${parts[2]}`;
};

const loadLiveNoteKeys = async (db) => {
  const keys = new Set();
  const stream = db.collectionGroup('notes').select().stream();
  for await (const snapshot of stream) {
    const key = liveNoteKey(snapshot.ref.path);
    if (key) keys.add(key);
  }
  return keys;
};

const loadStorageGroups = async (bucket) => {
  const groups = new Map();
  let ignoredObjects = 0;
  let pageToken;

  do {
    const [files, nextQuery] = await bucket.getFiles({
      autoPaginate: false,
      maxResults: 1000,
      pageToken,
      prefix: STORAGE_PREFIX,
    });

    for (const file of files) {
      const key = storageNoteKey(file.name);
      if (!key) {
        ignoredObjects += 1;
        continue;
      }

      const [uid, noteId] = key.split('/');
      const createdAt = Date.parse(file.metadata?.timeCreated || file.metadata?.updated || '');
      const size = Number(file.metadata?.size) || 0;
      const group = groups.get(key) || {
        key,
        uid,
        noteId,
        objectNames: [],
        totalBytes: 0,
        newestCreatedAt: 0,
        unknownAge: false,
      };
      group.objectNames.push(file.name);
      group.totalBytes += size;
      if (Number.isFinite(createdAt)) {
        group.newestCreatedAt = Math.max(group.newestCreatedAt, createdAt);
      } else {
        group.unknownAge = true;
      }
      groups.set(key, group);
    }

    pageToken = nextQuery?.pageToken;
  } while (pageToken);

  return { groups, ignoredObjects };
};

const formatBytes = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
};

const printHelp = () => {
  console.log(`Usage:
  npm run cleanup:orphan-images -- --project <id> --bucket <name>
  npm run cleanup:orphan-images -- --project <id> --bucket <name> --delete --confirm-project <id>

The command is a dry run unless --delete is supplied. Objects newer than 24 hours are
skipped by default. Use --min-age-hours <hours> and --max-delete <count> to adjust the
safety limits.`);
};

const main = async () => {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }

  const projectId = readArg(args, '--project');
  const bucketName = readArg(args, '--bucket');
  const shouldDelete = args.includes('--delete');
  const confirmedProject = readArg(args, '--confirm-project');
  const minAgeHours = parsePositiveNumber(
    readArg(args, '--min-age-hours'),
    DEFAULT_MIN_AGE_HOURS,
    '--min-age-hours',
  );
  const maxDelete = parsePositiveNumber(
    readArg(args, '--max-delete'),
    DEFAULT_MAX_DELETE,
    '--max-delete',
  );

  if (!projectId || !bucketName) {
    throw new Error('Both --project and --bucket are required. Run with --help for examples.');
  }
  if (shouldDelete && confirmedProject !== projectId) {
    throw new Error(`Deletion requires --confirm-project ${projectId}.`);
  }

  const app = initializeApp({
    credential: applicationDefault(),
    projectId,
    storageBucket: bucketName,
  });

  try {
    const db = getFirestore(app);
    const bucket = getStorage(app).bucket(bucketName);
    const cutoff = Date.now() - minAgeHours * 60 * 60 * 1000;
    const [liveNotes, storageResult] = await Promise.all([
      loadLiveNoteKeys(db),
      loadStorageGroups(bucket),
    ]);

    const orphanGroups = [...storageResult.groups.values()].filter(
      (group) => !liveNotes.has(group.key),
    );
    const eligibleGroups = orphanGroups.filter(
      (group) => !group.unknownAge && group.newestCreatedAt <= cutoff,
    );
    const eligibleObjects = eligibleGroups.flatMap((group) => group.objectNames);
    const eligibleBytes = eligibleGroups.reduce((sum, group) => sum + group.totalBytes, 0);

    console.log(`Project: ${projectId}`);
    console.log(`Bucket: ${bucketName}`);
    console.log(`Live notes: ${liveNotes.size}`);
    console.log(`Storage note prefixes: ${storageResult.groups.size}`);
    console.log(`Orphan prefixes: ${orphanGroups.length}`);
    console.log(
      `Eligible after ${minAgeHours}h safety window: ${eligibleGroups.length} prefixes, ` +
        `${eligibleObjects.length} objects, ${formatBytes(eligibleBytes)}`,
    );
    if (storageResult.ignoredObjects) {
      console.log(`Ignored unrecognized objects under notes/: ${storageResult.ignoredObjects}`);
    }
    eligibleGroups.slice(0, 50).forEach((group) => {
      console.log(`  ${group.key}: ${group.objectNames.length} objects (${formatBytes(group.totalBytes)})`);
    });
    if (eligibleGroups.length > 50) {
      console.log(`  ...and ${eligibleGroups.length - 50} more prefixes`);
    }

    if (!shouldDelete) {
      console.log('Dry run only; no objects were deleted.');
      return;
    }
    if (eligibleObjects.length > maxDelete) {
      throw new Error(
        `Refusing to delete ${eligibleObjects.length} objects; --max-delete is ${maxDelete}. ` +
          'Review the dry run and raise the limit explicitly if the result is expected.',
      );
    }

    // Re-read live note paths immediately before deletion. Only the exact object names
    // from the scan are removed, so files uploaded after the scan are left untouched.
    const refreshedLiveNotes = await loadLiveNoteKeys(db);
    const confirmedObjects = eligibleGroups
      .filter((group) => !refreshedLiveNotes.has(group.key))
      .flatMap((group) => group.objectNames);

    let deleted = 0;
    const failures = [];
    for (let index = 0; index < confirmedObjects.length; index += DELETE_CONCURRENCY) {
      const batch = confirmedObjects.slice(index, index + DELETE_CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map((name) => bucket.file(name).delete({ ignoreNotFound: true })),
      );
      results.forEach((result, resultIndex) => {
        if (result.status === 'fulfilled') deleted += 1;
        else failures.push({ name: batch[resultIndex], reason: result.reason?.message || 'unknown error' });
      });
    }

    console.log(`Deleted ${deleted} orphan objects.`);
    if (failures.length) {
      failures.slice(0, 20).forEach((failure) => {
        console.error(`Failed: ${failure.name}: ${failure.reason}`);
      });
      throw new Error(`${failures.length} object deletions failed; rerun the dry run before retrying.`);
    }
  } finally {
    await deleteApp(app);
  }
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}

module.exports = { liveNoteKey, storageNoteKey };
