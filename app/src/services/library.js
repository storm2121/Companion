import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocFromCache,
  getCountFromServer,
  getDocFromServer,
  getDocs,
  increment,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase';

const NOTE_CONTENT_DOC_ID = 'main';
const DEFAULT_CANVAS_HEIGHT = 720;
const CALLABLE_TIMEOUT_MS = 300000;
const callDeleteClass = httpsCallable(functions, 'deleteClassCascade', { timeout: CALLABLE_TIMEOUT_MS });
const callDeleteNote = httpsCallable(functions, 'deleteNoteCascade', { timeout: CALLABLE_TIMEOUT_MS });
const callDeleteNotes = httpsCallable(functions, 'deleteNotesCascade', { timeout: CALLABLE_TIMEOUT_MS });
const getNoteRef = (uid, classId, noteId) => doc(db, 'users', uid, 'classes', classId, 'notes', noteId);
const getNoteContentRef = (uid, classId, noteId) =>
  doc(db, 'users', uid, 'classes', classId, 'notes', noteId, 'content', NOTE_CONTENT_DOC_ID);

const sanitizeBlocks = (blocks) => (Array.isArray(blocks) ? blocks : []);
// Which design a note belongs to. Notes written before the dual-design seam carry no
// `format` at all, and ABSENT MEANS 'canvas' — see designModes.js.
const sanitizeNoteFormat = (value) => (value === 'page' ? 'page' : 'canvas');
const sanitizeCanvasHeight = (value) => (Number.isFinite(value) ? value : DEFAULT_CANVAS_HEIGHT);

