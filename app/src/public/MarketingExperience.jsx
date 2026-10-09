import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/authState';
import PublicLoader from './PublicLoader';
import SagePreview from './SagePreview';
import {
  COVER,
  DESK,
  DESK_TARGETS,
  FEATURES,
  FIRST_SHOWN,
  HUB,
  IMAGES,
  LEDE,
  NOTE_ORDER,
  NOTES,
  pathOf,
  sceneOf,
} from './sceneData';
import { useCardFlight } from './useCardFlight';
import { useReducedMotion } from './useReducedMotion';
import { useSceneTransition } from './useSceneTransition';
import './marketing.css';

// The public home: one complete page read top to bottom — the cover, the desk (its cards switch
// the note shown under it), Sage, the rest of what Companion does, and what is coming — with a
// page of its own for each note on the desk, a level down (/desk/:view). A note opens out of what
// was clicked and folds back into it (useSceneTransition.js); the desk's switch flies a note out
// of its card (useCardFlight.js). PublicLayout renders this for /, /desk, /desk/:view and /sage;
// /desk and /sage are sections of the home. Copy and pictures: sceneData.js.

const PHONE = '(max-width: 719px)';
const PHONE_SIZES = 'calc(100vw - 40px)';
const COVER_SIZES = '(min-width: 1344px) 860px, (min-width: 900px) calc(100vw - 420px), calc(100vw - 80px)';
const DESK_SIZES = '(min-width: 1344px) 1200px, (min-width: 1200px) calc(100vw - 144px), calc(100vw - 80px)';
const SHOWN_SIZES = '(min-width: 1344px) 900px, (min-width: 900px) calc(100vw - 444px), calc(100vw - 80px)';
const FRAME_SIZES = '(min-width: 1344px) 872px, (min-width: 1200px) calc(100vw - 472px), (min-width: 900px) calc(100vw - 408px), calc(100vw - 80px)';
const MOODS = [
  { id: 'candlelight', label: 'Candlelight' },
  { id: 'rain', label: 'Rain' },
];
// Openers on the home page: going back there folds the note into what opened it.
const FROM_HOME = ['cover', 'shown'];

const subscribePhone = (listener) => {
  const query = window.matchMedia(PHONE);
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
};
const readPhone = () => window.matchMedia(PHONE).matches;
const usePhone = () => useSyncExternalStore(subscribePhone, readPhone, () => false);

const srcSetOf = (photo) => `${IMAGES}/${photo.src}-small.webp ${photo.width / 2}w, ${IMAGES}/${photo.src}.webp ${photo.width}w`;

// Proportions come from CSS per screen size (marketing.css): a picture that has just mounted is
// measured (for the motion) before the browser has chosen between the phone and desktop crops.
const Picture = ({ photo, sizes, alt = photo.alt, eager = false, className, imageProps }) => (
  <picture
    className={className}
    style={{
      '--mx-ratio': `${photo.width} / ${photo.height}`,
      '--mx-ratio-phone': `${photo.phone.width} / ${photo.phone.height}`,
    }}
  >
    <source media={PHONE} srcSet={srcSetOf(photo.phone)} sizes={PHONE_SIZES} width={photo.phone.width} height={photo.phone.height} />
    <img
      src={`${IMAGES}/${photo.src}.webp`}
      srcSet={srcSetOf(photo)}
      sizes={sizes}
      width={photo.width}
      height={photo.height}
      alt={alt}
      loading={eager ? 'eager' : 'lazy'}
      fetchPriority={eager ? 'high' : 'auto'}
      {...imageProps}
    />
  </picture>
);

// Photographs are fetched as soon as a pointer or focus reaches a way to them, so they are
// there when they are shown.
const fetched = new Set();
const fetchPhoto = (photo, sizes) => {
  if (!photo) return;
  const phone = readPhone();
  const source = phone ? photo.phone : photo;
  if (fetched.has(source.src)) return;
  fetched.add(source.src);
  const image = new Image();
  image.sizes = phone ? PHONE_SIZES : sizes;
  image.srcset = srcSetOf(source);
  image.src = `${IMAGES}/${source.src}.webp`;
};
const fetchNote = (view) => {
  const note = NOTES[view];
  fetchPhoto(note.photo ?? note.moods?.candlelight, FRAME_SIZES);
  fetchPhoto(note.shown.photo, SHOWN_SIZES);
};
const fetchOn = (view) => ({
  onPointerEnter: () => fetchNote(view),
  onFocus: () => fetchNote(view),
  onTouchStart: () => fetchNote(view),
});

