import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/authState';
import { clearBoot } from '../designModes';
import { authHref } from './authNavigation';
import PublicLoader from './PublicLoader';
import { MOOD_NAMES, readMood, subscribeMood } from './windowMood';
import './public.css';

// Every public page: the top line (a material bar that content scrolls under — its shadow shows
// only once something is under it), the page, and on the home a footer on the ground. On the home
// the top line also says which room the window is in and the time, as the app's own top line does
// (windowMood.js).

const ACCOUNT_PAGES = ['/login', '/register'];
const MOTION_QUERY = '(prefers-reduced-motion: reduce)';
const subscribeMotion = (listener) => {
  const query = window.matchMedia(MOTION_QUERY);
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
};
const readReducedMotion = () => window.matchMedia(MOTION_QUERY).matches;
const skipToMain = (event) => {
  const main = document.getElementById('main-content');
  if (!main) return;
  event.preventDefault();
  if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
  main.focus();
};
// iOS only shows :active (the press) when a touch listener exists on the page.
const noop = () => {};

const RoomStatus = () => {
  const { mood, clock } = useSyncExternalStore(subscribeMood, readMood, readMood);
  return (
    <p className="pub-status" data-mood={mood}>
      <span className="pub-status-dot" aria-hidden="true" />
      <span className="pub-hidden">The room in the window: </span>
      <span className="pub-tabular">
        {MOOD_NAMES[mood]} · {clock}
      </span>
    </p>
  );
};

const PublicLayout = () => {
  const { loading } = useAuth();
  const { pathname, search } = useLocation();
  const marketing = pathname === '/' || pathname === '/sage' || pathname === '/desk' || pathname.startsWith('/desk/');
  const [still, setStill] = useState(false);
  const reducedMotion = useSyncExternalStore(subscribeMotion, readReducedMotion, () => false);
  const motionOff = still || reducedMotion;
  const edgeRef = useRef(null);
  const [under, setUnder] = useState(false);
  // Own public marks before paint, including arrivals from the signed-in app.
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-public', '');
    root.toggleAttribute('data-public-site', marketing);
    root.toggleAttribute('data-public-still', marketing && motionOff);
    root.removeAttribute('data-public-mood');
    clearBoot();
    return () => {
      root.removeAttribute('data-public');
      root.removeAttribute('data-public-site');
      root.removeAttribute('data-public-still');
    };
  }, [marketing, motionOff]);
  useEffect(() => {
    // The marketing scene owns scroll and transition measurements between its routes.
    if (!marketing) window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [pathname, marketing]);
  useEffect(() => {
    // Arriving from an account page starts at the home's top. This does not run between
    // marketing scenes, so their own reading-position memory wins.
    if (marketing) window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [marketing]);
  useEffect(() => {
    document.addEventListener('touchstart', noop, { passive: true });
    return () => document.removeEventListener('touchstart', noop);
  }, []);
  // The scroll edge: the top line casts its shadow only while something has gone under it.
  useEffect(() => {
    const edge = edgeRef.current;
    if (!edge || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(([entry]) => setUnder(!entry.isIntersecting));
    observer.observe(edge);
    return () => observer.disconnect();
  }, [loading]);
  if (loading) return <PublicLoader />;
  const next = ACCOUNT_PAGES.includes(pathname) ? new URLSearchParams(search).get('next') : null;
  const accountHref = (page) => (next ? authHref(page, next) : page);
  const current = (page) => (pathname === page ? 'page' : undefined);
  const home = (hash) => ({ pathname: '/', search: '?landing', hash });
  return (
    <div className={`pub-site${marketing ? ' pub-site--marketing' : ''}`}>
      <a className="pub-skip" href="#main-content" onClick={skipToMain}>
        Skip to content
      </a>
      <span className="pub-edge" ref={edgeRef} aria-hidden="true" />
      <header className={`pub-top${under ? ' is-under' : ''}`}>
        <div className="pub-top-in">
          <Link className="pub-wordmark" to={marketing ? '/?landing' : '/'} aria-label="Companion home page">
            companion.
          </Link>
          {marketing && (
            <nav className="pub-product-nav" aria-label="Product">
              <Link to="/desk" aria-current={pathname === '/desk' || pathname.startsWith('/desk/') ? 'page' : undefined}>
                Inside Companion
              </Link>
              <Link to="/sage" aria-current={current('/sage')}>
                Sage
              </Link>
              <Link to={home('#find')}>Find anything</Link>
            </nav>
          )}
          {marketing && <RoomStatus />}
          <nav className="pub-top-nav" aria-label="Account">
            <Link className="pub-top-link" to={accountHref('/login')} aria-current={current('/login')}>
              Log in
            </Link>
            <Link className="pub-top-register" to={accountHref('/register')} aria-current={current('/register')}>
              Register
            </Link>
          </nav>
        </div>
      </header>
      <Outlet context={{ still: motionOff, reducedMotion }} />
      {marketing && (
        <footer className="pub-footer">
          <div className="pub-footer-in">
            <div>
              <Link className="pub-wordmark" to="/?landing" aria-label="Companion home page">
                companion.
              </Link>
            </div>
            <nav aria-label="Footer">
              <Link to="/app">Open your desk ↗</Link>
              <button
                className="pub-motion-switch"
                type="button"
                aria-pressed={motionOff}
                disabled={reducedMotion}
                title={reducedMotion ? 'Motion is off to follow your system setting.' : undefined}
                onClick={() => setStill(!still)}
              >
                {motionOff ? 'Motion off' : 'Motion on'}
              </button>
            </nav>
          </div>
        </footer>
      )}
    </div>
  );
};
export default PublicLayout;
