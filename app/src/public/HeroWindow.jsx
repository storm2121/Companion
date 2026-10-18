import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import Picture from './Picture';
import Segmented from './Segmented';
import { fetchOn } from './photos';
import { NOTES, WINDOW, pathOf } from './sceneData';
import { useCrossfade } from './useCrossfade';
import { useReducedMotion } from './useReducedMotion';
import { MOOD_CHOICES, MOOD_NAMES, readMood, setMoodChoice, subscribeMood } from './windowMood';

// The window under the home's first words: the invented Weekend list in Companion's room, seen
// through a pane of glass with weather on it. The room follows the visitor's clock as the app
// does (Rain by day, Candlelight at night; windowMood.js), or the one picked on the window. On
// the glass (rainGlass.js, WebGL2, its own chunk, fetched once the page has painted and only
// while the window is in view): rain, and condensation the visitor can wipe away with a pointer
// or a finger — it gathers back over about twenty seconds. A click still opens the note; a drag
// of more than ~10px is a wipe. Without WebGL2 or on any failure it is simply the capture. Rain
// sound (rainSound.js) only when asked for.

const NOTE = NOTES['weekend-list'];
const ORDER = ['rain', 'candlelight'];
const SIZES = '(min-width: 1144px) 1100px, (min-width: 720px) calc(100vw - 44px), calc(100vw - 32px)';
const TAP = 10;
const DEBUG = import.meta.env.DEV;

const queryStore = (query) => ({
  subscribe: (listener) => {
    const list = window.matchMedia(query);
    list.addEventListener('change', listener);
    return () => list.removeEventListener('change', listener);
  },
  read: () => window.matchMedia(query).matches,
});
const CLEAR_GLASS = queryStore('(prefers-reduced-transparency: reduce)');
const COARSE = queryStore('(pointer: coarse)');
const useQuery = (store) => useSyncExternalStore(store.subscribe, store.read, () => false);

// Once the glass has been wiped, the hint has done its work for the rest of the visit.
let wipedOnce = false;

const SoundIcon = ({ on }) => (
  <svg className="mx-sound-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
    <path d="M2.5 6h2.2L8 3.2v9.6L4.7 10H2.5Z" />
    {on ? (
      <path d="M10.6 5.6a3.4 3.4 0 0 1 0 4.8M12.4 3.8a6 6 0 0 1 0 8.4" />
    ) : (
      <path d="m11 6.2 3.2 3.6M14.2 6.2 11 9.8" />
    )}
  </svg>
);

