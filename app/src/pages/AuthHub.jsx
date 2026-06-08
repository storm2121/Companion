import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const AuthHub = () => {
  const {
    registerWithPassword,
    loginWithPassword,
    sendLoginLink,
    firebaseUser,
    profile,
    profileReady,
    loading,
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
    // Email verification temporarily disabled.
    if (firebaseUser) {
      navigate(profileReady ? '/dashboard' : '/setup', { replace: true });
    }
  }, [firebaseUser, profileReady, loading, navigate]);

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

  return (
    <div className={`gate-shell ${eligible ? 'eligible' : ''}`}>
      <motion.div
        className="gate-card"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeInOut' }}
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
      </motion.div>
    </div>
  );
};

export default AuthHub;
