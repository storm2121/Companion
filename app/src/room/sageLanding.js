import { diffBlocks, snapshotOf } from './pageBlocks.js';

// Where a Sage answer goes when it arrives (run room2).
//
// A run takes seconds, and the student may have left the note by the time it answers. The
// note page is keyed by its path, so leaving unmounts it: the old code then handed the answer
// to a page that was gone (nothing was saved) and still banked a "before Sage" copy and marked
// the note as having two versions. The run was charged and the note showed "Before Sage /
// After Sage" over two identical pages.
//
//  - 'page'    the note is still on screen: the editor takes it, as it always did.
//  - 'library' the note was left and is not open: the answer is written straight to the note
//              (library.js `saveSageAnswer`, one batch with the "before" copy and the marks).
//  - 'nowhere' the note was left and has been opened AGAIN. A fresh editor is on it, with its
//              own idea of what is saved; writing underneath it would mix two pages. Nothing is
//              banked, nothing is marked, and one line says so.

const open = new Map();

export const notePageKey = (courseId, noteId) => `${courseId}/${noteId}`;

// Called by the note page while it is mounted; returns the function that takes it back.
export const noteOpened = (key) => {
  open.set(key, (open.get(key) || 0) + 1);
  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    const left = (open.get(key) || 1) - 1;
    if (left > 0) open.set(key, left);
    else open.delete(key);
  };
};

export const isNoteOpen = (key) => open.has(key);

export const sageLanding = ({ alive, reopened }) => {
  if (alive) return 'page';
  return reopened ? 'nowhere' : 'library';
};

// What to write for an answer that lands in the library: `last` is the page as it was when
// the note was left (the unmount flush has already handed exactly that to Firestore), `next`
// the page with Sage's answer applied to it.
export const sageLandingDelta = (last, next) => {
  const { changedBlocks, removedBlockIds, order, changed } = diffBlocks(
    next,
    snapshotOf(last),
    last.map((block) => block.id),
  );
  return { changedBlocks, removedBlockIds, order, changed };
};
