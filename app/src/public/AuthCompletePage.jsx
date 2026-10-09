import { useEffect, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { isSignInWithEmailLink } from 'firebase/auth';
import { auth } from '../firebase';
import { useAuth } from '../context/authState';
import { AUTH_EMAIL_STORAGE_KEY } from '../utils/offlineData';
import PublicLoader from './PublicLoader';
import { authHref, clearAuthDestination, readAuthDestination } from './authNavigation';

const savedEmail = () => {
  try { return localStorage.getItem(AUTH_EMAIL_STORAGE_KEY) || ''; } catch { return ''; }
};

const AuthCompletePage = () => {
  const { completeEmailLinkSignIn, firebaseUser, emailVerified, profile, profileReady, loading } = useAuth();
  const [email, setEmail] = useState(savedEmail);
  const [next] = useState(readAuthDestination);
  const [linkValid] = useState(() => isSignInWithEmailLink(auth, window.location.href));
  const [working, setWorking] = useState(() => linkValid && Boolean(email));
  const [error, setError] = useState('');
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;
    if (!linkValid || !email) return;
    completeEmailLinkSignIn(email)
      .catch(() => setError('This link could not be verified. Check the email address or request another link.'))
      .finally(() => setWorking(false));
  }, [completeEmailLinkSignIn, email, linkValid]);

  useEffect(() => {
    if (!working && !loading && firebaseUser && emailVerified && profileReady) clearAuthDestination();
  }, [working, loading, firebaseUser, emailVerified, profileReady]);

  if (working || loading) return <PublicLoader note="Checking your login link…" />;
  if (firebaseUser && emailVerified) {
    return <Navigate to={profileReady ? next : profile ? authHref('/setup', next) : '/app'} replace />;
  }

  const confirm = async (event) => {
    event.preventDefault();
    if (working) return;
    setWorking(true);
    setError('');
    try {
      await completeEmailLinkSignIn(email.trim());
    } catch {
      setError('This link could not be verified. Check the email address or request another link.');
    } finally {
      setWorking(false);
    }
  };

  return (
    <main className="pub-auth" id="main-content">
      <div className="pub-auth-intro">
        <span className="pub-kicker">Login link</span>
        <h1>{linkValid ? 'Confirm your email.' : 'Request a new link.'}</h1>
        <p>{linkValid ? 'Use the same address that received the login link.' : 'This login link is missing or has expired.'}</p>
      </div>
      <div className="pub-auth-sheet">
        {linkValid ? <form className="pub-form" onSubmit={confirm}>
          <div className="pub-field">
            <label htmlFor="link-email">Email address</label>
            <input id="link-email" type="email" autoComplete="email" required value={email} onChange={event => { setEmail(event.target.value); setError(''); }} />
          </div>
          <button type="submit" className="pub-button pub-button--solid">Finish login</button>
          {error && <p className="pub-feedback pub-feedback--alert" role="alert">{error}</p>}
        </form> : <Link className="pub-button pub-button--solid" to={authHref('/login', next)}>Back to login</Link>}
        {linkValid && <p className="pub-auth-switch"><Link to={authHref('/login', next)}>Back to login</Link></p>}
      </div>
    </main>
  );
};

export default AuthCompletePage;
