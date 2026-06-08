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

  if (requireProfile && !profile) {
    return <ScreenLoader note="Loading profile..." />;
  }

  if (requireProfile && !profileReady) {
    return <Navigate to="/setup" replace />;
  }

  return children;
};

export default ProtectedRoute;
