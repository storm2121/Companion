import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import ScreenLoader from './ui/ScreenLoader';

const ProtectedRoute = ({ children, requireProfile = false }) => {
  const { firebaseUser, profile, profileReady, loading } = useAuth();

  if (loading) {
    return <ScreenLoader note="Checking secure session..." />;
  }

  if (!firebaseUser) {
    return <Navigate to="/" replace />;
  }

  // Email verification temporarily disabled.

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
