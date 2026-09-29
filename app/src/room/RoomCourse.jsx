import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/authState';
import { createPageNote, deleteNotes, moveNotes } from '../services/library';
import { startingBlocks } from './pageBlocks';
import RoomShell from './RoomShell';
import Paper from './components/Paper';
import { Dot, Pill } from './components/primitives';
import { MenuCard } from './components/Overlay';
import CourseSheet from './components/CourseSheet';
import CourseFiles from './components/CourseFiles';
import SheetTags from './components/SheetTags';
import { courseMeta } from './calendarDays';
import { noteStamp, sortCourseNotes, useRoomDesk } from './roomData';
import { tiltFor } from './roomPrefs';
import { markGone, offerUndo, sayInRoom, unmarkGone } from './roomUndo';
import { MOD_KEY } from './platform';
import { usePageActions } from './roomCommands';

// Course — design 6b. See a course's notes and start a new one.
//
// Order is pinned first, then newest first. No sort control, no filter row, no search
// within the course, no stats — the design deletes all of those on purpose.
//
// Selecting (full parity, dualmode.md §4.2). Visible first: a `Select` pill in the header,
// and a round mark on a sheet's corner when you hover it — the design's own checklist
// box — that selects it on a click. Shift- or ⌘/Ctrl-click and a touch long-press are the
// shortcuts, named in the tooltip. Selected sheets take the Today outline, and the
// actions are one line of text: `3 SELECTED · MOVE · DELETE`.
//
// Deletes and moves report on the room's one undo line (roomUndo.js), so an undo outlives
// the page — leaving inside the window no longer cuts it short.

const HOLD_MS = 480;

// Typing somewhere should never be interrupted by a single-letter shortcut.
const isTyping = (target) =>
  Boolean(target?.closest?.('input, textarea, select, [contenteditable="true"]'));

// The room decorates notes with where they live (`classId`, `className`). Those are
// NEVER stored — and `moveNotes` writes every field of what it is handed into the moved
// document, so they have to come off first or every move would bake them into Firestore.
const storedFields = (note) => {
  const stored = { ...note };
  delete stored.classId;
  delete stored.className;
  return stored;
};

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

