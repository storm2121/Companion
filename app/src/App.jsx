import { Component, lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { useAuth } from './context/authState';
import { clearBoot, DESIGN_ROOM, designFor, rememberDesign } from './designModes';
import ProtectedRoute from './components/ProtectedRoute';
import ScreenLoader from './components/ui/ScreenLoader';
import PublicLoader from './public/PublicLoader';
import ProfileSetup from './pages/ProfileSetup';
import Dashboard from './pages/Dashboard';
import ClassNotes from './pages/ClassNotes';

// Code-split the heavy editor (TipTap + canvas) and the secondary pages out of the
// main bundle: the dashboard boots lighter and dashboard <-> calendar navigation
// never re-downloads anything after the first visit.
const NoteEditor = lazy(() => import('./pages/NoteEditor'));
const Settings = lazy(() => import('./pages/Settings'));
const Calendar = lazy(() => import('./pages/Calendar'));
const PublicLayout = lazy(() => import('./public/PublicLayout'));
const MarketingExperience = lazy(() => import('./public/MarketingExperience'));
const AuthPage = lazy(() => import('./public/AuthPage'));
const AuthCompletePage = lazy(() => import('./public/AuthCompletePage'));

// The room redesign is a separate, self-contained tree (see dualmode.md). Lazy so
// none of it — code or CSS — reaches a user who never switches designs.
// The room's parent route owns the ground and weather, so they persist between pages.
const RoomLayout = lazy(() => import('./room/RoomLayout'));
const RoomHome = lazy(() => import('./room/RoomHome'));
const RoomCourse = lazy(() => import('./room/RoomCourse'));
const RoomYou = lazy(() => import('./room/RoomYou'));
const RoomNote = lazy(() => import('./room/RoomNote'));
const RoomInbox = lazy(() => import('./room/RoomInbox'));
const RoomCalendar = lazy(() => import('./room/RoomCalendar'));
const RoomNotes = lazy(() => import('./room/RoomNotes'));

// The room's code arrives as lazy chunks. One that cannot load — the connection dropped
// before it was fetched, or a dev server still pointing at a file that has since moved —
// must not blank the whole app: without a boundary here React unmounts everything and the
// screen is simply empty. React.lazy remembers a failed import, so the honest retry is a
// reload. Styled inline: if the room failed to load, so did its stylesheet.
class RoomLoadBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.error('The room did not load', error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          padding: 24,
          background: '#1f2622',
          color: '#efe7d8',
          fontFamily: 'system-ui, sans-serif',
          textAlign: 'center',
        }}
      >
        <div>
          <p style={{ margin: 0, fontSize: 17 }}>
            {navigator.onLine
              ? 'The room did not load.'
              : 'The room is not on this device yet, and you are offline.'}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              marginTop: 18,
              height: 40,
              padding: '0 18px',
              border: '1.6px solid #efe7d8',
              borderRadius: '22px 18px 24px 16px',
              background: 'none',
              color: '#efe7d8',
              font: 'inherit',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }
}

// Every signed-in page sits under this one layout, and it decides the design for the
// address in the bar — at the root of the tree, never by redirecting. In the room it wraps
// the page in the room's layout (ground, weather, data); in classic it renders the page
// exactly as it always did. It stays mounted across navigation, so moving between room
// pages never tears the room down and re-opens its listeners.
const DesignLayout = () => {
  const { designMode } = useAuth();
  const { pathname } = useLocation();
  const design = designFor(pathname, designMode);

  // What this device should paint first next time (public/boot.js).
  useEffect(() => {
    rememberDesign(designMode);
  }, [designMode]);

  // Classic takes over here; the room clears the boot marks itself once its own ground is up.
  useEffect(() => {
    if (design !== DESIGN_ROOM) clearBoot();
  }, [design]);

  return design === DESIGN_ROOM ? (
    <RoomLoadBoundary>
      <RoomLayout />
    </RoomLoadBoundary>
  ) : (
    <Outlet />
  );
};

// The existing setup page keeps its own styling: a device that booted in the room's
// colours hands setup back its own.
const ClassicPage = ({ children }) => {
  useEffect(() => {
    clearBoot();
  }, []);
  return children;
};

// A page both designs have. Which one this address shows follows the preference.
const ByDesign = ({ classic, room }) => {
  const { designMode } = useAuth();
  const { pathname } = useLocation();
  return designFor(pathname, designMode) === DESIGN_ROOM ? room : classic;
};

const RouteLoader = () => {
  const { pathname } = useLocation();
  return /^\/(?:login|register|sage|desk(?:\/[^/]+)?|auth\/complete)?\/?$/.test(pathname)
    ? <PublicLoader note="Loading Companion…" />
    : <ScreenLoader note="Loading…" />;
};

const App = () => {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Suspense fallback={<RouteLoader />}>
        <Routes>
          <Route element={<PublicLayout />}>
            {/* One parent stays mounted across the home and the note pages, so transitions,
                reading positions and return focus carry from one to the other. */}
            <Route element={<MarketingExperience />}>
              <Route path="/" element={<></>} />
              <Route path="/desk" element={<></>} />
              <Route path="/desk/:view" element={<></>} />
              <Route path="/sage" element={<></>} />
            </Route>
            <Route path="/login" element={<AuthPage key="login" />} />
            <Route path="/register" element={<AuthPage key="register" registering />} />
            <Route path="/auth/complete" element={<AuthCompletePage />} />
          </Route>
          {/* A stable bookmark for returning people. The real auth/profile guard
              checks the session, then the dashboard keeps the chosen design. */}
          <Route path="/app" element={<ProtectedRoute requireProfile><Navigate to="/dashboard" replace /></ProtectedRoute>} />
          <Route
            path="/setup"
            element={
              <ProtectedRoute>
                <ClassicPage>
                  <ProfileSetup />
                </ClassicPage>
              </ProtectedRoute>
            }
          />
          {/* Everything signed-in. The layout picks classic or room for each address. */}
          <Route
            element={
              <ProtectedRoute requireProfile>
                <DesignLayout />
              </ProtectedRoute>
            }
          >
            {/* Pages both designs have: same address, the design you picked. */}
            <Route path="/dashboard" element={<ByDesign classic={<Dashboard />} room={<RoomHome />} />} />
            <Route path="/settings" element={<ByDesign classic={<Settings />} room={<RoomYou />} />} />
            <Route
              path="/class/:classId"
              element={<ByDesign classic={<ClassNotes />} room={<RoomCourse />} />}
            />
            <Route path="/calendar" element={<ByDesign classic={<Calendar />} room={<RoomCalendar />} />} />

            {/* Classic only: a canvas note and the template builder are things only the
                canvas editor can show. */}
            <Route path="/class/:classId/note/:noteId" element={<NoteEditor />} />
            <Route path="/template/new" element={<NoteEditor />} />

            {/* Room only. */}
            <Route path="/room" element={<RoomHome />} />
            <Route path="/room/course/:courseId" element={<RoomCourse />} />
            <Route path="/room/you" element={<RoomYou />} />
            <Route path="/room/note/:courseId/:noteId" element={<RoomNote />} />
            <Route path="/room/inbox" element={<RoomInbox />} />
            <Route path="/room/calendar" element={<RoomCalendar />} />
            <Route path="/room/notes" element={<RoomNotes />} />
            {/* Anything else under /room lands on the desk rather than bouncing to login. */}
            <Route path="/room/*" element={<Navigate to="/room" replace />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
  );
};

export default App;
