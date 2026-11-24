import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/authState';
import { createPageNote, deleteNotes, moveRoomNotes } from '../services/library';
import { startingBlocks } from './pageBlocks';
import { courseMeta } from './calendarDays';
import { sortCourseNotes, useRoomDesk } from './roomData';
import { markGone, offerUndo, sayInRoom, unmarkGone } from './roomUndo';
import { usePageActions } from './roomCommands';

// A course's page, whatever draws it (round eight, run 3): today's sheets (RoomCourse) or the opened book
// on the desk (CourseBook). Everything the page can do lives here once — its notes in their order, New
// note and the N key, Edit, Files, Select with Move and Delete (each reported on the room's undo line),
// opening a note, Escape, and what Ctrl K offers — and both views only draw it. (Moved here unchanged from
// RoomCourse.jsx; the book adds only `onEscape`, what Escape does when there is nothing to put down.)
//
// Order is pinned first, then newest first. No sort control, no filter row, no search within the course,
// no stats — the design deletes all of those on purpose.
//
// Selecting (full parity, dualmode.md §4.2): a `Select` action, a mark on each note that selects it on a
// click, and Shift- or ⌘/Ctrl-click and a touch long-press as shortcuts. The actions are one line:
// `3 SELECTED · MOVE · DELETE`.
//
// Deletes and moves report on the room's one undo line (roomUndo.js), so an undo outlives the page —
// leaving inside the window no longer cuts it short.

const HOLD_MS = 480;

// Typing somewhere should never be interrupted by a single-letter shortcut.
export const isTyping = (target) => Boolean(target?.closest?.('input, textarea, select, [contenteditable="true"]'));

// The room decorates notes with where they live (`classId`, `className`). Those are
// NEVER stored. The room's move (`moveRoomNotes`) uses only the ids and moves what the server
// holds, but they still come off here, so nothing handed to the library carries them.
const storedFields = (note) => {
  const stored = { ...note };
  delete stored.classId;
  delete stored.className;
  return stored;
};

