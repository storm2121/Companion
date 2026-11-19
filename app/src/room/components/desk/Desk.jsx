import { useRef } from 'react';
import { useFlameFilm } from './useFlameFilm';

// The flow desk (prototype Home, RoomDesk, phones and tablets below 1100px): a real wooden top
// running edge to edge under the wall, and the page's own flow of things on it. Wide screens
// get the seated scene instead (DeskScene.jsx).
//
// Its light and shade are baked: the night's dusk and the day's even light (flat tints that
// cross-fade with the mood), the shade along the back edge, the candle's light on the wood (a
// picture), and the objects' CSS shadows. The blended ones live here, on the wood itself, so
// their blend sees the wood and nothing else (desk.css).
//
// The candle's flame is a film (Pexels 7034332, assets/desk/README.md): a flame on black,
// screened onto the wood — black adds nothing, the flame adds light — so it needs no alpha
// and plays in every browser. A blend sees only what shares its layer, so the film lives here
// on the wood. It plays only at night, with motion, with the tab visible and the flame on
// screen (useFlameFilm); if it cannot play, the candle's drawn flame stays (Candle.jsx).

const FLAME = {
  webm: new URL('../../assets/desk/flame.webm', import.meta.url).href,
  mp4: new URL('../../assets/desk/flame.mp4', import.meta.url).href,
};

const Desk = ({ night = true, still = false, children }) => {
  const deskRef = useRef(null);
  const videoRef = useRef(null);

  useFlameFilm(videoRef, {
    night,
    still,
    onShow: (shown) => {
      const desk = deskRef.current;
      if (!desk) return;
      if (shown) desk.dataset.flame = 'video';
      else delete desk.dataset.flame;
    },
  });

  return (
    <div ref={deskRef} className="room-desk is-flow">
      <div className="room-desk-surface" aria-hidden="true">
        <span className="room-desk-dusk" />
        <span className="room-desk-daylight" />
        <span className="room-desk-back" />
        <span className="room-desk-light">
          <span className="room-desk-light-map" />
        </span>
        <video
          ref={videoRef}
          className="room-desk-flamevideo"
          muted
          loop
          playsInline
          preload="auto"
          disablePictureInPicture
          tabIndex={-1}
        >
          <source src={FLAME.webm} type="video/webm" />
          <source src={FLAME.mp4} type="video/mp4" />
        </video>
        <span className="room-desk-front" />
      </div>
      {/* The objects arrive together, once, with the plaque's last line — never one by one. */}
      <div className="room-desk-stage room-rise" style={{ animationDelay: '0.14s' }}>
        {children}
      </div>
    </div>
  );
};

export default Desk;