// Back to the home page: the browser's own Back when that is where the visitor came from, so the
// history does not grow with every return (and the note folds back into what opened it).
const BackLink = ({ to, previous, children }) => {
  const navigate = useNavigate();
  const onClick = (event) => {
    if (!previous || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(-1);
  };
  return (
    <Link className="mx-back" to={to} onClick={onClick}>
      <span aria-hidden="true">←</span> {children}
    </Link>
  );
};

const OpenLabel = ({ name }) => (
  <span className="mx-open">
    Open<span className="mx-hidden"> {name}</span> <span aria-hidden="true">→</span>
  </span>
);

// ── Small drawn scenes for "More on the desk" (decorative: the text says it all) ─────────────

const CalendarScene = () => (
  <div className="mx-scene mx-scene--calendar" aria-hidden="true">
    {['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((day) => (
      <span key={day} className="sc-day">
        {day}
      </span>
    ))}
    <span className="sc-block sc-class" style={{ gridColumn: 1, gridRow: 2 }}>
      Signals <em>10:30</em>
    </span>
    <span className="sc-block sc-class sc-second" style={{ gridColumn: 3, gridRow: 2 }}>
      Signals <em>10:30</em>
    </span>
    <span className="sc-block sc-meet" style={{ gridColumn: 2, gridRow: 3 }}>
      Harbor <em>14:00</em>
    </span>
    <span className="sc-block sc-due" style={{ gridColumn: 4, gridRow: 3 }}>
      Report due
    </span>
  </div>
);

const InboxScene = () => (
  <div className="mx-scene mx-scene--inbox" aria-hidden="true">
    <p className="sc-title">Inbox</p>
    <p className="sc-scrap sc-filed">Call the bike shop before ten</p>
    <p className="sc-scrap">Ask Mira about the north gate</p>
    <p className="sc-into">
      Filed into <span>Everyday</span>
    </p>
  </div>
);

const FindScene = () => (
  <div className="mx-scene mx-scene--find" aria-hidden="true">
    <p className="sc-field">
      <kbd>⌘K</kbd>
      <span className="sc-typed">aliasing</span>
    </p>
    <ul className="sc-results">
      <li className="is-hit">
        Sampling notes <span>Systems &amp; Signals</span>
      </li>
      <li>New note “aliasing”</li>
      <li>Switch to Rain</li>
    </ul>
  </div>
);

const StructureScene = () => (
  <div className="mx-scene mx-scene--structure" aria-hidden="true">
    <p className="sc-h">
      <span>§1</span> From a wave to a sequence
    </p>
    <p className="sc-math">
      <i>f</i>
      <sub>s</sub> &gt; 2<i>f</i>
      <sub>max</sub>
    </p>
    <p className="sc-callout">Too slow a rate turns fast into slow.</p>
    <p className="sc-check">
      <span className="sc-box" /> Compare two sampling intervals
    </p>
  </div>
);

const ExportScene = () => (
  <div className="mx-scene mx-scene--export" aria-hidden="true">
    <div className="sc-page">
      <span />
      <span />
      <span />
      <span />
      <b>PDF</b>
    </div>
    <ul className="sc-tree">
      <li>Everyday/</li>
      <li className="sc-leaf">Weekend list.md</li>
      <li>Working Notes/</li>
      <li className="sc-leaf">Harbor review.md</li>
    </ul>
  </div>
);

const RoomScene = () => (
  <div className="mx-scene mx-scene--room" aria-hidden="true">
    <div className="sc-rooms">
      <img src={`${IMAGES}/rain-cover-small.webp`} alt="" width="936" height="394" loading="lazy" />
      <img className="sc-night" src={`${IMAGES}/room-cover-small.webp`} alt="" width="936" height="394" loading="lazy" />
    </div>
    <p className="sc-moods">
      <span>Rain</span>
      <span>Candlelight</span>
    </p>
  </div>
);

