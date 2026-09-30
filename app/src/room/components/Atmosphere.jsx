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
// its own start, and Still mode and reduced motion stop all of it (room.css).

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

const Candlelight = () => (
  <div className="room-candlelight">
    {/* The picture itself comes from room.css, with a sharper copy for high-density screens. */}
    <div className="room-cl-stage">
      {/* Beyond the glass: mist over the city, the river shimmering, lights, rain. */}
      <div className="room-cl-window">
        <div className="room-cl-mist" />
        <div className="room-cl-water" />
        <div className="room-cl-rain">
          {WINDOW_RAIN.map((drop) => (
            <span
              key={drop.key}
              className="room-cl-streak"
              style={{
                left: `${drop.left}%`,
                animationDuration: `${drop.time}s`,
                animationDelay: `${drop.delay}s`,
                '--a': drop.alpha,
              }}
            />
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

const Atmosphere = ({ mood, scene, grain = true }) => {
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
    weather = <Candlelight />;
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
