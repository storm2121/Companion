import { useEffect, useRef } from 'react';
import { MOOD_CANDLELIGHT, MOOD_DAY } from '../roomPrefs';

// The room's weather. Absolutely-positioned, pointer-events:none layers.
//
// Night was a lamp glow — the ONLY gradient in the original design — over a flat ground.
// Candlelight (owner, 2026-09-29) is a picture instead: a bedroom at night, two candles lit,
// a big window onto a city by a river, the bed soft in the foreground. It is made gently
// alive, never busy:
//   - the candles flicker, and the warmth they throw on the window frame and the wall
//     breathes with them;
//   - rain falls beyond the glass, faint, and now and then a drop slides down the pane;
//   - a few city lights twinkle, the river's reflections shimmer, mist drifts over the city.
// Everything is placed in the PICTURE's own coordinates — the stage is the picture, scaled
// to cover the screen — so the flicker stays on the candles and the rain inside the window
// whatever the screen's shape. Only opacity and transform ever animate, every loop returns to
// its own start, and Still mode and reduced motion stop all of it (room.css; the window's
// rain, which is moved from here, by `useWindowRain`).

const RAIN_STREAKS = 22;

// Deterministic from the index so the field never reshuffles on re-render, and the
// negative delays mean it is already full on first paint rather than starting empty.
const streaks = Array.from({ length: RAIN_STREAKS }, (_, i) => ({
  key: i,
  left: `${i * 4.6 + (i % 3) * 1.3}%`,
  height: `${90 + ((i * 37) % 121)}px`,
  duration: `${(5 + ((i * 17) % 37) / 10).toFixed(1)}s`,
  delay: `${-(i * 0.7).toFixed(1)}s`,
}));

/* ── Candlelight, in the picture's coordinates (percent of its width / height) ─────── */

// Rain beyond the glass: thin, faint, a little slanted, at a few speeds.
const WINDOW_RAIN = Array.from({ length: 28 }, (_, i) => ({
  key: i,
  left: (i * 3.7 + (i % 5) * 0.9) % 100,
  time: 1.3 + ((i * 7) % 10) / 10,
  delay: -((i * 0.41) % 2.3),
  alpha: 0.06 + ((i * 13) % 8) / 100,
}));

// The streaks fall by element.animate(), not by a CSS animation. A CSS animation has to wake
// the page at every loop restart (the browser owes it an `animationiteration` event, and React
// listens for those at the root), and 28 streaks restarting every 1.3 to 2.2 s kept the page
// restyling about fifty times a second on every room page: 8 to 17% of the main thread, at
// rest. The same keyframes from element.animate() fire no events, so the compositor moves the
// rain alone (measured: 120 ms of style work per 3 s before, 2 ms after). Same keyframes, same
// durations, same delays: the picture is unchanged.
const RAIN_FALL = [{ transform: 'translateY(-12%)' }, { transform: 'translateY(100%)' }];

// CSS cannot stop these (room.css's Still and reduced-motion rules reach CSS animations only),
// so both are honoured here. Stopped, a streak rests above the glass, out of sight, exactly
// where `animation: none` used to leave it.
// Owner fixes 3 (2026-11-23): and they fall only while the backdrop is DRAWN. Under the desk and
// under an open book the backdrop is `display: none` (desk.css, book.css), which stops its CSS
// animations but not these: 28 streaks kept "running" on nothing, and the browser ran a whole
// frame for them at the screen's rate (measured at rest on a 144 Hz screen: 144 style recalcs a
// second and 61 to 65 ms of main-thread work per second with the desk showing, 27 to 35 ms per
// second with a book open; with them paused 4 ms and 0). They are paused while the backdrop has
// no box and go on from where they were when it has one again.
const useWindowRain = (still) => {
  const boxRef = useRef(null);
  useEffect(() => {
    const box = boxRef.current;
    if (!box || still || typeof box.animate !== 'function') return undefined;
    const quiet = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    let falling = [];
    const watched = typeof IntersectionObserver === 'function';
    let drawn = !watched;
    const stop = () => {
      falling.forEach((animation) => animation.cancel());
      falling = [];
    };
    const start = () => {
      stop();
      if (quiet?.matches) return;
      falling = WINDOW_RAIN.map((drop, index) =>
        box.children[index]?.animate(RAIN_FALL, {
          duration: drop.time * 1000,
          delay: drop.delay * 1000,
          iterations: Infinity,
        }),
      ).filter(Boolean);
      if (!drawn) falling.forEach((animation) => animation.pause());
    };
    start();
    // (An element with no box never intersects, and the observer answers in the frame it gets one.)
    const seen = watched
      ? new IntersectionObserver((entries) => {
          drawn = entries[entries.length - 1].isIntersecting;
          falling.forEach((animation) => (drawn ? animation.play() : animation.pause()));
        })
      : null;
    seen?.observe(box.closest('.room-atmos') || box);
    quiet?.addEventListener?.('change', start);
    return () => {
      quiet?.removeEventListener?.('change', start);
      seen?.disconnect();
      stop();
    };
  }, [still]);
  return boxRef;
};