const HeroWindow = () => {
  const { choice, mood, clock } = useSyncExternalStore(subscribeMood, readMood, readMood);
  const reduce = useReducedMotion();
  const clearGlass = useQuery(CLEAR_GLASS);
  const coarse = useQuery(COARSE);
  const frameRef = useRef(null);
  const canvasRef = useRef(null);
  const glassRef = useRef(null);
  const images = useRef({});
  // The room on show when the page arrived: its picture comes first and eagerly.
  const [firstMood] = useState(mood);
  const [loaded, setLoaded] = useState({});
  const [both, setBoth] = useState(false);
  const [gl, setGl] = useState('off');
  const [wiped, setWiped] = useState(wipedOnce);
  const gesture = useRef(null);
  const swallowClick = useRef(false);
  const [sound, setSound] = useState(false);
  const audio = useRef({ context: null, engine: null, wanted: false });
  const moodNow = useRef(mood);
  useEffect(() => {
    moodNow.current = mood;
  }, [mood]);

  // The crossfade between the two rooms: one value, 0 (Rain) to 1 (Candlelight), driving the top
  // picture's opacity and the glass's own blend together. It waits for the picture it goes to.
  const applyMix = useCallback((value) => {
    const night = images.current.candlelight?.parentElement;
    if (night) night.style.opacity = String(value);
    glassRef.current?.setMix(value);
  }, []);
  const mix = useCrossfade({ value: mood === 'candlelight' ? 1 : 0, ready: Boolean(loaded[mood]), apply: applyMix, reduce });
  useEffect(() => {
    if (!both && mood !== firstMood) setBoth(true);
  }, [both, mood, firstMood]);

  const onLoaded = (id) => {
    setLoaded((prev) => (prev[id] ? prev : { ...prev, [id]: true }));
    const image = images.current[id];
    if (image) glassRef.current?.setPicture(id, image);
    // The other room comes in once the page has settled.
    if (id === firstMood) {
      if (window.requestIdleCallback) window.requestIdleCallback(() => setBoth(true), { timeout: 2500 });
      else window.setTimeout(() => setBoth(true), 900);
    }
  };

  // The glass: after the page has painted, and only once the window is in view.
  useEffect(() => {
    const frame = frameRef.current;
    const canvas = canvasRef.current;
    if (!frame || !canvas || typeof IntersectionObserver === 'undefined') return undefined;
    let cancelled = false;
    let idle = 0;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      const start = () => {
        import('./rainGlass.js').then(
          ({ createRainGlass }) => {
            if (cancelled) return;
            const glass = createRainGlass({
              canvas,
              reduce: Boolean(document.documentElement.hasAttribute('data-public-still') || window.matchMedia('(prefers-reduced-motion: reduce)').matches),
              foggy: !CLEAR_GLASS.read(),
              debug: DEBUG,
            });
            if (!glass) {
              setGl('failed');
              return;
            }
            glassRef.current = glass;
            if (DEBUG) window.__companionRain = glass.stats;
            glass.setMix(mix.current.now);
            glass.ready.then((ok) => {
              if (cancelled) return;
              if (!ok) {
                setGl('failed');
                return;
              }
              if (DEBUG) console.info(`rain: shaders ready in ${Math.round(glass.stats.compileMs)} ms`);
              ORDER.forEach((id) => {
                const image = images.current[id];
                if (image?.complete && image.naturalWidth) glass.setPicture(id, image);
              });
              glass.onFirstFrame(() => !cancelled && setGl('on'));
            });
          },
          () => !cancelled && setGl('failed'),
        );
      };
      idle = window.requestIdleCallback ? window.requestIdleCallback(start, { timeout: 1200 }) : window.setTimeout(start, 300);
    });
    observer.observe(frame);
    return () => {
      cancelled = true;
      observer.disconnect();
      if (window.cancelIdleCallback) window.cancelIdleCallback(idle);
      else window.clearTimeout(idle);
      glassRef.current?.destroy();
      glassRef.current = null;
    };
  }, [mix]);

  useEffect(() => {
    glassRef.current?.setStill(reduce);
  }, [reduce]);
  useEffect(() => {
    glassRef.current?.setFoggy(!clearGlass);
  }, [clearGlass]);

  // ── Wiping ────────────────────────────────────────────────────────────────────────────────
  const wipeable = gl === 'on' && !clearGlass;

  const onPointerDown = (event) => {
    if (!wipeable || event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, last: [event.clientX, event.clientY], rect, moved: false };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // A pointer that has already gone.
    }
  };

  const onPointerMove = (event) => {
    const now = gesture.current;
    const glass = glassRef.current;
    if (!now || now.id !== event.pointerId || !glass) return;
    const { rect } = now;
    const points = event.nativeEvent.getCoalescedEvents?.() ?? [];
    const path = points.length ? points : [event.nativeEvent];
    for (const point of path) {
      const [lx, ly] = now.last;
      glass.stroke((lx - rect.left) / rect.width, (ly - rect.top) / rect.height, (point.clientX - rect.left) / rect.width, (point.clientY - rect.top) / rect.height);
      now.last = [point.clientX, point.clientY];
    }
    if (!now.moved && Math.hypot(event.clientX - now.x, event.clientY - now.y) > TAP) {
      now.moved = true;
      if (!wipedOnce) {
        wipedOnce = true;
        setWiped(true);
      }
    }
  };

  const onPointerEnd = (event) => {
    const now = gesture.current;
    if (!now || now.id !== event.pointerId) return;
    gesture.current = null;
    // A wipe is not a click: the click that follows it is swallowed.
    if (now.moved) {
      swallowClick.current = true;
      window.setTimeout(() => {
        swallowClick.current = false;
      }, 0);
    }
  };

  const onClick = (event) => {
    if (!swallowClick.current) return;
    swallowClick.current = false;
    event.preventDefault();
  };

  // ── Rain sound ────────────────────────────────────────────────────────────────────────────
  const AudioContextType = typeof window !== 'undefined' ? window.AudioContext || window.webkitAudioContext : null;
  const fetchSound = () => {
    import('./rainSound.js').catch(() => {});
  };
  const toggleSound = () => {
    const next = !sound;
    setSound(next);
    const held = audio.current;
    held.wanted = next;
    if (!next) {
      held.engine?.stop();
      return;
    }
    if (!AudioContextType) return;
    // Made inside the click, so the browser lets it start.
    held.context ??= new AudioContextType();
    held.context.resume?.().catch(() => {});
    if (held.engine) {
      held.engine.play(moodNow.current);
      return;
    }
    import('./rainSound.js').then(
      ({ createRainSound }) => {
        if (!held.context || held.context.state === 'closed') return;
        held.engine ??= createRainSound(held.context);
        if (held.wanted) held.engine.play(moodNow.current);
      },
      () => setSound(false),
    );
  };
  useEffect(() => {
    audio.current.engine?.setMood(mood);
  }, [mood]);
  useEffect(
    () => () => {
      const held = audio.current;
      if (held.engine) held.engine.destroy();
      else held.context?.close().catch(() => {});
      audio.current = { context: null, engine: null, wanted: false };
    },
    [],
  );

  const pictures = ORDER.filter((id) => id === firstMood || id === mood || both);
  const hint = wipeable && !wiped;

  return (
    <figure className="mx-window" data-mood={mood}>
      <div className="mx-window-frame" ref={frameRef}>
        <Link
          className="mx-window-glass"
          to={pathOf('weekend-list')}
          state={{ opener: 'window' }}
          data-target="weekend-list"
          data-source="window"
          draggable={false}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onClick={onClick}
          {...fetchOn('weekend-list')}
        >
          <span className="mx-hidden">Open: </span>
          {pictures.map((id) => (
            <Picture
              key={id}
              photo={NOTE.moods[id]}
              sizes={SIZES}
              alt={id === mood ? NOTE.moods[id].alt : ''}
              eager={id === firstMood}
              className={`mx-window-room mx-window-room--${id}`}
              imageProps={{
                ref: (image) => {
                  images.current[id] = image;
                  // The top room starts where the crossfade is.
                  if (image && id === 'candlelight') image.parentElement.style.opacity = String(mix.current.now);
                },
                draggable: false,
                'data-photo': id === mood ? '' : undefined,
                onLoad: () => onLoaded(id),
              }}
            />
          ))}
        </Link>
        <canvas ref={canvasRef} className={`mx-rain${gl === 'on' ? ' is-on' : ''}`} aria-hidden="true" />
        {hint && (
          <p className="mx-window-hint" aria-hidden="true">
            {coarse ? WINDOW.hint.touch : WINDOW.hint.pointer}
          </p>
        )}
        <Segmented
          name="window-mood"
          label="The room’s mood"
          tone="glass"
          className="mx-window-moods"
          options={MOOD_CHOICES}
          value={choice}
          onChange={setMoodChoice}
        />
      </div>
      <figcaption className="mx-window-strip">
        <span>{WINDOW.note}</span>
        <span>{WINDOW.saved}</span>
        <span className="mx-tabular">{`${MOOD_NAMES[mood]} room · ${clock}`}</span>
        {AudioContextType && (
          <button
            type="button"
            className="mx-sound"
            aria-pressed={sound}
            onClick={toggleSound}
            onPointerEnter={fetchSound}
            onFocus={fetchSound}
          >
            <SoundIcon on={sound} />
            Rain sound
          </button>
        )}
      </figcaption>
    </figure>
  );
};

export default HeroWindow;
