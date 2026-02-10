import { useAuth } from '../context/AuthContext';
import ScreenLoader from '../components/ui/ScreenLoader';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const VerifyGate = () => {
  const { firebaseUser, resendVerification, statusMessage, setStatusMessage } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (firebaseUser?.emailVerified) {
      navigate('/dashboard', { replace: true });
    }
  }, [firebaseUser, navigate]);

  if (!firebaseUser) {
    return <ScreenLoader note="Preparing session..." />;
  }

  return (
    <div className="verify-shell">
      <div className="verify-card">
        <h2>Verify Your Academic Identity</h2>
        <p>
          We sent a verification link to <strong>{firebaseUser.email}</strong>. Access to the Companion ecosystem is
          locked until you confirm.
        </p>
        <button className="btn-accent" onClick={resendVerification}>
          Resend verification link
        </button>
        {statusMessage && <p className="text-success">{statusMessage}</p>}
        <button className="btn-outline" onClick={() => setStatusMessage('')}>
          Refresh status
        </button>
      </div>
    </div>
  );
};

export default VerifyGate;