// Storage model: blocks are kept as a map { [id]: block } plus an `order` array so
// a single edit can be persisted as a delta (one field path) instead of rewriting the
// whole array. These helpers convert between the on-disk map and the array the app uses.
const newBlockId = () =>
  globalThis.crypto?.randomUUID?.() || `block-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const blocksArrayToMap = (blocks) => {
  const map = {};
  const order = [];
  (Array.isArray(blocks) ? blocks : []).forEach((block) => {
    if (!block || typeof block !== 'object') return;
    // Template blocks arrive without ids — assign one instead of dropping the block
    // (dropping was why notes created from templates came out empty).
    const id = block.id || newBlockId();
    map[id] = block.id ? block : { ...block, id };
    order.push(id);
  });
  return { map, order };
};

const blocksMapToArray = (map, order) => {
  if (!map || typeof map !== 'object') return [];
  const ids = Array.isArray(order) && order.length ? order : Object.keys(map);
  const seen = new Set();
  const result = [];
  const pushId = (id) => {
    if (seen.has(id)) return;
    const block = map[id];
    if (block && typeof block === 'object') {
      result.push(block);
      seen.add(id);
    }
  };
  ids.forEach(pushId);
  // Safety net: include any map entries missing from the order array.
  Object.keys(map).forEach(pushId);
  return result;
};

const normalizeMergedNote = (meta = {}, content = {}) => {
  const { blocks: legacyBlocks, canvasHeight: legacyCanvasHeight, ...metaFields } = meta || {};
  const rawBlocks = content?.blocks ?? legacyBlocks;
  let blocks;
  let blocksSchema;
  if (rawBlocks && !Array.isArray(rawBlocks) && typeof rawBlocks === 'object') {
    blocks = blocksMapToArray(rawBlocks, content?.order);
    blocksSchema = 'map';
  } else {
    blocks = sanitizeBlocks(rawBlocks);
    blocksSchema = 'array';
  }
  const canvasHeight = sanitizeCanvasHeight(content?.canvasHeight ?? legacyCanvasHeight);
  return {
    ...metaFields,
    blocks,
    canvasHeight,
    // 'map' = already on the delta-friendly schema; 'array' = legacy, first save migrates.
    blocksSchema,
  };
};

const readDocFromCacheFirst = async (ref) => {
  try {
    const cached = await getDocFromCache(ref);
    if (cached.exists()) return cached;
  } catch {
    // Cache miss fallback.
  }
  return getDoc(ref);
};

// Each design lists only its own courses (owner, 2026-09-29). A course made in the room
// carries `design: 'room'` (createCourse, below); classic's list leaves those out. Filtered
// here rather than in the query: Firestore cannot ask for "field missing or not 'room'", and
// every classic course is one with the field missing. The listener hands on a snapshot-like
// object with the same `docs` (what classic reads), `size`, `empty`, `forEach`, `metadata`.
const ROOM_COURSE = 'room';
const withoutRoomCourses = (snapshot) => {
  const docs = snapshot.docs.filter((docSnap) => docSnap.data()?.design !== ROOM_COURSE);
  return {
    docs,
    size: docs.length,
    empty: docs.length === 0,
    metadata: snapshot.metadata,
    forEach: (fn) => docs.forEach(fn),
    docChanges: () => snapshot.docChanges().filter((change) => change.doc.data()?.design !== ROOM_COURSE),
  };
};

export const listenToClasses = (uid, onData, onError) => {
  const q = query(collection(db, 'users', uid, 'classes'), orderBy('order', 'asc'));
  return onSnapshot(q, (snapshot) => onData(withoutRoomCourses(snapshot)), onError);
};

// The room's listener: every course. It lists its own, plus any older course that already
// holds room notes — and needs to see all of them to find those (room/courseDesigns.js).
export const listenToAllClasses = (uid, onData, onError) =>
  onSnapshot(query(collection(db, 'users', uid, 'classes'), orderBy('order', 'asc')), onData, onError);

// An older course whose notes turned out all to be room notes becomes the room's own.
export const markRoomCourse = (uid, classId) =>
  updateDoc(doc(db, 'users', uid, 'classes', classId), { design: ROOM_COURSE });

// Every note in a course, both designs', counted on the server (one read per 1,000 notes).
export const countCourseNotes = async (uid, classId) => {
  const snap = await getCountFromServer(collection(db, 'users', uid, 'classes', classId, 'notes'));
  return snap.data().count;
};

export const createClass = async (uid, { name, color }) => {
  const cleanedName = name.trim();
  const payload = {
    name: cleanedName,
    color,
    code: cleanedName,
    noteCount: 0,
    order: Date.now(),
    createdAt: serverTimestamp(),
  };
  const ref = await addDoc(collection(db, 'users', uid, 'classes'), payload);
  return ref.id;
};

export const updateClassColor = async (uid, classId, color) => {
  await updateDoc(doc(db, 'users', uid, 'classes', classId), { color });
};

export const renameClass = async (uid, classId, name) => {
  const cleanedName = name.trim();
  if (!cleanedName) return;
  await updateDoc(doc(db, 'users', uid, 'classes', classId), {
    name: cleanedName,
    code: cleanedName,
  });
};

export const reorderClasses = async (uid, orderedClasses) => {
  for (let offset = 0; offset < orderedClasses.length; offset += 400) {
    const batch = writeBatch(db);
    orderedClasses.slice(offset, offset + 400).forEach((item, index) => {
      batch.update(doc(db, 'users', uid, 'classes', item.id), { order: offset + index });
    });
    await batch.commit();
  }
};

export const deleteClass = async (uid, classId) => {
  if (!uid || !classId) return;
  await callDeleteClass({ classId });
};

export const getClass = async (uid, classId) => {
  const ref = doc(db, 'users', uid, 'classes', classId);
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
};

export const listenToNotes = (uid, classId, onData, onError) => {
  return onSnapshot(collection(db, 'users', uid, 'classes', classId, 'notes'), onData, onError);
};

export const createNote = async (uid, classId, payload = {}) => {
  const noteRef = doc(collection(db, 'users', uid, 'classes', classId, 'notes'));
  const contentRef = getNoteContentRef(uid, classId, noteRef.id);
  const metaPayload = {
    title: payload.title || 'Untitled Note',
    summary: payload.summary || '',
    coverUrl: payload.coverUrl || '',
    tags: payload.tags || [],
    pinned: payload.pinned || false,
    templateId: payload.templateId || '',
    format: sanitizeNoteFormat(payload.format),
    order: Number.isFinite(payload.order) ? payload.order : Date.now(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    contentUpdatedAt: serverTimestamp(),
  };
  const { map: newBlocksMap, order: newBlocksOrder } = blocksArrayToMap(sanitizeBlocks(payload.blocks));
  const contentPayload = {
    blocks: newBlocksMap,
    order: newBlocksOrder,
    canvasHeight: sanitizeCanvasHeight(payload.canvasHeight),
    updatedAt: serverTimestamp(),
  };
  const batch = writeBatch(db);
  batch.set(noteRef, metaPayload);
  batch.set(contentRef, contentPayload);
  batch.update(doc(db, 'users', uid, 'classes', classId), {
    noteCount: increment(1),
  });
  await batch.commit();
  return noteRef.id;
};

export const deleteNote = async (uid, classId, noteId) => {
  if (!uid || !classId || !noteId) return;
  await callDeleteNote({ classId, noteId });
};

export const deleteNotes = async (uid, classId, noteIds = []) => {
  if (!uid || !classId || !Array.isArray(noteIds) || !noteIds.length) return;
  const uniqueIds = [...new Set(noteIds.filter(Boolean))];
  for (let offset = 0; offset < uniqueIds.length; offset += 100) {
    await callDeleteNotes({ classId, noteIds: uniqueIds.slice(offset, offset + 100) });
  }
};

export const setNotePinned = async (uid, classId, noteId, pinned) => {
  await updateDoc(getNoteRef(uid, classId, noteId), {
    pinned: Boolean(pinned),
    updatedAt: serverTimestamp(),
  });
};

// Self-heal: overwrite a class's stored noteCount with the real count once we know it.
export const setClassNoteCount = async (uid, classId, count) => {
  if (!Number.isFinite(count)) return;
  await updateDoc(doc(db, 'users', uid, 'classes', classId), { noteCount: count });
};

// Fetch note metadata across many classes (for global search). Returns each note
// tagged with its classId/className.
export const fetchNotesForClasses = async (uid, classes = []) => {
  const groups = await Promise.all(
    classes.map(async (cls) => {
      try {
        const snap = await getDocs(collection(db, 'users', uid, 'classes', cls.id, 'notes'));
        return snap.docs.map((docSnap) => ({
          ...toNoteMetaOnly(docSnap),
          classId: cls.id,
          className: cls.name || '',
        }));
      } catch {
        return [];
      }
    }),
  );
  return groups.flat();
};

const toNoteMetaOnly = (docSnap) => {
  const meta = { ...(docSnap.data() || {}) };
  delete meta.blocks;
  delete meta.canvasHeight;
  return { id: docSnap.id, ...meta };
};

const stripHtmlToText = (html) => {
  if (typeof html !== 'string' || !html) return '';
  if (typeof DOMParser === 'undefined') return html.replace(/<[^>]*>/g, ' ');
  try {
    return new DOMParser().parseFromString(html, 'text/html').body.textContent || '';
  } catch {
    return html.replace(/<[^>]*>/g, ' ');
  }
};

// Plain-text of a note's content (for "search inside notes"). Cache-first read.
export const getNoteText = async (uid, classId, noteId) => {
  try {
    const data = await getNote(uid, classId, noteId);
    if (!Array.isArray(data?.blocks)) return '';
    return data.blocks
      .filter((block) => block?.type === 'text')
      .map((block) => stripHtmlToText(block.value || ''))
      .join('  ')
      .replace(/\s+/g, ' ')
      .trim();
  } catch {
    return '';
  }
};

export const getNote = async (uid, classId, noteId) => {
  const noteRef = getNoteRef(uid, classId, noteId);
  const contentRef = getNoteContentRef(uid, classId, noteId);
  const noteSnap = await readDocFromCacheFirst(noteRef);
  if (!noteSnap.exists()) return null;

  const meta = noteSnap.data();
  let contentSnap = null;
  try {
    contentSnap = await readDocFromCacheFirst(contentRef);
  } catch {
    contentSnap = null;
  }
  let contentData = contentSnap?.exists() ? contentSnap.data() : null;

  const hasLegacyContent = Array.isArray(meta?.blocks) || Number.isFinite(meta?.canvasHeight);
  if (!contentData && hasLegacyContent) {
    const { map: legacyMap, order: legacyOrder } = blocksArrayToMap(sanitizeBlocks(meta.blocks));
    const legacyCanvasHeight = sanitizeCanvasHeight(meta.canvasHeight);
    contentData = {
      blocks: legacyMap,
      order: legacyOrder,
      canvasHeight: legacyCanvasHeight,
      updatedAt: meta.updatedAt || serverTimestamp(),
    };
    try {
      const batch = writeBatch(db);
      batch.set(contentRef, {
        blocks: legacyMap,
        order: legacyOrder,
        canvasHeight: legacyCanvasHeight,
        updatedAt: serverTimestamp(),
      });
      batch.update(noteRef, {
        blocks: deleteField(),
        canvasHeight: deleteField(),
        contentUpdatedAt: serverTimestamp(),
      });
      await batch.commit();
    } catch (err) {
      console.warn('Failed to migrate legacy note content', err);
    }
  }

  return normalizeMergedNote(meta, contentData || {});
};

/* ── The room's reads of one note ─────────────────────────────────────────────
   `getNote` reads cache-first. Nothing listens to a note's CONTENT doc, though, so once a
   device has a copy it never refreshes: a note edited on another device — or at another
   address, since localhost and the deployed site each keep their own cache — kept opening
   in its old version, and the first save wrote that old version's block order back over
   the newer one. `getNote` itself is classic's and stays as it is.                    */

const SERVER_WAIT_MS = 3500;
const WAITED = Symbol('waited');

// The server's copy, merged; null when the note is gone. Throws when there is no server.
const readNoteFromServer = async (uid, classId, noteId) => {
  const [noteSnap, contentSnap] = await Promise.all([
    getDocFromServer(getNoteRef(uid, classId, noteId)),
    getDocFromServer(getNoteContentRef(uid, classId, noteId)),
  ]);
  if (!noteSnap.exists()) return null;
  // No content doc: an old canvas note, which getNote knows how to migrate.
  if (!contentSnap.exists()) return getNote(uid, classId, noteId);
  return normalizeMergedNote(noteSnap.data(), contentSnap.data());
};

// For an editor: the server's copy whenever it answers within a moment, this device's copy
// when it does not (offline, or a slow connection) — so a note still opens at once with no
// connection. `later`, when set, is the server's answer still on its way; the caller may
// use it if nothing has been typed yet. Reading from the server also refreshes the cache.
export const getNoteFresh = async (uid, classId, noteId, { waitMs = SERVER_WAIT_MS } = {}) => {
  const cached = async () => ({ note: await getNote(uid, classId, noteId), fresh: false, later: null });
  if (globalThis.navigator?.onLine === false) return cached();
  const server = readNoteFromServer(uid, classId, noteId);
  let timer;
  const waited = new Promise((resolve) => {
    timer = setTimeout(() => resolve(WAITED), waitMs);
  });
  try {
    const first = await Promise.race([server, waited]);
    if (first !== WAITED) return { note: first, fresh: true, later: null };
  } catch {
    return cached();
  } finally {
    clearTimeout(timer);
  }
  return { ...(await cached()), later: server.catch(() => undefined) };
};

// For lists that know when a note's content last changed — its meta's `contentUpdatedAt`,
// which the room's note listeners keep live: this device's copy when it is at least that
// new, the server's when it is older. A server read only for a note that changed elsewhere.
export const getNoteAsOf = async (uid, classId, noteId, stampMs = 0) => {
  if (stampMs) {
    const contentRef = getNoteContentRef(uid, classId, noteId);
    try {
      const cachedContent = await getDocFromCache(contentRef);
      const at = cachedContent.exists() ? cachedContent.get('updatedAt')?.toMillis?.() || 0 : 0;
      // 0 = a save from this device the server has not stamped yet: this copy is the newest.
      if (at && at < stampMs) await getDocFromServer(contentRef);
    } catch {
      // Not on this device, or no connection: getNote reads what it can.
    }
  }
  return getNote(uid, classId, noteId);
};

export const updateNote = async (uid, classId, noteId, payload) => {
  const noteRef = getNoteRef(uid, classId, noteId);
  const { blocks, canvasHeight, ...metaPayload } = payload || {};
  if (Object.keys(metaPayload).length) {
    await updateDoc(noteRef, {
      ...metaPayload,
      updatedAt: serverTimestamp(),
    });
  }
  if (blocks !== undefined || canvasHeight !== undefined) {
    // Full content replace on the map schema (rare path — editor uses delta saves).
    await saveNoteContentDelta(
      uid,
      classId,
      noteId,
      {
        fullRewrite: true,
        allBlocks: blocks !== undefined ? blocks : [],
        canvasHeight: canvasHeight !== undefined ? canvasHeight : DEFAULT_CANVAS_HEIGHT,
      },
      { touchMeta: true },
    );
  }
};

// Incremental content save. With `fullRewrite` it replaces the whole content doc
// (used for the first save / legacy array -> map migration). Otherwise it writes only
// the changed/removed block field paths, so a one-character edit costs a tiny write.
export const saveNoteContentDelta = async (uid, classId, noteId, delta = {}, options = {}) => {
  const contentRef = getNoteContentRef(uid, classId, noteId);
  const noteRef = getNoteRef(uid, classId, noteId);
  const touchMeta = options.touchMeta !== false;
  const {
    fullRewrite = false,
    allBlocks = null,
    changedBlocks = {},
    removedBlockIds = [],
    order = null,
    canvasHeight,
  } = delta;

  const touchNoteMeta = (batch) => {
    batch.update(noteRef, {
      updatedAt: serverTimestamp(),
      contentUpdatedAt: serverTimestamp(),
    });
  };

  if (fullRewrite) {
    const { map, order: builtOrder } = blocksArrayToMap(sanitizeBlocks(allBlocks || []));
    const payload = {
      blocks: map,
      order: builtOrder,
      canvasHeight: sanitizeCanvasHeight(canvasHeight),
      updatedAt: serverTimestamp(),
    };
    // setDoc without merge fully replaces the doc, dropping any legacy `blocks` array.
    if (touchMeta) {
      const batch = writeBatch(db);
      batch.set(contentRef, payload);
      touchNoteMeta(batch);
      await batch.commit();
    } else {
      await setDoc(contentRef, payload);
    }
    return;
  }

  const update = {};
  Object.entries(changedBlocks || {}).forEach(([id, block]) => {
    if (!id || !block) return;
    update[`blocks.${id}`] = block;
  });
  (Array.isArray(removedBlockIds) ? removedBlockIds : []).forEach((id) => {
    if (!id) return;
    update[`blocks.${id}`] = deleteField();
  });
  if (Array.isArray(order)) update.order = order;
  if (canvasHeight !== undefined) update.canvasHeight = sanitizeCanvasHeight(canvasHeight);
  if (!Object.keys(update).length) return;
  update.updatedAt = serverTimestamp();

  if (touchMeta) {
    const batch = writeBatch(db);
    batch.update(contentRef, update);
    touchNoteMeta(batch);
    await batch.commit();
  } else {
    await updateDoc(contentRef, update);
  }
};

export const moveNotes = async (uid, fromClassId, toClassId, notes = []) => {
  if (!uid || !fromClassId || !toClassId || fromClassId === toClassId) return;
  if (!Array.isArray(notes) || notes.length === 0) return;
  const contentSnapshots = await Promise.all(
    notes.map(async (note) => {
      const id = note?.id;
      if (!id) return { id: '', content: null, unavailable: false };
      const ref = getNoteContentRef(uid, fromClassId, id);
      try {
        const snap = await readDocFromCacheFirst(ref);
        return { id, content: snap.exists() ? snap.data() : null, unavailable: false };
      } catch {
        return { id, content: null, unavailable: true };
      }
    }),
  );
  const contentById = new Map(contentSnapshots.map((entry) => [entry.id, entry]));
  // Four writes per note plus counter transforms stay comfortably below Firestore's
  // 500-write limit. Each chunk moves complete notes atomically and updates both counts.
  for (let offset = 0; offset < notes.length; offset += 90) {
    const chunk = notes.slice(offset, offset + 90);
    const batch = writeBatch(db);
    let count = 0;
    chunk.forEach((note) => {
      const { id, blocks, canvasHeight, ...data } = note;
      if (!id) return;
      const targetRef = getNoteRef(uid, toClassId, id);
      const sourceRef = getNoteRef(uid, fromClassId, id);
      const sourceContentRef = getNoteContentRef(uid, fromClassId, id);
      const targetContentRef = getNoteContentRef(uid, toClassId, id);
      const contentEntry = contentById.get(id);
      const movedContent = contentEntry?.content || null;
      const legacyContent =
        movedContent ||
        (Array.isArray(blocks) || Number.isFinite(canvasHeight)
          ? {
              blocks: sanitizeBlocks(blocks),
              canvasHeight: sanitizeCanvasHeight(canvasHeight),
            }
          : null);
      if (contentEntry?.unavailable && !legacyContent) {
        throw new Error('Cannot move note while offline before opening it at least once.');
      }
      batch.set(targetRef, { ...data, updatedAt: serverTimestamp() }, { merge: true });
      if (legacyContent) {
        batch.set(
          targetContentRef,
          {
            ...legacyContent,
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
      }
      batch.delete(sourceRef);
      batch.delete(sourceContentRef);
      count += 1;
    });
    if (!count) continue;
    batch.update(doc(db, 'users', uid, 'classes', fromClassId), { noteCount: increment(-count) });
    batch.update(doc(db, 'users', uid, 'classes', toClassId), { noteCount: increment(count) });
    await batch.commit();
  }
};

export const reorderNotes = async (uid, classId, orderedNotes) => {
  if (!uid || !classId || !Array.isArray(orderedNotes)) return;
  for (let offset = 0; offset < orderedNotes.length; offset += 400) {
    const batch = writeBatch(db);
    orderedNotes.slice(offset, offset + 400).forEach((note, index) => {
      if (!note?.id) return;
      batch.update(doc(db, 'users', uid, 'classes', classId, 'notes', note.id), {
        order: offset + index,
      });
    });
    await batch.commit();
  }
};

export const listenToNoteTemplates = (uid, onData, onError) => {
  const q = query(collection(db, 'users', uid, 'noteTemplates'), orderBy('updatedAt', 'desc'));
  return onSnapshot(q, onData, onError);
};

// Calendar events live as a map on the user's profile doc (events.{id}). Additive —
// no rules change, no new collection, surfaced live through the profile listener.
export const setCalendarEvent = async (uid, event) => {
  const id =
    event.id || globalThis.crypto?.randomUUID?.() || `evt-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const payload = {
    id,
    date: event.date,
    time: event.time || '',
    title: (event.title || '').trim() || 'Untitled',
    color: event.color || '',
    note: (event.note || '').trim(),
    createdAt: event.createdAt || Date.now(),
    // Room only: the course a thing belongs to ("Quiz 2 · Statistics"). Classic neither
    // writes nor reads it, and never re-saves an existing event, so it cannot drop it.
    ...(event.courseId ? { courseId: String(event.courseId) } : {}),
  };
  await updateDoc(doc(db, 'users', uid), { [`events.${id}`]: payload });
  return id;
};

