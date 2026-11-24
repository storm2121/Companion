import { memo, useContext, useEffect, useRef, useState } from 'react';
import { Dot } from '../primitives';
import SheetTags from '../SheetTags';
import { useAuth } from '../../../context/authState';
import { clipPolygon, quadBox, quadMatrix3d, quadSize, quadTransform } from '../../deskProject';
import { giltSmall } from '../../deskStage';
import { saveData, useFlameFilm } from './useFlameFilm';
import { StageSnap, px, usePress } from './stageKit';

// The parts both of the desk's stages draw with (round eight, run 3): round seven's stage (DeskStage.jsx,
// its pictures inlined in its own chunk) and the production table (TableStage.jsx, its pictures fetched
// from public/assets/desk-p1). Moved here from DeskStage.jsx unchanged but for what each stage hands in
// (a picture's URL, a quad), so neither copies the other and neither pulls the other's pictures in.

// Words on a quad: laid out flat at `size` (px), carried onto the quad (stage px, relative to
// `origin`) at the stage's scale.
export const OnQuad = ({ quad, size, scale, origin = [0, 0], className, children, style, as = 'div', ...rest }) => {
  const Tag = as;
  const rel = quad.map(([x, y]) => [x - origin[0], y - origin[1]]);
  const { width, height } = size || quadSize(quad);
  return (
    <Tag className={className} style={{ width: px(width), height: px(height), transform: quadMatrix3d(rel, width, height, scale), ...style }} {...rest}>
      {children}
    </Tag>
  );
};

// Under deskStage.js TOOLED_PX the strip lies over the place's flat gilt at this opacity: where the strip's
// wear leaves the least gold (its alpha 0.45, post.py gilt_fill) the letter is still 85% gold.
const SMALL_GOLD = 0.73;

