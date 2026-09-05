import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { deleteObject, ref, uploadBytes } from 'firebase/storage';

let testEnv;

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-companion',
    firestore: { rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8') },
    storage: { rules: await readFile(new URL('../storage.rules', import.meta.url), 'utf8') },
  });
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'users', 'alice'), { displayName: 'Alice' });
    await setDoc(doc(context.firestore(), 'sageUsage', 'alice'), { date: '2026-09-04', count: 3, cap: 10 });
    await setDoc(doc(context.firestore(), 'sageUsage', 'bob'), { date: '2026-09-04', count: 9, cap: 10 });
    await setDoc(doc(context.firestore(), 'sageUsage', '_global'), { date: '2026-09-04', count: 120, cap: 400 });
  });
});

after(async () => {
  await testEnv?.cleanup();
});

test('verified AUI users can edit profiles but cannot alter usage counters', async () => {
  const context = testEnv.authenticatedContext('alice', {
    email: 'alice@aui.ma',
    email_verified: true,
  });
  const db = context.firestore();
  await assertSucceeds(updateDoc(doc(db, 'users', 'alice'), { displayName: 'Alice Updated' }));
  await assertFails(updateDoc(doc(db, 'users', 'alice'), { aiUsage: { date: '2026-07-10', count: 0 } }));
  await assertFails(setDoc(doc(db, 'sageUsage', 'alice'), { date: '2026-07-10', count: 0 }));
  // Reading your own Sage counter IS allowed — it is how the popout shows what is left.
  // Writing it never is: a counter its own subject can edit would not be a limit.
  await assertSucceeds(getDoc(doc(db, 'sageUsage', 'alice')));
  await assertFails(setDoc(doc(db, 'deleteUsage', 'alice'), { date: '2026-07-10', count: 0 }));
  await assertFails(getDoc(doc(db, 'deleteUsage', 'alice')));
});

test('an unverified AUI address reaches no data at all', async () => {
  const db = testEnv
    .authenticatedContext('mallory', { email: 'mallory@aui.ma', email_verified: false })
    .firestore();
  await assertFails(setDoc(doc(db, 'users', 'mallory'), { displayName: 'Mallory' }));
  await assertFails(getDoc(doc(db, 'users', 'mallory')));
  await assertFails(
    setDoc(doc(db, 'users', 'mallory', 'classes', 'c1'), { name: 'Smuggled' }),
  );
  const storage = testEnv
    .authenticatedContext('mallory', { email: 'mallory@aui.ma', email_verified: false })
    .storage();
  await assertFails(
    uploadBytes(ref(storage, 'avatars/mallory/avatar.png'), new Uint8Array([137, 80, 78, 71]), {
      contentType: 'image/png',
    }),
  );
});

test('profile creation rejects aiUsage and non-AUI accounts', async () => {
  const auiDb = testEnv
    .authenticatedContext('new-user', { email: 'new-user@aui.ma', email_verified: true })
    .firestore();
  await assertSucceeds(setDoc(doc(auiDb, 'users', 'new-user'), { displayName: 'New User' }));
  const usageDb = testEnv
    .authenticatedContext('usage-user', { email: 'usage-user@aui.ma', email_verified: true })
    .firestore();
  await assertFails(
    setDoc(doc(usageDb, 'users', 'usage-user'), {
      displayName: 'Bad',
      aiUsage: { count: 0 },
    }),
  );
  const outsiderDb = testEnv
    .authenticatedContext('outsider', { email: 'outsider@example.com', email_verified: true })
    .firestore();
  await assertFails(setDoc(doc(outsiderDb, 'users', 'outsider'), { displayName: 'Outsider' }));
});

test('Storage accepts bounded raster images and rejects SVG or oversized uploads', async () => {
  const storage = testEnv
    .authenticatedContext('alice', { email: 'alice@aui.ma', email_verified: true })
    .storage();
  const avatar = ref(storage, 'avatars/alice/avatar.png');
  await assertSucceeds(uploadBytes(avatar, new Uint8Array([137, 80, 78, 71]), { contentType: 'image/png' }));
  await assertFails(
    uploadBytes(ref(storage, 'avatars/alice/avatar.svg'), new Uint8Array([1]), {
      contentType: 'image/svg+xml',
    }),
  );
  await assertFails(
    uploadBytes(
      ref(storage, 'notes/alice/note-1/too-large.png'),
      new Uint8Array(10 * 1024 * 1024 + 1),
      { contentType: 'image/png' },
    ),
  );
  await assertSucceeds(deleteObject(avatar));
});

test('the Sage allowance counter is readable only by its own owner', async () => {
  const alice = testEnv
    .authenticatedContext('alice', { email: 'alice@aui.ma', email_verified: true })
    .firestore();
  // own counter: readable, so the popout can say "7 of 10 left"
  await assertSucceeds(getDoc(doc(alice, 'sageUsage', 'alice')));
  // someone else's usage is nobody's business
  await assertFails(getDoc(doc(alice, 'sageUsage', 'bob')));
  // and the app-wide counter stays private — no uid can equal "_global", which is
  // exactly why that id was chosen
  await assertFails(getDoc(doc(alice, 'sageUsage', '_global')));
  // writes remain closed on every path, including your own
  await assertFails(setDoc(doc(alice, 'sageUsage', 'alice'), { date: '2026-09-04', count: 0 }));
  await assertFails(updateDoc(doc(alice, 'sageUsage', 'alice'), { count: 0 }));
  await assertFails(setDoc(doc(alice, 'sageUsage', '_global'), { count: 0 }));
  // an unverified mailbox reads nothing, same as everywhere else
  const mallory = testEnv
    .authenticatedContext('mallory', { email: 'mallory@aui.ma', email_verified: false })
    .firestore();
  await assertFails(getDoc(doc(mallory, 'sageUsage', 'mallory')));
  // deletion metering stays fully server-only: nothing in the UI needs it
  await assertFails(getDoc(doc(alice, 'deleteUsage', 'alice')));
});
