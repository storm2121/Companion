import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/authState';

const AuthHub = () => {
  const {
    registerWithPassword,
    loginWithPassword,
    sendLoginLink,
    resendVerification,
    refreshVerification,
    firebaseUser,
    profileReady,
    loading,
    emailVerified,
    logout,
    statusMessage,
    setStatusMessage,
  } = useAuth();
  const [mode, setMode] = useState('register');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const navigate = useNavigate();

  const eligible = email.trim().toLowerCase().endsWith('@aui.ma');

  useEffect(() => {
    if (loading) return;
    // Unverified accounts stay here so the confirm-your-address card can render.
    if (firebaseUser && emailVerified) {
      navigate(profileReady ? '/dashboard' : '/setup', { replace: true });
    }
  }, [firebaseUser, emailVerified, profileReady, loading, navigate]);

  const resetFeedback = () => {
    setError('');
    setStatusMessage('');
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setWorking(true);
    resetFeedback();
    try {
      if (mode === 'register') {
        await registerWithPassword(email.trim(), password);
      } else if (mode === 'login') {
        await loginWithPassword(email.trim(), password);
      } else {
        await sendLoginLink(email.trim());
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setWorking(false);
    }
  };

  const handleVerificationAction = async (action) => {
    setWorking(true);
    resetFeedback();
    try {
      await action();
    } catch (err) {
      setError(err.message);
    } finally {
      setWorking(false);
    }
  };

  if (!loading && firebaseUser && !emailVerified) {
    return (
      <div className="gate-shell eligible">
        <div className="gate-card">
          <h1>Confirm your address</h1>
          <p className="status-text">
            We sent a link to <strong>{firebaseUser.email}</strong>. Open it, then come back
            and continue.
          </p>
          <button
            type="button"
            className="primary-btn"
            disabled={working}
            onClick={() => handleVerificationAction(refreshVerification)}
          >
            {working ? 'Working…' : "I've confirmed it"}
          </button>
          <button
            type="button"
            className="ghost-btn"
            disabled={working}
            onClick={() => handleVerificationAction(resendVerification)}
          >
            Resend the email
          </button>
          <button type="button" className="ghost-btn" disabled={working} onClick={logout}>
            Use a different account
          </button>
          {(error || statusMessage) && <p className="status-text">{error || statusMessage}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className={`gate-shell ${eligible ? 'eligible' : ''}`}>
      <div
        className="gate-card"
      >
        <h1>Companion</h1>
        <p className="status-text">Private vault access for verified AUI students.</p>
        <div className="tab-switch">
          <button className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>
            Register
          </button>
          <button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>
            Login
          </button>
          <button className={mode === 'link' ? 'active' : ''} onClick={() => setMode('link')}>
            Link
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <input
            type="email"
            placeholder="you@aui.ma"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              resetFeedback();
            }}
            autoComplete="email"
            required
          />
          {mode !== 'link' && (
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                resetFeedback();
              }}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              required
              minLength={8}
            />
          )}
          <button className="primary-btn" type="submit" disabled={working || !eligible}>
            {working ? 'Working…' : mode === 'register' ? 'Create Account' : mode === 'login' ? 'Sign In' : 'Send Link'}
          </button>
        </form>
        {(error || statusMessage) && <p className="status-text">{error || statusMessage}</p>}
      </div>
    </div>
  );
};

export default AuthHub;