// Room quick-capture. Stored as a MAP ON THE PROFILE DOC, exactly like `events` — that
// is deliberate: a new subcollection would need a firestore.rules entry and a deploy,
// and the profile doc is already owner-writable.
export const addInboxEntry = async (uid, text) => {
  const clean = (text || '').trim();
  if (!uid || !clean) return '';
  const id =
    globalThis.crypto?.randomUUID?.() || `inb-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await updateDoc(doc(db, 'users', uid), {
    [`inbox.${id}`]: { id, text: clean.slice(0, 2000), createdAt: Date.now() },
  });
  return id;
};

export const deleteCalendarEvent = async (uid, id) => {
  if (!uid || !id) return;
  await updateDoc(doc(db, 'users', uid), { [`events.${id}`]: deleteField() });
};

// Sage versioning: snapshots live as sibling docs of content/main (covered by the same
// security rules). 'original' is written once, before the first AI rewrite.
export const saveNoteVersion = async (uid, classId, noteId, versionId, blocks, canvasHeight) => {
  const { map, order } = blocksArrayToMap(sanitizeBlocks(blocks));
  await setDoc(doc(db, 'users', uid, 'classes', classId, 'notes', noteId, 'content', versionId), {
    blocks: map,
    order,
    canvasHeight: sanitizeCanvasHeight(canvasHeight),
    updatedAt: serverTimestamp(),
  });
};

export const deleteNoteVersion = async (uid, classId, noteId, versionId) => {
  await deleteDoc(doc(db, 'users', uid, 'classes', classId, 'notes', noteId, 'content', versionId));
};

export const getNoteVersion = async (uid, classId, noteId, versionId) => {
  const snap = await getDoc(
    doc(db, 'users', uid, 'classes', classId, 'notes', noteId, 'content', versionId),
  );
  if (!snap.exists()) return null;
  const data = snap.data();
  return {
    blocks: blocksMapToArray(data.blocks, data.order),
    canvasHeight: sanitizeCanvasHeight(data.canvasHeight),
  };
};

// Preference: whether the "Upcoming" widget also appears on the dashboard sidebar.
export const setDashboardUpcomingVisible = async (uid, visible) => {
  await updateDoc(doc(db, 'users', uid), { showUpcomingOnDashboard: Boolean(visible) });
};

// Sage presets: named goal+add-on combos saved from the Sage popout. Stored as a map on
// the profile doc (same pattern as calendar events); the default preset id lives in its
// own field so switching defaults is a one-field write. Older presets stored a single
// `base` style — readers normalize with `presetStyles()` below.
export const saveSagePreset = async (uid, preset) => {
  const id =
    preset.id || globalThis.crypto?.randomUUID?.() || `sp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const payload = {
    id,
    name: (preset.name || '').trim() || 'My preset',
    styles: Array.isArray(preset.styles) ? preset.styles : preset.base ? [preset.base] : [],
    addons: Array.isArray(preset.addons) ? preset.addons : [],
    topic: (preset.topic || '').trim(),
    comment: (preset.comment || '').trim(),
    createdAt: preset.createdAt || Date.now(),
  };
  await updateDoc(doc(db, 'users', uid), { [`sagePresets.${id}`]: payload });
  return id;
};

