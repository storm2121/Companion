import { MOOD_DAY } from '../roomPrefs';

// The room's weather. Three absolutely-positioned, pointer-events:none layers.
//
// The lamp glow is the ONLY gradient in the entire design (non-negotiable #1) —
// the ground itself is a flat colour. No gradient meshes, no glass blur, no blobs.

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

const Atmosphere = ({ mood, grain = true }) => {
  const isDay = mood === MOOD_DAY;

  return (
    <>
      <div className="room-atmos" aria-hidden="true">
        {isDay ? (
          streaks.map((drop) => (
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
          ))
        ) : (
          <>
            <div className="room-lamp-glow" />
            <div className="room-lamp-vignette" />
          </>
        )}
      </div>
      {/* Topmost, over everything including paper. */}
      {grain && <div className="room-grain" aria-hidden="true" />}
    </>
  );
};

export default Atmosphere;
