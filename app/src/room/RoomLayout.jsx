import { Component, Suspense, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/authState';
import { applyDesignMode, clearBoot, DESIGN_CLASSIC, DESIGN_ROOM } from '../designModes';
import { clearRoomAttributes, useRoomAtmosphere } from './roomPrefs';
import { RoomCoursesContext, RoomNotesContext, useRoomDataSource } from './roomData';
import { settleNow, undoNow, useRoomUndo } from './roomUndo';
import RoomSearch from './RoomSearch';
import Atmosphere from './components/Atmosphere';
import { Pill } from './components/primitives';
import './room.css';

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
  return <Atmosphere mood={mood} scene={prefs.mood} grain={prefs.grain} />;
};

// Every room page's code, fetched while the connection is good, so the room keeps
// working if it drops: a page whose chunk was never downloaded cannot open offline.
// (Each path names the .jsx page itself — see contextweb §5 on case-only file names.)
// The editor is the heavy one (TipTap), so it is skipped when the browser says the user
// asked to save data, and nothing is fetched on a connection that is already gone.
const preloadRoom = () => {
  const connection = navigator.connection;
  if (!navigator.onLine) return;
  import('./RoomHome');
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
  const { firebaseUser, profile } = useAuth();
  const { pathname } = useLocation();
  const { coursesValue, notes } = useRoomDataSource(firebaseUser?.uid);

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
            {/* Keyed by path, so moving to another page clears a failure. */}
            <RoomPageBoundary key={pathname}>
              <Suspense fallback={<p className="room-stamp room-loading">Opening…</p>}>
                <Outlet />
              </Suspense>
            </RoomPageBoundary>
          </div>
          <RoomSearch />
          <RoomUndoLine />
        </div>
      </RoomNotesContext.Provider>
    </RoomCoursesContext.Provider>
  );
};

export default RoomLayout;
