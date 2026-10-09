import { useEffect, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/authState';
import PublicLoader from './PublicLoader';
import { authDestination, authHref, clearAuthDestination, rememberAuthDestination } from './authNavigation';

const authError = (error, registering) => {
  const messages = {
    'auth/email-already-in-use': 'There is already an account with this email. Log in instead.',
    'auth/invalid-credential': 'The email or password did not match. Try again.',
    'auth/user-not-found': 'The email or password did not match. Try again.',
    'auth/wrong-password': 'The email or password did not match. Try again.',
    'auth/invalid-email': 'Check the email address and try again.',
    'auth/weak-password': 'Use a password with at least eight characters.',
    'auth/too-many-requests': 'There have been too many attempts. Give it a moment, then try again.',
    'auth/network-request-failed': 'The connection dropped. Try again when you are back online.',
    'auth/user-disabled': 'This account is unavailable. Please contact the person who manages Companion.',
  };
  if (messages[error?.code]) return messages[error.code];
  if (error?.message?.includes('email addresses are permitted')) {
    return registering ? 'Use an eligible email address to register.' : 'Use the email address associated with your Companion account.';
  }
  return 'That did not go through. Please try again.';
};

const AuthPage = ({ registering = false }) => {
  const {
    firebaseUser, emailVerified, profile, profileReady, loading,
    registerWithPassword, loginWithPassword, sendLoginLink,
    resendVerification, refreshVerification, logout,
  } = useAuth();
  const [params] = useSearchParams();
  const next = authDestination(params.get('next'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [linkMode, setLinkMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const eligible = /^[A-Z0-9._%+-]+@aui\.ma$/i.test(email.trim());

  useEffect(() => {
    if (!loading && firebaseUser && emailVerified && profileReady) clearAuthDestination();
  }, [loading, firebaseUser, emailVerified, profileReady]);

  if (loading) return <PublicLoader />;
  if (firebaseUser && emailVerified) {
    return <Navigate to={profileReady ? next : profile ? authHref('/setup', next) : '/app'} replace />;
  }

  const run = async (action, message) => {
    setBusy(true);
    setFeedback(null);
    try {
      const result = await action();
      if (message) setFeedback({ kind: 'status', text: typeof message === 'function' ? message(result) : message });
    } catch (error) {
      setFeedback({ kind: 'alert', text: authError(error, registering) });
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    if (busy) return;
    if (registering && !eligible) {
      setFeedback({ kind: 'alert', text: 'Use an eligible email address to register.' });
      return;
    }
    rememberAuthDestination(next);
    const action = registering ? registerWithPassword : linkMode ? sendLoginLink : loginWithPassword;
    run(() => action(email.trim(), password), linkMode ? 'A login link is on its way. Check your inbox.' : null);
  };

  const feedbackLine = feedback && (
    <p className={`pub-feedback pub-feedback--${feedback.kind}`} role={feedback.kind}>
      {feedback.text}
    </p>
  );

  if (firebaseUser && !emailVerified) {
    return (
      <main className="pub-auth" id="main-content">
        <div className="pub-auth-intro">
          <span className="pub-kicker">Confirm your address</span>
          <h1>Check your inbox.</h1>
          <p>{registering ? <>We sent a confirmation link to <strong>{firebaseUser.email}</strong>.</> : 'We sent a confirmation link to your account’s email address.'} Open it, confirm your address, then come back here.</p>
        </div>
        <div className="pub-auth-sheet">
          <div className="pub-auth-actions">
            <button className="pub-button pub-button--solid" type="button" disabled={busy} onClick={() => run(refreshVerification, verified => verified ? 'Address confirmed.' : 'The address has not been confirmed yet. Open the link in your inbox first.')}>
              {busy ? 'Checking…' : 'I have confirmed my address'}
            </button>
            <button className="pub-text-button" type="button" disabled={busy} onClick={() => run(resendVerification, 'Another verification email is on its way.')}>
              Resend the email
            </button>
            <button className="pub-text-button" type="button" disabled={busy} onClick={() => run(logout)}>
              Use a different account
            </button>
          </div>
          {feedbackLine}
        </div>
      </main>
    );
  }

  return (
    <main className="pub-auth" id="main-content">
      <div className="pub-auth-intro">
        <span className="pub-kicker">Your account</span>
        <h1>{registering ? 'Create an account.' : 'Log in.'}</h1>
        <p>{registering ? 'We will email a link to confirm the address before you can open your notes.' : 'Use the email and password you registered with, or ask for a login link.'}</p>
      </div>
      <div className="pub-auth-sheet">
        <form className="pub-form" onSubmit={handleSubmit} aria-busy={busy}>
          <div className="pub-field">
            <label htmlFor="auth-email">Email address</label>
            <input id="auth-email" name="email" type="email" autoComplete="email" required value={email} readOnly={busy} aria-describedby={registering ? 'registration-domain' : undefined} onChange={event => { setEmail(event.target.value); setFeedback(null); }} />
          </div>
          {registering && <p className="pub-field-note" id="registration-domain">Registration is open to @aui.ma addresses.</p>}
          {!linkMode && (
            <div className="pub-field">
              <label htmlFor="auth-password">Password</label>
              <input id="auth-password" name="password" type="password" autoComplete={registering ? 'new-password' : 'current-password'} minLength={registering ? 8 : undefined} required value={password} readOnly={busy} aria-describedby={registering ? 'password-length' : undefined} onChange={event => { setPassword(event.target.value); setFeedback(null); }} />
              {registering && <p className="pub-field-note" id="password-length">At least 8 characters.</p>}
            </div>
          )}
          {linkMode && <p className="pub-field-note">We will email you a link to open your account.</p>}
          <button className="pub-button pub-button--solid pub-auth-submit" type="submit" disabled={busy}>
            {busy ? 'One moment…' : registering ? 'Register' : linkMode ? 'Send login link' : 'Log in'}
          </button>
          {feedbackLine}
        </form>
        {!registering && <button className="pub-text-button pub-auth-alternative" type="button" disabled={busy} onClick={() => { setLinkMode(!linkMode); setFeedback(null); }}>
          {linkMode ? 'Use a password instead' : 'Email me a login link instead'}
        </button>}
        <p className="pub-auth-switch">
          {registering ? 'Already have an account? ' : 'Need an account? '}
          <Link to={authHref(registering ? '/login' : '/register', next)}>{registering ? 'Log in' : 'Register'}</Link>
        </p>
        {!registering && <p className="pub-auth-bookmark">For next time, bookmark <code>/app</code> to open your notes directly.</p>}
      </div>
    </main>
  );
};

export default AuthPage;
