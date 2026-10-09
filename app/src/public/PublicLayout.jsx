import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/authState';
import { clearBoot } from '../designModes';
import { authHref } from './authNavigation';
import PublicLoader from './PublicLoader';
import './public.css';

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
const PublicLayout = () => {
  const { loading } = useAuth();
  const { pathname, search } = useLocation();
  const marketing = pathname === '/' || pathname === '/sage' || pathname === '/desk' || pathname.startsWith('/desk/');
  const [still, setStill] = useState(false);
  const reducedMotion = useSyncExternalStore(subscribeMotion, readReducedMotion, () => false);
  const motionOff = still || reducedMotion;
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
    // Arriving from an account page starts at the cover or preview's top. This does
    // not run between marketing scenes, so their own reading-position memory wins.
    if (marketing) window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [marketing]);
  if (loading) return <PublicLoader />;
  const next = ACCOUNT_PAGES.includes(pathname) ? new URLSearchParams(search).get('next') : null;
  const accountHref = (page) => (next ? authHref(page, next) : page);
  const current = (page) => (pathname === page ? 'page' : undefined);
  return (
    <div className={`pub-site${marketing ? ' pub-site--marketing' : ''}`}>
      <a className="pub-skip" href="#main-content" onClick={skipToMain}>Skip to content</a>
      <header className="pub-top">
        <Link className="pub-wordmark" to={marketing ? '/?landing' : '/'} aria-label="Companion home page">companion<span aria-hidden="true">.</span></Link>
        {marketing && <nav className="pub-product-nav" aria-label="Product">
          <Link to="/desk" aria-current={pathname === '/desk' || pathname.startsWith('/desk/') ? 'page' : undefined}>Inside Companion</Link>
          <Link to="/sage" aria-current={current('/sage')}>Sage</Link>
        </nav>}
        <nav className="pub-top-nav" aria-label="Account">
          <Link className="pub-top-link" to={accountHref('/login')} aria-current={current('/login')}>Log in</Link>
          <Link className="pub-button pub-button--solid pub-top-register" to={accountHref('/register')} aria-current={current('/register')}>Register</Link>
        </nav>
      </header>
      <Outlet context={{ still: motionOff, reducedMotion }} />
      {marketing && <footer className="pub-footer">
        <div><Link className="pub-wordmark" to="/?landing" aria-label="Companion home page">companion<span aria-hidden="true">.</span></Link>
          <p>Already have a desk? Bookmark <Link to="/app">/app</Link>.</p></div>
        <nav aria-label="Footer">
          <Link to="/app">Open your desk ↗</Link>
          <button className="pub-motion-switch" type="button" aria-pressed={motionOff} disabled={reducedMotion} title={reducedMotion ? 'Motion is off to follow your system setting.' : undefined} onClick={() => setStill(!still)}>{motionOff ? 'Motion off' : 'Motion on'}</button>
        </nav>
      </footer>}
    </div>
  );
};
export default PublicLayout;
