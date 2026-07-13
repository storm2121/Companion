import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { isSignInWithEmailLink } from 'firebase/auth';
import { auth } from '../firebase';
import { useAuth } from '../context/authState';
import { AUTH_EMAIL_STORAGE_KEY } from '../utils/offlineData';
import ScreenLoader from '../components/ui/ScreenLoader';

const AuthComplete = () => {
  const { completeEmailLinkSignIn, firebaseUser, profile } = useAuth();
  const [email, setEmail] = useState(localStorage.getItem(AUTH_EMAIL_STORAGE_KEY) || '');
  const [error, setError] = useState('');
  const [working, setWorking] = useState(true);
  const attemptedRef = useRef(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (attemptedRef.current) return;
    attemptedRef.current = true;
    const attempt = async () => {
      if (!isSignInWithEmailLink(auth, window.location.href)) {
        setError('Open the verification link from your email to continue.');
        setWorking(false);
        return;
      }
      try {
        await completeEmailLinkSignIn(email || undefined);
      } catch (err) {
        setError(err.message);
      } finally {
        setWorking(false);
      }
    };
    attempt();
  }, [completeEmailLinkSignIn, email]);

  useEffect(() => {
    if (!firebaseUser) return;
    if (profile?.profileComplete) {
      navigate('/dashboard', { replace: true });
    } else {
      navigate('/setup', { replace: true });
    }
  }, [firebaseUser, profile, navigate]);

  const handleConfirm = async () => {
    setWorking(true);
    setError('');
    try {
      await completeEmailLinkSignIn(email);
    } catch (err) {
      setError(err.message);
      setWorking(false);
    }
  };

  if (working) {
    return <ScreenLoader note="Verifying your link..." />;
  }

  return (
    <div className="gate-shell">
      <div className="gate-card">
        <h2>Confirm your email</h2>
        <p className="status-text">Open the email link first, then confirm the same address here.</p>
        <input
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setError('');
          }}
          placeholder="you@aui.ma"
        />
        <button className="primary-btn" onClick={handleConfirm}>
          Finish Sign-in
        </button>
        {error && <p className="status-text">{error}</p>}
      </div>
    </div>
  );
};

export default AuthComplete;
