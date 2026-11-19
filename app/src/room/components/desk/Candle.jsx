import { useState } from 'react';

// The desk's candle — and the room's light switch. Lit, the room is in Candlelight; blow it
// out and the room turns to the grey day (Rain); light it again for the evening. It writes
// the same preference the You page does (roomPrefs.mood), so the room's own 600ms mood
// cross-fade carries the change.
//
// A real candle: the white pillar from the film whose flame burns above it (Pexels 7034332),
// matted and standing in a small brass dish (assets/desk/README.md). Two grades cross-fade
// with the mood: warm and lit from above by its flame at night, ivory by the window by day.
//
// The flame is that film, screened onto the wood (Desk.jsx). Wherever it cannot play, the drawn
// flame below shows: two paths in their own little SVGs, flickering on the compositor
// (transform only, two periods that never line up, desk.css). The wide screens' candle is the
// stage's (DeskStage.jsx).
//
// Blowing it out sends up one wisp of smoke (~900ms, once).

// The drawn flame's box and the smoke's, in the old drawing's coordinates.
const FLAME_BOX = '46 22 32 50';
const SMOKE_BOX = '46 0 32 72';

const Candle = ({ lit, onToggle, style }) => {
  // Each blow-out mounts a fresh wisp, so it plays once and only then.
  const [wisp, setWisp] = useState(0);

  const toggle = () => {
    if (lit) setWisp((n) => n + 1);
    onToggle?.();
  };

  return (
    <div className="room-desk-candle" style={style}>
      <button
        type="button"
        className="room-desk-candle-button"
        aria-pressed={lit}
        aria-label={lit ? 'Candle lit. Blow out for daylight' : 'Candle out. Light it for the evening'}
        onClick={toggle}
      >
        <span className="room-desk-candle-photo" aria-hidden="true" />

        {/* The drawn flame: shown only where the filmed one cannot play. */}
        <span className="room-desk-flame" aria-hidden="true">
          <svg className="room-desk-flame-outer" viewBox={FLAME_BOX} focusable="false">
            <path d="M62.3 69.6C53.4 63.8 53.4 50.6 62.3 27.2C71.2 50.6 71.2 63.8 62.3 69.6Z" fill="#f4a64f" />
            <path d="M62.3 68.4C56.4 64 56.6 54.4 62.3 38.6C68 54.4 68.2 64 62.3 68.4Z" fill="#fbc56c" />
          </svg>
          <svg className="room-desk-flame-inner" viewBox={FLAME_BOX} focusable="false">
            <path d="M62.3 66.8C59.2 64 59.2 58 62.3 48.6C65.4 58 65.4 64 62.3 66.8Z" fill="#fff4d8" />
            <ellipse cx="62.3" cy="67.6" rx="2.2" ry="1.4" fill="rgba(110, 130, 190, 0.5)" />
          </svg>
        </span>

        {wisp > 0 && (
          <svg key={wisp} className="room-desk-smoke" viewBox={SMOKE_BOX} aria-hidden="true" focusable="false">
            <path
              d="M62.3 66c-4-7 4-12 0-19s3-12 0-19-2-10 1-15"
              fill="none"
              stroke="rgba(214, 206, 196, 0.62)"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
        )}
      </button>
      <span className="room-desk-candle-stamp" aria-hidden="true">
        {lit ? 'LIT' : 'OUT'}
      </span>
    </div>
  );
};

export default Candle;