const SCENES = {
  calendar: CalendarScene,
  inbox: InboxScene,
  find: FindScene,
  structure: StructureScene,
  export: ExportScene,
  room: RoomScene,
};

// ── The home page ────────────────────────────────────────────────────────────────────────────

const HomePage = ({ shownView, onShow }) => {
  const phone = usePhone();
  const reduce = useReducedMotion();
  const targets = (phone ? DESK_TARGETS?.phone : DESK_TARGETS?.desktop)?.targets ?? [];
  const frameRef = useRef(null);
  const layerRef = useRef(null);
  const flight = useCardFlight({ frameRef, layerRef, reduce });
  const shown = NOTES[shownView];

  const pick = (view, card) => {
    if (view === shownView) return;
    fetchNote(view);
    flight.capture(card);
    onShow(view);
  };

  // Once the page has settled, the notes' photographs come in the background.
  useEffect(() => {
    const timer = window.setTimeout(() => NOTE_ORDER.forEach(fetchNote), 1500);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <>
      <section className="mx-wrap mx-cover" aria-labelledby="mx-title">
        <h1 id="mx-title" className="mx-wordmark">
          companion<span aria-hidden="true">.</span>
        </h1>
        <div className="mx-cover-body">
          <div className="mx-cover-copy">
            <p className="mx-lede-line">{LEDE.line}</p>
            <p className="mx-lede-more">{LEDE.more}</p>
            <div className="mx-cover-actions">
              <Link className="pub-button pub-button--solid" to="/register">
                Register
              </Link>
              <Link className="mx-look" to="/desk">
                <span>Look inside</span> <span aria-hidden="true">↓</span>
              </Link>
            </div>
          </div>
          <figure className="mx-cover-figure">
            <Link
              className="mx-cover-note"
              to={pathOf('weekend-list')}
              state={{ opener: 'cover' }}
              data-target="weekend-list"
              data-source="cover"
              {...fetchOn('weekend-list')}
            >
              <Picture photo={COVER} eager sizes={COVER_SIZES} />
              <OpenLabel name="Weekend list" />
            </Link>
            <figcaption>An invented Weekend list, in Companion’s Candlelight room.</figcaption>
          </figure>
        </div>
      </section>

      <section className="mx-wrap mx-section mx-inside" id="inside" aria-labelledby="inside-title">
        <div className="mx-section-head">
          <h2 id="inside-title" tabIndex={-1} data-scene-focus>
            Inside Companion
          </h2>
          <p>A desk of groups, each with its latest note. Pick one to see it.</p>
        </div>
        <div className="mx-stage" data-stage>
          <Picture photo={DESK} sizes={DESK_SIZES} />
          {targets
            .filter((target) => Object.hasOwn(NOTES, target.view))
            .map((target) => (
              <button
                key={target.view}
                type="button"
                className="mx-target"
                data-target={target.view}
                data-source="card"
                aria-pressed={target.view === shownView}
                aria-label={`${NOTES[target.view].group}: ${NOTES[target.view].title}`}
                style={{
                  left: `${target.x * 100}%`,
                  top: `${target.y * 100}%`,
                  width: `${target.w * 100}%`,
                  height: `${target.h * 100}%`,
                }}
                onClick={(event) => pick(target.view, event.currentTarget)}
                {...fetchOn(target.view)}
              />
            ))}
        </div>
        <figure className="mx-shown">
          <Link
            ref={frameRef}
            className="mx-shown-note"
            to={pathOf(shownView)}
            state={{ opener: 'shown' }}
            data-target={shownView}
            data-source="shown"
          >
            <Picture key={shownView} photo={shown.shown.photo} sizes={SHOWN_SIZES} alt={shown.shown.photo.alt} />
            <OpenLabel name={shown.title} />
          </Link>
          <figcaption>
            <span className="mx-shown-name">
              {shown.group} · {shown.title}
            </span>
            <span>
              <strong>{shown.shown.label}</strong> {shown.shown.text}
            </span>
            <span className="mx-shown-fine">Actual Companion views. All names and note content are invented.</span>
          </figcaption>
        </figure>
        {/* The sheet that brings a note out of its card is drawn here, over the section. */}
        <div className="mx-swap" ref={layerRef} aria-hidden="true" />
      </section>

      <section className="mx-wrap mx-section mx-sage" id="sage" aria-labelledby="sage-title">
        <div className="mx-section-head">
          <h2 id="sage-title" tabIndex={-1}>
            Sage
          </h2>
          <p>Four prepared results on the same fictional note. Pick one.</p>
        </div>
        <SagePreview />
        <p className="mx-sage-own">
          In your own notes, Sage runs on the whole note or only the section you are in, and Before Sage and After Sage
          stay a click apart until you keep one. A real run sends that text to an AI model, which writes the new
          version.
        </p>
      </section>

      <section className="mx-wrap mx-section mx-more-desk" id="more" aria-labelledby="more-title">
        <h2 id="more-title">More on the desk</h2>
        <ol className="mx-features">
          {FEATURES.map((feature, index) => {
            const Scene = SCENES[feature.id];
            return (
              <li key={feature.id} className={`mx-feature mx-feature--${feature.id}`}>
                <div className="mx-feature-text">
                  {/* Numbered the way Companion numbers a note's sections. */}
                  <h3>
                    <span className="mx-feature-n" aria-hidden="true">
                      §{index + 1}
                    </span>
                    {feature.title}
                  </h3>
                  <p>{feature.text}</p>
                </div>
                <Scene />
              </li>
            );
          })}
        </ol>
      </section>

      <section className="mx-wrap mx-section mx-hub" id="hub" aria-labelledby="hub-title">
        <div className="mx-hub-copy">
          <p className="mx-hub-label">{HUB.label}</p>
          <h2 id="hub-title">{HUB.title}</h2>
          <p className="mx-hub-text">{HUB.text}</p>
          <ul className="mx-hub-list">
            {HUB.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className="mx-hub-close">{HUB.close}</p>
          <Link className="pub-button pub-button--solid" to="/register">
            Register to be there first
          </Link>
        </div>
        <div className="mx-hub-drawing" aria-hidden="true">
          {['one', 'two', 'three'].map((name) => (
            <span key={name} className={`hd-note hd-note--${name}`}>
              <i />
              <i />
              <i />
            </span>
          ))}
          <span className="hd-line" />
          <span className="hd-dot" />
        </div>
      </section>
    </>
  );
};

// The Weekend list in either of the room's two moods: the same note, photographed in the same crop.
const MoodFrame = ({ note, mood, missing, onMissing }) => (
  <div className="mx-frame mx-frame--moods" data-frame data-mood={mood}>
    {MOODS.filter((item) => item.id === 'candlelight' || !missing).map((item) => (
      <Picture
        key={item.id}
        photo={note.moods[item.id]}
        className={`mx-mood${item.id === mood ? ' is-shown' : ''}`}
        eager
        sizes={FRAME_SIZES}
        imageProps={{
          'data-photo': item.id === mood ? '' : undefined,
          onError: item.id === 'candlelight' ? undefined : onMissing,
        }}
      />
    ))}
  </div>
);

const NotePage = ({ scene }) => {
  const note = NOTES[scene.view];
  const [mood, setMood] = useState('candlelight');
  // Without its Rain photograph the Weekend list simply stays in Candlelight.
  const [rainMissing, setRainMissing] = useState(false);
  const moods = note.moods && !rainMissing ? MOODS : null;
  const others = NOTE_ORDER.filter((view) => view !== scene.view);
  return (
    <div className="mx-wrap mx-note">
      <div className="mx-note-text">
        <BackLink to="/desk" previous={FROM_HOME.includes(scene.opener)}>
          Back
        </BackLink>
        <p className="mx-kicker">{note.group}</p>
        <h1 tabIndex={-1} data-scene-focus>
          {note.title}
        </h1>
        <p className="mx-lede">{note.text}</p>
        {moods && (
          <div className="mx-moods" role="group" aria-label="The room’s mood">
            {moods.map((item) => (
              <button key={item.id} type="button" aria-pressed={mood === item.id} onClick={() => setMood(item.id)}>
                {item.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {note.moods ? (
        <MoodFrame
          note={note}
          mood={rainMissing ? 'candlelight' : mood}
          missing={rainMissing}
          onMissing={() => {
            setRainMissing(true);
            setMood('candlelight');
          }}
        />
      ) : (
        <div className="mx-frame" data-frame>
          <Picture photo={note.photo} eager sizes={FRAME_SIZES} imageProps={{ 'data-photo': '' }} />
        </div>
      )}

      <div className="mx-note-after">
        <p className="mx-caption">An actual Companion view. Names and note content are invented.</p>
        <nav className="mx-more" aria-label="More on this desk">
          <p>More on this desk</p>
          <ul>
            {others.map((view) => (
              <li key={view}>
                <Link to={pathOf(view)} state={{ opener: 'more' }} {...fetchOn(view)}>
                  {NOTES[view].title}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </div>
  );
};

const MarketingExperience = () => {
  const { firebaseUser, loading } = useAuth();
  const { pathname, state, key } = useLocation();
  const [params] = useSearchParams();
  const reduce = useReducedMotion();
  // Which note the desk shows; kept here so it is the same when a note's page closes again.
  const [shownView, setShownView] = useState(FIRST_SHOWN);
  const place = sceneOf(pathname);
  // The cover is the signed-out home page: a signed-in visitor goes to their desk unless they
  // asked for the cover (?landing). One address per page: an unknown note is the desk section.
  const home = pathname === '/' && !params.has('landing');
  const waiting = home && loading;
  const signedIn = home && Boolean(firebaseUser);
  const canonical = place.path !== (pathname.replace(/\/+$/, '') || '/') ? place.path : null;
  const { shown, leaving, rootRef, flightRef } = useSceneTransition({
    scene: waiting || signedIn || canonical ? null : { ...place, opener: state?.opener ?? null },
    reduce,
  });

  // Within the home page, land on the section the address names: at once on arrival, gliding when
  // a link is followed on the page (unless motion is off). Moving to or from a note is placed by
  // useSceneTransition instead, and a fresh load of / is left to the browser.
  const landed = useRef(null);
  const arrival = useRef(null);
  useLayoutEffect(() => {
    const last = landed.current;
    if (last?.key === key) return;
    landed.current = { key, scene: place.key };
    if (place.key !== 'home' || (last && last.scene !== 'home')) return;
    const first = last === null;
    const behavior = first || document.documentElement.hasAttribute('data-public-still') ? 'instant' : 'smooth';
    const target = place.section ? document.getElementById(place.section) : null;
    if (target) {
      target.scrollIntoView({ block: 'start', behavior });
      if (!first) target.querySelector('h2')?.focus({ preventScroll: true });
      if (first) arrival.current = target;
    } else if (!first || key !== 'default') {
      window.scrollTo({ top: 0, left: 0, behavior });
    }
  }, [key, place.key, place.section]);

  // Arriving, the site's layout (PublicLayout) puts the page at its top after this component's
  // effects have run; land on the section once more right after it.
  useEffect(() => {
    const target = arrival.current;
    if (!target) return undefined;
    const timer = window.setTimeout(() => {
      arrival.current = null;
      target.scrollIntoView({ block: 'start', behavior: 'instant' });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [key, place.key]);

  if (waiting) return <PublicLoader />;
  if (signedIn) return <Navigate to="/app" replace />;
  if (!shown) return canonical ? <Navigate to={canonical} replace /> : null;

  const pages = leaving ? [leaving, shown] : [shown];
  return (
    <main className="mx" id="main-content" ref={rootRef}>
      {/* The page on show stays while a wrong address is replaced. */}
      {canonical && <Navigate to={canonical} replace />}
      {pages.map((page) => {
        const away = page === leaving;
        return (
          <div
            key={page.key}
            className="mx-page"
            data-scene-page={page.key}
            aria-hidden={away || undefined}
            inert={away || undefined}
          >
            {page.view ? <NotePage scene={page} /> : <HomePage shownView={shownView} onShow={setShownView} />}
          </div>
        );
      })}
      {/* The sheet that carries a note onto its own page is drawn here, over both pages. */}
      <div className="mx-flight" ref={flightRef} aria-hidden="true" />
    </main>
  );
};

export default MarketingExperience;
