import { Component, lazy, startTransition, Suspense, useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { useLocation, useNavigate, useOutlet } from 'react-router-dom';
import { useAuth } from '../context/authState';
import { applyDesignMode, clearBoot, DESIGN_CLASSIC, DESIGN_ROOM } from '../designModes';
import { clearRoomAttributes, HOME_DESK, homeFor, MOTION_STILL, useRoomAtmosphere } from './roomPrefs';
import { useRoomPrefsWriter } from './roomPrefsWriter';
import { RoomCoursesContext, RoomNotesContext, useRoomDataSource } from './roomData';
import { settleNow, undoNow, useRoomUndo } from './roomUndo';
import RoomSearch from './RoomSearch';
import Atmosphere from './components/Atmosphere';
import DeskFlightLayer from './components/desk/DeskFlightLayer';
import { Pill } from './components/primitives';
import { HELD_WAIT_MS, HOME_PATHS, coursePath, filmShowsCourse, getFilm, getNoteKeep, getPreview, isNotePath, noteOfFilm, setNoteKeep, slotsFor, subscribeFilm, subscribeNoteKeep, subscribePreview } from './deskFilm';
import { bookShows, getDeskBook } from './deskBook';
import { filmLeft, filmWentHome, filmWentToCourse, leaveDeskForNote, returnToKeptDesk, setFilmNavigate, setWakeAllowed, subscribePainted } from './deskFilmRun';
import './room.css';

// The room's Home addresses (App.jsx: /room, and /dashboard in the room's design; deskFilm.js HOME_PATHS): their page
// is drawn in the Home slot, so the desk can be kept there, hidden, while a course it opened is shown.

// The course page the desk's book film opens, drawn here by its course (round eight, run 2) rather than
// as the address's own route element: a press on a book mounts it under the desk before the click, and
// the same element stays when the address moves to it, so the film never waits for it to mount. The same
// chunk as the route's (RoomLayout preloads it).
const FilmCourse = lazy(() => import('./RoomCourse'));

// The room itself: the flat ground, the weather, the <html> attributes that turn the
// room's tokens on, and the room's data. It is the PARENT route of every room page, so it
// stays mounted — listeners and all — while you move between them.
//
// data-design is owned by this route, not by the stored preference: set on mount, cleared
// on unmount. A user whose preference is 'room' can still open a classic URL and see
// classic exactly as it was (dualmode.md §1).

// Its own component, so the once-a-minute clock tick re-renders the weather and nothing
// else — not the page, and not an open editor.
const Weather = ({ stored }) => {
  const { mood, prefs } = useRoomAtmosphere(stored);
  return <Atmosphere mood={mood} scene={prefs.mood} grain={prefs.grain} still={prefs.motion === MOTION_STILL} />;
};

// Every room page's code, fetched while the connection is good, so the room keeps
// working if it drops: a page whose chunk was never downloaded cannot open offline.
// (Each path names the .jsx page itself — see contextweb §5 on case-only file names.)
// The editor is the heavy one (TipTap), so it is skipped when the browser says the user
// asked to save data, and nothing is fetched on a connection that is already gone.
const preloadRoom = () => {
  const connection = navigator.connection;
  if (!navigator.onLine) return;
  // Home's door (RoomHomeDoor.jsx, which holds the papers' RoomHome). Not the desk: that loads
  // only when chosen.
  import('./RoomHomeDoor');
  import('./RoomCourse');
  import('./RoomYou');
  import('./RoomInbox');
  import('./RoomCalendar');
  import('./RoomNotes');
  if (!connection?.saveData && !/(^|-)2g$/.test(connection?.effectiveType || '')) {
    import('./RoomNote');
  }
};

// A page that fails to load (usually: its code was never downloaded and the connection
// is gone) gets one calm line instead of a white screen. React.lazy remembers a failed
// import, so the only honest retry is a reload.
class RoomPageBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.error('A room page failed to load', error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="room-loading">
        <p className="room-gallery-note">
          {navigator.onLine
            ? 'This page did not load.'
            : 'This page is not on this device yet, and you are offline.'}
        </p>
        <Pill style={{ marginTop: 18 }} onClick={() => window.location.reload()}>
          Try again
        </Pill>
      </div>
    );
  }
}