// A title's or a count's gilt on its label (a quad), in one mood: the gold is the place's gilt strip
// (`stripUrl`: always its 2x file, a few KB; the 1x one halved the wear's grain into a blur) through the
// letters, over a pressed layer (the leather in the letters, where the gold is worn). Large on the
// screen, the mood's impression (an SVG filter) over both, round six's tooled look; small, no filter:
// the press one device pixel below the gold, the wear eased (deskStage.js giltSmall). Carried onto its label by a
// 2D matrix where the label is flat enough (every spine's: deskProject.js quadTransform), its origin
// on a whole device pixel. `mood`: the impression's light ('night' | 'day').
// `lift` (the production table, round eight run 3): the letters never darker than the place's gilt tone (the
// strip lightened onto it, per channel): some strips are lit only along their top (the near stack's), and a
// title in the label's middle came out dark on dark.
export const Gilt = ({ quad, origin, scale, stripUrl, tone, mood, size, lines, className = '', dir = 'auto', flat = false, lift = false, perLine = false }) => {
  const snap = useContext(StageSnap);
  const dpr = snap?.dpr || (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1;
  const rel = quad.map(([x, y]) => [x - origin[0], y - origin[1]]);
  const { width, height } = quadSize(quad);
  const at = snap ? { x: snap.x + Math.round(origin[0] * scale * 100) / 100, y: snap.y + Math.round(origin[1] * scale * 100) / 100, dpr } : null;
  // `flat`: a ghost's lettering (it moves): never the impression's filter, a layer cheaper to draw.
  const small = flat || giltSmall(size, scale, dpr);
  // The strip is the label's own size at 2x (post.py gilt_fill); where rounding a small label to
  // whole px changed its aspect by over 1%, it covers the label instead of stretching.
  const sw = Math.max(2, Math.round(width * 2));
  const sh = Math.max(2, Math.round(height * 2));
  const stretched = Math.abs(sw / sh / (width / height) - 1) > 0.01;
  const text = lines.map((line, i) => <span key={i}>{line}</span>);
  return (
    <OnQuad
      quad={quad}
      origin={origin}
      scale={scale}
      className={`room-stage-gilt ${className}${small ? ' is-small' : ''}`}
      style={{
        transform: quadTransform(rel, width, height, scale, at),
        filter: small ? undefined : `url(#room-stage-impress-${mood})`,
        fontSize: px(size),
        '--gilt-press': small ? `${Math.round((1 / (scale * dpr)) * 1000) / 1000}px` : undefined,
      }}
      aria-hidden="true"
    >
      <span className="room-stage-gilt-press" dir={dir}>
        {text}
      </span>
      <span
        className={`room-stage-gilt-gold${perLine && lines.length > 1 ? ' is-per-line' : ''}`}
        dir={dir}
        style={
          perLine && lines.length > 1
            ? {
                // (The production table, fix run: a title on two or three lines takes the strip's middle band on each
                // line, as one line does: the strip is lit from above, and whole across the label it gave the first
                // line its bright top and the second its dark foot, two tones.)
                '--gilt-strip': `url("${stripUrl}")`,
                '--gilt-tall': px(height),
                '--gilt-under': lift && tone ? `rgb(${tone.map((v) => Math.round(v * 255)).join(', ')})` : small && tone ? `rgba(${tone.map((v) => Math.round(v * 255)).join(', ')}, ${SMALL_GOLD})` : 'transparent',
                '--gilt-blend': lift && tone ? 'lighten' : 'normal',
              }
            : {
                backgroundImage: `url("${stripUrl}")`,
                backgroundSize: stretched ? 'cover' : undefined,
                backgroundColor: lift && tone ? `rgb(${tone.map((v) => Math.round(v * 255)).join(', ')})` : small && tone ? `rgba(${tone.map((v) => Math.round(v * 255)).join(', ')}, ${SMALL_GOLD})` : undefined,
                backgroundBlendMode: lift && tone ? 'lighten' : undefined,
              }
        }
      >
        {text}
      </span>
    </OnQuad>
  );
};

// The impressions: the letters pressed into the leather, lit from the mood's light (by night the
// candle, low on the left: the dark edge in the letters on that side, a warm catch on the other;
// by day the window's light from above, softer). Offsets in the label's own px at 1x; light, so a
// hairline of 1.3 px at the stage's least scale keeps its gold (at 0.6 px and 0.62 it lost half).
const IMPRESSIONS = {
  night: { away: [0.4, -0.2], shade: 0.38, toward: [-0.35, 0.2], catchColour: '#ffd99a', catchOpacity: 0.3 },
  day: { away: [0.08, 0.38], shade: 0.32, toward: [-0.04, -0.3], catchColour: '#fff4dc', catchOpacity: 0.22 },
};

export const Impressions = () => (
  <svg className="room-stage-defs" width="0" height="0" aria-hidden="true" focusable="false">
    <defs>
      {Object.entries(IMPRESSIONS).map(([mood, f]) => (
        <filter key={mood} id={`room-stage-impress-${mood}`} x="-5%" y="-25%" width="110%" height="150%" colorInterpolationFilters="sRGB">
          <feOffset in="SourceAlpha" dx={f.away[0]} dy={f.away[1]} result="away" />
          <feComposite in="SourceAlpha" in2="away" operator="out" result="near" />
          <feFlood floodColor="#000000" floodOpacity={f.shade} />
          <feComposite in2="near" operator="in" result="shade" />
          <feOffset in="SourceAlpha" dx={f.toward[0]} dy={f.toward[1]} result="toward" />
          <feComposite in="SourceAlpha" in2="toward" operator="out" result="far" />
          <feFlood floodColor={f.catchColour} floodOpacity={f.catchOpacity} />
          <feComposite in2="far" operator="in" result="catch" />
          <feMerge>
            <feMergeNode in="SourceGraphic" />
            <feMergeNode in="shade" />
            <feMergeNode in="catch" />
          </feMerge>
        </filter>
      ))}
    </defs>
  </svg>
);

// The frame's picture as a mood's stack draws it (under that mood's light on it and its frame):
// the student's own picture, or the bare backing board. The picture's controls (add, change, take
// down: SceneSlot) are one, above both stacks, drawn clear but for the empty board's "+", which stands
// above the frame's light in the page's ink (under it, round six's dark "+" held 1.6:1 by night).
// `opening`: the frame's opening (a quad, stage px).
export const StagePicture = ({ scale, opening: quad }) => {
  const { profile } = useAuth();
  const url = typeof profile?.roomPrefs?.scene?.url === 'string' ? profile.roomPrefs.scene.url : '';
  const [broken, setBroken] = useState('');
  const opening = quadBox(quad);
  return (
    <div
      className="room-stage-picture is-drawn"
      style={{
        left: px(opening[0] * scale),
        top: px(opening[1] * scale),
        width: px(opening[2] * scale),
        height: px(opening[3] * scale),
        clipPath: clipPolygon(quad, opening, scale),
      }}
    >
      {url && broken !== url ? <img src={url} alt="" decoding="async" onError={() => setBroken(url)} /> : null}
    </div>
  );
};


// Where a dragged book may go, in the room's dashed idiom; the one under the pointer drawn whole.
// `stage`: the stage's size (stage px).
export const DragTargets = ({ targets, over, scale, stage }) => (
  <svg className="room-stage-targets" viewBox={`0 0 ${stage.width} ${stage.height}`} style={{ width: px(stage.width * scale), height: px(stage.height * scale) }} aria-hidden="true">
    {targets.map((t) => (
      <polygon key={t.key || t.place} data-target={t.key || t.place} className={`is-${t.kind}${(t.key || t.place) === over ? ' is-over' : ''}`} points={t.polygon.map(([tx, ty]) => `${tx},${ty}`).join(' ')} vectorEffect="non-scaling-stroke" />
    ))}
  </svg>
);

// A book's menu (right-click, or a long press that does not become a drag): what can be done with it,
// in the room's words (Figtree; dark by night, pale by day; desk.css). Arrow keys move through it;
// Escape, a click elsewhere or a choice close it, focus back on the book.
export const StageMenu = ({ menu, items, onClose }) => {
  const ref = useRef(null);
  useEffect(() => {
    const root = ref.current;
    root?.querySelector('button')?.focus();
    const away = (event) => {
      if (root && !root.contains(event.target)) onClose(false);
    };
    window.addEventListener('pointerdown', away, true);
    return () => window.removeEventListener('pointerdown', away, true);
  }, [menu, onClose]);
  const onKeyDown = (event) => {
    const buttons = [...(ref.current?.querySelectorAll('button') || [])];
    const at = buttons.indexOf(document.activeElement);
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      onClose(true);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      buttons[(at + step + buttons.length) % buttons.length]?.focus();
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      buttons[event.key === 'Home' ? 0 : buttons.length - 1]?.focus();
    }
  };
  // Inside the window, at the pointer (or the book), never past its edges.
  const width = 236;
  const height = items.length * 40 + 12;
  const left = Math.max(8, Math.min(menu.at[0], (typeof window !== 'undefined' ? window.innerWidth : 1440) - width - 8));
  const top = Math.max(8, Math.min(menu.at[1], (typeof window !== 'undefined' ? window.innerHeight : 900) - height - 8));
  return (
    <div ref={ref} className="room-stage-menu" role="menu" aria-label={menu.title} style={{ left: px(left), top: px(top) }} onKeyDown={onKeyDown}>
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role={item.checked === undefined ? 'menuitem' : 'menuitemradio'}
          aria-checked={item.checked === undefined ? undefined : item.checked}
          className={`room-stage-menu-item${item.checked ? ' is-checked' : ''}`}
          onClick={() => {
            onClose(item.key !== 'open');
            item.run();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
};

const Row = ({ note, color, stamp, onOpen }) => (
  <li>
    <button type="button" className="room-stage-row" onClick={() => onOpen(note)}>
      <Dot size={7} color={color} />
      <span className="room-stage-row-text">
        <span className="room-stage-row-title" dir="auto">
          {note.title}
        </span>
        <span className="room-stage-row-stamp">{stamp(note)}</span>
      </span>
    </button>
  </li>
);

// The notebook's two pages. The left one is the day's page: the greeting and the day's sentence
// (the plaque's words, off the wall), the date in its corner, then where you left off. The right
// one is the latest note itself. `quads`: { L, R } (stage px); `size`: the box the words are laid out
// in (the left page's own size at 1x).
export const Pages = memo(function Pages({ notes, colorOf, stamp, onOpen, page, scale, capacity, greeting, status, clock, quads, size }) {
  const latest = notes[0];
  const lines = page.lines.slice(0, capacity.lines);
  // The note's lines fill at most `clamp` lines of the page (whole lines: deskStage.js pageCapacity).
  const text = lines.length ? lines.join('\n') : page.read ? latest?.summary : '';
  const courseColor = latest ? colorOf(latest.classId) : undefined;
  return (
    <>
      <OnQuad quad={quads.L} size={size} scale={scale} className="room-stage-page is-left" as="section" aria-labelledby="room-stage-greeting">
        <header className="room-stage-day">
          <h1 id="room-stage-greeting" className="room-stage-greeting">
            {greeting}
          </h1>
          {clock && <span className="room-stage-clock">{clock}</span>}
        </header>
        {status && (
          <p className="room-stage-day-line" style={{ WebkitLineClamp: capacity.sentence }}>
            {status}
          </p>
        )}
        <hr className="room-stage-page-rule" />
        <h2 id="room-stage-nb-heading" className="room-stage-page-heading">
          Where you left off
        </h2>
        {latest ? (
          <ul className="room-stage-rows">
            {notes.slice(0, capacity.rows).map((note) => (
              <Row key={note.id} note={note} color={colorOf(note.classId)} stamp={stamp} onOpen={onOpen} />
            ))}
          </ul>
        ) : (
          <p className="room-stage-page-empty">Your first note will show up here.</p>
        )}
      </OnQuad>
      <OnQuad quad={quads.R} size={size} scale={scale} className="room-stage-page is-right" as="article">
        {latest && (
          <>
            {(latest.className || latest.kind) && (
              <p className="room-stage-page-meta">
                {latest.className && (
                  <span className="room-stage-page-course" dir="auto">
                    {latest.className}
                  </span>
                )}
                {latest.kind && (
                  <span className="room-stage-page-kind" style={courseColor ? { '--room-course': courseColor } : undefined}>
                    {latest.kind}
                  </span>
                )}
              </p>
            )}
            <h3 className="room-stage-page-title" dir="auto">
              {latest.title}
            </h3>
            {text && capacity.clamp > 0 && (
              <p className="room-stage-page-lines" dir="auto" style={{ WebkitLineClamp: capacity.clamp }}>
                {text}
              </p>
            )}
            {capacity.tags && <SheetTags tags={latest.tags} />}
            <button type="button" className="room-stage-page-action" onClick={() => onOpen(latest)}>
              Continue writing
            </button>
          </>
        )}
      </OnQuad>
    </>
  );
});

// The flame's film: with an alpha channel for the stage (flame-stage.webm, drawn plainly: a screened
// film made the compositor redraw the whole stage for each of its frames), the flow desk's screened
// film where that will not play (Safari: flame.mp4, screened).
const FLAME = {
  webm: new URL('../../assets/desk/flame-stage.webm', import.meta.url).href,
  mp4: new URL('../../assets/desk/flame.mp4', import.meta.url).href,
};
// Safari plays a VP9 film but not its alpha (a black box): there the screened mp4.
const ALPHA_FILM = typeof navigator === 'undefined' || !/^((?!chrome|chromium|android|crios|fxios|edg).)*safari/i.test(navigator.userAgent);
// The film's frame (120 x 240): its wick at (62, 225), its tip near y 35.
const FILM = { width: 120, height: 240, wickX: 62, wickY: 225, tipY: 35 };

// The candle: the room's light switch, baked into the picture. The page adds its film flame at
// the wick (screened — the film is a flame on black), the render's still flame where the film
// cannot play, and one wisp of smoke when it is blown out. `points` (wick, flameTip) and `box` ([x0, y0,
// x1, y1]): its place's; `stillFlame`: the render's own flame, drawn by the stage (a picture element).
export const StageCandle = ({ lit, onToggle, still, scale, points, box, stillFlame = null, onDrag, onMenu, onPrime, onFocus, onBlur, label }) => {
  const rootRef = useRef(null);
  const videoRef = useRef(null);
  const press = usePress();
  const [wisp, setWisp] = useState(0);
  // No film where it will not play (run desk1, D10): by day, with motion still or reduced, or when the
  // browser asks to save data, it is not fetched at all (it was, 48 kB, with the room's pictures) and
  // the render's own flame stands; lighting the candle fetches it.
  const filmed = lit && !still && !saveData();
  useFlameFilm(videoRef, {
    night: lit,
    still: !filmed,
    onShow: (shown) => {
      const root = rootRef.current;
      if (!root) return;
      if (shown) {
        root.dataset.flame = 'video';
        // The alpha film plays plainly; the mp4 (no alpha) is screened.
        root.dataset.film = String(videoRef.current?.currentSrc || '').includes('.webm') ? 'alpha' : 'screen';
      } else delete root.dataset.flame;
    },
  });
  // Its place (round seven, run three): the wick, the flame's tip and the candle's box there.
  const [bx, , bx1, by1] = box;
  const [wx, wy] = points.wick;
  const ty = points.flameTip[1];
  // The film scaled so its wick-to-tip matches the render's, its wick on the wick.
  const k = (wy - ty) / (FILM.wickY - FILM.tipY);
  const film = { left: wx - FILM.wickX * k, top: wy - FILM.wickY * k, width: FILM.width * k, height: FILM.height * k };
  const toggle = (event) => {
    // The click a drag or a long press ends with lights nothing.
    if (!press.click(event)) return;
    if (lit) setWisp((n) => n + 1);
    onToggle?.();
  };
  // Taken like a book (6 css px with the pointer down; on touch after a 350ms long press, which opens
  // its menu if it does not move); a right-click opens its menu (its places by name).
  const onPointerDown = (event) => {
    onPrime?.();
    if (onDrag) press.down(event);
  };
  const onPointerMove = (event) => {
    const start = press.move(event);
    if (start) onDrag(start);
  };
  const onPointerUp = (event) => {
    if (press.up()) onMenu?.([event.clientX, event.clientY]);
  };
  const onContextMenu = (event) => {
    if (!onMenu) return;
    event.preventDefault();
    const r = event.currentTarget.getBoundingClientRect();
    press.spend();
    onMenu(event.clientX || event.clientY ? [event.clientX, event.clientY] : [r.left + r.width / 2, r.top + r.height / 2]);
  };
  return (
    <div ref={rootRef} className={`room-stage-candle${lit ? ' is-lit' : ''}`}>
      <video
        ref={videoRef}
        className="room-stage-flamefilm"
        muted
        loop
        playsInline
        preload={filmed ? 'auto' : 'none'}
        disablePictureInPicture
        tabIndex={-1}
        aria-hidden="true"
        style={{ left: px(film.left * scale), top: px(film.top * scale), width: px(film.width * scale), height: px(film.height * scale) }}
      >
        {ALPHA_FILM && <source src={FLAME.webm} type="video/webm" />}
        <source src={FLAME.mp4} type="video/mp4" />
      </video>
      {stillFlame}
      {wisp > 0 && (
        <svg
          key={wisp}
          className="room-stage-smoke"
          viewBox="46 0 32 72"
          aria-hidden="true"
          focusable="false"
          style={{ left: px((wx - film.width * 0.16) * scale), top: px((ty - film.height * 0.45) * scale), width: px(film.width * 0.32 * scale), height: px(film.height * 0.72 * scale) }}
        >
          <path d="M62.3 66c-4-7 4-12 0-19s3-12 0-19-2-10 1-15" fill="none" stroke="rgba(214, 206, 196, 0.62)" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      )}
      <button
        type="button"
        className="room-stage-candle-button"
        aria-label={label || (lit ? 'Candle lit. Blow out for daylight' : 'Candle out. Light it for the evening')}
        onClick={toggle}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={press.cancel}
        onContextMenu={onContextMenu}
        onFocus={onFocus}
        onBlur={onBlur}
        style={{ left: px(bx * scale), top: px((ty - 6) * scale), width: px((bx1 - bx) * scale), height: px((by1 - ty + 6) * scale) }}
      />
    </div>
  );
};