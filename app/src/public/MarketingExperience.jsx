import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Link, Navigate, useLocation, useNavigate, useNavigationType, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/authState';
import FindDemo from './FindDemo';
import HeroWindow from './HeroWindow';
import Picture from './Picture';
import PublicLoader from './PublicLoader';
import SagePreview from './SagePreview';
import Segmented from './Segmented';
import { FRAME_SIZES, SHOWN_SIZES, fetchNote, fetchOn, usePhone } from './photos';
import { CLOSE, DESK, DESK_TARGETS, FEATURES, FIRST_SHOWN, HUB, IMAGES, LEDE, NOTE_ORDER, NOTES, WINDOW, pathOf, sceneOf } from './sceneData';
import { warmSprings } from './springLoader';
import { useCardFlight } from './useCardFlight';
import { useCrossfade } from './useCrossfade';
import { useReducedMotion } from './useReducedMotion';
import { useSceneTransition } from './useSceneTransition';
import { MOOD_CHOICES, readMood, setMoodChoice, subscribeMood } from './windowMood';
import './marketing.css';

// The public home: one page read top to bottom — the window into the room (HeroWindow.jsx), the
// desk (its cards switch the note shown under it), Sage, ⌘K and the week, the rest of the desk,
// what is coming, and the last word — with a page of its own for each note on the desk, a level
// down (/desk/:view). A note opens out of what was clicked and folds back into it
// (useSceneTransition.js); the desk's switch flies a note out of its card (useCardFlight.js).
// PublicLayout renders this for /, /desk, /desk/:view and /sage; /desk and /sage are sections of
// the home, and #find lands on ⌘K. Copy and pictures: sceneData.js.
//
// Daylight studio: a pale ground, white tiles with soft physical shadows, ink, one blue accent;
// translucent material only where something floats over a picture (marketing.css).

const DESK_SIZES = '(min-width: 1180px) 1024px, (min-width: 720px) calc(100vw - 156px), calc(100vw - 80px)';
// Openers on the home page: going back there folds the note into what opened it.
const FROM_HOME = ['window', 'shown', 'find'];
const featureOf = (id) => FEATURES.find((feature) => feature.id === id);

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
      <span aria-hidden="true">‹</span> {children}
    </Link>
  );
};

// ── The small drawn scenes (decorative: the words say it all) ───────────────────────────────
// Each is drawn in the app's own colours, and plays its scene as it comes into view
// (marketing.css; still without browser support, with reduced motion or Motion off).