// Normalizes old ({base}) and new ({styles}) preset shapes to a styles array.
/**
 * Live view of your own Sage allowance counter.
 *
 * `sageUsage/{uid}` is written only by the Admin SDK in Cloud Functions — the client is
 * denied every write in firestore.rules, and reads are scoped to your own uid (which also
 * keeps the app-wide `_global` document private). The document simply may not exist yet
 * for an account that has never run Sage, which reads as a full allowance.
 */
export const listenSageUsage = (uid, onData, onError) => {
  if (!uid) return () => {};
  return onSnapshot(
    doc(db, 'sageUsage', uid),
    (snap) => onData(snap.exists() ? snap.data() : null),
    onError,
  );
};

export const presetStyles = (preset) =>
  Array.isArray(preset?.styles) && preset.styles.length
    ? preset.styles
    : preset?.base
      ? [preset.base]
      : [];

export const deleteSagePreset = async (uid, id) => {
  if (!uid || !id) return;
  await updateDoc(doc(db, 'users', uid), { [`sagePresets.${id}`]: deleteField() });
};

export const setDefaultSagePreset = async (uid, presetId) => {
  await updateDoc(doc(db, 'users', uid), {
    sageDefaultPreset: presetId ? presetId : deleteField(),
  });
};

export const fetchNoteTemplates = async (uid) => {
  try {
    const snap = await getDocs(collection(db, 'users', uid, 'noteTemplates'));
    return snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
  } catch {
    return [];
  }
};

