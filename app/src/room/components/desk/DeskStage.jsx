import { createContext, memo, startTransition, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import SceneSlot from '../SceneSlot';
import scene from '../../assets/desk/scene.json';
import { clipPolygon, quadBox, quadSize } from '../../deskProject';
import {
  SPINE_BASE,
  arrangePiles,
  candlePlaces,
  candleRing,
  arrangementFrom,
  dragTargets,
  filmLook,
  liftOut,
  placesKey,
  frameHidden,
  isNightKey,
  isNearPlace,
  pickTarget,
  fitSpineCount,
  fitSpineTitle,
  ghostPlace,
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
import { getFilm, nearPose, pilePose, setDeskOpener, setMoveAnnouncer, stageCamera } from '../../deskFilm';
import { dropPreparedFilm, filmRunning, openFilm, prepareFilm, prepareGrain, prepareHeld, prepareRoomPictures, warmFilm, warmRoomOnce } from '../../deskFilmRun';
import { bookLight, bookShows, getDeskBook } from '../../deskBook';
import { heldFit } from '../../deskBookPages';
import { isSearchOpen, subscribeSearch } from '../../deskSearch';
import StageCard from './StageCard';
import { saveData } from './useFlameFilm';
// Round eight, run 3: the parts both stages draw with (moved there unchanged; the production table uses them too).
import { DragTargets, Gilt, Impressions, OnQuad, Pages, StageCandle, StageMenu, StagePicture } from './stageParts';
import {
  GLIDE_EASE,
  GLIDE_MS,
  PLACING_OPACITY,
  SETTLE_GLIDE_MS,
  SETTLE_MS,
  StageSnap,
  clipStyle,
  hitStyle,
  landing,
  moveCss,
  once,
  px,
  quietNow,
  typeVars,
  unionBox,
  usePress,
} from './stageKit';

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
const file = (name) => FILES[`../../assets/desk/${name}`];

// Fixed sizes the words are laid out at, then carried onto their quads (the stage scales them).
// Laid out at the left page's own size at 1x (its mean edges), so a 22px greeting is 22px in the
// design crop.
const PAGE = (({ width, height }) => ({ width: Math.round(width), height: Math.round(height) }))(quadSize(scene.quads.pageL));
// The capture card: laid out at its own size at 1x (its quad's mean edges), like the pages.
const SCRAP = (({ width, height }) => ({ width: Math.round(width), height: Math.round(height) }))(quadSize(scene.quads.scrap));
// The card's padding across (desk.css .room-stage-scrap-paper).
const CARD_PAD = 14;
// The notebook's pages (stageParts Pages).
const PAGE_QUADS = { L: scene.quads.pageL, R: scene.quads.pageR };

// The 2x files when a stage px is drawn at 1.25 device px or more, else the 1x ones (and the 1x
// when the browser asks to save data): deskStage.js pictureDensity.
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
// The render's own flame where the film cannot play (StageCandle), the room's night's.
const stillFlameOf = (nightKey, scale) => {
  const rec = (scene.images[nightKey] || scene.images.night).flame;
  return rec ? <Picture rec={rec} scale={scale} className="room-stage-flame-still" /> : null;
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
  // A mood's pictures decoded now (round eight: a press on the candle primes the other place's light,
  // so its drop changes the room at once); its stack is mounted, unseen, once they are in.
  const priming = useRef(new Set());
  const prime = useCallback((m) => {
    if (!m || !scene.images[m] || readyNow.current[m] || priming.current.has(m) || saveData()) return;
    priming.current.add(m);
    const { books: places, scale: at, wantSurround: sur, candle: where } = wanted.current;
    Promise.allSettled(picturesOf(m, places, sur, where).map((rec) => decodeOne(rec, at))).then(() => {
      priming.current.delete(m);
      setReady((r) => (r[m] ? r : { ...r, [m]: true }));
      if (sur) setSurroundReady((r) => (r[m] ? r : { ...r, [m]: true }));
    });
  }, []);
  const list = ORDER.filter((m) => m === room || m === leaving || ready[m]);
  const surroundIn = wantSurround && Object.values(surroundReady).some(Boolean);
  return { list, room, leaving, swapping: Boolean(leaving), ready: roomReady, surroundIn, surroundOf: (m) => Boolean(surroundIn && surroundReady[m]), prime };
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
const silhouette = once((place) => {
  if (isNearPlace(place)) return scene.quads.nearHulls[place];
  const top = scene.quads.tops[place];
  const spine = scene.quads.spines[place];
  return [top[0], top[1], spine[1], spine[2], spine[3], spine[0]];
});

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
const slabBox = once((place) =>
  ORDER.map((m) => scene.images[m] && bookRec(m, place))
    .filter(Boolean)
    .map((rec) => rec.box)
    .reduce(unionBox),
);

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
// `ghost`: a copy drawn on its own layer (a drag, a glide): each dye is cut to the book's own picture as
// well as its mask (two mask layers, intersected), so on a layer of its own, with nothing under its soft
// edge, no dye shows past the book as a rim (round 5B's reason for never moving the real ones).
const ghostMask = (dyeUrl, dyeBox, rec, scale, densityScale) => {
  const [cx, cy] = dyeBox;
  const [x, y, w, h] = rec.box;
  const slab = pick(rec, densityScale);
  const at = `0px 0px, ${px((x - cx) * scale)} ${px((y - cy) * scale)}`;
  const size = `100% 100%, ${px(w * scale)} ${px(h * scale)}`;
  return {
    maskImage: `url("${dyeUrl}"), url("${slab}")`,
    WebkitMaskImage: `url("${dyeUrl}"), url("${slab}")`,
    maskPosition: at,
    WebkitMaskPosition: at,
    maskSize: size,
    WebkitMaskSize: size,
    maskComposite: 'intersect',
    WebkitMaskComposite: 'source-in',
  };
};

const SlabVisual = ({ course, place, mood, scale, dragging = false, bare = false, plate = false, ghost = false }) => {
  const densityScale = useContext(DensityScale);
  const box = slabBox(place);
  const [x, y] = box;
  const rec = bookRec(mood, place);
  const tints = spineLook(scene, mood, place, course.color);
  const maskOf = (dyeRec, dyeBox) => {
    const url = pick(dyeRec, densityScale);
    return ghost ? ghostMask(url, dyeBox, rec, scale, densityScale) : { maskImage: `url("${url}")`, WebkitMaskImage: `url("${url}")` };
  };
  return (
    <div
      className={`room-stage-slab${dragging ? ' is-dragging' : ''}`}
      data-place={place}
      data-course={course.id}
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
                ...maskOf(rec[part], rec[`${part}Box`]),
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
                ...maskOf(rec.plate, rec.plate.box),
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
const SlabGilt = ({ place, mood, scale, words, lifted, picked, dragging = false, courseId, flat = false }) => {
  const box = slabBox(place);
  const [x, y] = box;
  const rec = bookRec(mood, place);
  const labelQuad = titleQuadOf(place);
  const countQuad = countQuadOf(place);
  const { title, numeral, rtl } = words;
  if (!rec.gilt) return null;
  return (
    <div
      className={`room-stage-slab is-gilt${lifted ? ' is-lifted' : ''}${picked ? ' is-picked' : ''}${dragging ? ' is-dragging' : ''}`}
      data-place={place}
      data-course={courseId}
      style={{ left: px(x * scale), top: px(y * scale), width: px(box[2] * scale), height: px(box[3] * scale) }}
    >
      {labelQuad && title.lines.length > 0 && (
        <Gilt
          quad={labelQuad}
          origin={[x, y]}
          scale={scale}
          stripUrl={file(rec.gilt.title.x2)}
          tone={scene.giltTone?.[mood]?.[place]?.title}
          mood={mood}
          size={title.size}
          lines={title.lines}
          className="is-title"
          dir={rtl ? 'rtl' : 'auto'}
          flat={flat}
        />
      )}
      {numeral && (
        <Gilt
          quad={countQuad}
          origin={[x, y]}
          scale={scale}
          stripUrl={file(rec.gilt.count.x2)}
          tone={scene.giltTone?.[mood]?.[place]?.count}
          mood={mood}
          size={numeral.size}
          lines={[numeral.text]}
          className="is-count"
          flat={flat}
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
// Memoized, its handlers DeskStage's unchanging ones (run desk1, D4): a render of the stage (a drag
// passing over a target, the minute, the undo line) renders no book's hit area again.
const SlabHit = memo(function SlabHit({ course, place, scale, hit, room, stageRef, lifted, picked, onPick, onMove, onArrange, onDrag, onMenu, onPrime }) {
  const box = slabBox(place);
  const [x, y, w, h] = box;
  const titleRef = useRef(null);
  const press = usePress();
  const outline = silhouette(place);
  const face = faceOf(place);
  const near = isNearPlace(place);
  const count = course.noteCount;
  const gilts = () => [...(stageRef.current?.querySelectorAll(`.room-stage-slab.is-gilt[data-place="${place}"]`) || [])];
  const light = (key, on) => gilts().forEach((el) => (on ? el.setAttribute(key, '') : el.removeAttribute(key)));
  // Where the book lay is read only if the old flight needs it (a function: reading it at the click
  // forced a style and layout pass of the whole stage into the click's frame).
  const pick = () => onPick?.(course.id, () => titleRef.current?.closest('.room-stage-spine')?.getBoundingClientRect(), spineLook(scene, room, place, course.color));
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
    // Whatever it may become (a click: its film; a drag, a menu's move: where it could go), it is
    // prepared now.
    onPrime?.(course.id, true);
    if (onDrag) press.down(event);
  };
  const onPointerMove = (event) => {
    const start = press.move(event);
    if (!start) return;
    light('data-press', false);
    onDrag(course.id, place, start, event);
  };
  const onPointerUp = (event) => {
    light('data-press', false);
    // A long press that did not become a drag: the menu.
    if (press.up()) onMenu?.(course.id, place, [event.clientX, event.clientY]);
  };
  // The click a drag or a long press ends with opens nothing.
  const onClick = (event) => {
    if (press.click(event)) pick();
  };
  const onContextMenu = (event) => {
    if (!onMenu) return;
    event.preventDefault();
    const r = event.currentTarget.getBoundingClientRect();
    // From the keyboard (the context-menu key, Shift + F10): at the book.
    const at = event.clientX || event.clientY ? [event.clientX, event.clientY] : [r.left + r.width / 2, r.top + r.height / 2];
    press.spend();
    onMenu(course.id, place, at);
  };
  return (
    <div
      className={`room-stage-slab is-hit${lifted ? ' is-lifted' : ''}${picked ? ' is-picked' : ''}`}
      data-place={place}
      data-course={course.id}
      style={{ left: px(x * scale), top: px(y * scale), width: px(w * scale), height: px(h * scale) }}
    >
      <button
        type="button"
        className="room-stage-slab-hit"
        data-course-id={course.id}
        aria-label={`${course.name}${count ? `, ${count} ${count === 1 ? 'note' : 'notes'}` : ''}${near ? ', brought closer' : ''}`}
        aria-keyshortcuts="Alt+Enter Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown"
        style={hit ? hitStyle(hit, [x, y], scale) : clipStyle(outline, box, scale)}
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
          press.cancel();
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
});

// A book on its way (round eight): the dragged copy under the pointer and the glide into a place. Its
// picture, dyes and gilt as its place draws them in the room's mood (its dyes cut to its own picture:
// ghostMask), a soft contact shadow under it while it is held, on ONE layer the size of its place's box,
// moved by transform only (round seven moved it by left/top: a repaint of the overlay each move). Its
// place's own picture shows again under it when it lands. `ghostRef`: the drag writes its transform.
const BookGhost = ({ ghostRef, course, place, mood, scale, words: given, lifted = true }) => {
  const [x, y, w, h] = slabBox(place);
  const rec = bookRec(mood, place);
  // Its words as its own place letters them (the stacks' may be for another place by now, or none: a
  // book lifted off its pile is in no stack while it is held).
  const words = useMemo(() => given || spineWords(course, place, scale), [given, course, place, scale]);
  return (
    <div
      ref={ghostRef}
      className={`room-stage-ghost${lifted ? ' is-lifted' : ''}`}
      data-ghost-of={course.id}
      style={{ left: px(x * scale), top: px(y * scale), width: px(w * scale), height: px(h * scale) }}
      aria-hidden="true"
    >
      <div className="room-stage-ghost-inner" style={{ left: px(-x * scale), top: px(-y * scale) }}>
        {lifted && rec && <Picture rec={rec} scale={scale} className="room-stage-ghost-shadow" />}
        <SlabVisual course={course} place={place} mood={mood} scale={scale} bare ghost plate={Boolean(words?.numeral)} />
        <SlabGilt place={place} mood={mood} scale={scale} words={words} flat />
      </div>
    </div>
  );
};

// The candle on its way: its picture as the room shows it at its place, on a layer the size of its
// picture's box, moved by transform. Its flame is the real one, carried along (StageCandle).
// `placing` (run 2, by night, while it is held): the room's light is still its place's and that night's
// pictures have the candle baked into them, so the candle stays lit where it stands and the hand holds a
// see-through likeness of it, unlit (desk.css is-placing) - where it will go, not a second candle.
const candleRec = (mood, place) => (mood === 'day' ? dayCandleOf(place).find((r) => !r.res) : scene.images[mood]?.candle);
const CandleGhost = ({ ghostRef, candle, mood, scale, placing = false }) => {
  const rec = candleRec(mood, candle);
  if (!rec) return null;
  const [x, y, w, h] = rec.box;
  return (
    <div ref={ghostRef} className={`room-stage-ghost is-candle${placing ? ' is-placing' : ''}`} style={{ left: px(x * scale), top: px(y * scale), width: px(w * scale), height: px(h * scale) }} aria-hidden="true">
      <div className="room-stage-ghost-inner" style={{ left: px(-x * scale), top: px(-y * scale) }}>
        <Picture rec={rec} scale={scale} className="room-stage-candle" />
      </div>
    </div>
  );
};

// A book's face (its spine, or a near book's cover): the part a glide carries onto the other place's.
const faceBox = once((place) => quadBox(faceOf(place)));
// The candle's own box at a place.
const candleBoxAt = (place) => {
  const [x0, y0, x1, y1] = candleAt(place).box;
  return [x0, y0, x1 - x0, y1 - y0];
};
// A glide (a drop, the menu, Ctrl K, the keys, a pile settling): the ghost from where it is (`offset`,
// css px: where a drop left it) onto its new place, then gone over the place's picture. `onLanded(key,
// 'landed' | 'gone')`: the book shows at its place when the ghost lands, the ghost goes after.
// `settle`: the book is drawn at its new place under the landed ghost (the stacks have caught up): the
// ghost hands over to it.
const BookGlide = memo(function BookGlide({ glide, course, mood, scale, onLanded, settle }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof el.animate !== 'function') {
      onLanded(glide.key, 'landed');
      return undefined;
    }
    const own = slabBox(glide.from);
    const to = landing(faceBox(glide.from), faceBox(glide.to), own, scale);
    const move = el.animate([{ transform: moveCss(glide.offset[0], glide.offset[1]) }, { transform: moveCss(to.tx, to.ty, to.sx, to.sy) }], { duration: glide.ms, easing: GLIDE_EASE, fill: 'forwards' });
    let alive = true;
    move.finished
      .then(() => {
        if (alive) onLanded(glide.key, 'landed');
      })
      .catch(() => null);
    return () => {
      alive = false;
    };
  }, [glide, scale, onLanded]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!settle || !el) return undefined;
    if (typeof el.animate !== 'function') {
      onLanded(glide.key, 'gone');
      return undefined;
    }
    let alive = true;
    const fade = el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: SETTLE_MS, easing: 'linear', fill: 'forwards' });
    fade.finished
      .then(() => {
        if (alive) onLanded(glide.key, 'gone');
      })
      .catch(() => null);
    return () => {
      alive = false;
      fade.cancel();
    };
  }, [settle, glide, onLanded]);
  return <BookGhost ghostRef={ref} course={course} place={glide.from} mood={mood} scale={scale} lifted={glide.lifted} />;
});

// The candle's glide: the ghost and the real flame together (the flame is drawn at the candle's new
// place by then: it is carried from where the ghost is to there), then the place's own candle shows.
const CandleGlide = memo(function CandleGlide({ glide, scale, flameOf, onLanded }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof el.animate !== 'function') {
      onLanded(glide.key, 'gone');
      return undefined;
    }
    const a = candleBoxAt(glide.from);
    const b = candleBoxAt(glide.to);
    const rec = candleRec(glide.mood, glide.from);
    const own = rec ? rec.box : a;
    const to = landing(a, b, own, scale);
    const timing = { duration: glide.ms, easing: GLIDE_EASE, fill: 'forwards' };
    const move = el.animate([{ transform: moveCss(glide.offset[0], glide.offset[1]) }, { transform: moveCss(to.tx, to.ty, to.sx, to.sy) }], timing);
    // A night's likeness let go off any place: it goes home alone (the candle and its flame never left).
    // A night's drop: the likeness becomes the candle (whole, lit) as the room's light comes with it.
    const whole = glide.fromPlacing ? el.animate([{ opacity: PLACING_OPACITY }, { opacity: 1 }], { duration: 120, easing: 'ease-out', fill: 'backwards' }) : null;
    // The flame, drawn at the new place, starts where the ghost's wick is.
    const wa = candleAt(glide.from).points.wick;
    const wb = candleAt(glide.to).points.wick;
    const fx = (wa[0] - wb[0]) * scale + glide.offset[0];
    const fy = (wa[1] - wb[1]) * scale + glide.offset[1];
    const flames = glide.placing
      ? []
      : flameOf().map((f) => {
          f.style.transform = '';
          return f.animate([{ transform: `translate(${fx.toFixed(2)}px, ${fy.toFixed(2)}px)` }, { transform: 'translate(0px, 0px)' }], timing);
        });
    let alive = true;
    move.finished
      .then(() => {
        if (alive) onLanded(glide.key, 'gone');
      })
      .catch(() => null);
    return () => {
      alive = false;
      move.cancel();
      whole?.cancel();
      flames.forEach((f) => f.cancel());
    };
  }, [glide, scale, flameOf, onLanded]);
  return <CandleGhost ghostRef={ref} candle={glide.from} mood={glide.mood} scale={scale} placing={Boolean(glide.placing)} />;
});