// The room's one undo line (roomUndo.js). It belongs to the layout rather than a page so an
// undo can outlive the page that offered it — deleting a course lands you on the desk.
const RoomUndoLine = () => {
  const { entry } = useRoomUndo();
  if (!entry) return null;
  return (
    <div className="room-undo" role="status">
      {entry.message}
      {entry.action && (
        <button type="button" className="room-you-action" onClick={entry.action.run}>
          {entry.action.label}
        </button>
      )}
      {entry.undo && (
        <button type="button" className="room-you-action" onClick={undoNow}>
          Undo
        </button>
      )}
    </div>
  );
};

const RoomLayout = () => {
  const { firebaseUser, profile, updateRoomPrefs } = useAuth();
  const location = useLocation();
  const { pathname } = location;
  const navigate = useNavigate();
  const outlet = useOutlet();
  const { coursesValue, notes } = useRoomDataSource(firebaseUser?.uid);
  // The newest preference writer, for an Undo pressed seconds after its click (roomPrefsWriter.js).
  useRoomPrefsWriter(updateRoomPrefs);

  // The desk's book film (round eight, deskFilm.js / deskFilmRun.js). Every page is drawn in one of two
  // slots: Home's (the papers or the desk) and the others'. Without a film only one slot holds the
  // page at the address, as before. While a book opens, its course page is mounted under the desk
  // (hidden, inert) and the desk stays on the screen until the film covers it; while its course is open
  // the desk is KEPT (mounted, unseen and out of reach: desk.css skips its stage's contents; never
  // remounted, so the way back is at once); closing, the course page is HELD under the film until it
  // covers it. Each slot's page is the one last seen at its kind of address (kept by the address's key,
  // so a re-render keeps it). Home and the others are still one page at a time without a film.
  const film = useSyncExternalStore(subscribeFilm, getFilm, getFilm);
  // A pressed book's course, mounted ahead of its click: in a transition, so its render never holds up
  // the click itself.
  const [preview, setPreviewShown] = useState(getPreview);
  useEffect(() => subscribePreview(() => startTransition(() => setPreviewShown(getPreview()))), []);
  const atHome = HOME_PATHS.includes(pathname);
  // Run 3: with the course shown as the held book, its notes keep the desk (deskFilm.js slotsFor `keep`). Fix run 2:
  // so does every note opened from the desk itself (deskFilm.js noteKeep), and the way back holds the note until the
  // desk has been drawn again (`returning`).
  const noteKeep = useSyncExternalStore(subscribeNoteKeep, getNoteKeep, getNoteKeep);
  const keepDesk = Boolean((film?.phase === 'shown' && getDeskBook() && noteOfFilm(film, pathname)) || (!film && noteKeep?.phase === 'note' && isNotePath(pathname)));
  // (`atNote`: the note has been reached; before that, the press's own render at home holds nothing.)
  const slots = slotsFor(film, pathname, HOME_PATHS, preview, keepDesk, Boolean(!film && noteKeep?.atNote && atHome));
  const [homePage, setHomePage] = useState({ key: null, el: null });
  const [otherPage, setOtherPage] = useState({ key: null, el: null, path: '' });
  // Fix run 2: a note's own way to its course (the held book: the Back pill) holds the note on the screen until the
  // book's page has been drawn under it (CourseBook filmPagePainted): its ground colour is never seen.
  const [outgoing, setOutgoing] = useState(null);
  if (atHome && homePage.key !== location.key) setHomePage({ key: location.key, el: outlet });
  if (!atHome && otherPage.key !== location.key) {
    const course = /^\/room\/course\/([^/]+)$/.exec(pathname);
    if (course && otherPage.el && isNotePath(otherPage.path) && getDeskBook()) setOutgoing({ el: otherPage.el, key: otherPage.path, courseId: course[1] });
    else if (outgoing) setOutgoing(null);
    setOtherPage({ key: location.key, el: outlet, path: pathname });
  }
  const homeEl = !slots.home ? null : atHome ? outlet : homePage.el;
  // The film's course page (pressed, under, live, held): always the same FilmCourse element, keyed by its
  // course, so it is mounted once.
  const filmCourseId = film?.courseId || preview;
  const filmPage = Boolean(
    filmCourseId &&
      (slots.page === 'preview' || slots.page === 'under' || slots.page === 'held' || (slots.page === 'live' && film && pathname === coursePath(film.courseId))),
  );
  const pageEl = !slots.page ? null : filmPage ? <FilmCourse courseId={filmCourseId} preview={slots.page === 'preview'} /> : slots.page === 'held' ? otherPage.el : outlet;
  const pageKey = filmPage ? `course:${filmCourseId}` : slots.page === 'held' ? otherPage.path : pathname;
  // Owner fixes (2026-11-23, A2): whatever is kept under the page on the screen is INERT: out of reach of the pointer,
  // the keyboard and assistive technology. The desk while it is kept under a book or a note, and on its way back until
  // the film is over (its state gone); a page held while the desk comes back. (The desk was only unseen: woken at 0.4%
  // over the page by a press on Back, its books and switches took the presses meant for the book.)
  const homeInert = slots.home === 'kept' || film?.phase === 'closing';
  const pageInert = slots.pageInert || slots.page === 'held' || Boolean(outgoing);

  useEffect(() => {
    setFilmNavigate(navigate);
  }, [navigate]);
  // Owner fixes 2 (2026-11-23): a book's address reached WITHOUT the desk (a reload on the book, its link): until the
  // book has been drawn whole, the room's own weather (the night window) and the page's "Opening..." line are kept
  // away (room.css html[data-book-wait]): the room's flat ground and the top line stand, then the book. The older
  // course page lets it go itself (RoomCourse), a book that cannot come after HELD_WAIT_MS.
  const bookWait = !film && /^\/room\/course\/[^/]+$/.test(pathname) && homeFor(profile?.roomPrefs) === HOME_DESK && bookShows({ width: typeof window === 'undefined' ? 1440 : window.innerWidth, homeIsDesk: true }, {});
  const [bookIn, setBookIn] = useState('');
  useLayoutEffect(() => {
    if (!bookWait || bookIn === pathname) return undefined;
    const root = document.documentElement;
    root.setAttribute('data-book-wait', '');
    const off = subscribePainted((id) => pathname === coursePath(id) && setBookIn(pathname));
    const timer = setTimeout(() => setBookIn(pathname), HELD_WAIT_MS);
    return () => {
      off();
      clearTimeout(timer);
      root.removeAttribute('data-book-wait');
    };
  }, [bookWait, bookIn, pathname]);
  const outgoingCourse = outgoing?.courseId || '';
  // (While a note is held over the book, the note's own room stays drawn: book.css hides it only under the book.)
  useLayoutEffect(() => {
    if (!outgoingCourse) return undefined;
    document.documentElement.setAttribute('data-note-held', '');
    return () => document.documentElement.removeAttribute('data-note-held');
  }, [outgoingCourse]);
  useEffect(() => {
    if (!outgoingCourse) return undefined;
    const done = () => setOutgoing(null);
    const off = subscribePainted((id) => id === outgoingCourse && done());
    // (Owner fixes 2: the note stays until the book is WHOLE; it was let go after 2.5 s whatever the book had.)
    const timer = setTimeout(done, HELD_WAIT_MS);
    return () => {
      off();
      clearTimeout(timer);
    };
  }, [outgoingCourse]);
  // The address moved while a film's course was open or opening: home closes it (or turns it round),
  // its course again opens it, anywhere else lets the desk go. Before the commit is painted, so the
  // close's first frame is the one the address changed in.
  useLayoutEffect(() => {
    const state = getFilm();
    // (The kept desk is woken by a press on Back only from the book's own page.)
    setWakeAllowed(!isNotePath(pathname));
    // A note opened from the desk itself: home again brings the desk back in one frame; another note keeps it; any
    // other page lets it go.
    const kept = getNoteKeep();
    if (!state && kept) {
      if (HOME_PATHS.includes(pathname)) {
        if (kept.atNote && kept.phase !== 'returning') returnToKeptDesk();
      } else if (isNotePath(pathname)) {
        if (!kept.atNote) setNoteKeep({ ...kept, atNote: true });
        leaveDeskForNote();
      } else setNoteKeep(null);
      return;
    }
    if (!state) return;
    if (HOME_PATHS.includes(pathname)) filmWentHome();
    else if (filmShowsCourse(state, pathname)) filmWentToCourse();
    else if (state.phase === 'shown' && getDeskBook() && noteOfFilm(state, pathname)) return;
    else filmLeft();
    // (By the address's own key as well as its path, owner fixes: two moves that end on the same path, taken in one
    // render, are still a move: a book shown while the address is Home's closes, never stays as a page with no way out.)
  }, [pathname, location.key]);

  useEffect(() => {
    applyDesignMode(DESIGN_ROOM);
    // The room's own ground is painting now; the boot-time stand-in can go.
    clearBoot();
    return () => {
      applyDesignMode(DESIGN_CLASSIC);
      clearRoomAttributes();
    };
  }, []);

  // Leaving the room, or closing the tab, inside an undo window still means "do it".
  useEffect(() => {
    window.addEventListener('pagehide', settleNow);
    return () => {
      window.removeEventListener('pagehide', settleNow);
      settleNow();
    };
  }, []);

  useEffect(() => {
    const idle = window.requestIdleCallback || ((run) => window.setTimeout(run, 1500));
    const cancel = window.cancelIdleCallback || window.clearTimeout;
    const handle = idle(preloadRoom);
    return () => cancel(handle);
  }, []);

  return (
    <RoomCoursesContext.Provider value={coursesValue}>
      <RoomNotesContext.Provider value={notes}>
        <div className="room">
          <Weather stored={profile?.roomPrefs} />
          <div className="room-content">
            {/* Keyed by path, so moving to another page clears a failure. Both slots are display:
                contents (room.css): the page lays out exactly as without them. */}
            <div className="room-home-slot" data-kept={slots.home === 'kept' ? '' : undefined} inert={homeInert ? true : undefined}>
              {homeEl && (
                <RoomPageBoundary key="home">
                  <Suspense fallback={<p className="room-stamp room-loading">Opening…</p>}>{homeEl}</Suspense>
                </RoomPageBoundary>
              )}
            </div>
            {/* The note held while the book's page is drawn under it (fix run 2): first in the flow, as it was. Each
                page's slot is keyed by its page, so the held one and the new one each stay mounted as they are. */}
            {outgoing && (
              <div key={`page:${outgoing.key}`} className="room-page-slot" inert>
                <RoomPageBoundary key={outgoing.key}>
                  <Suspense fallback={null}>{outgoing.el}</Suspense>
                </RoomPageBoundary>
              </div>
            )}
            <div
              key={`page:${pageKey}`}
              className="room-page-slot"
              data-under={slots.page === 'under' || slots.page === 'preview' || outgoing ? '' : undefined}
              inert={pageInert ? true : undefined}
            >
              {pageEl && (
                <RoomPageBoundary key={pageKey}>
                  <Suspense fallback={<p className="room-stamp room-loading">Opening…</p>}>{pageEl}</Suspense>
                </RoomPageBoundary>
              )}
            </div>
          </div>
          <RoomSearch />
          <RoomUndoLine />
          <DeskFlightLayer />
        </div>
      </RoomNotesContext.Provider>
    </RoomCoursesContext.Provider>
  );
};

export default RoomLayout;