// Gather the user's entire workspace (profile, templates, classes, notes + content)
// into one plain object for "export my data".
export const exportUserData = async (uid) => {
  const out = { exportedAt: new Date().toISOString(), profile: null, templates: [], classes: [] };
  const profileSnap = await getDoc(doc(db, 'users', uid));
  out.profile = profileSnap.exists() ? profileSnap.data() : null;
  out.templates = await fetchNoteTemplates(uid);
  const classesSnap = await getDocs(collection(db, 'users', uid, 'classes'));
  for (const classDoc of classesSnap.docs) {
    const cls = { id: classDoc.id, ...classDoc.data(), notes: [] };
    const notesSnap = await getDocs(collection(db, 'users', uid, 'classes', classDoc.id, 'notes'));
    for (const noteDoc of notesSnap.docs) {
      const note = { id: noteDoc.id, ...noteDoc.data() };
      try {
        const contentSnap = await getDoc(getNoteContentRef(uid, classDoc.id, noteDoc.id));
        note.content = contentSnap.exists() ? contentSnap.data() : null;
      } catch {
        note.content = null;
      }
      cls.notes.push(note);
    }
    out.classes.push(cls);
  }
  return out;
};

/* ── Room (lofi study room) note access ─────────────────────────────────────
   Additive and room-only; classic never calls these.

   Querying on `format` is SAFE here and only here. Classic must never do it, because
   classic notes predate the field and "absent" means canvas. Every room note is born
   with format:'page', so there is no missing-field case to lose. It also means the room
   reads ONLY its own notes — before this, every visit to Home or a course read every
   note in every course, classic ones included, and was billed for all of them. */

