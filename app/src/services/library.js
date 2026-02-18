import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';

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
  notesSnap.forEach((docSnap) => batch.delete(docSnap.ref));
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
  const ref = await addDoc(collection(db, 'users', uid, 'classes', classId, 'notes'), {
    title: payload.title || 'Untitled Note',
    summary: payload.summary || '',
    coverUrl: payload.coverUrl || '',
    blocks: payload.blocks || [],
    canvasHeight: Number.isFinite(payload.canvasHeight) ? payload.canvasHeight : 720,
    tags: payload.tags || [],
    pinned: payload.pinned || false,
    templateId: payload.templateId || '',
    order: Number.isFinite(payload.order) ? payload.order : Date.now(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await updateDoc(doc(db, 'users', uid, 'classes', classId), {
    noteCount: increment(1),
  });
  return ref.id;
};

export const deleteNote = async (uid, classId, noteId) => {
  await deleteDoc(doc(db, 'users', uid, 'classes', classId, 'notes', noteId));
  await updateDoc(doc(db, 'users', uid, 'classes', classId), {
    noteCount: increment(-1),
  });
};

export const deleteNotes = async (uid, classId, noteIds = []) => {
  if (!uid || !classId || !Array.isArray(noteIds) || !noteIds.length) return;
  const batch = writeBatch(db);
  noteIds.forEach((noteId) => {
    if (!noteId) return;
    batch.delete(doc(db, 'users', uid, 'classes', classId, 'notes', noteId));
  });
  batch.update(doc(db, 'users', uid, 'classes', classId), {
    noteCount: increment(-noteIds.length),
  });
  await batch.commit();
};

export const getNote = async (uid, classId, noteId) => {
  const ref = doc(db, 'users', uid, 'classes', classId, 'notes', noteId);
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
};

export const updateNote = async (uid, classId, noteId, payload) => {
  const ref = doc(db, 'users', uid, 'classes', classId, 'notes', noteId);
  await updateDoc(ref, {
    ...payload,
    updatedAt: serverTimestamp(),
  });
};

export const moveNotes = async (uid, fromClassId, toClassId, notes = []) => {
  if (!uid || !fromClassId || !toClassId || fromClassId === toClassId) return;
  if (!Array.isArray(notes) || notes.length === 0) return;
  const batch = writeBatch(db);
  const count = notes.length;
  notes.forEach((note) => {
    const { id, ...data } = note;
    if (!id) return;
    const targetRef = doc(db, 'users', uid, 'classes', toClassId, 'notes', id);
    const sourceRef = doc(db, 'users', uid, 'classes', fromClassId, 'notes', id);
    batch.set(targetRef, { ...data, updatedAt: serverTimestamp() }, { merge: true });
    batch.delete(sourceRef);
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
