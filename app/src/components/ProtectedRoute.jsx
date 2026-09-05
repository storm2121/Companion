import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/authState';
import ScreenLoader from './ui/ScreenLoader';

const ProtectedRoute = ({ children, requireProfile = false }) => {
  const { firebaseUser, profile, profileReady, loading, emailVerified } = useAuth();
  const location = useLocation();
  // Where the person was actually trying to go. Before the landing page existed, a
  // logged-out visitor was dropped at "/" and lost their destination; now "/" is a
  // marketing page, so losing it would mean clicking your own dashboard bookmark and
  // arriving at a sales pitch.
  const next = encodeURIComponent(`${location.pathname}${location.search}`);

  if (loading) {
    return <ScreenLoader note="Checking secure session..." />;
  }

  if (!firebaseUser) {
    return <Navigate to={`/login?next=${next}`} replace />;
  }

  // Unverified accounts are sent back to the hub, which owns the "confirm your address"
  // card and the resend controls.
  if (!emailVerified) {
    return <Navigate to={`/login?next=${next}`} replace />;
  }

  // At this point `loading` is already false, so a null profile means the profile
  // fetch failed (network/permissions) — show a recoverable state, not a perpetual loader.
  if (requireProfile && !profile) {
    return (
      <div className="gate-shell">
        <div className="gate-card centered screen-loader">
          <p className="screen-loader-text">We couldn&apos;t load your profile.</p>
          <p className="status-text">This can happen on a flaky connection or right after signing in.</p>
          <button type="button" className="primary-btn" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }

  if (requireProfile && !profileReady) {
    return <Navigate to="/setup" replace />;
  }

  return children;
};

export default ProtectedRoute;