// Live page notes for one course. A listener rather than a one-off read: with the
// persistent cache, re-attaching resumes from a token and is billed only for changes, and
// while offline it keeps serving the cached notes.
export const listenToPageNotes = (uid, classId, onData, onError) =>
  onSnapshot(
    query(collection(db, 'users', uid, 'classes', classId, 'notes'), where('format', '==', 'page')),
    onData,
    onError,
  );

// Starts a page note WITHOUT waiting for the server. The id is generated on this device
// and the batch lands in the local cache at once, so the note can be opened immediately —
// online or not. (`createNote` awaits the commit, and with Firestore's offline queue that
// promise only settles when the SERVER acknowledges: offline, "+ New note" hung forever.)
// `saved` settles when the server has it, or rejects if it refuses.
export const createPageNote = (uid, classId, payload = {}) => {
  const noteRef = doc(collection(db, 'users', uid, 'classes', classId, 'notes'));
  const contentRef = getNoteContentRef(uid, classId, noteRef.id);
  const { map, order } = blocksArrayToMap(sanitizeBlocks(payload.blocks));
  const batch = writeBatch(db);
  batch.set(noteRef, {
    title: payload.title || 'Untitled',
    summary: '',
    coverUrl: '',
    tags: [],
    pinned: false,
    templateId: '',
    format: 'page',
    order: Date.now(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    contentUpdatedAt: serverTimestamp(),
  });
  batch.set(contentRef, {
    blocks: map,
    order,
    canvasHeight: sanitizeCanvasHeight(undefined),
    updatedAt: serverTimestamp(),
  });
  batch.update(doc(db, 'users', uid, 'classes', classId), { noteCount: increment(1) });
  return { id: noteRef.id, saved: batch.commit() };
};

// Room page templates ("save this note's structure"). A map on the PROFILE doc, like
// `events` and `inbox` — NOT the `noteTemplates` collection, which classic's template
// picker lists: a page-shaped template there would create a broken canvas note.
export const saveRoomTemplate = (uid, { name, blocks }) => {
  const id =
    globalThis.crypto?.randomUUID?.() || `tpl-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const saved = updateDoc(doc(db, 'users', uid), {
    [`roomTemplates.${id}`]: {
      id,
      name: String(name || 'My template').trim().slice(0, 40) || 'My template',
      blocks: Array.isArray(blocks) ? blocks : [],
      createdAt: Date.now(),
    },
  });
  return { id, saved };
};

export const deleteRoomTemplate = (uid, id) =>
  updateDoc(doc(db, 'users', uid), { [`roomTemplates.${id}`]: deleteField() });

// Inbox lines leave the map when filed or let go; undo writes the same entry back. Neither
// is awaited by the room — both land in the local cache at once, online or not.
export const deleteInboxEntry = (uid, id) =>
  updateDoc(doc(db, 'users', uid), { [`inbox.${id}`]: deleteField() });

export const restoreInboxEntry = (uid, entry) =>
  updateDoc(doc(db, 'users', uid), {
    [`inbox.${entry.id}`]: {
      id: entry.id,
      text: String(entry.text || '').slice(0, 2000),
      createdAt: entry.createdAt || Date.now(),
    },
  });

// Room course details — all OPTIONAL and additive (dualmode.md §6.1). Classic never reads
// them, and a course without them is exactly the course it always was:
//   schedule   { days: [0-6], time: 'HH:MM' | '' }  weekly meetings; the room's calendar
//              derives its classes from this rather than storing dated events
//   room, professor   plain strings
// The room cleans the values before they get here (room/calendarDays.js).

// Starts a course WITHOUT waiting for the server, like createPageNote: the id is made on
// this device, so the desk shows it at once, online or not. Same fields createClass
// writes, plus any details given.
export const createCourse = (uid, { name, color, schedule, room, professor } = {}) => {
  const cleanedName = String(name || '').trim();
  const ref = doc(collection(db, 'users', uid, 'classes'));
  const payload = {
    name: cleanedName,
    color,
    code: cleanedName,
    noteCount: 0,
    order: Date.now(),
    createdAt: serverTimestamp(),
    // The room's own: classic's list leaves it out (see listenToClasses).
    design: ROOM_COURSE,
  };
  if (schedule) payload.schedule = schedule;
  if (room) payload.room = room;
  if (professor) payload.professor = professor;
  return { id: ref.id, saved: setDoc(ref, payload) };
};

// A course's name, colour and details in one write. An emptied detail is REMOVED rather
// than stored blank, so "empty means absent" holds in the data as well as on screen.
// Only the keys present in `changes` are touched.
export const updateCourse = (uid, courseId, changes = {}) => {
  const patch = {};
  const name = typeof changes.name === 'string' ? changes.name.trim() : '';
  if (name) {
    patch.name = name;
    patch.code = name;
  }
  if (changes.color) patch.color = changes.color;
  ['schedule', 'room', 'professor'].forEach((key) => {
    if (key in changes) patch[key] = changes[key] || deleteField();
  });
  return updateDoc(doc(db, 'users', uid, 'classes', courseId), patch);
};

export const createNoteTemplate = async (uid, payload = {}) => {
  const name = (payload.name || 'Custom template').trim() || 'Custom template';
  const blocks = Array.isArray(payload.blocks) ? payload.blocks : [];
  const canvasHeight = Number.isFinite(payload.canvasHeight) ? payload.canvasHeight : 720;
  const ref = await addDoc(collection(db, 'users', uid, 'noteTemplates'), {
    name,
    blocks,
    canvasHeight,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
};

export const deleteNoteTemplate = async (uid, templateId) => {
  if (!uid || !templateId) return;
  await deleteDoc(doc(db, 'users', uid, 'noteTemplates', templateId));
};
