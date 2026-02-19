import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocFromCache,
  getDocs,
  increment,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';

const NOTE_CONTENT_DOC_ID = 'main';
const DEFAULT_CANVAS_HEIGHT = 720;
const getNoteRef = (uid, classId, noteId) => doc(db, 'users', uid, 'classes', classId, 'notes', noteId);
const getNoteContentRef = (uid, classId, noteId) =>
  doc(db, 'users', uid, 'classes', classId, 'notes', noteId, 'content', NOTE_CONTENT_DOC_ID);

const sanitizeBlocks = (blocks) => (Array.isArray(blocks) ? blocks : []);
const sanitizeCanvasHeight = (value) => (Number.isFinite(value) ? value : DEFAULT_CANVAS_HEIGHT);

const normalizeMergedNote = (meta = {}, content = {}) => {
  const { blocks: legacyBlocks, canvasHeight: legacyCanvasHeight, ...metaFields } = meta || {};
  const blocks = sanitizeBlocks(content?.blocks ?? legacyBlocks);
  const canvasHeight = sanitizeCanvasHeight(content?.canvasHeight ?? legacyCanvasHeight);
  return {
    ...metaFields,
    blocks,
    canvasHeight,
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

export const listenToClasses = (uid, onData, onError) => {
  const q = query(collection(db, 'users', uid, 'classes'), orderBy('order', 'asc'));
  return onSnapshot(q, onData, onError);
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

export const reorderClasses = async (uid, orderedClasses) => {
  const batch = writeBatch(db);
  orderedClasses.forEach((item, index) => {
    batch.update(doc(db, 'users', uid, 'classes', item.id), { order: index });
  });
  await batch.commit();
};

export const deleteClass = async (uid, classId) => {
  const notesRef = collection(db, 'users', uid, 'classes', classId, 'notes');
  const notesSnap = await getDocs(notesRef);
  const batch = writeBatch(db);
  notesSnap.forEach((docSnap) => {
    batch.delete(docSnap.ref);
    batch.delete(getNoteContentRef(uid, classId, docSnap.id));
  });
  batch.delete(doc(db, 'users', uid, 'classes', classId));
  await batch.commit();
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
    order: Number.isFinite(payload.order) ? payload.order : Date.now(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    contentUpdatedAt: serverTimestamp(),
  };
  const contentPayload = {
    blocks: sanitizeBlocks(payload.blocks),
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
  const batch = writeBatch(db);
  batch.delete(getNoteRef(uid, classId, noteId));
  batch.delete(getNoteContentRef(uid, classId, noteId));
  batch.update(doc(db, 'users', uid, 'classes', classId), {
    noteCount: increment(-1),
  });
  await batch.commit();
};

export const deleteNotes = async (uid, classId, noteIds = []) => {
  if (!uid || !classId || !Array.isArray(noteIds) || !noteIds.length) return;
  const batch = writeBatch(db);
  noteIds.forEach((noteId) => {
    if (!noteId) return;
    batch.delete(getNoteRef(uid, classId, noteId));
    batch.delete(getNoteContentRef(uid, classId, noteId));
  });
  batch.update(doc(db, 'users', uid, 'classes', classId), {
    noteCount: increment(-noteIds.length),
  });
  await batch.commit();
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
    contentData = {
      blocks: sanitizeBlocks(meta.blocks),
      canvasHeight: sanitizeCanvasHeight(meta.canvasHeight),
      updatedAt: meta.updatedAt || serverTimestamp(),
    };
    try {
      const batch = writeBatch(db);
      batch.set(contentRef, {
        blocks: contentData.blocks,
        canvasHeight: contentData.canvasHeight,
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
    await updateNoteContent(
      uid,
      classId,
      noteId,
      {
        blocks: blocks !== undefined ? blocks : [],
        canvasHeight: canvasHeight !== undefined ? canvasHeight : DEFAULT_CANVAS_HEIGHT,
      },
      { touchMeta: true },
    );
  }
};

export const updateNoteContent = async (uid, classId, noteId, payload = {}, options = {}) => {
  const contentRef = getNoteContentRef(uid, classId, noteId);
  const noteRef = getNoteRef(uid, classId, noteId);
  const contentPayload = {};
  if (Object.prototype.hasOwnProperty.call(payload, 'blocks')) {
    contentPayload.blocks = sanitizeBlocks(payload.blocks);
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'canvasHeight')) {
    contentPayload.canvasHeight = sanitizeCanvasHeight(payload.canvasHeight);
  }
  if (!Object.keys(contentPayload).length) return;
  const touchMeta = options.touchMeta !== false;
  if (touchMeta) {
    const batch = writeBatch(db);
    batch.set(
      contentRef,
      {
        ...contentPayload,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
    batch.update(noteRef, {
      updatedAt: serverTimestamp(),
      contentUpdatedAt: serverTimestamp(),
    });
    await batch.commit();
  } else {
    await setDoc(
      contentRef,
      {
        ...contentPayload,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
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
  const batch = writeBatch(db);
  const count = notes.length;
  notes.forEach((note) => {
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
  });
  batch.update(doc(db, 'users', uid, 'classes', fromClassId), { noteCount: increment(-count) });
  batch.update(doc(db, 'users', uid, 'classes', toClassId), { noteCount: increment(count) });
  await batch.commit();
};

export const reorderNotes = async (uid, classId, orderedNotes) => {
  if (!uid || !classId || !Array.isArray(orderedNotes)) return;
  const batch = writeBatch(db);
  orderedNotes.forEach((note, index) => {
    if (!note?.id) return;
    batch.update(doc(db, 'users', uid, 'classes', classId, 'notes', note.id), { order: index });
  });
  await batch.commit();
};

export const listenToNoteTemplates = (uid, onData, onError) => {
  const q = query(collection(db, 'users', uid, 'noteTemplates'), orderBy('updatedAt', 'desc'));
  return onSnapshot(q, onData, onError);
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
