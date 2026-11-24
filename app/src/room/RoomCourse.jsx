import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/authState';
import RoomShell from './RoomShell';
import Paper from './components/Paper';
import { DataTrouble, Dot, Pill } from './components/primitives';
import { MenuCard } from './components/Overlay';
import CourseSheet from './components/CourseSheet';
import CourseFiles from './components/CourseFiles';
import SheetTags from './components/SheetTags';
import { noteStamp } from './roomData';
import { HOME_DESK, homeFor, resolveMood, tiltFor } from './roomPrefs';
import { MOD_KEY } from './platform';
import { useCourseFlight } from './deskFlightRun';
import { filmHome, getFilm } from './deskFilm';
import { filmPageGone, filmPageReady } from './deskFilmRun';
import { bookShows, getDeskBook, subscribeDeskBook } from './deskBook';
import { useCoursePage } from './useCoursePage';

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

// `courseId`: given by RoomLayout for the desk's book film (run 2), which mounts this page by its course;
// `preview`: mounted under the desk by a press on the book, before its click (nothing of it answers keys
// or Ctrl K until it is shown).
// Run 3: what the page does is useCoursePage's (shared with the opened book); on the desk's stage, once
// a book is registered (the harness's `?book=1` until the production pictures exist), the page is drawn
// as the held book (CourseBook, its own chunk); otherwise as today's sheets, below.
const CourseBook = lazy(() => import('./CourseBook'));
// The window's width, listened to only while a book is registered (nothing changes for the app without).
const noListen = () => () => {};
const listenWidth = (onChange) => {
  window.addEventListener('resize', onChange);
  return () => window.removeEventListener('resize', onChange);
};
const widthNow = () => (typeof window === 'undefined' ? 1440 : window.innerWidth);

const RoomCourse = ({ courseId: givenId = null, preview = false } = {}) => {
  // At /room/course/:courseId, or at classic's own /class/:classId when the room is the
  // chosen design — same course, same page.
  const { courseId: roomParam, classId } = useParams();
  const courseId = givenId || roomParam || classId;
  const navigate = useNavigate();
  const { profile } = useAuth();
  const registered = useSyncExternalStore(subscribeDeskBook, getDeskBook, getDeskBook);
  const width = useSyncExternalStore(registered ? listenWidth : noListen, widthNow, widthNow);
  const homeIsDesk = homeFor(profile?.roomPrefs) === HOME_DESK;
  const asBook = bookShows({ width, homeIsDesk }, registered);
  // Owner fixes (2026-11-23, A3): the book's address is real: reached without the desk (a reload on the book, its
  // link opened in a new tab), the book is registered from the table's own data (deskBookLoad.js, its chunk fetched
  // only then) and the course shows as the book, not as its older page. Until that is read the top line stands alone,
  // never one page and then the other; if it cannot be read, the older page, as with round seven's desk.
  const [bookFailed, setBookFailed] = useState(false);
  const awaitBook = !registered && !preview && !bookFailed && !getFilm() && bookShows({ width, homeIsDesk }, {});
  const prefsNow = useRef(profile?.roomPrefs);
  useEffect(() => {
    prefsNow.current = profile?.roomPrefs;
  });
  useEffect(() => {
    if (!awaitBook) return undefined;
    let alive = true;
    import('./deskBookLoad')
      .then((m) => m.loadDeskBook(prefsNow.current))
      .then(
        (ok) => alive && !ok && setBookFailed(true),
        () => alive && setBookFailed(true),
      );
    return () => {
      alive = false;
    };
  }, [awaitBook]);
  // (Owner fixes 2: while the book is being read, the room's own weather is kept away as under the book itself
  // (book.css html[data-desk-book]): the top line on the room's flat ground, never the night window and then the book.)
  const bookMood = resolveMood(profile?.roomPrefs?.mood) === 'day' ? 'day' : 'night';
  useLayoutEffect(() => {
    if (!awaitBook) return undefined;
    const root = document.documentElement;
    root.setAttribute('data-desk-book', bookMood);
    return () => root.removeAttribute('data-desk-book');
  }, [awaitBook, bookMood]);
  const page = useCoursePage(courseId, { preview, onEscape: asBook ? () => navigate(filmHome()) : null });
  const { course, own, others, loading, trouble, retry, selected, selectMode, meta, newNote } = page;
  const { setSheetOpen, setFilesOpen, sheetOpen, filesOpen, moveOpen, setMoveOpen, clearSelection, openOrSelect } = page;
  const { holdStart, holdMove, holdEnd, holdMenu, removeSelected, moveSelected, startSelecting } = page;

  // The desk's book flies in to this title, and home again on the way out (deskFlightRun.js).
  const titleRef = useRef(null);
  useCourseFlight(courseId, titleRef);
  // Opened by the desk's book (round eight, deskFilmRun.js): the film is its arrival, so nothing of
  // it rises on its own (the head and the sheets are there when the page turns into it), and it tells
  // the film it is on the page (the open page waits for that, never the other way round).
  const [filmed] = useState(() => preview || getFilm()?.courseId === String(courseId));
  useLayoutEffect(() => {
    filmPageReady(courseId);
    return () => filmPageGone(courseId);
  }, [courseId]);

  if (awaitBook) return <RoomShell back="Desk" onBack={() => navigate(filmHome())} ownTrouble />;
  // (The older page is what shows: RoomLayout's wait for a book is off.)
  if (!asBook && typeof document !== 'undefined') document.documentElement.removeAttribute('data-book-wait');
  if (asBook) {
    return (
      <Suspense fallback={null}>
        <CourseBook page={page} preview={preview} book={registered} courseId={courseId} />
      </Suspense>
    );
  }

  return (
    <RoomShell back="Desk" onBack={() => navigate('/room')} ownTrouble>
      <div className="room-course-head room-rise" data-filmed={filmed ? '' : undefined}>
        <div>
          <h1 ref={titleRef} className="room-course-title">
            <Dot size={18} color={course?.color} />
            {/* Not "gone" when the courses simply could not be read. */}
            {course?.name || (loading || trouble === 'courses' ? '' : 'That course is gone')}
          </h1>
          {trouble ? (
            <DataTrouble trouble={trouble} onRetry={retry} className="room-course-sub" />
          ) : (
            meta && <p className="room-course-sub">{meta}</p>
          )}
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
              onClick={() => (selectMode ? clearSelection() : startSelecting())}
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

      <div className={`room-note-grid${selectMode ? ' is-selecting' : ''}`} data-filmed={filmed ? '' : undefined}>
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
            // A long press on touch would otherwise also open the browser's own menu.
            onContextMenu={holdMenu}
          >
            {/* The design's checklist box, pinned to the sheet's corner: it appears on hover,
                stays in select mode, and a click on it selects instead of opening. */}
            <span className="room-select-mark" aria-hidden="true" title="Select">
              {selected.has(note.id) ? '✓' : ''}
            </span>
            <div className="room-course-top">
              <span className="room-stamp room-stamp--course" style={{ '--room-course': course?.color }}>
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