// Drops on the pane itself, sliding down slowly, each fading before its loop restarts.
const PANE_DROPS = [
  { left: 14, size: 5, time: 13, delay: -3 },
  { left: 33, size: 4, time: 16, delay: -11 },
  { left: 52, size: 6, time: 14, delay: -6 },
  { left: 71, size: 4, time: 17, delay: -14 },
  { left: 88, size: 5, time: 15, delay: -1 },
];

// City lights that twinkle — on the bridge, the towers and across the water.
const CITY_LIGHTS = [
  { x: 22.6, y: 48.4, time: 7, delay: -1 },
  { x: 26.9, y: 48.2, time: 9, delay: -4 },
  { x: 31.5, y: 48.3, time: 6, delay: -2 },
  { x: 36.2, y: 48.2, time: 10, delay: -7 },
  { x: 29.1, y: 41.4, time: 8, delay: -3 },
  { x: 33.7, y: 39.8, time: 11, delay: -6 },
  { x: 47.2, y: 40.4, time: 7, delay: -5 },
  { x: 56.1, y: 44.6, time: 9, delay: -8 },
  { x: 66.3, y: 36.8, time: 12, delay: -2 },
  { x: 73.2, y: 41.1, time: 8, delay: -6 },
  { x: 79.1, y: 42.5, time: 10, delay: -9 },
  { x: 61.7, y: 54.9, time: 11, delay: -4 },
];

const Candlelight = ({ still }) => {
  const rainRef = useWindowRain(still);
  return (
  <div className="room-candlelight">
    {/* The picture itself comes from room.css, with a sharper copy for high-density screens. */}
    <div className="room-cl-stage">
      {/* Beyond the glass: mist over the city, the river shimmering, lights, rain. */}
      <div className="room-cl-window">
        <div className="room-cl-mist" />
        <div className="room-cl-water" />
        <div className="room-cl-rain" ref={rainRef}>
          {WINDOW_RAIN.map((drop) => (
            <span key={drop.key} className="room-cl-streak" style={{ left: `${drop.left}%`, '--a': drop.alpha }} />
          ))}
        </div>
        {PANE_DROPS.map((drop) => (
          <span
            key={drop.left}
            className="room-cl-drop"
            style={{
              left: `${drop.left}%`,
              '--s': `${drop.size}px`,
              animationDuration: `${drop.time}s`,
              animationDelay: `${drop.delay}s`,
            }}
          />
        ))}
        <div className="room-cl-fog" />
      </div>
      {CITY_LIGHTS.map((light) => (
        <span
          key={`${light.x}-${light.y}`}
          className="room-cl-light"
          style={{
            left: `${light.x}%`,
            top: `${light.y}%`,
            animationDuration: `${light.time}s`,
            animationDelay: `${light.delay}s`,
          }}
        />
      ))}
      {/* The warmth the candles throw, then the candles themselves. */}
      <div className="room-cl-spill room-cl-spill--left" />
      <div className="room-cl-spill room-cl-spill--right" />
      <div className="room-cl-flame room-cl-flame--left" />
      <div className="room-cl-flame room-cl-flame--right" />
    </div>
  </div>
  );
};

const Atmosphere = ({ mood, scene, grain = true, still = false }) => {
  const isDay = mood === MOOD_DAY;

  let weather;
  if (isDay) {
    weather = streaks.map((drop) => (
      <span
        key={drop.key}
        className="room-rain-drop"
        style={{
          left: drop.left,
          height: drop.height,
          animationDuration: drop.duration,
          animationDelay: drop.delay,
        }}
      />
    ));
  } else if (scene === MOOD_CANDLELIGHT) {
    weather = <Candlelight still={still} />;
  } else {
    weather = (
      <>
        <div className="room-lamp-glow" />
        <div className="room-lamp-vignette" />
      </>
    );
  }

  return (
    <>
      <div className="room-atmos" aria-hidden="true">
        {weather}
      </div>
      {/* Topmost, over everything including paper. */}
      {grain && <div className="room-grain" aria-hidden="true" />}
    </>
  );
};

export default Atmosphere;