// One mood's stack: everything of that mood, as at rest (see the top of this file).
// Memoized: the candle's click changes none of its props, so the swap renders no stack again.
// `hidden`: '|id|id|' — the books out of the stacks (in the hand, on their way).
const MoodStack = memo(function MoodStack({ mood, scale, hasSurround, books, byId, words, liftedId, pickedId, hidden = '||', candle }) {
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
      <StagePicture scale={scale} opening={scene.quads.frameOpening} />
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
              dragging={hidden.includes(`|${id}|`)}
              plate={Boolean(words.get(id)?.numeral)}
            />
          ) : null,
        )}
        {books.map(({ id, place }) =>
          byId.has(id) ? (
            <SlabGilt
              key={`gilt-${id}`}
              courseId={id}
              place={place}
              mood={mood}
              scale={scale}
              words={words.get(id)}
              lifted={liftedId === id}
              picked={pickedId === id}
              dragging={hidden.includes(`|${id}|`)}
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

const DashedSlab = memo(function DashedSlab({ place, scale, label, hit, onClick, className = '' }) {
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
        style={hit ? hitStyle(hit, [x, y], scale) : clipStyle(spine, box, scale, true)}
        onClick={onClick}
        aria-label={label}
      />
      {/* The drawn words are the button's name already: read once (run desk1, D9). */}
      <OnQuad quad={spine} origin={[x, y]} scale={scale} className="room-stage-dashed-label" as="span" aria-hidden="true" style={ghost ? undefined : { fontSize: px(size) }}>
        {/* The ghost of the next book wears its label (a dark morocco plate, gilt), and so does "and
            N more": their words hold on whatever is behind the place, the wall, the window or its
            frame (round seven measured "and 7 more" without it at 1.15:1 on its worst 5% by day,
            against the window). */}
        <span className="room-stage-ghost-label">{label}</span>
      </OnQuad>
    </div>
  );
});

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
  // Run 2: what the stacks draw is the saved arrangement, or a move announced before it is saved
  // (pending, until the saved one says the same), or, while a pile book is dragged, the pile it left
  // settled (liftOut).
  const [drag, setDrag] = useState(null);
  const [glides, setGlides] = useState([]);
  const [landed, setLanded] = useState('|');
  const [candleGlides, setCandleGlides] = useState([]);
  const [pending, setPending] = useState(null);
  const realKey = arrangement ? placesKey(arrangement.map) : '';
  if (pending && pending.key === realKey) setPending(null);
  const arrangementRef = useRef(arrangement);
  useEffect(() => {
    arrangementRef.current = arrangement;
  });
  // A pile book let go: its pile stays settled until the announced move is drawn (heldLift, cleared in
  // the same transition that sets pending), so the books above it never rise for a frame and settle again.
  const [heldLift, setHeldLift] = useState(null);
  const liftId = drag && !drag.candle && !isNearPlace(drag.place) ? drag.id : heldLift;
  const shownArrangement = useMemo(() => {
    if (pending && arrangement) return arrangementFrom(pending.map, arrangement);
    if (liftId && arrangement) return liftOut(arrangement, liftId);
    return arrangement;
  }, [pending, liftId, arrangement]);
  const { arranged, byId, places, ghost, dashedPlace, books } = useMemo(() => pileLayout(courses, shownArrangement), [courses, shownArrangement]);
  // The fit: the plain frame first; once the surround is in (only when the window reaches past the
  // frame), its extent, the room growing out from the centre as it fades in (deskStage.js stageFit).
  // Pictures are fetched for the fit they will end at (one density, no second fetch).
  const plainFit = stageFit(viewport.width, viewport.height, scene.stage, scene.crop);
  const wideFit = scene.surround ? stageFit(viewport.width, viewport.height, scene.stage, scene.crop, scene.surround.extent) : plainFit;
  const wantSurround = Boolean(scene.surround) && wideFit.surround;
  const densityScale = wantSurround ? wideFit.scale : plainFit.scale;
  const stageRef = useRef(null);
  const arabic = useMemo(() => courses.some((course) => textDirection(course.name) === 'rtl'), [courses]);
  const { list, room, leaving, swapping, ready, surroundIn, surroundOf: hasSurround, prime } = useMoods(
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
  // The candle the room draws: by night the place whose light the room is in (a moved candle shows at
  // its new place with that place's light, never ahead of it), by day where it stands.
  const shownCandle = isNightKey(room) ? Object.keys(scene.candles || {}).find((p) => scene.candles[p].night === room) || candle : candle;
  // Moving a book or the candle (round eight, M2; run 2). A press on a book or the candle first PRIMES
  // every picture any place it could go to needs (decoded off the page), so a drop never waits. A drag
  // (round seven's threshold, targets and rules) moves its ghost by transform (BookGhost / CandleGhost);
  // the pile it left settles at once, the books above it gliding one place down (liftOut). A move (a
  // drop, the menu, Ctrl K, the keys) is ANNOUNCED by RoomDesk before it is saved (announceMoves): every
  // book whose place changes starts GLIDING in that very frame (BookGlide), hidden in the stacks by a DOM
  // mark (data-gliding: no stack is rendered for it), and the stacks catch up under the ghosts in a
  // transition (pending), then the real save. The candle glides when the room shows it at its new place
  // (by night once that place's light is in: until then it waits in the hand, lit). Nothing but the
  // thing itself fades (its ghost, over its own place's picture). The pointer moves a ghost's transform,
  // never React.
  const ghostRef = useRef(null);
  const dragNow = useRef(null);
  useEffect(() => {
    dragNow.current = drag;
  });
  // Every picture a book needs at the places it could go to (in the room's mood), decoded now.
  const primed = useRef(new Set());
  const primeBook = (id, pressed = false) => {
    if (!byId.has(id) || !arranged.map?.[id]) return;
    // A press may end as a click: its film is built now, unseen (deskFilmRun prepareFilm).
    if (pressed && !filmRunning()) {
      const film = filmOf(id);
      if (film) prepareFilm(film);
    }
    dragTargets(arranged, id).forEach((t) => {
      const key = `${room}:${t.place}`;
      if (primed.current.has(key)) return;
      primed.current.add(key);
      const rec = bookRec(room, t.place);
      if (!rec) return;
      const masks = ['leather', 'label'].map((part) => rec[part] && { ...rec[part], box: rec[`${part}Box`] });
      [rec, rec.shadow, ...masks, rec.plate, rec.gilt?.title, rec.gilt?.count, surroundIn ? rec.shadowWide : null]
        .filter(Boolean)
        .forEach((r) => decodeOne(r, densityScale).catch(() => null));
    });
  };
  // The candle's other places: by night each one's whole light (its night set: the room changes the
  // moment the candle lands), by day its picture and shadow there.
  const primeCandle = () => {
    candlePlaces(scene)
      .filter((p) => p !== candle)
      .forEach((p) => {
        if (isNightKey(room)) prime(scene.candles[p].night);
        else dayCandleOf(p).forEach((r) => decodeOne(r, densityScale).catch(() => null));
      });
  };
  // A book out of the stacks while it travels: its pictures, gilt and rim marked (DOM, never React, so
  // no stack renders again for it); the mark stays on its elements wherever React then places them.
  const markGliding = (id, on) => {
    stageRef.current?.querySelectorAll(on ? `.room-stage-slab[data-course="${CSS.escape(id)}"]` : `.room-stage-slab[data-gliding="${CSS.escape(id)}"]`).forEach((el) => {
      if (on) el.setAttribute('data-gliding', id);
      else el.removeAttribute('data-gliding');
    });
  };
  const startCandleDrag = (start) => {
    if (!onMoveCandle || drag) return;
    primeCandle();
    const targets = Object.keys(scene.candles || {})
      .filter((p) => candlePlaces(scene).includes(p))
      .map((p) => ({ place: p, kind: p === candle ? 'own' : 'candle', polygon: candleRing(candleAt(p).box) }));
    setDrag({ id: 'candle', place: shownCandle, targets, over: null, start, candle: true, from: room });
  };
  const startDrag = (id, place, start) => {
    if (!onArrange || drag) return;
    dropPreparedFilm();
    primeBook(id);
    markGliding(id, true);
    // Its own pile's next place is where the pile's top now is (the books above it settle).
    const targets = dragTargets(arranged, id).map((t) => {
      const own = t.kind === 'pile' && t.place[0] === place[0] && !isNearPlace(place);
      return { ...t, polygon: silhouette(own ? `${t.place[0]}${Number(t.place.slice(1)) - 1}` : t.place) };
    });
    setDrag({ id, place, targets, over: null, start, from: room });
  };
  // The ghost's offset from its place (css px), and the flame carried with the candle.
  const flames = useCallback(() => [...(stageRef.current?.querySelectorAll('.room-stage-candle > .room-stage-flamefilm, .room-stage-candle > .room-stage-flame-still') || [])], []);
  const offsetRef = useRef([0, 0]);
  // Where each book is drawn now (for an announced move's starting places).
  const placesNow = useMemo(() => new Map(books.map(({ id, place }) => [id, place])), [books]);
  const drawnRef = useRef(placesNow);
  useEffect(() => {
    drawnRef.current = placesNow;
  });
  // The moves RoomDesk announces before it saves them (announceMoves): every book whose place changes
  // glides from where it is drawn (a dropped one from where it was let go) at once; the stacks follow.
  const announce = (fromMap, toMap, primary = null) => {
    const drawn = drawnRef.current;
    const d = dragNow.current && !dragNow.current.candle ? dragNow.current : null;
    const quiet = quietNow(still);
    const made = [];
    Object.keys(toMap || {}).forEach((id) => {
      const mine = d && d.id === id;
      const from = mine ? d.place : drawn.get(id) || fromMap?.[id];
      const to = toMap[id];
      if (!from || !to || (from === to && !mine) || !byId.has(id)) return;
      made.push({ id, from, to, offset: mine ? offsetRef.current : [0, 0], lifted: Boolean(mine) || id === primary, ms: mine || id === primary ? GLIDE_MS : SETTLE_GLIDE_MS });
    });
    // Still or reduced motion: nothing glides, everything is where it goes at once (and the book that was
    // held is shown again).
    if (quiet) {
      made.forEach((g) => markGliding(g.id, false));
      if (d) markGliding(d.id, false);
    } else made.forEach((g) => markGliding(g.id, true));
    // The drag is over: its handlers see it at once (the up handler checks it right after).
    if (d) dragNow.current = null;
    flushSync(() => {
      if (!quiet && made.length) {
        setGlides((was) => [...was.filter((g) => !made.some((m) => m.id === g.id)), ...made.map((m) => ({ ...m, key: `${m.id}:${m.from}>${m.to}:${++glideSeq.current}` }))]);
      }
      if (d) {
        setDrag(null);
        if (!isNearPlace(d.place)) setHeldLift(d.id);
      }
    });
    // The stacks catch up under the ghosts, in a transition (the save follows: RoomDesk).
    startTransition(() => {
      setPending({ map: { ...toMap }, key: placesKey(toMap) });
      setHeldLift(null);
    });
  };
  const announceNow = useRef(null);
  useEffect(() => {
    announceNow.current = announce;
  });
  useEffect(() => {
    setMoveAnnouncer((...args) => announceNow.current?.(...args));
    return () => setMoveAnnouncer(null);
  }, []);
  const glideSeq = useRef(0);
  const dragId = drag?.id;
  const dragLive = Boolean(drag);
  useEffect(() => {
    if (!dragId || !dragLive) return undefined;
    const place = (dx, dy) => {
      offsetRef.current = [dx, dy];
      const el = ghostRef.current;
      if (el) el.style.transform = `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px)`;
      // By day the flame goes with the candle in the hand; by night it stays where the room's light is.
      if (dragNow.current?.candle && !isNightKey(dragNow.current.from)) flames().forEach((f) => (f.style.transform = `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px)`));
    };
    // Let go off a target (or Escape): back to its own place, gliding (the pile it left rises again).
    const goBack = () => {
      const d = dragNow.current;
      if (!d) return;
      flames().forEach((f) => (f.style.transform = ''));
      if (d.candle) {
        setDrag(null);
        if (!quietNow(still)) setCandleGlides((g) => [...g, { key: `c${++glideSeq.current}-${d.place}`, from: d.place, to: d.place, mood: room, offset: offsetRef.current, ms: GLIDE_MS, placing: isNightKey(d.from) }]);
        return;
      }
      announceNow.current?.(null, { ...(arrangementRef.current?.map || {}) }, d.id);
    };
    const move = (event) => {
      const d = dragNow.current;
      if (!d) return;
      place(event.clientX - d.start[0], event.clientY - d.start[1]);
      const at = [(event.clientX - fitNow.current.left) / fitNow.current.scale, (event.clientY - fitNow.current.top) / fitNow.current.scale];
      const over = pickTarget(d.targets, at, 40);
      if (over !== d.over) setDrag((cur) => (cur && cur.id === d.id ? { ...cur, over } : cur));
    };
    const up = () => {
      const d = dragNow.current;
      if (!d) return;
      if (d.over && d.over !== d.place) {
        if (d.candle) {
          // Held where it was let go until the room shows the candle moved (by night: its light in).
          setDrag((cur) => (cur && cur.candle ? { ...cur, dropped: { to: d.over, offset: offsetRef.current } } : cur));
          onMoveCandle?.(d.over);
        } else onArrange(d.id, { to: d.over });
        // (RoomDesk announces the move: the glide starts there, this frame.)
        if (!d.candle && dragNow.current?.id === d.id) goBack();
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
  }, [dragId, dragLive, onArrange, onMoveCandle, flames, still, room]);
  // A dropped candle the room never took (the write was refused, nothing changed): back to its place.
  const droppedKey = drag?.dropped ? `${drag.id}>${drag.dropped.to}` : '';
  useEffect(() => {
    if (!droppedKey) return undefined;
    const timer = setTimeout(() => setDrag((cur) => (cur?.dropped ? null : cur)), 4000);
    return () => clearTimeout(timer);
  }, [droppedKey]);

  // Moves nobody announced (a save from elsewhere, a delete's settling, an undo): every book whose drawn
  // place changed glides too, worked out in render from the last places seen (no effect, no ref read:
  // the room's lint), marked in the layout effect below before the frame is drawn.
  const [seenPlaces, setSeenPlaces] = useState(placesNow);
  if (seenPlaces !== placesNow) {
    setSeenPlaces(placesNow);
    const moved = [...placesNow].filter(([id, place]) => seenPlaces.has(id) && seenPlaces.get(id) !== place && !glides.some((g) => g.id === id && g.to === place));
    if (moved.length && !still) {
      setGlides((was) => [
        ...was.filter((g) => !moved.some(([id]) => id === g.id)),
        ...moved.map(([id, to]) => {
          const from = seenPlaces.get(id);
          return { key: `${id}:${from}>${to}:u${was.length}`, id, from, to, offset: [0, 0], lifted: moved.length === 1, ms: moved.length === 1 ? GLIDE_MS : SETTLE_GLIDE_MS };
        }),
      ]);
    }
  }
  // Every book on its way is marked out of the stacks (before the frame is drawn); one whose ghost has
  // landed is SETTLED once the stacks draw it at its new place: shown again, and its ghost hands over.
  const settled = `|${glides
    .filter((g) => landed.includes(`|${g.key}|`) && placesNow.get(g.id) === g.to)
    .map((g) => g.key)
    .join('|')}|`;
  useLayoutEffect(() => {
    glides.forEach((g) => markGliding(g.id, !settled.includes(`|${g.key}|`)));
  });
  // A glide's object never changes once made (its animation would start again): landing is kept apart.
  const onLanded = useCallback((key, how) => {
    if (how === 'gone') {
      setGlides((was) => was.filter((g) => g.key !== key));
      setLanded((was) => was.replace(`|${key}|`, '|'));
    } else setLanded((was) => (was.includes(`|${key}|`) ? was : `${was}${key}|`));
  }, []);
  // An announced move the save never confirmed (refused, or settled differently): let go after 3 s.
  useEffect(() => {
    if (!pending) return undefined;
    const timer = setTimeout(() => setPending(null), 3000);
    return () => clearTimeout(timer);
  }, [pending]);
  const [seenCandle, setSeenCandle] = useState(shownCandle);
  if (seenCandle !== shownCandle) {
    setSeenCandle(shownCandle);
    const drop = drag?.candle && drag.dropped ? drag : null;
    if (!still) {
      setCandleGlides((was) => [
        ...was,
        { key: `c${was.length}:${seenCandle}>${shownCandle}`, from: drop ? drop.place : seenCandle, to: shownCandle, mood: drop ? drop.from : room, offset: drop ? drop.dropped.offset : [0, 0], ms: GLIDE_MS, fromPlacing: Boolean(drop && isNightKey(drop.from)) },
      ]);
    }
    if (drop) setDrag(null);
  }
  const onCandleLanded = useCallback((key) => setCandleGlides((was) => was.filter((g) => g.key !== key)), []);
  // The candle in the hand ('held') or on its way ('gliding'): desk.css takes it out of the room's
  // pictures where that shows the truth (see there).
  // (A night's likeness going home alone is not the candle: the room keeps its own.)
  const candleAway = drag?.candle ? 'held' : candleGlides.some((g) => !g.placing) ? 'gliding' : undefined;
  // Opening a book (round eight, deskFilmRun.js): the film, drawn through the render's own camera from
  // the book's place (its spine's quad on a pile, scene.json nearPlaces for the near place) at the
  // stage's fit of the moment. The real book is hidden at its place while the film has it (data-filmed:
  // its picture, dyes and gilt; its shadow stays, as in a drag); focus comes back to it after.
  // False when no film plays (still, reduced motion): the caller opens the course at once.
  const filmGeometry = (place) => () => {
    if (typeof window === 'undefined') return null;
    const f = fitNow.current;
    const cam = stageCamera(scene, f);
    const view = { width: window.innerWidth, height: window.innerHeight };
    if (isNearPlace(place)) {
      const spot = scene.nearPlaces?.[place];
      if (!spot) return null;
      const { pose, t } = nearPose(cam, spot);
      return { cam, from: pose, near: true, view, t };
    }
    const quad = scene.quads.spines[place];
    if (!quad) return null;
    const { pose, t } = pilePose(cam, quad, f);
    return { cam, from: pose, near: false, view, t };
  };
  // What a book's film needs (its geometry, its look, hiding and focusing the real one); null when no
  // film can play from it.
  // Run 3: a course shown as the held book (deskBook.js; the harness's `?book=1` until the production
  // pictures exist): the film lands on the picture. A function, so a close made later reads the window then.
  const heldOf = (course) => {
    const registered = getDeskBook();
    if (!bookShows({ width: window.innerWidth, homeIsDesk: true }, registered)) return null;
    return () => {
      const held = registered.held(bookLight(room), course.color);
      const view = { width: window.innerWidth, height: window.innerHeight };
      const fit = heldFit(view, held);
      const { left, right } = held.pages;
      const at = (p) => [fit.left + p[0] * fit.scale, fit.top + p[1] * fit.scale];
      // The spread on the window: its spine (the pages' meeting edges), its middle, its height.
      const spineX = (at(left.page[1])[0] + at(left.page[2])[0] + at(right.page[0])[0] + at(right.page[3])[0]) / 4;
      const top = (at(left.page[0])[1] + at(right.page[1])[1]) / 2;
      const bottom = (at(left.page[3])[1] + at(right.page[2])[1]) / 2;
      const src = fit.scale * (window.devicePixelRatio || 1) > 1.05 ? held.src.x2 : held.src.x1;
      return { src, fit, ground: held.ground, paper: held.paper, spread: { x: spineX, cy: (top + bottom) / 2, tall: bottom - top } };
    };
  };
  const filmOf = (id) => {
    const course = byId.get(id);
    const place = arranged.map?.[id];
    if (still || !course || !place || !bookRec(room, place)) return null;
    const rec = bookRec(room, place);
    const look = { ...filmLook(scene, room, place, course), strip: rec.gilt?.title ? file(rec.gilt.title.x2) : '', held: heldOf(course) };
    const stage = stageRef.current;
    return {
      courseId: id,
      describe: filmGeometry(place),
      look,
      hideBook: (on) =>
        stage?.querySelectorAll(`.room-stage-slab[data-place="${place}"]`).forEach((el) => (on ? el.setAttribute('data-filmed', '') : el.removeAttribute('data-filmed'))),
      focusBook: () => {
        // Not when focus has gone elsewhere on the desk; focus on the course page that is going (its
        // Back, its links) comes home to the book (run 2: it fell to <body> when that page unmounted).
        const active = document.activeElement;
        if (active && active !== document.body && !active.closest('.room-page-slot')) return;
        stage?.querySelector(`.room-stage-slab-hit[data-course-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
      },
    };
  };
  const openBook = (id) => {
    if (filmRunning()) return true;
    const film = filmOf(id);
    return film ? openFilm(film) : false;
  };
  // A book's menu: { id, place, at: [x, y] (window px), title }.
  const [menu, setMenu] = useState(null);
  const openMenu = (id, place, at) => {
    if (!byId.has(id)) return;
    primeBook(id);
    setMenu((m) => (m && m.id === id ? m : { id, place, at, title: byId.get(id).name }));
  };
  const openCandleMenu = (at) => {
    primeCandle();
    setMenu((m) => (m && m.id === 'candle' ? m : { id: 'candle', place: candle, at, title: 'Candle' }));
  };
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
  // The latest handlers behind names that never change (run desk1, D4), so the books' hit areas and
  // the dashed places render again only when they themselves change.
  const latest = useRef({});
  useEffect(() => {
    latest.current = { onPick, onMove, onArrange, onMore, onNewCourse, startDrag, openMenu, primeBook };
  });
  const act = useMemo(
    () => ({
      pick: (...args) => latest.current.onPick?.(...args),
      move: (...args) => latest.current.onMove?.(...args),
      arrange: (...args) => latest.current.onArrange?.(...args),
      drag: (...args) => latest.current.startDrag?.(...args),
      prime: (...args) => latest.current.primeBook?.(...args),
      menu: (...args) => latest.current.openMenu?.(...args),
      more: () => latest.current.onMore?.(),
      newCourse: () => latest.current.onNewCourse?.(),
    }),
    [],
  );
  // The stage's page-wide rules (desk.css html[data-desk-stage]: no page scroll, the room's own
  // atmosphere not drawn under the stage, the top line's pills) while it is on the screen.
  // Run 2: the scrollbar's gutter, measured before the stage takes it away, so desk.css keeps the top
  // line's links where every other room page has them (they moved by its width).
  useLayoutEffect(() => {
    const root = document.documentElement;
    // (html's own box: its clientWidth reports the whole window while scrollbar-gutter: stable
    // keeps a strip with no scrollbar in it.)
    if (!root.hasAttribute('data-desk-stage')) root.style.setProperty('--room-gutter-w', `${Math.max(0, Math.round((window.innerWidth - root.getBoundingClientRect().width) * 100) / 100)}px`);
    root.setAttribute('data-desk-stage', '');
    return () => root.removeAttribute('data-desk-stage');
  }, []);
  // A book opens by its film however it is opened: a click or Enter (RoomDesk's pick asks here first),
  // the menu's Open, ⌘K's course rows (not while a course of it is open: the desk is kept then, hidden).
  // The leather's grain is drawn once, and the course page's own picture fetched and decoded, in idle
  // time, before the first click.
  const openNow = useRef(null);
  const roomNow = useRef(room);
  useEffect(() => {
    openNow.current = openBook;
    roomNow.current = room;
  });
  // Ctrl K open on the desk: it may move the candle, so the other place's light is decoded meanwhile
  // (the moment the action runs the room can change; unprimed, the candle waited 300-600 ms lit).
  const primeNow = useRef(null);
  useEffect(() => {
    primeNow.current = primeCandle;
  });
  useEffect(
    () =>
      subscribeSearch(() => {
        if (isSearchOpen() && !getFilm()) primeNow.current?.();
      }),
    [],
  );
  useEffect(() => {
    setDeskOpener((id) => {
      const state = getFilm();
      // Kept (its course shown): the address simply changes. Mid-film: nothing else starts.
      if (state?.phase === 'shown') return false;
      if (state || filmRunning()) return true;
      return Boolean(openNow.current?.(id));
    });
    const prepare = () => {
      prepareGrain();
      prepareRoomPictures();
      warmFilm();
      warmRoomOnce();
      // Run 3: the held book's picture for the room's light, decoded and drawn once, all but unseen.
      const registered = getDeskBook();
      if (bookShows({ width: window.innerWidth, homeIsDesk: true }, registered)) {
        const held = registered.held(bookLight(roomNow.current));
        const fit = heldFit({ width: window.innerWidth, height: window.innerHeight }, held);
        prepareHeld(fit.scale * (window.devicePixelRatio || 1) > 1.05 ? held.src.x2 : held.src.x1, fit);
      }
    };
    const idle = typeof window.requestIdleCallback === 'function' ? window.requestIdleCallback(prepare, { timeout: 3000 }) : setTimeout(prepare, 1500);
    return () => {
      setDeskOpener(null);
      if (typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(idle);
      else clearTimeout(idle);
    };
  }, []);
  // The frame's opening, where its picture's controls sit; left out when a pile stands before the
  // frame with its top above the frame's lower rule (deskStage.js frameHidden).
  const opening = quadBox(scene.quads.frameOpening);
  const frameCovered = useMemo(() => frameHidden(scene.quads, places.books), [places]);
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
            // Unseen until its pictures are in (desk.css: opacity 0), and until then out of reach too:
            // no click, no focus, nothing read out (run desk1, D7).
            inert={!ready}
            data-room={room}
            data-swapping={swapping ? '' : undefined}
          data-leaving={leaving || undefined}
          data-dragging={dragLive ? '' : undefined}
          data-candle-away={candleAway}
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
              candle={candle}
            />
            ))}

            {/* Above both: what belongs to no mood. */}
            <div className="room-stage-overlay">
              {/* The frame's picture's controls (SceneSlot: add, change, take it down), drawn clear: the
                  stacks draw the picture. Under the books' hit areas, which may reach over it. Not there
                  at all once pile R's top is above the frame's lower rule (from its ninth book; ROUND7-BRIEF
                  §9: until its tenth the "+" stood on a spine, and at thirty courses it was lettered on
                  one at 1.06:1). */}
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
                      room={room}
                      stageRef={stageRef}
                      lifted={liftedId === id}
                      picked={pickedId === id}
                      onPick={act.pick}
                      onMove={onMove ? act.move : undefined}
                      onArrange={onArrange ? act.arrange : undefined}
                      onDrag={onArrange ? act.drag : undefined}
                      onMenu={onArrange ? act.menu : undefined}
                      onPrime={onArrange ? act.prime : undefined}
                    />
                  ) : null,
                )}
                {places.more && <DashedSlab place={places.more.place} scale={scale} hit={hits[places.more.place]} label={`and ${places.more.count} more`} onClick={act.more} />}
                {/* "+ New course": the ghost of the next book, in gilt dash, where it will lie. */}
                {ghost && <DashedSlab place={ghost} scale={scale} hit={hits[ghost]} label="+ New course" onClick={act.newCourse} className="is-new" />}
              </div>

              {/* A dragged book and where it may go: above the books' hit areas, taking no pointer. */}
              {drag && !drag.dropped && <DragTargets targets={drag.targets} over={drag.over} scale={scale} stage={scene.stage} />}
              {drag?.candle && <CandleGhost ghostRef={ghostRef} candle={drag.place} mood={drag.from} scale={scale} placing={isNightKey(drag.from)} />}
              {drag && !drag.candle && byId.has(drag.id) && (
                <BookGhost ghostRef={ghostRef} course={byId.get(drag.id)} place={drag.place} mood={drag.from} scale={scale} />
              )}
              {glides.map((g) =>
                byId.has(g.id) ? (
                  <BookGlide key={g.key} glide={g} course={byId.get(g.id)} mood={room} scale={scale} onLanded={onLanded} settle={settled.includes(`|${g.key}|`)} />
                ) : null,
              )}
              {candleGlides.map((g) => (
                <CandleGlide key={g.key} glide={g} scale={scale} flameOf={flames} onLanded={onCandleLanded} />
              ))}

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
                quads={PAGE_QUADS}
                size={PAGE}
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
              points={candleAt(shownCandle).points}
              box={candleAt(shownCandle).box}
              stillFlame={stillFlameOf(isNightKey(room) ? room : nightKey, scale)}
              onDrag={onMoveCandle && candlePlaces(scene).length > 1 ? startCandleDrag : undefined}
              onMenu={onMoveCandle && candlePlaces(scene).length > 1 ? openCandleMenu : undefined}
              onPrime={onMoveCandle && candlePlaces(scene).length > 1 ? primeCandle : undefined}
            />
          </div>
          {menu && (menu.id === 'candle' || byId.has(menu.id)) && <StageMenu menu={menu} items={menuItems(menu)} onClose={closeMenu} />}
        </div>
      </StageSnap.Provider>
    </DensityScale.Provider>
  );
};

export default DeskStage;
