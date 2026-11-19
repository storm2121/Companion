import { createContext, memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import SceneSlot from '../SceneSlot';
import { Dot } from '../primitives';
import SheetTags from '../SheetTags';
import scene from '../../assets/desk/scene.json';
import { useAuth } from '../../../context/authState';
import { clipPolygon, quadBox, quadMatrix3d, quadSize, quadTransform } from '../../deskProject';
import {
  LONG_PRESS_MS,
  STAGE_TYPE,
  SPINE_BASE,
  arrangePiles,
  candlePlaces,
  candleRing,
  dragTargets,
  isNightKey,
  isDrag,
  isNearPlace,
  pickTarget,
  pointInPolygon,
  fitSpineCount,
  fitSpineTitle,
  ghostPlace,
  giltSmall,
  moreSize,
  pageCapacity,
  pictureDensity,
  pileHits,
  spineFloor,
  spineLook,
  stageFit,
  stageType,
} from '../../deskStage';
import { textDirection } from '../../deskLayout';
import StageCard from './StageCard';
import { useFlameFilm } from './useFlameFilm';

// The desk as Blender rendered it (prototype Home, RoomDesk on wide screens). One seated
// camera (room-harness/blender): the empty room (its table, its window onto a photographed town,
// its shelf) is one picture per mood; by night the candle's light on it is the lit room, a second
// opaque picture over the dark one (round seven: no blend at frame time; its opacity is the light's
// in the swap), breathing a little only around the candle (the dark room there, faded in and out a
// few percent over it); the frame, each pile position, the notebook on its stand,
// the candle and the scrap are cutouts carrying their own baked shadows, stacked far to near.
// The page adds the words — the notebook's, each book's title on its
// spine, the scrap's real field, the Home's picture in the frame — on the quads the render
// wrote into scene.json, each through one homography (deskProject.js). Nothing moves the
// camera; at rest only the flame's film and the light's opacity change.
//
// The books are leather (round six): the render is neutral and the page dyes each book's leather
// and its label with the leathers its course's colour picks (deskStage.js spineLook), and letters
// its title and count in gilt: the letters are filled with the place's gilt strip (the label
// rendered as solid gilt under the room's light, so they carry the candle's glint and match the
// fillets beside them; worn where the strip is), over a pressed layer, with an impression lit
// from the mood's light (the SVG filters below).
//
// The render is a native frame (1800 x 1080 at 1x) around a 1440 x 810 design crop: a 1440 x 810
// window shows the crop, a bigger one more of the room around it (deskStage.js stageFit).
//
// Night and day are two whole stacks of pictures (round seven: one soft choreography, never a
// "boom"). Each mood's stack is everything of that mood's pictures, drawn exactly as at rest: the
// room, its surround and light, the frame's picture and light, the frame, the notebook, candle and
// card, and every book (its shadow, its picture, its dyes), in one isolated group painted flat, then
// every book's gilt last (each title and count is drawn through a 3D transform, a layer of its own:
// placed among the books it split the stack into dozens of layers, each later book's blend another
// pass; last, it splits nothing; no label is ever under a book above it). Both are mounted once the
// other mood is decoded; the candle's click turns the stage's data-room over, and the night's stack,
// always over the day's, runs ONE opacity transition on the swap's curve: an exact crossfade (opaque
// over opaque) for the cost of one layer, where a hundred crossfading layers (round seven's first
// try: every book's picture, shadow, dyes and gilt each fading) ran the swap at under 20 frames a
// second. The candle's light inside it has its own timing. Above both, what belongs to no mood: the
// books' hit areas, the dashed places, the notebook's words, the card's field, the frame's picture's
// own controls, the candle and its flame; the words turn their colour on the same curve. A click
// mid-swap turns it round from where it is. Still and reduced motion: at once.

const FILES = import.meta.glob('../../assets/desk/*.webp', { eager: true, query: '?url', import: 'default' });
// The flame's film: with an alpha channel for the stage (flame-stage.webm, drawn plainly: a screened
// film made the compositor redraw the whole stage for each of its frames), the flow desk's screened
// film where that will not play (Safari: flame.mp4, screened).
const FLAME = {
  webm: new URL('../../assets/desk/flame-stage.webm', import.meta.url).href,
  mp4: new URL('../../assets/desk/flame.mp4', import.meta.url).href,
};
const file = (name) => FILES[`../../assets/desk/${name}`];
// Safari plays a VP9 film but not its alpha (a black box): there the screened mp4.
const ALPHA_FILM = typeof navigator === 'undefined' || !/^((?!chrome|chromium|android|crios|fxios|edg).)*safari/i.test(navigator.userAgent);

// The film's frame (120 x 240): its wick at (62, 225), its tip near y 35.
const FILM = { width: 120, height: 240, wickX: 62, wickY: 225, tipY: 35 };

// Fixed sizes the words are laid out at, then carried onto their quads (the stage scales them).
// Laid out at the left page's own size at 1x (its mean edges), so a 22px greeting is 22px in the
// design crop.
const PAGE = (({ width, height }) => ({ width: Math.round(width), height: Math.round(height) }))(quadSize(scene.quads.pageL));
// The capture card: laid out at its own size at 1x (its quad's mean edges), like the pages.
const SCRAP = (({ width, height }) => ({ width: Math.round(width), height: Math.round(height) }))(quadSize(scene.quads.scrap));
// The card's padding across (desk.css .room-stage-scrap-paper).
const CARD_PAD = 14;

const px = (n) => `${Math.round(n * 100) / 100}px`;

// Every word kind's size at this scale (deskStage.js stageType: max(its own, 13 css px)), for
// desk.css: --room-stage-type-<kind>.
const typeVars = (scale) =>
  Object.fromEntries(Object.keys(STAGE_TYPE).map((kind) => [`--room-stage-type-${kind.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`, px(stageType(kind, scale))]));

// A hit area (a polygon in stage px, deskStage.js pileHits) as a button's box and clip, relative
// to its holder's box origin [x, y].
const hitStyle = (polygon, origin, scale) => {
  const box = quadBox(polygon);
  return {
    left: px((box[0] - origin[0]) * scale),
    top: px((box[1] - origin[1]) * scale),
    width: px(box[2] * scale),
    height: px(box[3] * scale),
    clipPath: clipPolygon(polygon, box, scale),
  };
};
const unionBox = (a, b) => {
  const x = Math.min(a[0], b[0]);
  const y = Math.min(a[1], b[1]);
  return [x, y, Math.max(a[0] + a[2], b[0] + b[2]) - x, Math.max(a[1] + a[3], b[1] + b[3]) - y];
};

// The 2x files when a stage px is drawn at 1.25 device px or more, else the 1x ones (and the 1x
// when the browser asks to save data): deskStage.js pictureDensity.
const saveData = () =>
  typeof navigator !== 'undefined' &&
  (Boolean(navigator.connection?.saveData) || Boolean(window.matchMedia?.('(prefers-reduced-data: reduce)').matches));
const pick = (rec, scale) => file(pictureDensity(scale, typeof window !== 'undefined' ? window.devicePixelRatio : 1, saveData()) === 2 ? rec.x2 : rec.x1);
// The scale the pictures are fetched for: the fit the stage ends at (DeskStage provides it), so a
// picture is fetched once, at one density.
const DensityScale = createContext(1);

// A picture placed at its 1x box (less an origin), scaled with the stage. A shadow's files are
// smaller than the box (`res`): the browser draws them up.
const Picture = ({ rec, scale, origin = [0, 0], className, eager = false, ...rest }) => {
  const [x, y, w, h] = rec.box;
  const densityScale = useContext(DensityScale);
  return (
    <img
      {...rest}
      className={className}
      src={pick(rec, densityScale)}
      width={w}
      height={h}
      alt=""
      decoding="async"
      fetchPriority={eager ? 'high' : 'auto'}
      draggable={false}
      style={{ left: px((x - origin[0]) * scale), top: px((y - origin[1]) * scale), width: px(w * scale), height: px(h * scale) }}
    />
  );
};

// A picture's file as the page will draw it, loaded and decoded off the page; settles either way.
const decodeOne = (rec, scale) => {
  const img = new Image();
  img.decoding = 'async';
  img.src = pick(rec, scale);
  return img.decode();
};

// The spines' faces (EB Garamond 700 for titles, Amiri 700 for their Arabic, Spectral SC 700 for
// counts; desk.css), loaded with the pictures; settles either way. Amiri only when a title has Arabic.
const spineFace = (arabic = false) =>
  typeof document !== 'undefined' && document.fonts?.load
    ? Promise.all([
        document.fonts.load(`700 ${SPINE_BASE}px "EB Garamond"`, 'Ab'),
        document.fonts.load(`700 ${SPINE_BASE}px "Spectral SC"`, '0123456789'),
        arabic ? document.fonts.load(`700 ${SPINE_BASE}px "Amiri"`, 'عرب') : null,
      ]).catch(() => null)
    : Promise.resolve();

// The books' shadows past the frame (run three, scene.json shadowWide: the surround is rendered
// without the piles), for the places given; loaded and drawn only with the surround.
const wideShadowsOf = (m, places) => places.map((place) => bookRec(m, place)?.shadowWide).filter(Boolean);
// The room past the frame (scene.json surround), a mood's pictures of it (by night, lit too).
const surroundOf = (m) => (scene.surround?.[m] ? [scene.surround[m].base, scene.surround[m].lit].filter(Boolean) : []);

// The candle by day at a place: its picture and its link (its shadow on the room), [] where scene.json
// has no candle places (the candle is then the day set's own picture, images.day.candle).
const dayCandleOf = (place) => {
  const day = scene.candles?.[place]?.day || scene.candles?.C0?.day;
  return day ? [day.link, day.candle].filter(Boolean) : [];
};
// The candle's points and box at a place (its wick, the flame's tip; [x0, y0, x1, y1]): scene.json's own
// for today's.
const candleAt = (place) => {
  const c = scene.candles?.[place];
  return { points: c?.points || scene.points, box: c?.box || scene.boxes.candle };
};

// A book place's records in a mood (scene.json): a pile place's (images.slabs) or a near place's
// (images.near, round seven: a book brought closer, lying flat on the near table, cover up).
const bookRec = (m, place) => (isNearPlace(place) ? scene.images[m].near?.[place] : scene.images[m].slabs[place]);
// Its labels: a pile book's on its spine, a near book's on its cover (the title's inside its gilt
// rules, the count's on a plate in the corner).
const titleQuadOf = (place) => (isNearPlace(place) ? scene.quads.coverLabels?.[place] : scene.quads.spineLabels?.[place]);
const countQuadOf = (place) => (isNearPlace(place) ? scene.quads.coverCounts?.[place] : scene.quads.spineCounts?.[place]);
// Its face, where the hover's rim and the flight to the course page start: its spine, or its cover.
const faceOf = (place) => (isNearPlace(place) ? scene.quads.covers[place] : scene.quads.spines[place]);

// Every picture a mood draws: the room, its light (lit, breath), the frame, the piles in use (each book, its
// shadow and its dye's mask), the notebook, the candle, the card; the surround when it is wanted.
const picturesOf = (m, books, withSurround = false, candle = 'C0') => {
  const imgs = scene.images[m];
  const recs = ['base', 'lit', 'breath', 'frameLight', 'frame', 'frameGlass', 'notebook', 'candle', 'scrap'].map((k) => imgs[k]);
  // By day the candle and its shadow are its place's (run three: scene.json candles.<place>.day).
  if (m === 'day') recs.push(...dayCandleOf(candle));
  if (withSurround) recs.push(...surroundOf(m), ...wideShadowsOf(m, books));
  books.forEach((place) => {
    const slab = bookRec(m, place);
    if (!slab) return;
    // The dyes' masks at the book's own density (round seven: always the 2x files, they cost the swap
    // an 80ms frame on the Intel UHD, the hidden stack's masks decoded again at its first frame).
    const masks = ['leather', 'label'].map((part) => slab[part] && { ...slab[part], box: slab[`${part}Box`] });
    recs.push(slab, slab.shadow, ...masks, slab.plate, slab.gilt?.title, slab.gilt?.count);
  });
  return recs.filter(Boolean);
};

// Which moods are on the page. `room` is the mood the room is at (or going to): the candle's wish
// once that mood's pictures are ALL decoded (or after 4s, whatever is in), so the room arrives whole,
// never a candle's light over a room not yet drawn. The first mood's pictures (with the surround when
// the window wants it, so the room is never seen growing) are decoded before the stage shows; once it
// is in, the other mood's in idle time (not when the browser asks to save data), so the candle's
// click turns the room at once. Every decoded mood's stack is mounted (the other one unseen, its
// layer ready), so the click only turns data-room over. `leaving` is the mood the room has just
// left, until the swap's transitions have finished (their own `finished` promises, never a timer, so
// a swap held still for the harness's frames stays whole): the stage is `data-swapping` meanwhile.
// The moods: day, then each candle place's night (round seven, run three), in that order on the stage
// (a later one over an earlier one).
const ORDER = ['day', 'night', ...Object.values(scene.candles || {}).map((c) => c.night).filter((m) => m !== 'night' && scene.images[m])];
const useMoods = (mood, books, scale, wantSurround, stageRef, arabic = false, nightKey = 'night', candle = 'C0') => {
  const [ready, setReady] = useState({});
  const [surroundReady, setSurroundReady] = useState({});
  const [state, setState] = useState({ room: mood, leaving: null });
  if (state.room !== mood && ready[mood]) setState({ room: mood, leaving: state.room });
  const { room, leaving } = state;
  const readyNow = useRef(ready);
  useEffect(() => {
    readyNow.current = ready;
  });
  // The pictures waited for are a mood's at the size of the moment it was asked for; a later resize
  // or a new book does not hold the room back again.
  const wanted = useRef({ books, scale, wantSurround, arabic, candle });
  useEffect(() => {
    wanted.current = { books, scale, wantSurround, arabic, candle };
  });
  // The wished mood's pictures, when they are not in: at first the room's own (the stage shows once
  // they are), later a mood the idle preload had not reached yet (the flame answers the click at once
  // and the room follows when they are in).
  const wishReady = Boolean(ready[mood]);
  useEffect(() => {
    if (wishReady) return undefined;
    let alive = true;
    const { books: places, scale: at, wantSurround: sur, arabic: rtl, candle: where } = wanted.current;
    const done = () => {
      if (!alive) return;
      setReady((r) => (r[mood] ? r : { ...r, [mood]: true }));
      if (sur) setSurroundReady((r) => (r[mood] ? r : { ...r, [mood]: true }));
    };
    Promise.allSettled([...picturesOf(mood, places, sur, where).map((rec) => decodeOne(rec, at)), spineFace(rtl)]).then(done);
    const timer = setTimeout(done, 4000);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [mood, wishReady]);
  // Once the room's mood is in, the other one's pictures are decoded in idle time (a 2s timeout).
  const roomReady = Boolean(ready[room]);
  useEffect(() => {
    // Only the chosen candle place's night is ever fetched (another's only once the candle is moved).
    const other = isNightKey(room) ? 'day' : nightKey;
    if (!roomReady || readyNow.current[other] || saveData()) return undefined;
    let alive = true;
    const run = () => {
      const { books: places, scale: at, wantSurround: sur, candle: where } = wanted.current;
      Promise.allSettled(picturesOf(other, places, sur, where).map((rec) => decodeOne(rec, at))).then(() => {
        if (!alive) return;
        setReady((r) => (r[other] ? r : { ...r, [other]: true }));
        if (sur) setSurroundReady((r) => (r[other] ? r : { ...r, [other]: true }));
      });
    };
    const idle = typeof window.requestIdleCallback === 'function';
    const handle = idle ? window.requestIdleCallback(run, { timeout: 2000 }) : setTimeout(run, 2000);
    return () => {
      alive = false;
      if (idle) window.cancelIdleCallback(handle);
      else clearTimeout(handle);
    };
  }, [room, roomReady, nightKey]);
  // The surround, when the window comes to reach past the frame after the room is in (a resize):
  // drawn once decoded, the fit widening with it.
  useEffect(() => {
    if (!roomReady || !wantSurround || surroundReady[room] || !surroundOf(room).length) return undefined;
    let alive = true;
    Promise.allSettled([...surroundOf(room), ...wideShadowsOf(room, wanted.current.books)].map((rec) => decodeOne(rec, wanted.current.scale))).then(() => {
      if (alive) setSurroundReady((r) => ({ ...r, [room]: true }));
    });
    return () => {
      alive = false;
    };
  }, [room, roomReady, wantSurround, surroundReady]);
  // The swap is over once every transition it started has finished; a new swap first (a click
  // mid-swap) makes its own.
  useEffect(() => {
    const stage = stageRef.current;
    if (!leaving) return undefined;
    let alive = true;
    const running = stage?.getAnimations ? stage.getAnimations({ subtree: true }).filter((a) => typeof CSSTransition !== 'undefined' && a instanceof CSSTransition) : [];
    Promise.allSettled(running.map((a) => a.finished)).then(() => {
      if (alive) setState((s) => (s.room === room && s.leaving === leaving ? { room, leaving: null } : s));
    });
    return () => {
      alive = false;
    };
  }, [room, leaving, stageRef]);
  const list = ORDER.filter((m) => m === room || m === leaving || ready[m]);
  const surroundIn = wantSurround && Object.values(surroundReady).some(Boolean);
  return { list, room, leaving, swapping: Boolean(leaving), ready: roomReady, surroundIn, surroundOf: (m) => Boolean(surroundIn && surroundReady[m]) };
};

// Words on a quad: laid out flat at `size` (px), carried onto the quad (stage px, relative to
// `origin`) at the stage's scale.
const OnQuad = ({ quad, size, scale, origin = [0, 0], className, children, style, as = 'div', ...rest }) => {
  const Tag = as;
  const rel = quad.map(([x, y]) => [x - origin[0], y - origin[1]]);
  const { width, height } = size || quadSize(quad);
  return (
    <Tag className={className} style={{ width: px(width), height: px(height), transform: quadMatrix3d(rel, width, height, scale), ...style }} {...rest}>
      {children}
    </Tag>
  );
};

// Each pile's hit areas, at least 24 css px tall at the scale (deskStage.js pileHits): its books
// bottom to top, then the dashed place if it is on that pile; a near book's, its whole outline (it
// lies in front of everything: its hit area is drawn last).
const stageHits = (books, dashedPlace, scale) => {
  const out = {};
  ['L', 'R'].forEach((side) => {
    const pile = books.filter((place) => place[0] === side).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
    if (dashedPlace && dashedPlace[0] === side) pile.push(dashedPlace);
    Object.assign(out, pileHits(scene.quads, pile, 24 / scale));
  });
  books.filter(isNearPlace).forEach((place) => {
    out[place] = scene.quads.nearHulls[place];
  });
  return out;
};

// A place's silhouette: a pile position's top face's far corners, then its spine's four; a near
// book's outline (the hull of its corners as the camera sees them).
const silhouette = (place) => {
  if (isNearPlace(place)) return scene.quads.nearHulls[place];
  const top = scene.quads.tops[place];
  const spine = scene.quads.spines[place];
  return [top[0], top[1], spine[1], spine[2], spine[3], spine[0]];
};

// Where the stage's origin is in the page and the device pixel ratio ({ x, y, dpr }, css px), for
// the lettering's origin on whole device pixels; null until measured.
const StageSnap = createContext(null);

// Under deskStage.js TOOLED_PX the strip lies over the place's flat gilt at this opacity: where the strip's
// wear leaves the least gold (its alpha 0.45, post.py gilt_fill) the letter is still 85% gold.
const SMALL_GOLD = 0.73;

// A title's or a count's gilt on its label (a quad), in one mood: the gold is the place's gilt strip
// (always its 2x file: a few KB, and the 1x one halved the wear's grain into a blur) through the
// letters, over a pressed layer (the leather in the letters, where the gold is worn). Large on the
// screen, the mood's impression (an SVG filter) over both, round six's tooled look; small, no filter:
// the press one device pixel below the gold, the wear eased (deskStage.js giltSmall). Carried onto its label by a
// 2D matrix where the label is flat enough (every spine's: deskProject.js quadTransform), its origin
// on a whole device pixel.
const Gilt = ({ quad, origin, scale, strip, tone, mood, size, lines, className = '', dir = 'auto' }) => {
  const snap = useContext(StageSnap);
  const dpr = snap?.dpr || (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1;
  const rel = quad.map(([x, y]) => [x - origin[0], y - origin[1]]);
  const { width, height } = quadSize(quad);
  const at = snap ? { x: snap.x + Math.round(origin[0] * scale * 100) / 100, y: snap.y + Math.round(origin[1] * scale * 100) / 100, dpr } : null;
  const small = giltSmall(size, scale, dpr);
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
        className="room-stage-gilt-gold"
        dir={dir}
        style={{
          backgroundImage: `url("${file(strip.x2)}")`,
          backgroundSize: stretched ? 'cover' : undefined,
          backgroundColor: small && tone ? `rgba(${tone.map((v) => Math.round(v * 255)).join(', ')}, ${SMALL_GOLD})` : undefined,
        }}
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

const Impressions = () => (
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

// A book's words on its spine at a scale: the title as it fits its label (deskStage.js fitSpineTitle:
// one line, two, smaller, shortened, cut at a word; never more than 32 letters; never under 13 css
// px, so a small scale shortens it more) and the count likewise, or none where it will not fit at the
// floor. The whole title (and the count) are the book's accessible name.
// A near book's title on its cover's label: up to 22px (the label is wider and taller than a spine's;
// its two lines allowed), the same rule and floor.
const COVER_BASE = 22;
const spineWords = (course, place, scale) => {
  const floor = spineFloor(scale);
  const near = isNearPlace(place);
  const labelQuad = titleQuadOf(place);
  const countQuad = countQuadOf(place);
  let title = { lines: [course.name], size: 17 };
  if (labelQuad) {
    const label = quadSize(labelQuad);
    title = near
      ? fitSpineTitle(course.name, { width: label.width - 6, height: label.height - 4, spineHeight: Infinity, base: COVER_BASE, floor })
      : fitSpineTitle(course.name, { width: label.width - 2, height: label.height, spineHeight: quadSize(faceOf(place)).height, floor });
  }
  let numeral = null;
  if (countQuad && course.noteCount) {
    const label = quadSize(countQuad);
    const fit = fitSpineCount(course.noteCount, { width: label.width - 1, height: label.height, floor });
    numeral = fit.text ? fit : null;
  }
  return { title, numeral, rtl: textDirection(course.name) === 'rtl' };
};

// The piles from the courses and their arrangement: each course by id, the places in use and "and N
// more", the ghost of the next book, the dashed place on top of its pile (for the hit areas), and the
// books bottom to top, pile L then pile R (each book's shadow drawn before the books above it), then
// the near places (nearest the camera: drawn last, their shadows over both piles).
const SIDE_ORDER = { L: 0, R: 1, N: 2 };
const pileLayout = (courses, arrangement) => {
  const arranged = arrangement || arrangePiles(courses.map((course) => course.id), null);
  const byId = new Map(courses.map((course) => [course.id, course]));
  const places = { books: arranged.books.map((book) => book.place), more: arranged.more };
  const ghost = ghostPlace(places.books, places.more);
  const books = [...arranged.books].sort((a, b) =>
    a.place[0] === b.place[0] ? Number(a.place.slice(1)) - Number(b.place.slice(1)) : SIDE_ORDER[a.place[0]] - SIDE_ORDER[b.place[0]],
  );
  return { arranged, byId, places, ghost, dashedPlace: places.more?.place || ghost, books };
};

// A book place's box: both moods' pictures of it (one origin for everything the book draws).
const slabBox = (place) =>
  ORDER.map((m) => scene.images[m] && bookRec(m, place))
    .filter(Boolean)
    .map((rec) => rec.box)
    .reduce(unionBox);

// A book as one mood draws it, inside that mood's stack: its shadow on the table, the wall and the
// books below; the book; its leather and label dyed with its course's leathers (multiplied under
// the mood's masks: the leather's and the label's share of the light as the book lies over that
// mood's room, their soft edges letting the room through, left undyed). Its gilt is above the
// stacks (SlabHit).
// While it is dragged (`dragging`) the book's picture, dyes and gilt are hidden in the stacks (its
// shadow and its place's look stay behind; the drag layer draws it under the pointer); arriving at
// a new place (`arriving`) they fade in over 200ms. `bare`: no shadow (the drag layer's copy).
// `plate`: its count's plate (run three: its own picture, scene.json plate; drawn, and dyed with the
// label's leather under its own picture as mask, only where a count is lettered on it).
const SlabVisual = ({ course, place, mood, scale, dragging = false, arriving = false, bare = false, plate = false }) => {
  const densityScale = useContext(DensityScale);
  const box = slabBox(place);
  const [x, y] = box;
  const rec = bookRec(mood, place);
  const tints = spineLook(scene, mood, place, course.color);
  return (
    <div
      className={`room-stage-slab${dragging ? ' is-dragging' : ''}${arriving ? ' is-arriving' : ''}`}
      data-place={place}
      style={{ left: px(x * scale), top: px(y * scale), width: px(box[2] * scale), height: px(box[3] * scale) }}
    >
      {rec.shadow && !bare && <Picture rec={rec.shadow} origin={[x, y]} scale={scale} className="room-stage-slab-img room-stage-slab-shadow" />}
      <div className="room-stage-slab-visual">
        <Picture rec={rec} origin={[x, y]} scale={scale} className="room-stage-slab-img" />
        {[
          ['leather', tints.tint],
          ['label', tints.labelTint],
        ].map(([part, tint]) => {
          if (!rec[part]) return null;
          const [cx, cy, cw, ch] = rec[`${part}Box`];
          return (
            <span
              key={part}
              className="room-stage-slab-dye"
              style={{
                left: px((cx - x) * scale),
                top: px((cy - y) * scale),
                width: px(cw * scale),
                height: px(ch * scale),
                backgroundColor: tint,
                maskImage: `url("${pick(rec[part], densityScale)}")`,
                WebkitMaskImage: `url("${pick(rec[part], densityScale)}")`,
              }}
            />
          );
        })}
        {plate && rec.plate && (
          <>
            <Picture rec={rec.plate} origin={[x, y]} scale={scale} className="room-stage-slab-img" />
            <span
              className="room-stage-slab-dye"
              style={{
                left: px((rec.plate.box[0] - x) * scale),
                top: px((rec.plate.box[1] - y) * scale),
                width: px(rec.plate.box[2] * scale),
                height: px(rec.plate.box[3] * scale),
                backgroundColor: tints.labelTint,
                maskImage: `url("${pick(rec.plate, densityScale)}")`,
                WebkitMaskImage: `url("${pick(rec.plate, densityScale)}")`,
              }}
            />
          </>
        )}
      </div>
    </div>
  );
};

// A book's title and count in one mood's gilt, in that mood's stack (after every book). Lit (hovered,
// focused: data-lit, data-focus, data-press, set by its hit area; lifted, picked: the classes) it
// brightens.
const SlabGilt = ({ place, mood, scale, words, lifted, picked, dragging = false, arriving = false }) => {
  const box = slabBox(place);
  const [x, y] = box;
  const rec = bookRec(mood, place);
  const labelQuad = titleQuadOf(place);
  const countQuad = countQuadOf(place);
  const { title, numeral, rtl } = words;
  if (!rec.gilt) return null;
  return (
    <div
      className={`room-stage-slab is-gilt${lifted ? ' is-lifted' : ''}${picked ? ' is-picked' : ''}${dragging ? ' is-dragging' : ''}${arriving ? ' is-arriving' : ''}`}
      data-place={place}
      style={{ left: px(x * scale), top: px(y * scale), width: px(box[2] * scale), height: px(box[3] * scale) }}
    >
      {labelQuad && title.lines.length > 0 && (
        <Gilt
          quad={labelQuad}
          origin={[x, y]}
          scale={scale}
          strip={rec.gilt.title}
          tone={scene.giltTone?.[mood]?.[place]?.title}
          mood={mood}
          size={title.size}
          lines={title.lines}
          className="is-title"
          dir={rtl ? 'rtl' : 'auto'}
        />
      )}
      {numeral && (
        <Gilt
          quad={countQuad}
          origin={[x, y]}
          scale={scale}
          strip={rec.gilt.count}
          tone={scene.giltTone?.[mood]?.[place]?.count}
          mood={mood}
          size={numeral.size}
          lines={[numeral.text]}
          className="is-count"
        />
      )}
    </div>
  );
};

// A book's hit area, above both moods' stacks: the button (its silhouette, run on toward the table
// where that is under 24 css px tall: deskStage.js pileHits; a near book's whole outline), its face
// (the spine, or a near book's cover: the warm rim along its top edge on hover and focus, and where
// the flight to the course page starts) and the focus ring. Hover and focus light the book's gilt in
// both stacks (data attributes on them, set here and never by React: lighting a book re-renders
// nothing). A click opens the course; 6 css px of movement with the pointer down is a drag instead
// (on touch, after a 350ms long press; one that does not move opens the menu); a right-click opens
// the menu (DeskStage); Alt + Enter brings it closer or puts it back.
const SlabHit = ({ course, place, scale, hit, look, stageRef, lifted, picked, onPick, onMove, onArrange, onDrag, onMenu }) => {
  const box = slabBox(place);
  const [x, y, w, h] = box;
  const titleRef = useRef(null);
  const press = useRef(null);
  const outline = silhouette(place);
  const face = faceOf(place);
  const near = isNearPlace(place);
  const count = course.noteCount;
  const gilts = () => [...(stageRef.current?.querySelectorAll(`.room-stage-slab.is-gilt[data-place="${place}"]`) || [])];
  const light = (key, on) => gilts().forEach((el) => (on ? el.setAttribute(key, '') : el.removeAttribute(key)));
  const pick = () => onPick?.(course.id, titleRef.current?.closest('.room-stage-spine')?.getBoundingClientRect(), look);
  // Alt + arrows on a focused book: Left / Right to that pile's top, Up / Down one place; Alt + Enter
  // brings it closer (or puts a near book back).
  const keys = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
  const onKeyDown = (event) => {
    const alt = event.altKey && !event.ctrlKey && !event.metaKey;
    if (alt && event.key === 'Enter' && onArrange) {
      event.preventDefault();
      onArrange(course.id, near ? 'back' : 'closer');
      return;
    }
    const how = alt ? keys[event.key] : null;
    if (!how || !onMove) return;
    event.preventDefault();
    onMove(course.id, how);
  };
  const onPointerDown = (event) => {
    light('data-press', true);
    if (event.button !== 0 || !onDrag) return;
    const touch = event.pointerType === 'touch';
    const state = { x: event.clientX, y: event.clientY, pointer: event.pointerId, touch, ready: !touch, timer: 0, done: false };
    if (touch) {
      state.timer = setTimeout(() => {
        state.ready = true;
      }, LONG_PRESS_MS);
    }
    press.current = state;
  };
  const onPointerMove = (event) => {
    const state = press.current;
    if (!state || state.done || state.pointer !== event.pointerId) return;
    if (!isDrag(event.clientX - state.x, event.clientY - state.y)) return;
    clearTimeout(state.timer);
    // A touch that moved before its long press is not a drag (nor a click).
    if (!state.ready) {
      press.current = null;
      return;
    }
    state.done = true;
    light('data-press', false);
    onDrag(course.id, place, [state.x, state.y], event);
  };
  const onPointerUp = (event) => {
    const state = press.current;
    light('data-press', false);
    if (!state) return;
    clearTimeout(state.timer);
    // A long press that did not become a drag: the menu.
    if (state.touch && state.ready && !state.done) {
      state.done = true;
      onMenu?.(course.id, place, [event.clientX, event.clientY]);
    }
  };
  // The click a drag or a long press ends with opens nothing.
  const onClick = () => {
    const state = press.current;
    press.current = null;
    if (state?.done) return;
    pick();
  };
  const onContextMenu = (event) => {
    if (!onMenu) return;
    event.preventDefault();
    const r = event.currentTarget.getBoundingClientRect();
    // From the keyboard (the context-menu key, Shift + F10): at the book.
    const at = event.clientX || event.clientY ? [event.clientX, event.clientY] : [r.left + r.width / 2, r.top + r.height / 2];
    if (press.current) press.current.done = true;
    onMenu(course.id, place, at);
  };
  return (
    <div
      className={`room-stage-slab is-hit${lifted ? ' is-lifted' : ''}${picked ? ' is-picked' : ''}`}
      data-place={place}
      style={{ left: px(x * scale), top: px(y * scale), width: px(w * scale), height: px(h * scale) }}
    >
      <button
        type="button"
        className="room-stage-slab-hit"
        data-course-id={course.id}
        aria-label={`${course.name}${count ? `, ${count} ${count === 1 ? 'note' : 'notes'}` : ''}${near ? ', brought closer' : ''}`}
        aria-haspopup="menu"
        aria-keyshortcuts="Alt+Enter Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown"
        style={hit ? hitStyle(hit, [x, y], scale) : { clipPath: clipPolygon(outline, box, scale) }}
        onClick={onClick}
        onKeyDown={onKeyDown}
        onContextMenu={onContextMenu}
        onPointerEnter={(event) => event.pointerType === 'mouse' && light('data-lit', true)}
        onPointerLeave={() => {
          light('data-lit', false);
          light('data-press', false);
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          clearTimeout(press.current?.timer);
          press.current = null;
          light('data-press', false);
        }}
        onFocus={(event) => event.currentTarget.matches(':focus-visible') && light('data-focus', true)}
        onBlur={() => light('data-focus', false)}
      />
      <div className="room-stage-slab-mark">
        <OnQuad quad={face} origin={[x, y]} scale={scale} className="room-stage-spine">
          <span ref={titleRef} className="room-stage-spine-face" />
        </OnQuad>
        <svg className="room-stage-slab-ring" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
          <polygon points={outline.map(([ox, oy]) => `${ox - x},${oy - y}`).join(' ')} vectorEffect="non-scaling-stroke" />
        </svg>
      </div>
    </div>
  );
};

// The frame's picture as a mood's stack draws it (under that mood's light on it and its frame):
// the student's own picture, or the bare backing board. The picture's controls (add, change, take
// down: SceneSlot) are one, above both stacks, drawn clear but for the empty board's "+", which stands
// above the frame's light in the page's ink (under it, round six's dark "+" held 1.6:1 by night).
const StagePicture = ({ scale }) => {
  const { profile } = useAuth();
  const url = typeof profile?.roomPrefs?.scene?.url === 'string' ? profile.roomPrefs.scene.url : '';
  const [broken, setBroken] = useState('');
  const opening = quadBox(scene.quads.frameOpening);
  return (
    <div
      className="room-stage-picture is-drawn"
      style={{
        left: px(opening[0] * scale),
        top: px(opening[1] * scale),
        width: px(opening[2] * scale),
        height: px(opening[3] * scale),
        clipPath: clipPolygon(scene.quads.frameOpening, opening, scale),
      }}
    >
      {url && broken !== url ? <img src={url} alt="" decoding="async" onError={() => setBroken(url)} /> : null}
    </div>
  );
};

// A dragged book under the pointer (round seven): its picture, dyes and gilt as its place draws them
// in the room's mood, no shadow (the shadow and the place's look stay behind), moved by its left/top
// (never a transform: an isolated dye let its own colour through as a rim; desk.css). Leaving (a
// drop: the book fades in at its new place meanwhile) it fades out over 200ms; put back (Escape, a
// drop off the targets) it returns to its place over 200ms.
const DragGhost = ({ ghostRef, course, place, mood, scale, words, state }) => (
  <div ref={ghostRef} className={`room-stage-drag${state ? ` is-${state}` : ''}`} aria-hidden="true">
    <SlabVisual course={course} place={place} mood={mood} scale={scale} bare plate={Boolean(words?.numeral)} />
    <SlabGilt place={place} mood={mood} scale={scale} words={words} />
  </div>
);

// A dragged candle (run three): its picture as the room showed it when it was taken (its place's,
// in that mood), by day with its shadow left behind, moved by its left/top like a book's. Dropped by
// night it stays where it was put (parked) until the room has turned to that place's light, then
// fades on the swap's curve as the new room's own candle comes in.
const CandleGhost = ({ ghostRef, candle, mood, scale, state }) => {
  const rec = mood === 'day' ? dayCandleOf(candle).find((r) => !r.res) : scene.images[mood]?.candle;
  return (
    <div ref={ghostRef} className={`room-stage-drag${state ? ` is-${state}` : ''}`} aria-hidden="true">
      {rec && <Picture rec={rec} scale={scale} className="room-stage-candle" />}
    </div>
  );
};

// Where a dragged book may go, in the room's dashed idiom: the next free slot on each pile, the near
// place, its own place (deskStage.js dragTargets); the one under the pointer drawn whole.
const DragTargets = ({ targets, over, scale }) => (
  <svg
    className="room-stage-targets"
    viewBox={`0 0 ${scene.stage.width} ${scene.stage.height}`}
    style={{ width: px(scene.stage.width * scale), height: px(scene.stage.height * scale) }}
    aria-hidden="true"
  >
    {targets.map((t) => (
      <polygon
        key={t.place}
        className={`is-${t.kind}${t.place === over ? ' is-over' : ''}`}
        points={t.polygon.map(([tx, ty]) => `${tx},${ty}`).join(' ')}
        vectorEffect="non-scaling-stroke"
      />
    ))}
  </svg>
);

// A book's menu (right-click, or a long press that does not become a drag): what can be done with it,
// in the room's words (Figtree; dark by night, pale by day; desk.css). Arrow keys move through it;
// Escape, a click elsewhere or a choice close it, focus back on the book.
const StageMenu = ({ menu, items, onClose }) => {
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

// One mood's stack: everything of that mood, as at rest (see the top of this file).
// Memoized: the candle's click changes none of its props, so the swap renders no stack again.
const MoodStack = memo(function MoodStack({ mood, scale, hasSurround, books, byId, words, liftedId, pickedId, draggingId, arrivingId, candle }) {
  const imgs = scene.images[mood];
  return (
    <div className={`room-stage-mood${isNightKey(mood) ? ' is-night' : ''}`} data-m={mood} aria-hidden="true">
      <Picture rec={imgs.base} scale={scale} className="room-stage-base" eager />
      {/* The room past the frame, rendered with it (its centre a hole), where the window reaches.
          Over the frame's own picture: it runs 2 px on under the frame's edge, so the frame's
          resampled edge never shows. */}
      {hasSurround && scene.surround?.[mood]?.base && (
        <div className="room-stage-surround">
          <Picture rec={scene.surround[mood].base} scale={scale} className="room-stage-base" />
        </div>
      )}
      {/* The candle's light, one layer: the lit room (and the lit surround where the window wants
          it), opaque, over the dark one: at the layer's opacity it is the old screened light at that
          opacity, with no blend. Its own timing in the swap (desk.css .room-stage-light-layer): it
          rises after the room has begun to darken, and goes as the day comes when the candle is
          blown out. Around the candle the dark room again, breathing a few percent over the lit one
          (scene.json breath: its alpha an ellipse round the wick). */}
      {imgs.lit && (
        <div className="room-stage-light-layer">
          <Picture rec={imgs.lit} scale={scale} className="room-stage-base" />
          {hasSurround && scene.surround?.[mood]?.lit && (
            <div className="room-stage-surround">
              <Picture rec={scene.surround[mood].lit} scale={scale} className="room-stage-base" />
            </div>
          )}
          {imgs.breath && <Picture rec={imgs.breath} scale={scale} className="room-stage-breath" />}
        </div>
      )}
      {/* The frame on the wall: its picture, the room's light on it (multiplied), the frame, its glass
          (screened). The set is rendered with the frame in the room but unseen, so where it hangs the
          wall is in its shadow and only the frame's own pictures cover it. */}
      <StagePicture scale={scale} />
      {imgs.frameLight && <Picture rec={imgs.frameLight} scale={scale} className="room-stage-frame-light" />}
      <Picture rec={imgs.frame} scale={scale} className="room-stage-frame" />
      {imgs.frameGlass && <Picture rec={imgs.frameGlass} scale={scale} className="room-stage-frame-glass" />}
      {/* What never moves: the notebook on its stand, the candle and the card (their shadows and what
          they hide in the varnish are in the base; nothing of the piles overlaps them), then both
          piles, each book's shadow just before it, so a book's shade falls on the books below as in
          the whole render. */}
      {['notebook', 'candle', 'scrap'].map((key) => {
        // By day the candle stands at its place (scene.json candles): its shadow, then itself.
        if (key === 'candle' && mood === 'day' && scene.candles) {
          return dayCandleOf(candle).map((rec, i) => (
            <Picture key={`${candle}-${i}`} rec={rec} scale={scale} className={rec.res ? 'room-stage-candle-link' : 'room-stage-candle'} />
          ));
        }
        return imgs[key] ? <Picture key={key} rec={imgs[key]} scale={scale} className={`room-stage-${key}`} /> : null;
      })}
      <div className="room-stage-piles">
        {books.map(({ id, place }) =>
          byId.has(id) ? (
            <SlabVisual
              key={id}
              course={byId.get(id)}
              place={place}
              mood={mood}
              scale={scale}
              dragging={draggingId === id}
              arriving={arrivingId === id}
              plate={Boolean(words.get(id)?.numeral)}
            />
          ) : null,
        )}
        {books.map(({ id, place }) =>
          byId.has(id) ? (
            <SlabGilt
              key={`gilt-${id}`}
              place={place}
              mood={mood}
              scale={scale}
              words={words.get(id)}
              lifted={liftedId === id}
              picked={pickedId === id}
              dragging={draggingId === id}
              arriving={arrivingId === id}
            />
          ) : null,
        )}
      </div>
      {/* Past the frame, where the window shows the surround (run three): each book's shadow over it
          (the surround is rendered without the piles; cut at the frame's edge they left a step).
          Nothing stands out there, so one layer for every book, in the books' order, clipped to the
          room outside the frame (inside it each book draws its own). */}
      {hasSurround && (
        <div className="room-stage-wide-shadows">
          {books.map(({ id, place }) => {
            const rec = byId.has(id) ? bookRec(mood, place)?.shadowWide : null;
            return rec ? <Picture key={id} rec={rec} scale={scale} /> : null;
          })}
        </div>
      )}
    </div>
  );
});

// "and N more" (opening All notes): the next spine's place on its pile, outlined a little inside
// its face and resting on the book below.
const inset = (quad, dx, dy) => {
  const [bx, by, bw, bh] = quadBox(quad);
  const cx = bx + bw / 2;
  const cy = by + bh / 2;
  const sx = Math.max(0, 1 - (2 * dx) / bw);
  const sy = Math.max(0, 1 - (2 * dy) / bh);
  return quad.map(([qx, qy]) => [cx + (qx - cx) * sx, cy + (qy - cy) * sy]);
};

const DashedSlab = ({ place, scale, label, hit, onClick, className = '' }) => {
  const spine = scene.quads.spines[place];
  const outline = inset(spine, 3, 2.5);
  const outer = quadBox(spine);
  const box = [outer[0] - 3, outer[1] - 3, outer[2] + 6, outer[3] + 6];
  const [x, y, w, h] = box;
  const ghost = className.includes('is-new');
  // Its words at a spine title's size, never under 13 css px (the ghost's: desk.css, from stageType).
  const size = moreSize(quadSize(spine).height, scale);
  return (
    <div className={`room-stage-dashed${className ? ` ${className}` : ''}`} style={{ left: px(x * scale), top: px(y * scale), width: px(w * scale), height: px(h * scale) }}>
      <svg className="room-stage-dashed-line" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
        <polygon points={outline.map(([ox, oy]) => `${ox - x},${oy - y}`).join(' ')} vectorEffect="non-scaling-stroke" />
      </svg>
      <button
        type="button"
        className="room-stage-dashed-hit"
        style={hit ? hitStyle(hit, [x, y], scale) : { inset: 0, clipPath: clipPolygon(spine, box, scale) }}
        onClick={onClick}
        aria-label={label}
      />
      <OnQuad quad={spine} origin={[x, y]} scale={scale} className="room-stage-dashed-label" as="span" style={ghost ? undefined : { fontSize: px(size) }}>
        {/* The ghost of the next book wears its label (a dark morocco plate, gilt), and so does "and
            N more": their words hold on whatever is behind the place, the wall, the window or its
            frame (round seven measured "and 7 more" without it at 1.15:1 on its worst 5% by day,
            against the window). */}
        <span className="room-stage-ghost-label">{label}</span>
      </OnQuad>
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
// one is the latest note itself.
const Pages = memo(function Pages({ notes, colorOf, stamp, onOpen, page, scale, capacity, greeting, status, clock }) {
  const latest = notes[0];
  const lines = page.lines.slice(0, capacity.lines);
  // The note's lines fill at most `clamp` lines of the page (whole lines: deskStage.js pageCapacity).
  const text = lines.length ? lines.join('\n') : page.read ? latest?.summary : '';
  const courseColor = latest ? colorOf(latest.classId) : undefined;
  return (
    <>
      <OnQuad quad={scene.quads.pageL} size={PAGE} scale={scale} className="room-stage-page is-left" as="section" aria-labelledby="room-stage-greeting">
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
      <OnQuad quad={scene.quads.pageR} size={PAGE} scale={scale} className="room-stage-page is-right" as="article">
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

// The candle: the room's light switch, baked into the picture. The page adds its film flame at
// the wick (screened — the film is a flame on black), the render's still flame where the film
// cannot play, and one wisp of smoke when it is blown out.
const StageCandle = ({ lit, onToggle, still, scale, candle = 'C0', nightKey = 'night', onDrag, onMenu }) => {
  const rootRef = useRef(null);
  const videoRef = useRef(null);
  const press = useRef(null);
  const [wisp, setWisp] = useState(0);
  useFlameFilm(videoRef, {
    night: lit,
    still,
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
  const at = candleAt(candle);
  const [bx, , bx1, by1] = at.box;
  const [wx, wy] = at.points.wick;
  const ty = at.points.flameTip[1];
  // The film scaled so its wick-to-tip matches the render's, its wick on the wick.
  const k = (wy - ty) / (FILM.wickY - FILM.tipY);
  const film = { left: wx - FILM.wickX * k, top: wy - FILM.wickY * k, width: FILM.width * k, height: FILM.height * k };
  const stillFlame = (scene.images[nightKey] || scene.images.night).flame;
  const toggle = () => {
    // The click a drag or a long press ends with lights nothing.
    const state = press.current;
    press.current = null;
    if (state?.done) return;
    if (lit) setWisp((n) => n + 1);
    onToggle?.();
  };
  // Taken like a book (6 css px with the pointer down; on touch after a 350ms long press, which opens
  // its menu if it does not move); a right-click opens its menu (its places by name).
  const onPointerDown = (event) => {
    if (event.button !== 0 || !onDrag) return;
    const touch = event.pointerType === 'touch';
    const state = { x: event.clientX, y: event.clientY, pointer: event.pointerId, touch, ready: !touch, timer: 0, done: false };
    if (touch) {
      state.timer = setTimeout(() => {
        state.ready = true;
      }, LONG_PRESS_MS);
    }
    press.current = state;
  };
  const onPointerMove = (event) => {
    const state = press.current;
    if (!state || state.done || state.pointer !== event.pointerId) return;
    if (!isDrag(event.clientX - state.x, event.clientY - state.y)) return;
    clearTimeout(state.timer);
    if (!state.ready) {
      press.current = null;
      return;
    }
    state.done = true;
    onDrag([state.x, state.y]);
  };
  const onPointerUp = (event) => {
    const state = press.current;
    if (!state) return;
    clearTimeout(state.timer);
    if (state.touch && state.ready && !state.done) {
      state.done = true;
      onMenu?.([event.clientX, event.clientY]);
    }
  };
  const onContextMenu = (event) => {
    if (!onMenu) return;
    event.preventDefault();
    const r = event.currentTarget.getBoundingClientRect();
    if (press.current) press.current.done = true;
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
        preload="auto"
        disablePictureInPicture
        tabIndex={-1}
        aria-hidden="true"
        style={{ left: px(film.left * scale), top: px(film.top * scale), width: px(film.width * scale), height: px(film.height * scale) }}
      >
        {ALPHA_FILM && <source src={FLAME.webm} type="video/webm" />}
        <source src={FLAME.mp4} type="video/mp4" />
      </video>
      {stillFlame && <Picture rec={stillFlame} scale={scale} className="room-stage-flame-still" />}
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
        aria-pressed={lit}
        aria-label={lit ? 'Candle lit. Blow out for daylight' : 'Candle out. Light it for the evening'}
        aria-haspopup={onMenu ? 'menu' : undefined}
        onClick={toggle}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          clearTimeout(press.current?.timer);
          press.current = null;
        }}
        onContextMenu={onContextMenu}
        style={{ left: px(bx * scale), top: px((ty - 6) * scale), width: px((bx1 - bx) * scale), height: px((by1 - ty + 6) * scale) }}
      />
    </div>
  );
};

const DeskStage = ({
  courses,
  notes,
  page,
  greeting,
  status,
  clock,
  colorOf,
  stamp,
  onOpenNote,
  onPick,
  pickedId,
  liftedId,
  lit,
  still,
  onToggleCandle,
  onNewCourse,
  onMore,
  arrangement,
  onMove,
  onArrange,
  candle = 'C0',
  nightKey = 'night',
  onMoveCandle,
  viewport,
}) => {
  // Where each book lies (RoomDesk's arrangement; without one, the courses' own order). Kept from
  // render to render (useMemo), so the candle's click renders no stack and no page again.
  const { arranged, byId, places, ghost, dashedPlace, books } = useMemo(() => pileLayout(courses, arrangement), [courses, arrangement]);
  // The fit: the plain frame first; once the surround is in (only when the window reaches past the
  // frame), its extent, the room growing out from the centre as it fades in (deskStage.js stageFit).
  // Pictures are fetched for the fit they will end at (one density, no second fetch).
  const plainFit = stageFit(viewport.width, viewport.height, scene.stage, scene.crop);
  const wideFit = scene.surround ? stageFit(viewport.width, viewport.height, scene.stage, scene.crop, scene.surround.extent) : plainFit;
  const wantSurround = Boolean(scene.surround) && wideFit.surround;
  const densityScale = wantSurround ? wideFit.scale : plainFit.scale;
  const stageRef = useRef(null);
  const arabic = useMemo(() => courses.some((course) => textDirection(course.name) === 'rtl'), [courses]);
  const { list, room, leaving, swapping, ready, surroundIn, surroundOf: hasSurround } = useMoods(
    lit ? nightKey : 'day',
    places.books,
    densityScale,
    wantSurround,
    stageRef,
    arabic,
    nightKey,
    candle,
  );
  const shown = room;
  const fit = surroundIn ? wideFit : plainFit;
  const scale = fit.scale;
  // Once both moods' stacks are mounted, the hidden one is drawn for a moment, all but invisibly
  // (desk.css data-warm: 0.2% of it), so the compositor has its tiles and its pictures decoded before
  // the first swap (round seven: the first swap after a load ran one frame of 80-97ms on the Intel
  // UHD, the hidden stack drawn for the first time; the swaps after it, none over 51ms).
  const both = list.length === 2;
  useEffect(() => {
    const stage = stageRef.current;
    if (!both || !stage) return undefined;
    stage.setAttribute('data-warm', '');
    const timer = setTimeout(() => stage.removeAttribute('data-warm'), 700);
    return () => {
      clearTimeout(timer);
      stage.removeAttribute('data-warm');
    };
  }, [both]);
  const fitNow = useRef(fit);
  useEffect(() => {
    fitNow.current = fit;
  });
  // At this scale: what each page holds, the books' hit areas, their spines' words (one fit for
  // both moods).
  const { capacity, hits, words } = useMemo(
    () => ({
      capacity: pageCapacity(scale),
      hits: stageHits(places.books, dashedPlace, scale),
      words: new Map(books.filter(({ id }) => byId.has(id)).map(({ id, place }) => [id, spineWords(byId.get(id), place, scale)])),
    }),
    [places, dashedPlace, books, byId, scale],
  );
  // The candle's breath keeps one phase: a stack mounted again (a mood decoded, the surround come
  // in) takes up the breathing where it was.
  const breathFrom = useRef(null);
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const breaths = [...stage.querySelectorAll('.room-stage-breath')]
      .flatMap((el) => (el.getAnimations ? el.getAnimations() : []))
      .filter((a) => a.animationName === 'room-stage-breath');
    const started = breaths.map((a) => a.startTime).filter((t) => t != null);
    if (breathFrom.current == null && started.length) breathFrom.current = Math.min(...started);
    if (breathFrom.current == null) return;
    breaths.forEach((a) => {
      a.startTime = breathFrom.current;
    });
  }, [surroundIn, shown, list.length]);
  // A book dragged (round seven, deskStage.js dragTargets / moveTo): { id, place, targets (each with
  // its polygon), over, state: null | 'leaving' | 'returning' }; the pointer moves the drag layer by
  // its left/top, never React. A drop on a target asks RoomDesk to move it there (onArrange); the book
  // fades in at its new place (arrivingId) as the dragged copy fades out, 200ms.
  const [drag, setDrag] = useState(null);
  const [arrivingId, setArrivingId] = useState(null);
  const ghostRef = useRef(null);
  const dragNow = useRef(null);
  useEffect(() => {
    dragNow.current = drag;
  });
  // The candle taken (run three): its places' rings the targets, a drop elsewhere than its own moves
  // it there (RoomDesk: roomPrefs.deskCandle); by night the room dissolves to that place's light once
  // its pictures are in (useMoods: only the chosen place's are ever fetched).
  const startCandleDrag = (start) => {
    if (!onMoveCandle || drag) return;
    const targets = Object.keys(scene.candles || {})
      .filter((p) => candlePlaces(scene).includes(p))
      .map((p) => ({ place: p, kind: p === candle ? 'own' : 'candle', polygon: candleRing(candleAt(p).box) }));
    setDrag({ id: 'candle', place: candle, targets, over: null, state: null, start, candle: true, from: room });
  };
  const startDrag = (id, place, start) => {
    if (!onArrange || drag) return;
    const targets = dragTargets(arranged, id).map((t) => ({ ...t, polygon: silhouette(t.place) }));
    // A near place's pictures, decoded while the book travels (only ever loaded when it is used).
    targets.filter((t) => t.kind === 'near').forEach((t) => {
      const rec = bookRec(room, t.place);
      if (rec) [rec, rec.shadow, rec.gilt?.title, rec.gilt?.count].filter(Boolean).forEach((r) => decodeOne(r, densityScale).catch(() => null));
    });
    setDrag({ id, place, targets, over: null, state: null, start });
  };
  const dragId = drag?.id;
  const dragLive = Boolean(drag && !drag.state);
  useEffect(() => {
    if (!dragId || !dragLive) return undefined;
    const end = (state) => {
      setDrag((d) => (d && d.id === dragId ? { ...d, state } : d));
      setTimeout(() => setDrag((d) => (d && d.id === dragId && d.state === state ? null : d)), 220);
    };
    // Back to its place over 200ms (at once where motion is reduced), then the book shows there.
    const goBack = () => {
      const el = ghostRef.current;
      if (el) {
        const quiet = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || document.documentElement.getAttribute('data-motion') === 'still';
        el.style.transition = quiet ? 'none' : 'left 200ms ease-out, top 200ms ease-out';
        el.style.left = '0px';
        el.style.top = '0px';
      }
      end('returning');
    };
    const move = (event) => {
      const d = dragNow.current;
      if (!d) return;
      const el = ghostRef.current;
      if (el) {
        el.style.left = px(event.clientX - d.start[0]);
        el.style.top = px(event.clientY - d.start[1]);
      }
      const at = [(event.clientX - fitNow.current.left) / fitNow.current.scale, (event.clientY - fitNow.current.top) / fitNow.current.scale];
      const over = pickTarget(d.targets, at, 40);
      if (over !== d.over) setDrag((cur) => (cur && cur.id === d.id ? { ...cur, over } : cur));
    };
    const up = () => {
      const d = dragNow.current;
      if (!d) return;
      if (d.over && d.over !== d.place && d.candle) {
        onMoveCandle?.(d.over);
        if (isNightKey(d.from)) {
          // By night the room turns to that place's light once its pictures are in: parked till then.
          const to = d.over;
          setDrag((cur) => (cur && cur.candle ? { ...cur, state: 'parked', to } : cur));
          setTimeout(() => setDrag((cur) => (cur && cur.candle && cur.state === 'parked' ? null : cur)), 12000);
        } else end('leaving');
      } else if (d.over && d.over !== d.place) {
        onArrange(d.id, { to: d.over });
        setArrivingId(d.id);
        setTimeout(() => setArrivingId((a) => (a === d.id ? null : a)), 260);
        end('leaving');
      } else goBack();
    };
    const key = (event) => {
      if (event.type === 'keydown' && event.key !== 'Escape') return;
      event.preventDefault?.();
      goBack();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', key);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', key);
      window.removeEventListener('keydown', key, true);
    };
  }, [dragId, dragLive, onArrange, onMoveCandle]);
  // The candle the room draws: by night the place whose light the room is in (a moved candle's flame
  // follows the room's dissolve, never ahead of it), by day where it stands.
  const shownCandle = isNightKey(room) ? Object.keys(scene.candles || {}).find((p) => scene.candles[p].night === room) || candle : candle;
  // A parked candle (dropped by night) goes once the room is at its new place's night.
  const candleArrived = Boolean(drag?.candle && drag.state === 'parked' && drag.to && room === scene.candles?.[drag.to]?.night);
  useEffect(() => {
    if (!candleArrived) return undefined;
    const timer = setTimeout(() => setDrag((cur) => (cur && cur.candle ? null : cur)), 2200);
    return () => clearTimeout(timer);
  }, [candleArrived]);
  // A book's menu: { id, place, at: [x, y] (window px), title }.
  const [menu, setMenu] = useState(null);
  const openMenu = (id, place, at) => {
    if (!byId.has(id)) return;
    setMenu((m) => (m && m.id === id ? m : { id, place, at, title: byId.get(id).name }));
  };
  const openCandleMenu = (at) => setMenu((m) => (m && m.id === 'candle' ? m : { id: 'candle', place: candle, at, title: 'Candle' }));
  const closeMenu = useCallback(
    (refocus) => {
      const id = menu?.id;
      setMenu(null);
      if (refocus && id === 'candle') stageRef.current?.querySelector('.room-stage-candle-button')?.focus();
      else if (refocus && id) stageRef.current?.querySelector(`.room-stage-slab-hit[data-course-id="${id}"]`)?.focus();
    },
    [menu],
  );
  const menuItems = (m) => {
    if (m.id === 'candle') {
      // The candle's menu: its places by name (the one it stands at checked), and its light.
      return [
        ...candlePlaces(scene).map((p) => ({
          key: p,
          label: `${scene.candles[p].name[0].toUpperCase()}${scene.candles[p].name.slice(1)}`,
          checked: p === candle,
          run: () => p !== candle && onMoveCandle?.(p),
        })),
        { key: 'light', label: lit ? 'Blow it out' : 'Light it', run: () => onToggleCandle?.() },
      ];
    }
    const course = byId.get(m.id);
    const near = isNearPlace(m.place);
    const openIt = () => {
      const rect = stageRef.current?.querySelector(`.room-stage-slab.is-hit[data-place="${m.place}"] .room-stage-spine`)?.getBoundingClientRect();
      onPick?.(m.id, rect, spineLook(scene, room, m.place, course?.color));
    };
    return [
      near
        ? { key: 'back', label: 'Put back on the pile', run: () => onArrange?.(m.id, 'back') }
        : { key: 'closer', label: 'Bring closer', run: () => onArrange?.(m.id, 'closer') },
      { key: 'across', label: 'Move to the other pile', run: () => onMove?.(m.id, 'across') },
      { key: 'open', label: 'Open', run: openIt },
    ];
  };
  // The frame's opening, where its picture's controls sit; covered when a book stands before its middle.
  const opening = quadBox(scene.quads.frameOpening);
  const frameCovered = books.some(({ place }) => !isNearPlace(place) && pointInPolygon(silhouette(place), [opening[0] + opening[2] / 2, opening[1] + opening[3] / 2]));
  // The stage's origin in the window (its backdrop is fixed at the window's origin: desk.css) and the
  // device pixel ratio, for the lettering's origin on whole device pixels (Gilt).
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const left = Math.round(fit.left * 100) / 100;
  const top = Math.round(fit.top * 100) / 100;
  const snap = useMemo(() => ({ x: left, y: top, dpr }), [left, top, dpr]);

  return (
    <DensityScale.Provider value={densityScale}>
      <StageSnap.Provider value={snap}>
        <Impressions />
        <div className={`room-stage-backdrop is-${shown}`} data-room={room}>
          <div
            ref={stageRef}
            className={`room-stage is-${shown}${ready ? ' is-ready' : ''}`}
            data-room={room}
            data-swapping={swapping ? '' : undefined}
          data-leaving={leaving || undefined}
          data-dragging={dragLive ? '' : undefined}
          data-candle-from={drag?.candle && drag.state !== 'leaving' && drag.from === 'day' ? drag.from : undefined}
          data-candle-moving={drag?.candle && drag.state !== 'leaving' && !candleArrived ? '' : undefined}
            style={{ left: px(fit.left), top: px(fit.top), width: px(fit.width), height: px(fit.height), ...typeVars(scale) }}
          >
            {/* Each mood's stack: the night's over the day's, which stays whole under it (opaque under
                opaque: the night's opacity alone is the crossfade; desk.css .room-stage-mood). */}
            {list.map((m) => (
              <MoodStack
              key={m}
              mood={m}
              scale={scale}
              hasSurround={hasSurround(m)}
              books={books}
              byId={byId}
              words={words}
              liftedId={liftedId}
              pickedId={pickedId}
              draggingId={drag && drag.state !== 'leaving' ? drag.id : null}
              arrivingId={arrivingId}
              candle={candle}
            />
            ))}

            {/* Above both: what belongs to no mood. */}
            <div className="room-stage-overlay">
              {/* The frame's picture's controls (SceneSlot: add, change, take it down), drawn clear: the
                  stacks draw the picture. Under the books' hit areas, which may reach over it. Not there
                  at all when pile R stands in front of the frame's middle (from R9, run three: its "+"
                  floated over the books' spines at 1:1). */}
              {!frameCovered && <div
                className="room-stage-picture is-slot"
                style={{
                  left: px(opening[0] * scale),
                  top: px(opening[1] * scale),
                  width: px(opening[2] * scale),
                  height: px(opening[3] * scale),
                  clipPath: clipPolygon(scene.quads.frameOpening, opening, scale),
                }}
              >
                <SceneSlot />
              </div>}

              <div className="room-stage-piles">
                {books.map(({ id, place }) =>
                  byId.has(id) ? (
                    <SlabHit
                      key={id}
                      course={byId.get(id)}
                      place={place}
                      scale={scale}
                      hit={hits[place]}
                      look={spineLook(scene, room, place, byId.get(id).color)}
                      stageRef={stageRef}
                      lifted={liftedId === id}
                      picked={pickedId === id}
                      onPick={onPick}
                      onMove={onMove}
                      onArrange={onArrange}
                      onDrag={onArrange ? startDrag : undefined}
                      onMenu={onArrange ? openMenu : undefined}
                    />
                  ) : null,
                )}
                {places.more && <DashedSlab place={places.more.place} scale={scale} hit={hits[places.more.place]} label={`and ${places.more.count} more`} onClick={onMore} />}
                {/* "+ New course": the ghost of the next book, in gilt dash, where it will lie. */}
                {ghost && <DashedSlab place={ghost} scale={scale} hit={hits[ghost]} label="+ New course" onClick={onNewCourse} className="is-new" />}
              </div>

              {/* A dragged book and where it may go: above the books' hit areas, taking no pointer. */}
              {drag && <DragTargets targets={drag.targets} over={drag.over} scale={scale} />}
              {drag?.candle && (
                <CandleGhost ghostRef={ghostRef} candle={drag.place} mood={drag.from} scale={scale} state={candleArrived ? 'arrived' : drag.state} />
              )}
              {drag && byId.has(drag.id) && (
                <DragGhost ghostRef={ghostRef} course={byId.get(drag.id)} place={drag.place} mood={room} scale={scale} words={words.get(drag.id)} state={drag.state} />
              )}

              <Pages
                notes={notes}
                colorOf={colorOf}
                stamp={stamp}
                onOpen={onOpenNote}
                page={page}
                scale={scale}
                capacity={capacity}
                greeting={greeting}
                status={status}
                clock={clock}
              />

              <OnQuad quad={scene.quads.scrap} size={SCRAP} scale={scale} className="room-stage-scrap">
                <StageCard className="room-stage-scrap-paper" width={SCRAP.width - CARD_PAD * 2} size={stageType('cardInput', scale)} />
              </OnQuad>
            </div>

            <StageCandle
              lit={lit}
              onToggle={onToggleCandle}
              still={still}
              scale={scale}
              candle={shownCandle}
              nightKey={isNightKey(room) ? room : nightKey}
              onDrag={onMoveCandle && candlePlaces(scene).length > 1 ? startCandleDrag : undefined}
              onMenu={onMoveCandle && candlePlaces(scene).length > 1 ? openCandleMenu : undefined}
            />
          </div>
          {menu && (menu.id === 'candle' || byId.has(menu.id)) && <StageMenu menu={menu} items={menuItems(menu)} onClose={closeMenu} />}
        </div>
      </StageSnap.Provider>
    </DensityScale.Provider>
  );
};

export default DeskStage;