const CalendarThing = () => (
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

const InboxThing = () => (
  <div className="mx-scene mx-scene--inbox" aria-hidden="true">
    <p className="sc-tray-label">
      Inbox{' '}
      <b>
        <span className="sc-count-was">3</span>
        <span className="sc-count-now">2</span>
      </b>
    </p>
    <div className="sc-tray">
      <p className="sc-slip sc-slip--filed">Call the bike shop before ten</p>
      <p className="sc-slip">Ask Mira about the north gate</p>
      <p className="sc-slip">Return the library book</p>
    </div>
    <p className="sc-into">
      Filed into <span>Everyday</span>
    </p>
  </div>
);

const StructureThing = () => (
  <div className="mx-scene mx-scene--structure" aria-hidden="true">
    <p className="sc-h">
      <span>§1</span> From a wave to a sequence
    </p>
    <p className="sc-math">
      <i>f</i>
      <sub>s</sub> &gt; 2<i>f</i>
      <sub>max</sub>
    </p>
    <p className="sc-callout">
      <b>Remember</b> Too slow a rate turns fast into slow.
    </p>
    <p className="sc-check">
      <span className="sc-box" /> Compare two sampling intervals
    </p>
  </div>
);

const ExportThing = () => (
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

const RoomThing = () => (
  <div className="mx-scene mx-scene--room" aria-hidden="true">
    <div className="sc-rooms">
      <img src={`${IMAGES}/rain-cover-small.webp`} alt="" width="936" height="394" loading="lazy" decoding="async" />
      <img className="sc-night" src={`${IMAGES}/room-cover-small.webp`} alt="" width="936" height="394" loading="lazy" decoding="async" />
    </div>
    <p className="sc-moods">
      <span>Rain</span>
      <span>Candlelight</span>
    </p>
  </div>
);

const MORE = [
  { id: 'inbox', Thing: InboxThing },
  { id: 'structure', Thing: StructureThing },
  { id: 'export', Thing: ExportThing },
  { id: 'room', Thing: RoomThing },
];

// Three people's copies of one note, the same line being written in all of them at once.
const HubDrawing = ({ people }) => (
  <div className="mx-hub-drawing" aria-hidden="true">
    <span className="hd-pile hd-pile--back" />
    <span className="hd-pile hd-pile--middle" />
    {people.map((name, index) => (
      <span key={name} className={`hd-note hd-note--${index + 1}`}>
        <b className="hd-who">{name}</b>
        <i className="hd-line hd-line--title" />
        <i className="hd-line" />
        <i className="hd-line hd-line--short" />
        <i className="hd-line hd-line--typing" />
      </span>
    ))}
  </div>
);

// ── The home page ────────────────────────────────────────────────────────────────────────────

const HomePage = ({ shownView, onShow }) => {
  const phone = usePhone();
  const reduce = useReducedMotion();
  const targets = (phone ? DESK_TARGETS?.phone : DESK_TARGETS?.desktop)?.targets ?? [];
  const frameRef = useRef(null);
  const layerRef = useRef(null);
  const flight = useCardFlight({ frameRef, layerRef, reduce });
  const shown = NOTES[shownView];
  const findId = useId();
  const calendar = featureOf('calendar');
  const find = featureOf('find');

  const pick = (view, card) => {
    if (view === shownView) return;
    fetchNote(view);
    flight.capture(card);
    onShow(view);
  };

  // Once the page has settled, the notes' photographs come in the background.
  useEffect(() => {
    const timer = window.setTimeout(() => NOTE_ORDER.forEach(fetchNote), 1800);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <>
      <section className="mx-hero" id="top" aria-labelledby="mx-title">
        <div className="mx-wrap">
          <h1 id="mx-title" className="mx-wordmark">
            companion.
          </h1>
          <p className="mx-lede-line">{LEDE.line}</p>
          <p className="mx-lede-more">{LEDE.more}</p>
          <div className="mx-actions">
            <Link className="pub-button" to="/register">
              Register
            </Link>
            <Link className="pub-link" to="/desk">
              Look inside <span aria-hidden="true">›</span>
            </Link>
          </div>
          <HeroWindow />
          <p className="mx-fine">{WINDOW.fine}</p>
        </div>
      </section>

      <section className="mx-section" id="inside" aria-labelledby="inside-title">
        <div className="mx-wrap">
          <div className="mx-tile mx-tile--inside">
            <div className="mx-head">
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
                <Picture key={shownView} photo={shown.shown.photo} sizes={SHOWN_SIZES} alt={shown.shown.photo.alt} imageProps={{ 'data-photo': '' }} />
              </Link>
              <figcaption>
                <span className="mx-shown-name">
                  {shown.group} · {shown.title}
                </span>
                <span>
                  <strong>{shown.shown.label}</strong> {shown.shown.text}
                </span>
                <Link className="pub-link" to={pathOf(shownView)} state={{ opener: 'shown' }}>
                  Open the note <span aria-hidden="true">›</span>
                </Link>
                <span className="mx-shown-fine">Actual Companion views. All names and note content are invented.</span>
              </figcaption>
            </figure>
            {/* The sheet that brings a note out of its card is drawn here, over the tile. */}
            <div className="mx-swap" ref={layerRef} aria-hidden="true" />
          </div>
        </div>
      </section>

      <section className="mx-section mx-later" id="sage" aria-labelledby="sage-title">
        <div className="mx-wrap">
          <div className="mx-tile">
            <div className="mx-head">
              <h2 id="sage-title" tabIndex={-1}>
                Sage
              </h2>
              <p>Four prepared results on the same fictional note. Pick one.</p>
            </div>
            <SagePreview />
            <p className="mx-sage-own">
              In your own notes, Sage runs on the whole note or only the section you are in, and Before Sage and After
              Sage stay a click apart until you keep one. A real run sends that text to an AI model, which writes the new
              version.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-section mx-later" id="find" aria-label="Find anything, and the calendar">
        <div className="mx-wrap mx-pair">
          <div className="mx-tile mx-tile--find">
            <h2 id={findId} tabIndex={-1}>
              {find.title}
            </h2>
            <p className="mx-tile-text">{find.text}</p>
            <FindDemo titleId={findId} />
          </div>
          <div className="mx-tile mx-tile--calendar">
            <h2>{calendar.title}</h2>
            <p className="mx-tile-text">{calendar.text}</p>
            <CalendarThing />
          </div>
        </div>
      </section>

      <section className="mx-section mx-later" id="more" aria-labelledby="more-title">
        <div className="mx-wrap">
          <h2 className="mx-section-title" id="more-title">
            More on the desk
          </h2>
          <ul className="mx-grid">
            {MORE.map((item) => {
              const { id } = item;
              const Thing = item.Thing;
              const feature = featureOf(id);
              return (
                <li key={id} className={`mx-tile mx-thing mx-thing--${id}`}>
                  <Thing />
                  <h3>{feature.title}</h3>
                  <p className="mx-tile-text">{feature.text}</p>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      <section className="mx-section mx-later" id="hub" aria-labelledby="hub-title">
        <div className="mx-wrap">
          <div className="mx-tile mx-tile--night mx-hub">
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
              <Link className="pub-button pub-button--light" to="/register">
                Register to be there first
              </Link>
            </div>
            <HubDrawing people={HUB.people} />
          </div>
        </div>
      </section>

      <section className="mx-section mx-close" aria-labelledby="close-title">
        <div className="mx-wrap">
          <h2 id="close-title">{CLOSE.title}</h2>
          <div className="mx-actions">
            <Link className="pub-button" to="/register">
              Register
            </Link>
            <Link className="pub-link" to="/app">
              {CLOSE.open} <span aria-hidden="true">›</span>
            </Link>
          </div>
        </div>
      </section>
    </>
  );
};

// The Weekend list in either of the room's two moods: the same note, photographed in the same
// crop, crossfading as the window on the home does (the two share the visit's mood).
const MoodFrame = ({ note, mood, onMissing }) => {
  const reduce = useReducedMotion();
  const night = useRef(null);
  const [loaded, setLoaded] = useState({});
  const apply = useCallback((value) => {
    if (night.current) night.current.style.opacity = String(value);
  }, []);
  const fade = useCrossfade({ value: mood === 'candlelight' ? 1 : 0, ready: Boolean(loaded[mood]), apply, reduce });
  return (
    <div className="mx-frame mx-frame--moods" data-frame data-mood={mood}>
      {['rain', 'candlelight'].map((id) => (
        <Picture
          key={id}
          photo={note.moods[id]}
          className={`mx-mood mx-mood--${id}`}
          alt={id === mood ? note.moods[id].alt : ''}
          eager
          sizes={FRAME_SIZES}
          pictureRef={
            id === 'candlelight'
              ? (element) => {
                  night.current = element;
                  if (element) element.style.opacity = String(fade.current.now);
                }
              : undefined
          }
          imageProps={{
            'data-photo': id === mood ? '' : undefined,
            onLoad: () => setLoaded((prev) => ({ ...prev, [id]: true })),
            onError: id === 'rain' ? onMissing : undefined,
          }}
        />
      ))}
    </div>
  );
};

// A note's own page.
const NotePage = ({ scene }) => {
  const note = NOTES[scene.view];
  const { choice, mood } = useSyncExternalStore(subscribeMood, readMood, readMood);
  // Without its Rain photograph the Weekend list simply stays in Candlelight.
  const [rainMissing, setRainMissing] = useState(false);
  const moods = note.moods && !rainMissing;
  const others = NOTE_ORDER.filter((view) => view !== scene.view);
  return (
    <section className="mx-note-page" aria-labelledby="mx-note-title">
      <div className="mx-wrap mx-note">
        <div className="mx-note-text">
          <BackLink to="/desk" previous={FROM_HOME.includes(scene.opener)}>
            Back
          </BackLink>
          <p className="mx-kicker">{note.group}</p>
          <h1 id="mx-note-title" tabIndex={-1} data-scene-focus>
            {note.title}
          </h1>
          <p className="mx-lede">{note.text}</p>
          {moods && (
            <Segmented
              name="note-mood"
              label="The room’s mood"
              className="mx-note-moods"
              options={MOOD_CHOICES}
              value={choice}
              onChange={setMoodChoice}
            />
          )}
        </div>

        {note.moods ? (
          <MoodFrame note={note} mood={rainMissing ? 'candlelight' : mood} onMissing={() => setRainMissing(true)} />
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
    </section>
  );
};

// The home first, then the notes: a page that leaves keeps its place in the document, so turning
// back mid-transition never moves anything in it.
const rank = (page) => (page.view ? 1 + NOTE_ORDER.indexOf(page.view) : 0);

const MarketingExperience = () => {
  const { firebaseUser, loading } = useAuth();
  const { pathname, state, key, hash } = useLocation();
  const navigation = useNavigationType();
  const [params] = useSearchParams();
  const reduce = useReducedMotion();
  // Which note the desk shows; kept here so it is the same when a note's page closes again.
  const [shownView, setShownView] = useState(FIRST_SHOWN);
  const place = sceneOf(pathname);
  // The home is the signed-out front page: a signed-in visitor goes to their desk unless they
  // asked for the home (?landing). One address per page: an unknown note is the desk section.
  const home = pathname === '/' && !params.has('landing');
  const waiting = home && loading;
  const signedIn = home && Boolean(firebaseUser);
  const canonical = place.path !== (pathname.replace(/\/+$/, '') || '/') ? place.path : null;
  const section = place.section ?? (hash === '#find' ? 'find' : null);
  // Back returns to where the home was left; a link that names a section lands on it.
  const landOn = navigation === 'POP' ? null : section;
  const { shown, leaving, rootRef, flightRef } = useSceneTransition({
    scene: waiting || signedIn || canonical ? null : { ...place, opener: state?.opener ?? null, landOn },
    reduce,
  });

  useEffect(() => warmSprings(), []);

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
    const target = section ? document.getElementById(section) : null;
    if (target) {
      target.scrollIntoView({ block: 'start', behavior });
      if (!first) target.querySelector('h2')?.focus({ preventScroll: true });
      if (first) arrival.current = target;
    } else if (!first || key !== 'default') {
      window.scrollTo({ top: 0, left: 0, behavior });
    }
  }, [key, place.key, section]);

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

  const pages = (leaving ? [leaving, shown] : [shown]).sort((a, b) => rank(a) - rank(b));
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