export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// `preview`: mounted under the desk by a press on the book, before its click (nothing of it answers keys
// or Ctrl K until it is shown). `onEscape`: Escape with nothing selected and no sheet open (the book closes).
export const useCoursePage = (courseId, { preview = false, onEscape = null } = {}) => {
  const previewNow = useRef(preview);
  useEffect(() => {
    previewNow.current = preview;
  });
  const navigate = useNavigate();
  const { firebaseUser, profile } = useAuth();
  // Notes waiting out a delete's undo window are already left out by useRoomDesk.
  const { courses, notes, loading, trouble, retry } = useRoomDesk();

  const [selected, setSelected] = useState(() => new Set());
  // Entered from the Select pill, before anything is picked.
  const [selecting, setSelecting] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const hold = useRef({ timer: null, fired: false, x: 0, y: 0 });

  const course = courses.find((item) => item.id === courseId);
  const own = sortCourseNotes(notes.filter((note) => note.classId === courseId));
  const others = courses.filter((item) => item.id !== courseId);
  const selectMode = selecting || selected.size > 0;

  /* ── New note ─────────────────────────────────────────────────────────── */

  // Opens at once, online or not: the id is made on this device and the note is in the
  // local cache before the server has heard of it. (`createPageNote` always stamps
  // format:'page', which is what keeps it out of classic's lists — dualmode.md §2.)
  const newNote = useCallback(() => {
    if (!firebaseUser) return;
    const { id, saved } = createPageNote(firebaseUser.uid, courseId, {
      title: 'Untitled',
      blocks: startingBlocks(),
    });
    saved.catch((err) => console.error('The server refused that note', err));
    navigate(`/room/note/${courseId}/${id}`);
  }, [firebaseUser, courseId, navigate]);

  const openNote = (note) => navigate(`/room/note/${courseId}/${note.id}`);

  /* ── Selection ────────────────────────────────────────────────────────── */

  const toggle = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const clearSelection = () => {
    setSelected(new Set());
    setSelecting(false);
    setMoveOpen(false);
  };

  const openOrSelect = (note) => (event) => {
    // A long press already selected it; the click that follows is not an "open".
    if (hold.current.fired) {
      hold.current.fired = false;
      return;
    }
    const onMark = Boolean(event.target.closest?.('.room-select-mark'));
    if (onMark || selectMode || event.shiftKey || event.metaKey || event.ctrlKey) {
      toggle(note.id);
      return;
    }
    openNote(note);
  };

  // Touch has no shift key: press and hold selects. Mouse and pen use modifier clicks.
  const holdStart = (note) => (event) => {
    if (event.pointerType !== 'touch') return;
    clearTimeout(hold.current.timer);
    hold.current.fired = false;
    hold.current.x = event.clientX;
    hold.current.y = event.clientY;
    hold.current.timer = setTimeout(() => {
      hold.current.fired = true;
      toggle(note.id);
      navigator.vibrate?.(10);
    }, HOLD_MS);
  };
  const holdMove = (event) => {
    if (Math.hypot(event.clientX - hold.current.x, event.clientY - hold.current.y) > 10) {
      clearTimeout(hold.current.timer);
    }
  };
  const holdEnd = () => clearTimeout(hold.current.timer);
  // A long press on touch would otherwise also open the browser's own menu.
  const holdMenu = (event) => {
    if (hold.current.fired) event.preventDefault();
  };

  /* ── Delete, with undo ────────────────────────────────────────────────── */

  // The cascade is server-side and irreversible, so it is not SENT until the undo window
  // has passed: until then the notes are only hidden, and "undo" means "it never happened".
  // Once sent they stay hidden (`markGone`) until the live list drops them — un-hiding them
  // as the request left made them flicker back for the second the server took.
  const removeSelected = () => {
    const ids = [...selected];
    if (!ids.length || !firebaseUser) return;
    if (!navigator.onLine) {
      sayInRoom('Deleting needs a connection');
      return;
    }
    const uid = firebaseUser.uid;
    const from = courseId;
    clearSelection();
    offerUndo({
      message: `${plural(ids.length, 'note')} deleted`,
      hides: ids,
      undo: () => {},
      commit: () => {
        markGone(ids);
        deleteNotes(uid, from, ids).catch((err) => {
          console.error('Could not delete those notes', err);
          // Nothing was deleted, so the live list still has them: un-hiding brings them back.
          unmarkGone(ids);
          sayInRoom('Those notes could not be deleted');
        });
      },
    });
  };

  /* ── Move, with undo ──────────────────────────────────────────────────── */

  // Through library.js `moveRoomNotes`, which moves what the SERVER holds — every content
  // doc of each note — and refuses when it cannot read them (offline, or no answer). Classic's
  // `moveNotes` copied this device's cached page, which could be an old one, and then deleted
  // the newer source. So "moved" is said only once it has happened, and a refusal says why.
  const moveSelected = (target) => {
    if (!firebaseUser) return;
    const moving = own.filter((note) => selected.has(note.id)).map(storedFields);
    if (!moving.length) return;
    const uid = firebaseUser.uid;
    const from = courseId;
    clearSelection();
    moveRoomNotes(uid, from, target.id, moving)
      .then(({ moved }) => {
        if (!moved) {
          sayInRoom('Those notes are no longer there to move');
          return;
        }
        offerUndo({
          message: `${plural(moved, 'note')} moved to ${target.name}`,
          undo: () =>
            moveRoomNotes(uid, target.id, from, moving).catch((err) => {
              console.error('Could not move them back', err);
              sayInRoom('They could not be moved back');
            }),
        });
      })
      .catch((err) => {
        console.error('Could not move those notes', err);
        sayInRoom(
          err?.code === 'move/unreadable'
            ? 'Notes can only be moved with a connection — nothing was moved'
            : 'Those notes could not be moved',
        );
      });
  };

  /* ── Keys ─────────────────────────────────────────────────────────────── */

  // What Escape does with nothing to put down, the newest (the book's: close).
  const escapeNow = useRef(onEscape);
  const openNow = useRef(false);
  useEffect(() => {
    escapeNow.current = onEscape;
    openNow.current = selectMode || moveOpen || sheetOpen || filesOpen;
  });
  useEffect(() => {
    const onKey = (event) => {
      if (previewNow.current || isTyping(event.target)) return;
      if (event.key === 'Escape') {
        const busy = openNow.current;
        setSelected(new Set());
        setSelecting(false);
        setMoveOpen(false);
        if (!busy && escapeNow.current && !event.defaultPrevented) escapeNow.current();
        return;
      }
      // The tile says "Or press N" — this is what makes that true.
      const plainN = (event.key === 'n' || event.key === 'N') && !event.metaKey && !event.ctrlKey && !event.altKey;
      if (plainN) {
        event.preventDefault();
        newNote();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [newNote]);

  // What ⌘K offers here. "new-note" replaces the room-wide "New note in …" of the same id.
  usePageActions(() =>
    course && !previewNow.current
      ? [
          { id: 'new-note', label: 'New note here', hint: course.name, keywords: ['create', 'add', 'write'], run: newNote },
          {
            id: 'course-edit',
            label: 'Edit this course',
            keywords: ['rename', 'colour', 'color', 'schedule', 'time', 'room', 'professor', 'details'],
            run: () => setSheetOpen(true),
          },
          ...(own.length
            ? [
                { id: 'course-files', label: "See this course's photos", keywords: ['files', 'images', 'pictures'], run: () => setFilesOpen(true) },
                { id: 'course-select', label: 'Select notes', keywords: ['move', 'delete', 'many'], run: () => setSelecting(true) },
              ]
            : []),
        ]
      : [],
  );

  const meta = [course ? courseMeta(course, { professor: true }) : '', own.length ? plural(own.length, 'note') : '']
    .filter(Boolean)
    .join(' · ');

  return {
    courseId,
    course,
    courses,
    own,
    others,
    loading,
    trouble,
    retry,
    profile,
    meta,
    newNote,
    openNote,
    selected,
    selectMode,
    toggle,
    startSelecting: () => setSelecting(true),
    clearSelection,
    openOrSelect,
    holdStart,
    holdMove,
    holdEnd,
    holdMenu,
    removeSelected,
    moveSelected,
    moveOpen,
    setMoveOpen,
    sheetOpen,
    setSheetOpen,
    filesOpen,
    setFilesOpen,
  };
};