const RoomCourse = () => {
  // At /room/course/:courseId, or at classic's own /class/:classId when the room is the
  // chosen design — same course, same page.
  const { courseId: roomParam, classId } = useParams();
  const courseId = roomParam || classId;
  const navigate = useNavigate();
  const { firebaseUser } = useAuth();
  // Notes waiting out a delete's undo window are already left out by useRoomDesk.
  const { courses, notes, loading } = useRoomDesk();

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
    navigate(`/room/note/${courseId}/${note.id}`);
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

  // Not awaited: the batch lands in the local cache at once and the live listeners
  // redraw both courses; the server gets it when it can.
  const moveSelected = (target) => {
    if (!firebaseUser) return;
    const moving = own.filter((note) => selected.has(note.id)).map(storedFields);
    if (!moving.length) return;
    const uid = firebaseUser.uid;
    const from = courseId;
    moveNotes(uid, from, target.id, moving).catch((err) => {
      console.error('Could not move those notes', err);
      sayInRoom(
        navigator.onLine
          ? 'Those notes could not be moved'
          : 'A note not yet opened on this device cannot move offline',
      );
    });
    clearSelection();
    offerUndo({
      message: `${plural(moving.length, 'note')} moved to ${target.name}`,
      undo: () =>
        moveNotes(uid, target.id, from, moving).catch((err) =>
          console.error('Could not move them back', err),
        ),
    });
  };

  /* ── Keys ─────────────────────────────────────────────────────────────── */

  useEffect(() => {
    const onKey = (event) => {
      if (isTyping(event.target)) return;
      if (event.key === 'Escape') {
        setSelected(new Set());
        setSelecting(false);
        setMoveOpen(false);
        return;
      }
      // The tile says "Or press N" — this is what makes that true.
      const plainN =
        (event.key === 'n' || event.key === 'N') && !event.metaKey && !event.ctrlKey && !event.altKey;
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
    course
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

  return (
    <RoomShell back="Desk" onBack={() => navigate('/room')}>
      <div className="room-course-head room-rise">
        <div>
          <h1 className="room-course-title">
            <Dot size={18} color={course?.color} />
            {course?.name || (loading ? '' : 'That course is gone')}
          </h1>
          {meta && <p className="room-course-sub">{meta}</p>}
        </div>
        <div className="room-seg">
          {course && (
            <Pill onClick={() => setSheetOpen(true)} title="Name, colour, when it meets, room, professor">
              Edit
            </Pill>
          )}
          {own.length > 0 && (
            <Pill onClick={() => setFilesOpen(true)} title="Every photo on this course's notes">
              Files
            </Pill>
          )}
          {own.length > 0 && (
            <Pill
              onClick={() => (selectMode ? clearSelection() : setSelecting(true))}
              aria-pressed={selectMode}
              title={selectMode ? undefined : `Or ${MOD_KEY}-click a note. On a phone, press and hold one.`}
            >
              {selectMode ? 'Done' : 'Select'}
            </Pill>
          )}
          <Pill variant="primary" onClick={newNote}>
            + New note
          </Pill>
        </div>
      </div>

      <div className={`room-note-grid${selectMode ? ' is-selecting' : ''}`}>
        <button
          type="button"
          className="room-new-note room-rise"
          style={{ animationDelay: '0.07s' }}
          onClick={newNote}
        >
          <span className="room-new-note-plus">+</span>
          <span className="room-new-note-label">New note</span>
          <span className="room-stamp">Or press N</span>
        </button>

        {own.map((note, i) => (
          <Paper
            key={note.id}
            tilt={tiltFor(i + 1)}
            stagger={i + 2}
            interactive
            className={selected.has(note.id) ? 'is-selected' : undefined}
            aria-pressed={selectMode ? selected.has(note.id) : undefined}
            onClick={openOrSelect(note)}
            onPointerDown={holdStart(note)}
            onPointerMove={holdMove}
            onPointerUp={holdEnd}
            onPointerCancel={holdEnd}
            onContextMenu={(event) => {
              // A long press on touch would otherwise also open the browser's own menu.
              if (hold.current.fired) event.preventDefault();
            }}
          >
            {/* The design's checklist box, pinned to the sheet's corner: it appears on hover,
                stays in select mode, and a click on it selects instead of opening. */}
            <span className="room-select-mark" aria-hidden="true" title="Select">
              {selected.has(note.id) ? '✓' : ''}
            </span>
            <div className="room-course-top">
              <span className="room-stamp" style={{ color: course?.color }}>
                {note.pinned ? 'Pinned' : note.kind || 'Note'}
              </span>
              <span className="room-stamp">{noteStamp(note)}</span>
            </div>
            <h3 className="room-course-name" style={{ fontSize: 22 }}>
              {note.title}
            </h3>
            {note.summary && <p className="room-course-meta">{note.summary}</p>}
            <SheetTags tags={note.tags} />
          </Paper>
        ))}
      </div>

      {/* One line of ground text. Sticky, so it stays in reach under a long grid. */}
      {selectMode && (
        <div className="room-bulk" role="toolbar" aria-label="Selected notes">
          <span className="room-stamp">
            {selected.size ? `${selected.size} selected` : 'Pick the notes to move or delete'}
          </span>
          {selected.size > 0 && others.length > 0 && (
            <span style={{ position: 'relative' }}>
              <button
                type="button"
                className="room-bulk-action"
                data-menu-trigger=""
                aria-expanded={moveOpen}
                onClick={() => setMoveOpen((open) => !open)}
              >
                Move
              </button>
              {moveOpen && (
                <MenuCard
                  onClose={() => setMoveOpen(false)}
                  style={{ position: 'absolute', bottom: 30, left: 0 }}
                  items={others.map((target) => ({
                    id: target.id,
                    label: target.name,
                    onSelect: () => moveSelected(target),
                  }))}
                />
              )}
            </span>
          )}
          {selected.size > 0 && (
            <button type="button" className="room-bulk-action" onClick={removeSelected}>
              Delete
            </button>
          )}
          <button type="button" className="room-bulk-action" onClick={clearSelection}>
            Cancel
          </button>
        </div>
      )}

      <CourseSheet open={sheetOpen && Boolean(course)} course={course} onClose={() => setSheetOpen(false)} />
      <CourseFiles open={filesOpen && Boolean(course)} course={course} notes={own} onClose={() => setFilesOpen(false)} />
    </RoomShell>
  );
};

export default RoomCourse;
