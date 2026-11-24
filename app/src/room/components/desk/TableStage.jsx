import { createContext, memo, startTransition, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import SceneSlot from '../SceneSlot';
import { clipPolygon, quadBox, quadSize } from '../../deskProject';
import { candleRing, leatherOf, pageCapacity, pictureDensity, pickTarget, stageFit } from '../../deskStage';
import { textDirection } from '../../deskLayout';
import {
  FLAT,
  NEAR,
  PLACES,
  PLACE_NAMES,
  arrangeTable,
  bookLayers,
  countLettering,
  isNightState,
  lampTwin,
  leathersOf,
  lookTwin,
  roomLayers,
  slotKey,
  slotOf,
  slotsKey,
  stateFor,
  tableFrom,
  tableLiftOut,
  tableMarks,
  tableTargets,
  titleLettering,
  toneState,
  wideLayers,
} from '../../deskTable';
import { decodePicture, loadState, pictureUrl, stateNow } from '../../deskTableData';
import { FILM_TONES, coverLines, getFilm, nearPose, pilePose, setDeskOpener, setMoveAnnouncer, stageCamera } from '../../deskFilm';
import { dropPreparedFilm, filmRunning, lastOpenedBook, openFilm, prepareFilm, prepareGrain, prepareHeld, prepareRoomPictures, warmFilm, warmRoomFor, warmRoomOnce } from '../../deskFilmRun';
import { bookShows, getDeskBook, setLookWarmer } from '../../deskBook';
import { heldDense, heldFit } from '../../deskBookPages';
import { isSearchOpen, subscribeSearch } from '../../deskSearch';
import { Gilt, OnQuad, Pages, StageCandle, StageMenu, StagePicture } from './stageParts';
import { GLIDE_EASE, GLIDE_MS, SETTLE_GLIDE_MS, StageSnap, hitStyle, landing, moveCss, px, quietNow, typeVars, usePress } from './stageKit';
import { saveData } from './useFlameFilm';
import '../../desk.css';
import '../../table.css';

// The desk's table (round eight, run 3): the production stage. Blender rendered the study from the chair
// (room-harness/blender p2.py, prod1/): six light states (night with the candle at C0 or C1, day, each with
// the lamp off or on), and in each one every place and level in six real leathers, the room's own pictures,
// each book's shadow and shade, and the pair layers that hold any filling of the five places (scene2.json;
// its README is the law for the stacking, deskTable.js the rules). The page fetches them as plain URLs
// (deskTableData.js), never inlined.
//
// One light state is one STACK (TableState): the room (base, and by night its light over it, breathing a
// little round the wick), the wall frame with the owner's picture, the room's layers for the arrangement
// (the small notebook, the candle, every place's shadows far to near with each pair right after the nearer
// of its two places), the books far to near (each level's shade, its picture, its plate where a count is
// lettered, the pairs' shades on that place, the big notebook after the towers), and every book's gilt
// last (its title on its label, as round seven). The shown state's stack is opaque; another comes in over
// it in a swap (table.css). Above every stack, what belongs to no state: the books' hit areas, the lamp's
// switch, the small notebook's button, the notebook's words, the frame's controls, the candle and its
// filmed flame. Everything is a plain picture drawn "over"; only the frame's light and glass blend.
//
// Motion is round eight's (run 1, run 2): a press primes the pictures of every place a thing could go to;
// a drag moves a ghost by transform; a move (a drop, the menu, Ctrl K, the keys) is announced before it is
// saved and the books travel in that frame, the books above a taken one settling down a level (a short
// glide); nothing on the screen fades but the thing itself handing over to its own picture.

// The 2x pictures when a stage px is drawn at 1.25 device px or more (deskStage.js pictureDensity).
const densityOf = (scale) => pictureDensity(scale, typeof window !== 'undefined' ? window.devicePixelRatio : 1, saveData());
const Density = createContext(1);
// Frames between a change and the frame that may rely on it having been drawn (a commit waits for the previous tree's
// raster, so the third frame's commit comes after the first's raster): deskFilmRun's PAINT_FRAMES.
const PAINT_FRAMES = 3;
const afterFrames = (n, fn) => {
  const step = (k) => requestAnimationFrame(() => (k <= 1 ? fn() : step(k - 1)));
  step(n);
};

// A picture at its 1x box (less an origin), scaled with the stage; soft layers' files are smaller than
// their box (`res`), drawn up. A picture that fails is simply absent (hidden, nothing thrown).
const hideBroken = (event) => {
  event.currentTarget.style.visibility = 'hidden';
};
// `sync` (fix run): a thing's picture appearing in the frame it is mounted (a ghost taking over from its book: its
// picture is decoded already, and drawn async it came a frame after the ghost's shadow, a blank book).
const Pic = ({ rec, scale, origin = [0, 0], className, eager = false, sync = false }) => {
  const density = useContext(Density);
  if (!rec) return null;
  const [x, y, w, h] = rec.box;
  return (
    <img
      className={className}
      src={pictureUrl(rec, density)}
      width={Math.round(w)}
      height={Math.round(h)}
      alt=""
      decoding={sync ? 'sync' : 'async'}
      fetchPriority={eager ? 'high' : 'auto'}
      draggable={false}
      onError={hideBroken}
      style={{ left: px((x - origin[0]) * scale), top: px((y - origin[1]) * scale), width: px(w * scale), height: px(h * scale) }}
    />
  );
};

// A slot's geometry (core.places): its level's quads; its face (a spine, or F3's cover), its title's and
// count's labels, its hull and its hit area with `count` books on its place.
const levelOf = (core, slot) => {
  const s = slotOf(slot);
  return s ? core.places[s.place]?.levels?.[s.level] || null : null;
};
const faceOf = (core, slot) => {
  const l = levelOf(core, slot);
  return l ? l.cover || l.spine : null;
};
const titleQuadOf = (core, slot) => {
  const l = levelOf(core, slot);
  return l ? l.coverTitle || l.label : null;
};
const countQuadOf = (core, slot) => {
  const l = levelOf(core, slot);
  return l ? l.coverCount || l.count : null;
};
const spineTall = (core, slot) => {
  const l = levelOf(core, slot);
  if (!l || l.cover) return Infinity;
  const q = l.spine;
  return (Math.hypot(q[3][0] - q[0][0], q[3][1] - q[0][1]) + Math.hypot(q[2][0] - q[1][0], q[2][1] - q[1][1])) / 2;
};
const hitOf = (core, slot, count) => {
  const s = slotOf(slot);
  return s ? core.places[s.place]?.hits?.[String(count)]?.[s.level] || levelOf(core, slot)?.hull : null;
};

// A book's words at its slot and the scale: the title on its label (deskTable.js titleLettering: 13 css px
// tall on the screen at the least, a cover's foreshortening counted) and the count on its plate, or none.
const wordsOf = (core, course, slot, scale) => {
  const title = titleLettering(course.name, titleQuadOf(core, slot), scale, { spineHeight: spineTall(core, slot) });
  let numeral = null;
  if (course.noteCount && countQuadOf(core, slot)) {
    const fit = countLettering(course.noteCount, countQuadOf(core, slot), scale);
    numeral = fit.text ? fit : null;
  }
  return { title, numeral, rtl: textDirection(course.name) === 'rtl' };
};

const toHex = (rgb) => `#${rgb.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('')}`;
// The leathers and labels as drawn (the book film's box book; measured on the production pictures by
// room-harness/r8m4-tones.py: by night a candle-lit spine, by day the near stack's).
const LEATHER_SEEN = {
  night: { oxblood: '#4b1109', chestnut: '#581b0b', tan: '#843715', bottle: '#1d1909', navy: '#1a1209', black: '#180c06' },
  day: { oxblood: '#612825', chestnut: '#703c29', tan: '#9d7151', bottle: '#263c33', navy: '#233046', black: '#232222' },
};
const LABEL_SEEN = { night: { black: '#1d120c', oxblood: '#3a130d' }, day: { black: '#171516', oxblood: '#361514' } };
// Fix run (rule 6): the film's book in the tones of its OWN picture at its place, in the state shown: the leather the
// median of the picture's opaque pixels inside its face (a spine, or F3's cover), the label the median inside its
// label's quad (the picture's label carries no letters: the page's gilt does). Read from the decoded picture on the
// page, once per state, slot and leather; LEATHER_SEEN / LABEL_SEEN only when the picture is not there.
const channels = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
// A book lying on one just lifted settles one level down in this long (fix run 2: at most 120 ms).
const LIFT_SETTLE_MS = 110;
// The candle put down: to its seat in this long, before the room's light changes (fix run 3).
const CANDLE_SEAT_MS = 140;
const measuredBooks = new Map();
const insideQuad = (q, x, y) => {
  let sign = 0;
  for (let i = 0; i < 4; i += 1) {
    const [ax, ay] = q[i];
    const [bx, by] = q[(i + 1) % 4];
    const c = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    if (c !== 0) {
      if (sign && Math.sign(c) !== sign) return false;
      sign = Math.sign(c);
    }
  }
  return true;
};
// `picture` (fix run 2): a decoded picture of that book at that slot to read instead of the stack's own.
const measureBook = (stage, core, state, id, slot, leather, picture = null) => {
  const key = `${state}|${slot}|${leather}`;
  if (measuredBooks.has(key)) return measuredBooks.get(key);
  const rec = stateNow(state)?.layers?.[`book-${slot}-${leather}`];
  const level = levelOf(core, slot);
  const img = picture || (rec && level ? stage?.querySelector(`.room-table-state[data-s="${state}"] .room-table-book[data-course="${CSS.escape(id)}"][data-slot="${slot}"] img[src*="/book-"]`) : null);
  if (!rec || !level || !img || !img.complete || !img.naturalWidth) return null;
  try {
    const [bx, by, bw] = rec.box;
    const k = img.naturalWidth / bw;
    const face = level.cover || level.spine;
    const label = level.coverTitle || level.label;
    const [fx, fy, fw, fh] = quadBox(face);
    const w = Math.max(1, Math.round(fw * k));
    const h = Math.max(1, Math.round(fh * k));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, (fx - bx) * k, (fy - by) * k, fw * k, fh * k, 0, 0, w, h);
    const data = g.getImageData(0, 0, w, h).data;
    const median = (quad) => {
      const ch = [[], [], []];
      for (let y = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1) {
          const at = (y * w + x) * 4;
          if (data[at + 3] < 230 || !insideQuad(quad, fx + (x + 0.5) / k, fy + (y + 0.5) / k)) continue;
          ch[0].push(data[at]);
          ch[1].push(data[at + 1]);
          ch[2].push(data[at + 2]);
        }
      }
      if (!ch[0].length) return null;
      return toHex(ch.map((v) => v.sort((a, b) => a - b)[v.length >> 1] / 255));
    };
    const out = { leather: median(face), label: label ? median(label) : null };
    measuredBooks.set(key, out);
    return out;
  } catch {
    return null;
  }
};

// Every picture a state's stack draws for an arrangement: the room, its light, its frame, its layers, the
// books, their plates and gilt strips; the surround and the shadows past the frame when wanted.
const picturesOf = (core, data, { leathers, plates, look, candle, held, surround }) => {
  if (!data) return [];
  const L = data.layers;
  const names = ['set-base', 'set-lit', 'breath', 'frame', 'frame-light', 'frame-glass', 'notebook', 'flame'];
  if (surround) names.push('surround-base', 'surround-lit', ...wideLayers(data, leathers, { look, candle, held }));
  names.push(...roomLayers(data, leathers, { look, candle, held }));
  bookLayers(data, leathers, plates).forEach((b) => {
    if (b.kind === 'book') names.push(b.shade, b.book, b.plate, `gilt-${b.slot}`, plates[b.slot] ? `gilt-count-${b.slot}` : null);
    else names.push(b.name);
  });
  return names.filter((n) => n && L[n]).map((n) => ({ name: n, rec: L[n], strip: n.startsWith('gilt') }));
};
const urlsOf = (list, density) => list.map(({ rec, strip }) => pictureUrl(rec, strip ? 2 : density));

/* ── The light states on the page ─────────────────────────────────────────── */

// Which states are on the page. `room` is the state the room is in (or going to): the wish once its file is
// read and all its pictures are decoded (4 s at most), so it arrives whole. Once it is in, its lamp's twin
// and then its other look (night <-> day) are fetched and decoded in idle time and mounted unseen, so the
// lamp's press and the candle's change the room at once; a candle place's night is primed from a press on
// the candle. `leaving`: the state just left, until the swap's own transitions have finished. `swap`: what
// kind of change it was ('look' | 'lamp' | 'candle'), for table.css.
// The harness's "before" for the bound (Fault 3): run 3's keeping, everything kept (globalThis.__deskHarness.noBound).
const unbound = () => Boolean(typeof globalThis !== 'undefined' && globalThis.__deskHarness?.noBound);
const swapKind = (from, to) => (isNightState(from) !== isNightState(to) ? 'look' : from.replace(/Lamp$/, '') === to.replace(/Lamp$/, '') ? 'lamp' : 'candle');
// Fix run (Fault 3, the bound): on the page are the room, the state it leaves, its lamp's twin, and a state asked for
// by a switch about to be used (`extra`: the candle's other look or place, while the pointer or the keyboard is on
// the candle); the rest are let go (their pictures, canvas and bitmaps). A state comes back by its prime, and the room
// changes to it only once its canvas has been drawn (`drawn`, TableState's RoomCanvas): never a room without its light.
// `hold` (fix run 3): the room does not change state while it is true (a candle on its way to its seat: the light
// changes once it has been put down).
const useStates = (core, wish, want, stageRef, extra = [], hold = false) => {
  const [ready, setReady] = useState({});
  const [drawn, setDrawn] = useState({});
  // Owner fixes (2026-11-23, D): a change of light is never a cut.
  //   - Turned round mid-way (the switch pressed again while the light is still changing): the stack that was coming in
  //     stays on top and goes out again from where it is (`back`: table.css), the one it was covering whole under it.
  //     (It had become the room at once, opaque on top: the light jumped back in one frame.)
  //   - A third state asked for mid-change waits for the change to end, then gets its own whole change.
  //   - A state not on the page is read and decoded first (prime), its canvas drawn, and only then does the change
  //     begin, in full.
  const [state, setState] = useState({ room: wish, leaving: null, swap: '', back: false });
  if (state.room !== wish && !hold) {
    if (state.leaving === wish) setState({ room: wish, leaving: state.room, swap: state.swap, back: !state.back });
    else if (!state.leaving && ready[wish] && (drawn[wish] || TABLE_ROOM !== 'canvas')) setState({ room: wish, leaving: state.room, swap: swapKind(state.room, wish), back: false });
  }
  const { room, leaving, swap, back } = state;
  const wantNow = useRef(want);
  useEffect(() => {
    wantNow.current = want;
  });
  const asked = useRef(new Map());
  // A state read and its pictures decoded (once per state and arrangement asked), then marked ready.
  const prime = useCallback(
    (s) => {
      if (!s || !core?.states?.[s]) return Promise.resolve(false);
      const key = `${s}|${wantNow.current.key}`;
      if (asked.current.has(key)) return asked.current.get(key);
      const p = loadState(core, s)
        .then((data) => {
          const list = picturesOf(core, data, wantNow.current.for(s));
          const f = wantNow.current.for(s);
          const d = wantNow.current.density;
          // On a canvas the room's layers are fetched once, as bitmaps (fetched as pictures too, each was asked
          // for twice at once: 2x a desk's first load came to 6.35 MB instead of about 4).
          const onCanvas = TABLE_ROOM === 'canvas' ? new Set(roomLayers(data, f.leathers, f)) : new Set();
          const room = [...onCanvas].map((n) => bitmapOf(pictureUrl(data.layers[n], d)));
          const pictures = urlsOf(list.filter((p) => !onCanvas.has(p.name)), d).map(decodePicture);
          return Promise.race([Promise.allSettled([...pictures, ...room]), new Promise((r) => setTimeout(r, 4000))]);
        })
        .then(
          () => {
            setReady((r) => (r[s] ? r : { ...r, [s]: true }));
            return true;
          },
          () => false,
        );
      asked.current.set(key, p);
      return p;
    },
    [core],
  );
  // The wish first.
  useEffect(() => {
    prime(wish);
  }, [wish, prime]);
  const filesAsked = useRef(new Set());
  const warmFiles = useCallback(
    (s, alive) => {
      if (!s || !core?.states?.[s] || filesAsked.current.has(s) || asked.current.has(`${s}|${wantNow.current.key}`)) return;
      filesAsked.current.add(s);
      loadState(core, s)
        .then((data) => {
          const urls = [...new Set(urlsOf(picturesOf(core, data, wantNow.current.for(s)), wantNow.current.density))];
          let i = 0;
          const next = () => {
            if (!alive() || i >= urls.length) return;
            const url = urls[i];
            i += 1;
            fetch(url, { priority: 'low' })
              .then((res) => res.arrayBuffer())
              .catch(() => null)
              .then(() => setTimeout(next, 30));
          };
          // (Three at a time, each after a breath: never in the way of a press's own pictures.)
          next();
          next();
          next();
        })
        .catch(() => null);
    },
    [core],
  );
  // Once the room is in: its lamp's twin, then its other look, in idle time (not when the browser asks to
  // save data).
  const roomReady = Boolean(ready[room]);
  useEffect(() => {
    if (!roomReady || saveData()) return undefined;
    let alive = true;
    const idle = typeof window.requestIdleCallback === 'function';
    const later = (fn, ms) => (idle ? window.requestIdleCallback(fn, { timeout: ms }) : setTimeout(fn, ms));
    const cancel = (h) => (idle ? window.cancelIdleCallback(h) : clearTimeout(h));
    // (Its other look is no longer fetched in idle time: the bound keeps the room and its lamp's twin; the candle
    // asks for its other look when the pointer or the keyboard comes to it.)
    // Owner fixes 3 (cleanup): nor are the other look's FILES read in idle time any more (owner fixes D did that, to
    // spare the candle's press the fetch: 79 pictures and their list, 1.4 MB, after every load, for a switch most visits
    // never make).
    // They are read when the pointer or the keyboard comes to the candle (primeCandle, as before), or to the You
    // page's Mood control (warmFiles, through deskBook's setLookWarmer).
    const first = later(() => {
      if (!alive) return;
      prime(lampTwin(room)).then(() => {
        if (alive && unbound()) prime(lookTwin(room));
      });
    }, 1500);
    return () => {
      alive = false;
      cancel(first);
    };
  }, [room, roomReady, prime]);
  useEffect(() => {
    if (!roomReady) return;
    setLookWarmer(() => !saveData() && warmFiles(lookTwin(room), () => true));
  }, [room, roomReady, warmFiles]);
  // The swap is over once every transition it started has finished.
  useEffect(() => {
    const stage = stageRef.current;
    if (!leaving) return undefined;
    let alive = true;
    // (Fix run 3: looked for two frames on, once the swap's transitions have started: looked for at once, none had yet,
    // and the swap counted as over while the new light was still fading in.)
    afterFrames(2, () => {
      if (!alive) return;
      const running = stage?.getAnimations ? stage.getAnimations({ subtree: true }).filter((a) => typeof CSSTransition !== 'undefined' && a instanceof CSSTransition) : [];
      Promise.allSettled(running.map((a) => a.finished)).then(() => {
        if (alive) setState((s) => (s.room === room && s.leaving === leaving ? { ...s, leaving: null, back: false } : s));
      });
    });
    return () => {
      alive = false;
    };
  }, [room, leaving, stageRef]);
  // On the page: the room, the one it leaves, its lamp's twin and the states a switch about to be used asked for.
  const near = new Set([room, leaving, lampTwin(room), ...extra, ...(unbound() ? [lookTwin(room)] : [])]);
  const list = Object.keys(core?.states || {}).filter((s) => ready[s] && stateNow(s) && (near.has(s) || s === wish));
  // A state's canvas drawn (the room only changes to a state whose light is in); let go with its canvas.
  const onDrawn = useCallback((s, on = true) => setDrawn((d) => (Boolean(d[s]) === on ? d : { ...d, [s]: on })), []);
  return { list, room, leaving, swap, back, ready: roomReady, prime, onDrawn };
};

/* ── One light state's stack ─────────────────────────────────────────────── */

// The gilt of one book in one state: its title on its label (the place's strip, the state's tone), and its
// count on its plate where it is lettered. Lit by its hit area (data-lit / -focus / -press, DOM-set).
// Lettered as round seven's small gilt at every size (the press one device pixel below, no SVG impression):
// with the impression's filter a strip that is partly see-through (the near stack's) came out dark whatever was
// under it (Chrome, measured: the same title bright without the filter).
const BookGilt = ({ id, slot, layers, tones, look, scale, words }) => {
  const flat = true;
  const strip = layers[`gilt-${slot}`];
  const countStrip = layers[`gilt-count-${slot}`];
  if (!strip || !words) return null;
  const { title, numeral, rtl } = words;
  return (
    <div className="room-stage-slab is-gilt room-table-gilt" data-course={id} data-slot={slot}>
      {title.lines.length > 0 && (
        <Gilt
          quad={strip.quad}
          origin={[0, 0]}
          scale={scale}
          stripUrl={pictureUrl(strip, 2)}
          tone={tones?.[slot]?.title?.gilt}
          mood={look}
          size={title.size}
          lines={title.lines}
          className="is-title"
          dir={rtl ? 'rtl' : 'auto'}
          flat={flat}
          lift
          perLine
        />
      )}
      {numeral && countStrip && (
        <Gilt
          quad={countStrip.quad}
          origin={[0, 0]}
          scale={scale}
          stripUrl={pictureUrl(countStrip, 2)}
          tone={tones?.[slot]?.count?.gilt}
          mood={look}
          size={numeral.size}
          lines={[numeral.text]}
          className="is-count"
          flat={flat}
          lift
        />
      )}
    </div>
  );
};

// The room's layers for the arrangement (the small notebook and its shadow, the candle, every place's shadows,
// the pairs' corrections), as the README proposes: ONE bitmap per arrangement on a canvas (TABLE_ROOM 'canvas',
// measured against stacked pictures: see ROUND8-LOG-M4), or as stacked pictures ('stack'; the harness's
// ?tableroom=stack). On a canvas a change of arrangement redraws the canvas from pictures decoded once
// (ImageBitmaps), a few layers a frame into a canvas off the page, then shown in one copy: nothing re-rasters
// the room under it, nothing is decoded again at raster time (stacked, every change re-rastered the stage's
// tiles with 30-40 pictures each and decoded them again at the new scale: 64-131 ms frames on the Intel UHD).
const TABLE_ROOM = typeof location !== 'undefined' && /[?&]tableroom=stack/.test(location.search) ? 'stack' : 'canvas';
// The decoded room layers (ImageBitmaps), one per URL. Fix run (Fault 3): bounded: what the room's and its lamp twin's
// canvases draw is kept, the rest closed in idle time once nothing moves (trimBitmaps), least recently used first.
const bitmaps = new Map();
const bitmapOf = (url) => {
  let entry = bitmaps.get(url);
  if (!entry) {
    entry = { p: null, bmp: null, used: 0 };
    const own = entry;
    entry.p = fetch(url)
      .then((res) => (res.ok ? res.blob() : Promise.reject(new Error(`${url} ${res.status}`))))
      .then((blob) => createImageBitmap(blob))
      .then((bmp) => {
        own.bmp = bmp;
        return bmp;
      })
      .catch(() => null);
    bitmaps.set(url, entry);
  }
  entry.used = performance.now();
  return entry.p;
};
// Which URLs each mounted canvas draws, with its state (RoomCanvas registers them).
const canvasUrls = new Map();
const trimBitmaps = (keepStates) => {
  // (Never while a canvas is being composed: its bitmaps are drawn over several frames.)
  if (composing.n > 0) return false;
  const keep = new Set();
  canvasUrls.forEach(({ state, urls }) => keepStates.has(state) && urls.forEach((u) => keep.add(u)));
  [...bitmaps.entries()]
    .filter(([url, e]) => e.bmp && !keep.has(url))
    .sort((a, b) => a[1].used - b[1].used)
    .forEach(([url, e]) => {
      e.bmp.close();
      bitmaps.delete(url);
    });
  return true;
};
// A room canvas's picture, composed off the page a few layers a frame and shown in one copy. Fix run (rule 9): shared
// by its key, so a move announced before its stacks render starts composing the new arrangement at once (primeMove)
// and the room's canvas shows it by the frame the book lands; given back (its pixels freed) once copied.
const composed = new Map();
const composing = { n: 0 };
const COMPOSE_SPARE = 2;
const composeRoom = (key, recs, stage, density, perFrame, delay = 0) => {
  let entry = composed.get(key);
  if (entry) return entry;
  entry = { p: null, canvas: null, waiters: 0 };
  const own = entry;
  composing.n += 1;
  const w = Math.round(stage.width * density);
  const h = Math.round(stage.height * density);
  entry.p = Promise.all(recs.map((rec) => bitmapOf(pictureUrl(rec, density)))).then(
    (maps) =>
      new Promise((resolve) => {
        const off = document.createElement('canvas');
        off.width = w;
        off.height = h;
        const g = off.getContext('2d');
        let i = 0;
        const step = () => {
          for (let k = 0; k < perFrame && i < recs.length; k += 1, i += 1) {
            const bmp = maps[i];
            if (!bmp) continue;
            const [x, y, bw, bh] = recs[i].box;
            try {
              g.drawImage(bmp, x * density, y * density, bw * density, bh * density);
            } catch {
              // (A bitmap closed meanwhile: left out; the next arrangement draws it again.)
            }
          }
          if (i < recs.length) {
            requestAnimationFrame(step);
            return;
          }
          own.canvas = off;
          composing.n -= 1;
          resolve(off);
        };
        if (delay) setTimeout(() => requestAnimationFrame(step), delay);
        else step();
      }),
  );
  composed.set(key, entry);
  // Composed for a move that never came: the oldest such let go.
  const spare = [...composed.entries()].filter(([, e]) => e.waiters === 0 && e !== own);
  while (spare.length > COMPOSE_SPARE) {
    const [k, e] = spare.shift();
    composed.delete(k);
    e.p.then((c) => {
      if (c) {
        c.width = 0;
        c.height = 0;
      }
    });
  }
  return entry;
};
const recsOf = (names, layers) => names.map((n) => layers[n]).filter(Boolean);
const composeKey = (state, names, density) => `${state}|${names.join('|')}@${density}`;
// The room's own canvas composes every layer in one frame (its bitmaps are on the GPU: a few ms; a book's shadow left
// behind for the 3-5 frames of 8 layers a frame read as a dark bar where it had lain); a hidden one a few a frame.
const LAYERS_A_FRAME = 64;
const HIDDEN_LAYERS_A_FRAME = 4;
const canvasSeq = { n: 0 };
const RoomCanvas = memo(function RoomCanvas({ state, names, layers, scale, stage, priority, onDrawn }) {
  const density = useContext(Density);
  const ref = useRef(null);
  const key = composeKey(state, names, density);
  const [id] = useState(() => {
    canvasSeq.n += 1;
    return canvasSeq.n;
  });
  // (Its state never changes: a stack is keyed by its state.)
  useEffect(
    () => () => {
      canvasUrls.delete(id);
      onDrawn?.(state, false);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id],
  );
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return undefined;
    let alive = true;
    const recs = recsOf(names, layers);
    canvasUrls.set(id, { state, urls: recs.map((rec) => pictureUrl(rec, density)) });
    const entry = composeRoom(key, recs, stage, density, priority ? LAYERS_A_FRAME : HIDDEN_LAYERS_A_FRAME, priority ? 0 : 250);
    entry.waiters += 1;
    let waiting = true;
    entry.p.then((off) => {
      waiting = false;
      entry.waiters -= 1;
      if (!alive || !off || !off.width) return;
      if (canvas.width !== off.width || canvas.height !== off.height) {
        canvas.width = off.width;
        canvas.height = off.height;
      }
      const v = canvas.getContext('2d');
      v.clearRect(0, 0, off.width, off.height);
      v.drawImage(off, 0, 0);
      canvas.dataset.drawn = key;
      onDrawn?.(state);
      // Copied: its pixels given back (unless another canvas waits on the same picture).
      if (entry.waiters === 0 && composed.get(key) === entry) {
        composed.delete(key);
        off.width = 0;
        off.height = 0;
      }
    });
    return () => {
      alive = false;
      if (waiting) entry.waiters -= 1;
    };
    // `key` says when the names, the state or the density changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, layers, stage, priority, id, onDrawn]);
  return <canvas ref={ref} className="room-table-canvas" aria-hidden="true" style={{ width: px(stage.width * scale), height: px(stage.height * scale) }} />;
});
// What the desk holds decoded (fix run, Fault 3), for the harness: every live ImageBitmap, every canvas (on the page and
// composed off it), every picture on the page that has been decoded (an upper bound: Chrome may drop an unseen one's).
const deskMemory = () => {
  const out = { bitmaps: 0, bitmapCount: 0, canvases: 0, canvasCount: 0, composed: 0, pictures: 0, pictureCount: 0 };
  bitmaps.forEach((e) => {
    if (e.bmp?.width) {
      out.bitmaps += e.bmp.width * e.bmp.height * 4;
      out.bitmapCount += 1;
    }
  });
  document.querySelectorAll('canvas').forEach((c) => {
    out.canvases += c.width * c.height * 4;
    out.canvasCount += 1;
  });
  composed.forEach((e) => {
    if (e.canvas?.width) out.composed += e.canvas.width * e.canvas.height * 4;
  });
  document.querySelectorAll('img').forEach((img) => {
    if (img.complete && img.naturalWidth) {
      out.pictures += img.naturalWidth * img.naturalHeight * 4;
      out.pictureCount += 1;
    }
  });
  out.total = out.bitmaps + out.canvases + out.composed + out.pictures;
  return out;
};
if (typeof globalThis !== 'undefined' && globalThis.__deskHarness) globalThis.__deskMemory = deskMemory;
const RoomLayers = ({ state, names, layers, scale, stage, priority, onDrawn }) =>
  TABLE_ROOM === 'canvas' ? (
    <RoomCanvas state={state} names={names} layers={layers} scale={scale} stage={stage} priority={priority} onDrawn={onDrawn} />
  ) : (
    names.map((name) => <Pic key={name} rec={layers[name]} scale={scale} />)
  );

const TableState = memo(function TableState({ core, state, on, back = false, scale, hasSurround, stacks, leathers, plates, words, look, candle, held, opening, onDrawn }) {
  const data = stateNow(state);
  const L = data?.layers || {};
  const night = isNightState(state);
  const tones = core.tones?.[toneState(core, state)];
  const lists = useMemo(
    () => ({
      room: roomLayers(data, leathers, { look, candle, held }),
      wide: hasSurround ? wideLayers(data, leathers, { look, candle, held }) : [],
      books: bookLayers(data, leathers, plates),
    }),
    [data, leathers, plates, look, candle, held, hasSurround],
  );
  if (!data) return null;
  const idAt = (slot) => {
    const s = slotOf(slot);
    return s ? stacks[s.place]?.[s.level] : null;
  };
  return (
    <div className="room-table-state" data-s={state} data-on={on || undefined} data-back={on && back ? '' : undefined} aria-hidden="true">
      {/* The room: past the frame (the surround, where the window reaches), then the frame (prod1/README.md
          step 1: surround-base, set-base; then their lit pictures). */}
      {hasSurround && L['surround-base'] && (
        <div className="room-stage-surround">
          <Pic rec={L['surround-base']} scale={scale} className="room-stage-base" />
        </div>
      )}
      <Pic rec={L['set-base']} scale={scale} className="room-stage-base" eager />
      {/* The candle's light (round seven's blend-free light): the lit room, opaque, over the dark one, its
          own timing in a look's swap (desk.css .room-stage-light-layer); round the wick the dark room again,
          breathing a few percent over it. */}
      {night && L['set-lit'] && (
        <div className="room-stage-light-layer">
          {hasSurround && L['surround-lit'] && (
            <div className="room-stage-surround">
              <Pic rec={L['surround-lit']} scale={scale} className="room-stage-base" />
            </div>
          )}
          <Pic rec={L['set-lit']} scale={scale} className="room-stage-base" />
          {L.breath && <Pic rec={L.breath} scale={scale} className="room-stage-breath" />}
        </div>
      )}
      {/* The wall frame: the owner's picture, the room's light on it (multiplied), the frame, its glass. */}
      <StagePicture scale={scale} opening={opening} />
      {L['frame-light'] && <Pic rec={L['frame-light']} scale={scale} className="room-stage-frame-light" />}
      <Pic rec={L.frame} scale={scale} className="room-stage-frame" />
      {L['frame-glass'] && <Pic rec={L['frame-glass']} scale={scale} className="room-stage-frame-glass" />}
      <RoomLayers state={state} names={lists.room} layers={L} scale={scale} stage={core.stage} priority={on === 'room' || on === 'leaving'} onDrawn={onDrawn} />
      {lists.books.map((b) => {
        if (b.kind === 'notebook') return <Pic key="notebook" rec={L.notebook} scale={scale} className="room-stage-notebook" />;
        if (b.kind === 'pairshade') return <Pic key={b.name} rec={L[b.name]} scale={scale} />;
        const id = idAt(b.slot);
        return (
          <div key={`${id}:${b.slot}`} className="room-table-book" data-course={id} data-slot={b.slot}>
            {b.shade && <Pic rec={L[b.shade]} scale={scale} />}
            {b.book && <Pic rec={L[b.book]} scale={scale} />}
            {b.plate && <Pic rec={L[b.plate]} scale={scale} />}
          </div>
        );
      })}
      {hasSurround && lists.wide.length > 0 && (
        <div className="room-stage-wide-shadows">
          {lists.wide.map((name) => (
            <Pic key={name} rec={L[name]} scale={scale} />
          ))}
        </div>
      )}
      {lists.books
        .filter((b) => b.kind === 'book')
        .map((b) => {
          const id = idAt(b.slot);
          return <BookGilt key={`g:${id}:${b.slot}`} id={id} slot={b.slot} layers={L} tones={tones} look={look} scale={scale} words={words.get(id)} />;
        })}
    </div>
  );
});

/* ── A book's hit area ───────────────────────────────────────────────────── */

// Above every stack: the button (its slot's hit polygon with the stack's count, scene2's: 24 css px tall at
// the least scale), its face (the spine, or the flat book's cover: the warm rim on hover and focus) and the
// focus ring. Hover and focus light its gilt in every stack (DOM attributes, no render). A click opens the
// course (its film); 6 css px with the pointer down is a drag; a right-click or a long press, its menu;
// Alt + arrows move it (Left / Right to the next place across, Up / Down in its stack), Alt + Enter brings
// it closer or puts it back. Memoized behind the stage's unchanging handlers.
const TableHit = memo(function TableHit({ core, course, slot, count, scale, stageRef, onPick, onKeyMove, onDrag, onMenu, onPrime, onHover, onMarks }) {
  const level = levelOf(core, slot);
  const hull = level.hull;
  const box = quadBox(hull);
  const [x, y, w, h] = box;
  const hit = hitOf(core, slot, count);
  const press = usePress();
  const face = faceOf(core, slot);
  const where = PLACE_NAMES[slotOf(slot).place];
  const gilts = () => [...(stageRef.current?.querySelectorAll(`.room-table-gilt[data-course="${CSS.escape(course.id)}"]`) || [])];
  const light = (key, on) => gilts().forEach((el) => (on ? el.setAttribute(key, '') : el.removeAttribute(key)));
  const keys = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
  const onKeyDown = (event) => {
    // (Owner fixes, C: Alt held on a book is the keyboard's "taken": the places it can go to are marked meanwhile.)
    if (event.key === 'Alt') {
      onMarks?.(course.id, true);
      return;
    }
    const alt = event.altKey && !event.ctrlKey && !event.metaKey;
    if (!alt) return;
    const how = event.key === 'Enter' ? 'closer' : keys[event.key];
    if (!how || !onKeyMove) return;
    event.preventDefault();
    onKeyMove(course.id, how);
  };
  const count_ = course.noteCount;
  return (
    <div className="room-stage-slab is-hit" data-course={course.id} data-slot={slot} style={{ left: px(x * scale), top: px(y * scale), width: px(w * scale), height: px(h * scale) }}>
      <button
        type="button"
        className="room-stage-slab-hit"
        data-course-id={course.id}
        aria-label={`${course.name}${count_ ? `, ${count_} ${count_ === 1 ? 'note' : 'notes'}` : ''}, on ${where}`}
        aria-keyshortcuts="Alt+Enter Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown"
        style={hitStyle(hit, [x, y], scale)}
        onClick={(event) => press.click(event) && onPick?.(course.id)}
        onKeyDown={onKeyDown}
        onKeyUp={(event) => event.key === 'Alt' && onMarks?.(course.id, false)}
        onContextMenu={(event) => {
          if (!onMenu) return;
          event.preventDefault();
          const r = event.currentTarget.getBoundingClientRect();
          press.spend();
          onMenu(course.id, event.clientX || event.clientY ? [event.clientX, event.clientY] : [r.left + r.width / 2, r.top + r.height / 2]);
        }}
        onPointerEnter={(event) => {
          if (event.pointerType === 'mouse') light('data-lit', true);
          onHover?.(course.id);
        }}
        onPointerLeave={() => {
          light('data-lit', false);
          light('data-press', false);
        }}
        onPointerDown={(event) => {
          light('data-press', true);
          onPrime?.(course.id, true);
          if (onDrag) {
            press.down(event);
            // (Fix run: the pointer's moves stay with the book that was pressed, whatever lies under it as it leaves: a
            // thin spine's drag began outside its own hit area.)
            if (event.button === 0) event.currentTarget.setPointerCapture?.(event.pointerId);
          }
        }}
        onPointerMove={(event) => {
          const start = press.move(event);
          if (!start) return;
          light('data-press', false);
          onDrag(course.id, start);
        }}
        onPointerUp={(event) => {
          light('data-press', false);
          if (press.up()) onMenu?.(course.id, [event.clientX, event.clientY]);
        }}
        onPointerCancel={() => {
          press.cancel();
          light('data-press', false);
        }}
        onFocus={(event) => {
          const keyboard = event.currentTarget.matches(':focus-visible');
          if (keyboard) light('data-focus', true);
          // (Fix run: the keyboard's moves primed as a press primes them; fix run 2: and its film, its page mounted under
          // the desk after a short rest on the book, as a press does at once.)
          onPrime?.(course.id, keyboard ? 'focus' : false);
        }}
        onBlur={() => {
          light('data-focus', false);
          onPrime?.(course.id, 'blur');
          onMarks?.(course.id, false);
        }}
      />
      <div className="room-stage-slab-mark">
        <OnQuad quad={face} origin={[x, y]} scale={scale} className="room-stage-spine" />
        <svg className="room-stage-slab-ring" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
          <polygon points={hull.map(([ox, oy]) => `${ox - x},${oy - y}`).join(' ')} vectorEffect="non-scaling-stroke" />
        </svg>
      </div>
    </div>
  );
});

/* ── Things on their way ─────────────────────────────────────────────────── */

// A book on its way: its picture (and plate) as its slot draws it in the room's state, with its gilt, on ONE
// layer the size of that picture, moved by transform only; a soft contact shadow under it while it is held.
const BookGhost = ({ ghostRef, core, course, slot, state, scale, words, lifted = true, z }) => {
  const data = stateNow(state);
  const L = data?.layers || {};
  const leather = leatherOf(course.color);
  const rec = L[`book-${slot}-${leather}`];
  if (!rec) return null;
  const [x, y, w, h] = rec.box;
  const plate = words?.numeral ? L[`plate-${slot}-${leather === 'black' ? 'oxblood' : 'black'}`] : null;
  const tones = core.tones?.[toneState(core, state)];
  return (
    <div
      ref={ghostRef}
      className={`room-stage-ghost${lifted ? ' is-lifted' : ''}`}
      data-ghost-of={course.id}
      style={{ left: px(x * scale), top: px(y * scale), width: px(w * scale), height: px(h * scale), zIndex: z }}
      aria-hidden="true"
    >
      <div className="room-stage-ghost-inner" style={{ left: px(-x * scale), top: px(-y * scale) }}>
        {lifted && <Pic rec={rec} scale={scale} className="room-stage-ghost-shadow" sync />}
        <div className="room-stage-ghost-tone">
          <Pic rec={rec} scale={scale} sync />
          {plate && <Pic rec={plate} scale={scale} sync />}
        </div>
        <BookGilt id={course.id} slot={slot} layers={L} tones={tones} look={isNightState(state) ? 'night' : 'day'} scale={scale} words={words} />
      </div>
    </div>
  );
};

const boxOf = (q) => quadBox(q);
// The glide (a drop, the menu, Ctrl K, the keys, a stack settling): from where the ghost is (`offset`, css px)
// onto its new slot's face, then gone over that slot's own picture.
const BookGlide = memo(function BookGlide({ glide, core, course, state, scale, words, onLanded, settle }) {
  const ref = useRef(null);
  // Fix run 3: lettered as the new place letters it, at the size that the glide's scale brings to the seated size (in the
  // hand-over frame the title was the old place's, a size and wording apart: "Book T00" a third larger on S11).
  const fitWords = useMemo(() => {
    if (glide.from === glide.to) return words;
    const there = wordsOf(core, course, glide.to, scale);
    const k = boxOf(faceOf(core, glide.to))[3] / boxOf(faceOf(core, glide.from))[3];
    if (!there?.title || !k) return words;
    return { ...there, title: { ...there.title, size: there.title.size / k }, numeral: there.numeral && words?.numeral ? { ...there.numeral, size: there.numeral.size / k } : null };
  }, [glide, core, course, scale, words]);
  // Its lettering grows (or shrinks) from the size it had in the hand to the seated size over the glide (a scale of the
  // lettering about its label's middle): never a change of size in one frame, at the drop or at the hand-over.
  const letterFrom = fitWords !== words && words?.title?.size && fitWords?.title?.size ? words.title.size / fitWords.title.size : 1;
  const countFrom = fitWords !== words && words?.numeral?.size && fitWords?.numeral?.size ? words.numeral.size / fitWords.numeral.size : 1;
  const letterNow = useRef([letterFrom, countFrom]);
  letterNow.current = [letterFrom, countFrom];
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof el.animate !== 'function') {
      onLanded(glide.key, 'landed');
      return undefined;
    }
    // (Lettered at the seated size, shown at the size it had in the hand until the glide sets off.)
    const [rt, rc] = letterNow.current;
    const pick = (kind, r) => (Math.abs(r - 1) > 0.02 ? [...el.querySelectorAll(`.room-table-gilt .${kind} > .room-stage-gilt-gold, .room-table-gilt .${kind} > .room-stage-gilt-press`)].map((span) => [span, r]) : []);
    const letters = [...pick('is-title', rt), ...pick('is-count', rc)];
    letters.forEach(([span, r]) => (span.style.scale = `${r.toFixed(4)}`));
    const rec = stateNow(state)?.layers?.[`book-${glide.from}-${leatherOf(course.color)}`];
    const own = rec ? rec.box : boxOf(faceOf(core, glide.from));
    const to = landing(boxOf(faceOf(core, glide.from)), boxOf(faceOf(core, glide.to)), own, scale);
    let alive = true;
    let move = null;
    let tone = null;
    // Fix run 2 (item 6): the book brought during its glide to the tone its own picture has at the new place (a
    // brightness filter on its pictures: light, never opacity; its lettering untouched): it was lit red in the hand and
    // near black once seated at T01, in one frame. Measured from the new place's picture once it is decoded.
    const toneTo = (left) => {
      // The book's leather as its own pictures draw it at the two places (the ghost carries the one it left; the new
      // place's is decoded off the page), the ratio of their luminance the brightness to bring it to.
      const inner = el.querySelector('.room-stage-ghost-tone');
      const leather = leatherOf(course.color);
      const rec = stateNow(state)?.layers?.[`book-${glide.to}-${leather}`];
      if (!inner || !rec || typeof inner.animate !== 'function') return;
      const a = measureBook(null, core, state, glide.id, glide.from, leather, inner.querySelector('img'));
      const img = new Image();
      img.src = pictureUrl(rec, inner.querySelector('img')?.getAttribute('src')?.includes('@2x') ? 2 : 1);
      (img.decode ? img.decode() : Promise.resolve())
        .then(() => {
          const b = measureBook(null, core, state, glide.id, glide.to, leather, img);
          if (!alive || !a?.leather || !b?.leather || left() < 40) return;
          // (brightness() scales the encoded values alike: the ratio on the leather's own strongest channel, its hue.)
          const ca = channels(a.leather);
          const cb = channels(b.leather);
          const c = [0, 1, 2].reduce((best, i) => (ca[i] + cb[i] > ca[best] + cb[best] ? i : best), 0);
          // (Out of deep shade the picture has little colour left to bring up: brightened past 1.6 its lit top went
          // pale violet while its spine stayed brown; capped there.)
          const k = Math.max(0.3, Math.min(1.6, (cb[c] + 2) / (ca[c] + 2)));
          globalThis.__deskFilmLog?.push?.(`tone ${glide.from}>${glide.to} ${a.leather}>${b.leather} k=${k.toFixed(2)}`);
          if (Math.abs(k - 1) < 0.06) return;
          tone = inner.animate([{ filter: 'brightness(1)' }, { filter: `brightness(${k.toFixed(3)})` }], { duration: Math.max(30, left()), easing: GLIDE_EASE, fill: 'forwards' });
        })
        .catch(() => null);
    };
    let order = null;
    const go = () => {
      if (!alive) return;
      const end = moveCss(to.tx, to.ty, to.sx, to.sy);
      letters.forEach(([span, r]) => {
        span.animate([{ scale: `${r.toFixed(4)}` }, { scale: '1' }], { duration: glide.ms, delay: glide.after || 0, easing: GLIDE_EASE, fill: 'both' });
        span.style.scale = '';
      });
      if (glide.slide) {
        // Fix run 3 (a lower book moved from rest): out from under the books on it at its own level, behind them, then
        // to its place in front of them (the order changes at the slide's end, on the glide's own clock).
        const f = glide.slide.at;
        move = el.animate(
          [
            { offset: 0, transform: moveCss(glide.offset[0], glide.offset[1]), easing: 'cubic-bezier(0.45, 0, 0.55, 1)' },
            { offset: f, transform: moveCss(glide.slide.x, glide.slide.y || 0), easing: 'cubic-bezier(0.45, 0, 0.55, 1)' },
            ...(glide.slide.at2 ? [{ offset: glide.slide.at2, transform: moveCss(glide.slide.x2, glide.slide.y || 0), easing: GLIDE_EASE }] : []),
            { offset: 1, transform: end },
          ],
          { duration: glide.ms, easing: 'linear', fill: 'forwards' },
        );
        const layer = el.parentElement?.classList.contains('room-table-behind') ? el.parentElement : el;
        order = layer.animate(
          [
            { offset: 0, zIndex: 1 },
            { offset: f, zIndex: 1 },
            { offset: f, zIndex: 3 },
            { offset: 1, zIndex: 3 },
          ],
          { duration: glide.ms, fill: 'forwards' },
        );
      } else {
        move = el.animate([{ transform: moveCss(glide.offset[0], glide.offset[1]) }, { transform: end }], { duration: glide.ms, delay: glide.after || 0, easing: GLIDE_EASE, fill: 'both' });
      }
      move.finished.then(() => alive && onLanded(glide.key, 'landed')).catch(() => null);
      // (Its time left by the glide's own clock: the same at any playback rate.)
      if (glide.from !== glide.to && !globalThis.__deskHarness?.noTone) toneTo(() => glide.ms + (glide.after || 0) - (Number(move.currentTime) || 0));
    };
    // (Held, fix run 3: a book lying on one being pulled out waits at its level, drawn as it lies. From rest: off once
    // the room shows the new arrangement, 120 ms at most, `after` ms later still for a book that lay on the moved one;
    // from the hand at once.)
    if (glide.hold) return () => {
      alive = false;
    };
    if (glide.ready) Promise.race([glide.ready, new Promise((r) => setTimeout(r, 120))]).then(() => requestAnimationFrame(go));
    else go();
    return () => {
      alive = false;
      move?.cancel();
      order?.cancel();
      tone?.cancel();
    };
    // The glide's own object never changes (its animation would start again); the state it was drawn in is its first.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [glide, scale, onLanded]);
  // Fix run (rule 1): landed, and the stacks showing the book at its new slot, its own picture is shown UNDER the ghost
  // (markGliding off); once that picture, its plate and its gilt strips are decoded and PAINT_FRAMES have gone, the
  // ghost goes in one frame. Never a fade: nothing of a book is ever see-through.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!settle || !el) return undefined;
    let alive = true;
    const stage = el.closest('.room-stage');
    const own = stage ? [...stage.querySelectorAll(`.room-table-state[data-on="room"] .room-table-book[data-course="${CSS.escape(glide.id)}"] img`)] : [];
    const L = stateNow(state)?.layers || {};
    const strips = [L[`gilt-${glide.to}`], L[`gilt-count-${glide.to}`]].filter(Boolean).map((rec) => decodePicture(pictureUrl(rec, 2)));
    Promise.all([...own.map((img) => (typeof img.decode === 'function' ? img.decode().catch(() => null) : null)), ...strips.map((p) => Promise.resolve(p).catch(() => null))]).then(() =>
      afterFrames(PAINT_FRAMES, () => alive && onLanded(glide.key, 'gone')),
    );
    return () => {
      alive = false;
    };
  }, [settle, glide, state, onLanded]);
  return <BookGhost ghostRef={ref} core={core} course={course} slot={glide.from} state={glide.state || state} scale={scale} words={fitWords} lifted={glide.lifted} />;
});

// The candle in the hand or on its way: its picture as the room shows it at its place (by night candle-look,
// by day candle-look-<C>), moved by transform; its flame carried with it.
const candleLook = (state, place) => {
  const L = stateNow(state)?.layers || {};
  return isNightState(state) ? L['candle-look'] : L[`candle-look-${place}`];
};
// (Fix run 2: cut to the candle's own hull: its picture's table round it carried the old place's light, a visible
// box at the new place while the room's light changed.)
const CandleGhost = ({ ghostRef, core, state, place, scale }) => {
  const rec = candleLook(state, place);
  if (!rec) return null;
  const [x, y, w, h] = rec.box;
  const hull = core?.candles?.[place]?.hull;
  return (
    <div
      ref={ghostRef}
      className="room-stage-ghost is-candle"
      style={{ left: px(x * scale), top: px(y * scale), width: px(w * scale), height: px(h * scale), clipPath: hull ? clipPolygon(hull, rec.box, scale) : undefined }}
      aria-hidden="true"
    >
      <div className="room-stage-ghost-inner" style={{ left: px(-x * scale), top: px(-y * scale) }}>
        <Pic rec={rec} scale={scale} className="room-stage-candle" sync />
      </div>
    </div>
  );
};
const candleBox = (core, place) => {
  const [x0, y0, x1, y1] = core.candles[place].box;
  return [x0, y0, x1 - x0, y1 - y0];
};
const candlePoints = (core, place) => {
  const p = core.candles[place].points;
  return { wick: p.wick, flame: p.flame, flameTip: p.flame_tip || p.flameTip };
};
const CandleGlide = memo(function CandleGlide({ glide, core, scale, flameOf, onLanded, exactState }) {
  const ref = useRef(null);
  // Fix run 3: the candle glides AS the new place's own picture of it (in the state it is going into), from where the
  // hand had it (that picture fitted to the old place's box) to its own box, unscaled at the end: in the hand-over frame
  // the carried picture and the room's are the same picture at the same place (fix run 2 swapped pictures at the end:
  // the candle seen at the old place, fitted to the new box, stood 20-34 css px off its seat). Without that state's
  // pictures, the old way.
  const [exact] = useState(() => Boolean(stateNow(exactState) && candleLook(exactState, glide.to)));
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof el.animate !== 'function') {
      onLanded(glide.key, glide.to);
      return undefined;
    }
    const a = candleBox(core, glide.from);
    const b = candleBox(core, glide.to);
    let first;
    let last;
    if (exact) {
      const rec = candleLook(exactState, glide.to);
      const back = landing(b, a, rec ? rec.box : b, scale);
      first = moveCss(back.tx + glide.offset[0], back.ty + glide.offset[1], back.sx, back.sy);
      last = moveCss(0, 0);
    } else {
      const rec = candleLook(glide.state, glide.from);
      const to = landing(a, b, rec ? rec.box : a, scale);
      first = moveCss(glide.offset[0], glide.offset[1]);
      last = moveCss(to.tx, to.ty, to.sx, to.sy);
    }
    const timing = { duration: glide.ms, easing: GLIDE_EASE, fill: 'forwards' };
    const move = el.animate([{ transform: first }, { transform: last }], timing);
    // The flame: from where the hand had it to the new wick, relative to where the room's candle stands now (`base`).
    const wa = candlePoints(core, glide.from).wick;
    const wb = candlePoints(core, glide.to).wick;
    const w0 = candlePoints(core, glide.base || glide.to).wick;
    const fx = (wa[0] - w0[0]) * scale + glide.offset[0];
    const fy = (wa[1] - w0[1]) * scale + glide.offset[1];
    const ex = (wb[0] - w0[0]) * scale;
    const ey = (wb[1] - w0[1]) * scale;
    const flames = flameOf().map((f) => {
      f.style.transform = '';
      return f.animate([{ transform: `translate(${fx.toFixed(2)}px, ${fy.toFixed(2)}px)` }, { transform: `translate(${ex.toFixed(2)}px, ${ey.toFixed(2)}px)` }], timing);
    });
    let alive = true;
    move.finished.then(() => alive && onLanded(glide.key, glide.to)).catch(() => null);
    return () => {
      alive = false;
      move.cancel();
      // (The flame stays where the glide left it until the room moves the candle there: the layout effect on its place.)
      flames.forEach((f) => {
        if (f.playState !== 'finished') f.cancel();
      });
    };
    // (The glide's own object and the state it goes into are its first: its animation would start again.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [glide, core, scale, flameOf, onLanded]);
  return exact ? <CandleGhost ghostRef={ref} core={core} state={exactState} place={glide.to} scale={scale} /> : <CandleGhost ghostRef={ref} core={core} state={glide.state} place={glide.from} scale={scale} />;
});

/* ── "+ New course", the lamp, the small notebook ─────────────────────────── */

// The ghost of the next book, in the room's dashed idiom, at the slot a new course would take: drawn as the would-be
// book's whole hull (fix run, rule 7: never a spine's quad alone, which lay across the cover of the book below), its
// words on the would-be spine (or, at the flat place, its cover's label).
const TableDashed = memo(function TableDashed({ core, slot, scale, label, onClick }) {
  const level = levelOf(core, slot);
  if (!level?.hull) return null;
  const hull = level.hull;
  const outer = quadBox(hull);
  const box = [outer[0] - 3, outer[1] - 3, outer[2] + 6, outer[3] + 6];
  const [x, y, w, h] = box;
  const cover = Boolean(level.cover);
  const labelQuad = cover ? level.coverTitle : level.spine;
  return (
    <div className={`room-stage-dashed is-new room-table-dashed${cover ? ' room-table-dashed-cover' : ''}`} data-slot={slot} style={{ left: px(x * scale), top: px(y * scale), width: px(w * scale), height: px(h * scale) }}>
      <svg className="room-stage-dashed-line" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
        <polygon points={hull.map(([ox, oy]) => `${ox - x},${oy - y}`).join(' ')} vectorEffect="non-scaling-stroke" />
      </svg>
      {/* (Its button the slot's own hit area with it on top: the hull overlaps the cover of the book below, whose press
          it must never take.) */}
      <button type="button" className="room-stage-dashed-hit" style={hitStyle(hitOf(core, slot, (slotOf(slot)?.level || 0) + 1) || hull, [x, y], scale)} onClick={onClick} aria-label={label} />
      {labelQuad && (
        <OnQuad quad={labelQuad} origin={[x, y]} scale={scale} className="room-stage-dashed-label" as="span" aria-hidden="true">
          <span className="room-stage-ghost-label">{label}</span>
        </OnQuad>
      )}
    </div>
  );
});

// Owner fixes (2026-11-23, C; this reverses fix run's rule 8, "only the place under the pointer is marked"): from the
// moment a book or the candle is taken, EVERY place that can take it shows its landing outline (the would-be book's
// hull, the candle's ring): thin, pale, solid, quiet; the one under the pointer clearly the stronger (`data-over`, set
// on the page by the pointer's moves: no render of the stage while a thing is carried). A place that cannot take it
// shows nothing. Drawn ABOVE the thing in the hand (table.css z 5: a book from the near stack is large and hid them),
// each line over a darker hairline so it reads on leather, paper and the lit table alike. They come and go with the
// carry on their own opacity (140 ms): nothing of the layout moves.
// (`data-targets`: each place's key and its hull's middle in stage px, for the harness and tests.)
const TableMarks = ({ targetRef, targets, on, stage, scale }) => (
  <svg
    ref={targetRef}
    className={`room-table-target${on ? ' is-on' : ''}`}
    viewBox={`0 0 ${stage.width} ${stage.height}`}
    style={{ width: px(stage.width * scale), height: px(stage.height * scale) }}
    data-targets={JSON.stringify(targets.map((t) => [t.key.replace(/^pile:/, 'place:'), ...[0, 1].map((k) => Math.round(t.polygon.reduce((sum, q) => sum + q[k], 0) / t.polygon.length))]))}
    aria-hidden="true"
  >
    {targets.map((t) => {
      const points = t.polygon.map(([x, y]) => `${x},${y}`).join(' ');
      return (
        <g key={t.key} data-key={t.key} data-kind={t.kind}>
          <polygon className="room-table-target-shade" points={points} vectorEffect="non-scaling-stroke" />
          <polygon className="room-table-target-line" points={points} vectorEffect="non-scaling-stroke" />
        </g>
      );
    })}
  </svg>
);

// A button on one or more polygons (stage px): its box their union, its clip a path of each, a ring round
// them from the keyboard.
const pathOf = (polygons, box, scale) => `path('${polygons.map((poly) => `M${poly.map(([x, y]) => `${((x - box[0]) * scale).toFixed(1)} ${((y - box[1]) * scale).toFixed(1)}`).join(' L')} Z`).join(' ')}')`;
const Switch = ({ polygons, scale, label, onClick, onPointerEnter, onPointerLeave, onPointerDown, onFocus, onBlur, className = '', pressed }) => {
  const xs = polygons.flat().map((p) => p[0]);
  const ys = polygons.flat().map((p) => p[1]);
  const box = [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
  const style = { left: px(box[0] * scale), top: px(box[1] * scale), width: px(box[2] * scale), height: px(box[3] * scale) };
  return (
    <>
      <button
        type="button"
        className={`room-table-switch ${className}`}
        aria-label={label}
        aria-pressed={pressed}
        style={{ ...style, clipPath: pathOf(polygons, box, scale) }}
        onClick={onClick}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        onPointerDown={onPointerDown}
        onFocus={onFocus}
        onBlur={onBlur}
      />
      <svg className="room-table-ring" style={style} viewBox={`0 0 ${box[2]} ${box[3]}`} preserveAspectRatio="none" aria-hidden="true">
        {polygons.map((poly, i) => (
          <polygon key={i} points={poly.map(([x, y]) => `${x - box[0]},${y - box[1]}`).join(' ')} vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
    </>
  );
};

/* ── The stage ───────────────────────────────────────────────────────────── */

// A book's own pictures in the stacks and its hit area: never a ghost's (a ghost carries the same course's gilt: marked
// with the book, the carried title went blank from the drop to the hand-over, fix run).
const ownOf = (id) => {
  const c = CSS.escape(id);
  return `.room-table-state [data-course="${c}"]:is(.room-table-book, .room-table-gilt), .room-stage-piles .room-stage-slab.is-hit[data-course="${c}"]`;
};
const glideSeq = { n: 0 };

const TableStage = ({
  core,
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
  lit,
  still,
  onToggleCandle,
  onNewCourse,
  arrangement,
  onMove,
  onKeyMove,
  menuItemsOf,
  candle = 'C0',
  onMoveCandle,
  lamp = false,
  onToggleLamp,
  onNewNote,
  viewport,
  bare = false,
  ghostSlot = null,
}) => {
  const stageRef = useRef(null);
  const byId = useMemo(() => new Map(courses.map((c) => [c.id, c])), [courses]);
  const colourOf = useCallback((id) => byId.get(id)?.color, [byId]);

  // What the stacks draw: the saved arrangement, a move announced before it is saved (pending), or, while a
  // book is dragged, its place settled without it (tableLiftOut).
  const [drag, setDrag] = useState(null);
  const [glides, setGlides] = useState([]);
  const [landed, setLanded] = useState('|');
  const [candleGlides, setCandleGlides] = useState([]);
  const [pending, setPending] = useState(null);
  const realKey = arrangement ? slotsKey(arrangement.map) : '';
  if (pending && pending.key === realKey) setPending(null);
  const arrangementRef = useRef(arrangement);
  useEffect(() => {
    arrangementRef.current = arrangement;
  });
  const [heldLift, setHeldLift] = useState(null);
  // (Fix run 3: a book pulled from under others is lifted out of the arrangement only once it is clear of them.)
  const liftId = drag && !drag.candle && !drag.pulling ? drag.id : heldLift;
  const shown = useMemo(() => {
    if (pending && arrangement) return tableFrom(pending.map, arrangement);
    if (liftId && arrangement) return tableLiftOut(arrangement, liftId);
    return arrangement;
  }, [pending, liftId, arrangement]);
  const stacks = shown.stacks;
  const leathers = useMemo(() => leathersOf(stacks, colourOf), [stacks, colourOf]);
  const books = shown.books;

  // The fit (deskStage.js stageFit: scale floor 0.7): the frame first; the surround's extent when the window
  // reaches past the frame. The surround (3900 x 1320) is plain pictures, never a canvas.
  const plainFit = stageFit(viewport.width, viewport.height, core.stage, core.crop);
  const wideFit = stageFit(viewport.width, viewport.height, core.stage, core.crop, core.surround);
  const wantSurround = wideFit.surround;
  // Fix run (smaller fault 1): the stage on whole device pixels, its width a whole number of them (the scale moved by
  // under 0.05%): with the surround on, the room's canvas ended on a half pixel where the surround's shadows began on
  // the same half, and that column kept neither's full shadow, a line 4.5 levels light from the wall to the foot
  // (1536 x 750 at 1.25, column 1747; 1920 x 1080 the same, fainter).
  const fit = useMemo(() => {
    const f = wantSurround ? wideFit : plainFit;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const sc = Math.round(core.stage.width * f.scale * dpr) / (core.stage.width * dpr);
    return { ...f, scale: sc, left: Math.round(f.left * dpr) / dpr, top: Math.round(f.top * dpr) / dpr, width: core.stage.width * sc, height: core.stage.height * sc };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the fit is the viewport's and the stage's
  }, [viewport.width, viewport.height, wantSurround, core]);
  const scale = fit.scale;
  const density = densityOf(scale);

  // Each book's words at this scale; a plate drawn only where its count is lettered.
  const words = useMemo(() => new Map(books.filter((b) => byId.has(b.id)).map((b) => [b.id, wordsOf(core, byId.get(b.id), b.slot, scale)])), [books, byId, core, scale]);
  const plates = useMemo(() => Object.fromEntries(books.filter((b) => words.get(b.id)?.numeral).map((b) => [b.slot, true])), [books, words]);

  // The light state: night or day (the candle's light), the candle's place, the lamp.
  const wish = stateFor({ night: lit, candle, lamp });
  const look = (s) => (isNightState(s) ? 'night' : 'day');
  // The candle in the hand or on its way: the room draws it away (candle-away by night; by day it leaves).
  // (Fix run: a candle glide that has landed no longer holds the candle: the room draws it at its new place, under the
  // carried picture, which goes once that has been drawn.)
  const [candleLanded, setCandleLanded] = useState('|');
  const candleHeld = Boolean(drag?.candle) || candleGlides.some((g) => !candleLanded.includes(`|${g.key}|`));
  const want = useMemo(() => {
    const key = `${slotsKey(shown.map)}|${density}|${wantSurround ? 'w' : ''}|${Object.keys(plates).join(',')}`;
    return {
      key,
      density,
      for: (s) => ({ leathers, plates, look: look(s), candle: s.startsWith('nightC1') ? 'C1' : isNightState(s) ? 'C0' : candle, held: false, surround: wantSurround }),
    };
  }, [shown, density, wantSurround, plates, leathers, candle]);
  // The states a switch about to be used asks for (the candle: its other look, and by night its other place), kept on
  // the page while it is near and for a while after (the bound lets them go then).
  const [extra, setExtra] = useState([]);
  const extraTimer = useRef(0);
  const candleOnItsWay = candleGlides.some((g) => !candleLanded.includes(`|${g.key}|`));
  const { list, room, leaving, swap, back: swapBack, ready, prime, onDrawn } = useStates(core, wish, want, stageRef, extra, candleOnItsWay);
  const roomLook = look(room);
  // The candle the room draws: by night the place whose light the room is in, by day where it stands.
  const shownCandle = isNightState(room) ? (room.startsWith('nightC1') ? 'C1' : 'C0') : candle;
  // Fix run 2 (rule 1): while the candle is carried, gliding, or landed but its light still changing, every stack draws
  // the room WITHOUT it (the carried picture is the only candle on the screen: a fading stack's candle was a grey ghost
  // at the old place and a pale double at the new one); once landed and the light's change over, the room draws it
  // again under the carried picture, which then goes (onCandleLanded).
  const candleTo = candleGlides.length ? candleGlides[candleGlides.length - 1].to : null;
  const candleAt = (s) => (isNightState(s) ? (s.startsWith('nightC1') ? 'C1' : 'C0') : candle);
  const heldFor = (s) => {
    if (candleHeld) return isNightState(s) ? s === room || s === leaving : true;
    // Landed: the stacks whose candle stands where it left draw it away; the one with it at its new place draws it
    // there, under the carried picture, which is now that state's own picture of it (CandleGlide `exact`): exactly
    // over it, so its light may fade in under it unseen.
    if (candleTo) return candleAt(s) !== candleTo;
    return false;
  };

  // The stacks on the page but not shown (a switch away) follow the arrangement only once it has been still for
  // 600 ms: a move re-renders and re-rasters the room's own stack alone. They are drawn at 0.2% above the room
  // (data-warm, table.css: their tiles rastered and their pictures decoded) while a switch is near: the pointer
  // by the lamp or the candle, the keyboard on them, Ctrl K open, and for a moment once a stack comes onto the
  // page. (Drawn all the time, they made every frame of a drag composite three full stages: 24 ms GPU passes on
  // the Intel UHD; drawn once for 700 ms only, the lamp's first switch rastered its stack cold: 57-74 ms frames.)
  const [quiet, setQuiet] = useState(() => ({ stacks, leathers, plates, words }));
  useEffect(() => {
    if (quiet.stacks === stacks && quiet.leathers === leathers && quiet.plates === plates && quiet.words === words) return undefined;
    const timer = setTimeout(() => setQuiet({ stacks, leathers, plates, words }), 600);
    return () => clearTimeout(timer);
  }, [quiet, stacks, leathers, plates, words]);
  const warmFor = useRef(new Set());
  const warm = useCallback((who, on) => {
    const set = warmFor.current;
    if (on) set.add(who);
    else set.delete(who);
    stageRef.current?.toggleAttribute('data-warm', set.size > 0);
  }, []);
  const listKey = list.join(',');
  useEffect(() => {
    if (list.length < 2) return undefined;
    warm('mounted', true);
    const timer = setTimeout(() => warm('mounted', false), 900);
    return () => {
      clearTimeout(timer);
      warm('mounted', false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- listKey says when
  }, [listKey, warm]);
  useEffect(() => subscribeSearch(() => warm('search', isSearchOpen())), [warm]);
  const fitNow = useRef(fit);
  useEffect(() => {
    fitNow.current = fit;
  });
  const capacity = useMemo(() => pageCapacity(scale), [scale]);
  const pageQuads = useMemo(() => ({ L: core.notebook.pages.L, R: core.notebook.pages.R }), [core]);
  const pageSize = useMemo(() => {
    const { width, height } = quadSize(core.notebook.pages.L);
    return { width: Math.round(width), height: Math.round(height) };
  }, [core]);

  // The breath keeps one phase across stacks mounted later.
  const breathFrom = useRef(null);
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const breaths = [...stage.querySelectorAll('.room-stage-breath')].flatMap((el) => (el.getAnimations ? el.getAnimations() : [])).filter((a) => a.animationName === 'room-stage-breath');
    const started = breaths.map((a) => a.startTime).filter((t) => t != null);
    if (breathFrom.current == null && started.length) breathFrom.current = Math.min(...started);
    if (breathFrom.current == null) return;
    breaths.forEach((a) => {
      a.startTime = breathFrom.current;
    });
  }, [wantSurround, room, list.length]);

  /* ── Priming ───────────────────────────────────────────────────────────── */

  // Every picture a book needs at the places it could go (in the room's state, and in its lamp's twin when
  // that is on the page), the books above it settled, decoded now: a drop never waits.
  const primed = useRef(new Set());
  // Only the room's own state (the stacks a switch away follow later, in idle time); on a canvas the room's layers
  // as bitmaps only. (Every mounted state, as pictures, cost the press 17 ms on the Intel UHD.)
  // `compose` (a move announced, fix run rule 9): the room's canvas for that arrangement composed now, so it is shown by
  // the frame the book lands.
  const primeMove = (map, compose = false) => {
    const s = room;
    const data = stateNow(s);
    if (!data) return null;
    let composedFor = null;
    const arr = tableFrom(map);
    const lea = leathersOf(arr.stacks, colourOf);
    const f = { leathers: lea, plates: null, look: look(s), candle: shownCandle, held: false, surround: wantSurround };
    if (compose && TABLE_ROOM === 'canvas') {
      const names = roomLayers(data, lea, f);
      const key = composeKey(s, names, density);
      // Shown on the room's canvas as soon as it is composed (not after the stacks' render, a transition: 3-4 frames
      // of the moved book's old shadow lying where it had been).
      composedFor = composeRoom(key, recsOf(names, data.layers), core.stage, density, LAYERS_A_FRAME).p;
      composedFor.then((off) => {
        const c = stageRef.current?.querySelector(`.room-table-state[data-on="room"][data-s="${s}"] canvas.room-table-canvas`);
        if (!c || !off?.width || c.dataset.drawn === key) return;
        if (c.width !== off.width || c.height !== off.height) {
          c.width = off.width;
          c.height = off.height;
        }
        const v = c.getContext('2d');
        v.clearRect(0, 0, off.width, off.height);
        v.drawImage(off, 0, 0);
        c.dataset.drawn = key;
      });
    }
    const key = `${s}|${slotsKey(arr.map)}`;
    if (primed.current.has(key)) return composedFor;
    primed.current.add(key);
    f.plates = Object.fromEntries(arr.books.filter((b) => byId.get(b.id)?.noteCount).map((b) => [b.slot, true]));
    const onCanvas = TABLE_ROOM === 'canvas' ? new Set(roomLayers(data, lea, f)) : new Set();
    picturesOf(core, data, f).forEach(({ name, rec, strip }) => (onCanvas.has(name) ? bitmapOf(pictureUrl(rec, density)) : decodePicture(pictureUrl(rec, strip ? 2 : density))));
    return composedFor;
  };
  const focusTimer = useRef(0);
  const primeBook = (id, pressed = false) => {
    if (!byId.has(id) || !arrangement?.map?.[id]) return;
    clearTimeout(focusTimer.current);
    if (pressed === 'blur') return;
    if (pressed === 'focus' && !filmRunning()) {
      focusTimer.current = setTimeout(() => {
        if (filmRunning() || dragNow.current) return;
        const film = filmOf(id);
        if (film) prepareFilm(film, { previewAfter: 0, keepMs: 8000 });
      }, 200);
    } else if (pressed && !filmRunning()) {
      const film = filmOf(id);
      // (Fix run 2: everything from the press: its page mounted under the desk, its film's book built.)
      if (film) prepareFilm(film, { previewAfter: 0 });
    }
    // After the press's own frame, one place a task.
    const lifted = tableLiftOut(arrangement, id);
    const maps = [lifted.map, ...tableTargets(arrangement, id).filter((t) => t.kind !== 'own').map((t) => ({ ...lifted.map, [id]: slotKey(t.place, (lifted.stacks[t.place] || []).length) }))];
    maps.forEach((m, i) => setTimeout(() => primeMove(m), 4 + i * 4));
  };
  // The candle's other place: by night its whole light (its night state, mounted unseen), by day its
  // picture there.
  // (What the room is in and is asked to be, for a read that ends later.)
  const lightNow = useRef({ room, wish });
  useEffect(() => {
    lightNow.current = { room, wish };
  });
  const primeCandle = (first = 'look') => {
    // Its other look (a press lights it or blows it out) and, by night, its other place: asked for, mounted unseen.
    const places = ['C0', 'C1'].filter((p) => p !== candle && core.candles[p] && isNightState(room)).map((p) => stateFor({ night: true, candle: p, lamp }));
    const want = [lookTwin(room), ...places];
    // Owner fixes 3 (cleanup): one after the other, not both at once. The other look is no longer read in idle time, so
    // on a slow line the two read together each took twice as long and a press waited on both (20 Mbit, measured:
    // 1.3 s from the press to the light's change; the look alone first: see the log). The look first for a pointer or a
    // focus (a press is what follows), the place first for a carry. The second is left out if the room has been asked
    // to change meanwhile: nothing is read into its fade.
    const order = first === 'place' ? [...places, lookTwin(room)] : want;
    const from = room;
    order.reduce((before, s, i) => before.then(() => (i === 0 || (lightNow.current.room === from && lightNow.current.wish === from) ? prime(s) : false)), Promise.resolve());
    setExtra((was) => (want.every((s) => was.includes(s)) && was.length === want.length ? was : want));
    clearTimeout(extraTimer.current);
    extraTimer.current = setTimeout(() => setExtra([]), 12000);
  };
  const primeLamp = () => prime(lampTwin(room));

  /* ── Moves ─────────────────────────────────────────────────────────────── */

  const ghostRef = useRef(null);
  const dragNow = useRef(null);
  useEffect(() => {
    dragNow.current = drag;
  });
  const markGliding = (id, on) => {
    stageRef.current?.querySelectorAll(on ? ownOf(id) : `[data-gliding="${CSS.escape(id)}"]`).forEach((el) => {
      if (on) el.setAttribute('data-gliding', id);
      else el.removeAttribute('data-gliding');
    });
  };
  const startCandleDrag = (start) => {
    if (!onMoveCandle || drag) return;
    primeCandle('place');
    // (Its picture at the other place, the one it glides as once put down (CandleGlide), decoded now.)
    ['C0', 'C1']
      .filter((p) => p !== shownCandle && core.candles[p])
      .forEach((p) => {
        const rec = candleLook(isNightState(room) ? stateFor({ night: true, candle: p, lamp }) : room, p);
        if (rec) decodePicture(pictureUrl(rec, density));
      });
    const targets = candleMarks(true);
    overRef.current = null;
    setDrag({ id: 'candle', place: shownCandle, targets, start, candle: true, from: room });
  };
  // The places a taken book can go to, as marks (deskTable.js tableMarks: its rule; here each one's hull).
  const marksOf = (id, carried) =>
    tableMarks(arrangement, id, core, { carried })
      .filter((t) => levelOf(core, t.slot)?.hull)
      .map((t) => ({ key: t.key, place: t.key, to: t.place, kind: t.kind === 'own' ? 'own' : 'pile', polygon: levelOf(core, t.slot).hull }));
  const candleMarks = (carried) =>
    ['C0', 'C1']
      .filter((p) => core.candles[p] && (carried || p !== candle))
      .map((p) => ({ place: p, key: p, kind: p === candle ? 'own' : 'candle', polygon: candleRing(core.candles[p].box) }));
  const startDrag = (id, start) => {
    if (!onMove || drag || !arrangement?.map?.[id]) return;
    dropPreparedFilm();
    primeBook(id);
    const lifted = tableLiftOut(arrangement, id);
    const targets = marksOf(id, true);
    overRef.current = null;
    // Fix run 3: books lying on it keep their level while it is pulled out from under them (it is drawn behind them,
    // its own spine and title in view below theirs); once it is clear they settle (110 ms) and it comes in front.
    const s = slotOf(arrangement.map[id]);
    const above = (arrangement.stacks[s.place] || []).slice(s.level + 1).filter((b) => byId.has(b));
    const pulling = above.length > 0 && !quietNow(still);
    if (pulling) {
      const waiting = above.map((b) => ({ key: `${b}:${arrangement.map[b]}>${lifted.map[b]}:p${++glideSeq.n}`, id: b, from: arrangement.map[b], to: lifted.map[b], offset: [0, 0], lifted: false, ms: LIFT_SETTLE_MS, state: room, over: true, hold: true }));
      setGlides((was) => [...was.filter((g) => !above.includes(g.id)), ...waiting]);
    }
    const from = arrangement.map[id];
    const hullBox = (slot) => boxOf(levelOf(core, slot).hull);
    pullRef.current = pulling
      ? {
          mine: hullBox(from),
          theirs: unionBox([hullBox(from), ...above.flatMap((b) => [hullBox(arrangement.map[b]), hullBox(lifted.map[b])])]),
        }
      : null;
    pullGeo.current = pullRef.current;
    setDrag({ id, slot: arrangement.map[id], targets, start, from: room, pulling });
  };
  const pullRef = useRef(null);
  // Fix run 3, the pull (a better order than "24 css px, then settle", which still left one book over the other's
  // title): while books lie on it, the taken book stays drawn behind them and comes out from under them toward you
  // (down the screen) as the pointer travels, whichever way it goes, following it a little sideways (sideways in full,
  // it went through the next tower's books). Once its whole picture is clear of theirs (where they lie and where they
  // will settle: about 52 css px of travel) they settle and it comes across, low, to the pointer, and rises to the hand
  // where that crosses none of their spines (the move handler): nothing of either covers the other. Returns the ghost's
  // offset (css px).
  const pullShape = (dx, dy) => {
    const pull = pullRef.current;
    if (!pull) return null;
    const gx = dx * 0.3;
    const gy = Math.hypot(dx, dy);
    const k = fitNow.current.scale;
    const [x, y, w, h] = pull.mine;
    const [ux, uy, uw, uh] = pull.theirs;
    const mx = x + gx / k;
    const my = y + gy / k;
    const clear = !(mx < ux + uw + 2 && ux - 2 < mx + w && my < uy + uh + 2 && uy - 2 < my + h);
    return { gx, gy, clear };
  };
  // After the pull, rising at this offset crosses none of the stack it came from (its picture beside theirs).
  const pullFree = (dx) => {
    const geo = pullGeo.current;
    if (!geo) return true;
    const k = fitNow.current.scale;
    const x0 = geo.mine[0] + dx / k;
    return x0 + geo.mine[2] < geo.theirs[0] - 2 || x0 > geo.theirs[0] + geo.theirs[2] + 2;
  };
  const pullGeo = useRef(null);
  const unionBox = (boxes) => {
    const x0 = Math.min(...boxes.map((q) => q[0]));
    const y0 = Math.min(...boxes.map((q) => q[1]));
    const x1 = Math.max(...boxes.map((q) => q[0] + q[2]));
    const y1 = Math.max(...boxes.map((q) => q[1] + q[3]));
    return [x0, y0, x1 - x0, y1 - y0];
  };
  const pullNow = useRef({});
  useEffect(() => {
    pullNow.current = { pullShape, pullFree, releasePull, cancelPull };
  });
  const releasePull = () => {
    if (!pullRef.current) return;
    pullRef.current = null;
    setGlides((was) => was.map((g) => (g.hold ? { ...g, hold: false } : g)));
    setDrag((cur) => (cur?.pulling ? { ...cur, pulling: false } : cur));
  };
  const cancelPull = () => {
    if (!pullRef.current) return;
    pullRef.current = null;
    setGlides((was) => {
      was.filter((g) => g.hold).forEach((g) => markGliding(g.id, false));
      return was.filter((g) => !g.hold);
    });
  };
  // The carried book's own pictures out of the stacks in the commit that mounts its ghost (fix run: hidden from the
  // pointer's move, they were gone for two frames before the ghost came, a blank place).
  const carried = drag && !drag.candle ? drag.id : null;
  useLayoutEffect(() => {
    if (carried) markGliding(carried, true);
  }, [carried]);
  const flames = useCallback(() => [...(stageRef.current?.querySelectorAll('.room-stage-candle > .room-stage-flamefilm, .room-stage-candle > .room-stage-flame-still') || [])], []);
  const offsetRef = useRef([0, 0]);
  const overRef = useRef(null);
  const targetRef = useRef(null);
  const placesNow = useMemo(() => new Map(books.map((b) => [b.id, b.slot])), [books]);
  const drawnRef = useRef(placesNow);
  useEffect(() => {
    drawnRef.current = placesNow;
  });
  // A move TableDesk announces before it saves it (deskFilm.js announceMoves): every book whose slot changes
  // glides from where it is drawn (a dropped one from where it was let go) at once; the stacks follow, once
  // the new arrangement's pictures are decoded.
  const announce = (fromMap, toMap, primary = null) => {
    const drawn = drawnRef.current;
    const d = dragNow.current && !dragNow.current.candle ? dragNow.current : null;
    const quiet = quietNow(still);
    // The new arrangement's room composed first: a book leaving its place from rest (the keys, the menu, Ctrl K) sets
    // off once its old shadow is gone from the room (fix run: 3-4 frames of it lay there as a dark bar), 120 ms at most.
    const composedNow = primeMove(toMap, true);
    const out = primary && !d ? slideOut(primary, drawn.get(primary) || fromMap?.[primary], toMap, drawn) : null;
    const made = [];
    Object.keys(toMap || {}).forEach((id) => {
      const mine = d && d.id === id;
      const from = mine ? d.slot : drawn.get(id) || fromMap?.[id];
      const to = toMap[id];
      if (!from || !to || (from === to && !mine) || !byId.has(id)) return;
      // (Fix run 3: a book that lay on the one moved from rest settles over it once that has slid out: see slideOut.)
      const f = slotOf(from);
      const onIt = Boolean(out && f && id !== primary && f.place === out.place && f.level > out.level);
      if (onIt) made.push({ id, from, to, offset: [0, 0], lifted: false, ms: LIFT_SETTLE_MS, state: room, ready: composedNow, over: true, after: out.after });
      else if (out && id === primary) made.push({ id, from, to, offset: [0, 0], lifted: !out.slide, ms: out.ms, state: room, ready: composedNow, slide: out.slide });
      else made.push({ id, from, to, offset: mine ? offsetRef.current : [0, 0], lifted: Boolean(mine) || id === primary, ms: mine || id === primary ? GLIDE_MS : SETTLE_GLIDE_MS, state: room, ready: mine ? null : composedNow });
    });
    if (quiet) {
      made.forEach((g) => markGliding(g.id, false));
      if (d) markGliding(d.id, false);
    } else made.forEach((g) => markGliding(g.id, true));
    if (d) dragNow.current = null;
    flushSync(() => {
      if (!quiet && made.length) {
        // (A glide already under way to the same slot, a book settling off a pulled one, goes on as it is.)
        setGlides((was) => {
          const keep = was.filter((g) => made.some((m) => m.id === g.id && m.to === g.to && g.over));
          const fresh = made.filter((m) => !keep.some((g) => g.id === m.id));
          return [...was.filter((g) => !fresh.some((m) => m.id === g.id)), ...fresh.map((m) => ({ ...m, key: `${m.id}:${m.from}>${m.to}:${++glideSeq.n}` }))];
        });
      }
      if (d) {
        setDrag(null);
        setHeldLift(d.id);
      }
    });
    startTransition(() => {
      setPending({ map: { ...toMap }, key: slotsKey(toMap) });
      setHeldLift(null);
    });
  };
  // A lower book moved from rest (the keys, the menu, Ctrl K), fix run 3: when books lie on it, it slides out from under
  // them toward you (behind them, at its own level) until its picture is clear of theirs, then goes to its place in
  // front of them; they settle once it is clear. A move down and out (the near stack) clears on its own.
  const slideOut = (id, from, toMap, drawn) => {
    const s0 = slotOf(from);
    const to = toMap?.[id];
    if (!s0 || !to || quietNow(still)) return null;
    const above = [...drawn].filter(([b, slot]) => b !== id && slotOf(slot)?.place === s0.place && slotOf(slot).level > s0.level);
    if (!above.length) return null;
    const hullBox = (slot) => boxOf(levelOf(core, slot).hull);
    const mine = hullBox(from);
    const theirs = unionBox([mine, ...above.flatMap(([b, slot]) => [hullBox(slot), ...(toMap[b] ? [hullBox(toMap[b])] : [])])]);
    const endBox = hullBox(to);
    const k = fitNow.current.scale;
    // Down and out: its target lies below theirs.
    if (endBox[1] >= theirs[1] + theirs[3]) return { place: s0.place, level: s0.level, after: Math.round(GLIDE_MS * 0.45), ms: GLIDE_MS, slide: null };
    // Out toward you (down the screen), the shortest way clear of them (sideways it went through the next tower's books);
    // then across, low, under its target; then up onto it (straight there, it passed in front of the book that had lain
    // on it, now settling where it was).
    const sy = theirs[1] + theirs[3] - mine[1] + 3;
    const across = Math.abs(endBox[0] - mine[0]);
    const up = Math.abs(mine[1] + sy - endBox[1]);
    const total = sy + across + up;
    const ms = GLIDE_MS + 120;
    const at = Math.max(0.25, sy / total);
    const at2 = Math.min(0.85, Math.max(at + 0.15, (sy + across) / total));
    return { place: s0.place, level: s0.level, after: Math.round(ms * at), ms, slide: { x: 0, y: sy * k, at, x2: (endBox[0] - mine[0]) * k, at2 } };
  };
  const announceNow = useRef(null);
  useEffect(() => {
    announceNow.current = announce;
  });
  useEffect(() => {
    setMoveAnnouncer((...args) => announceNow.current?.(...args));
    return () => setMoveAnnouncer(null);
  }, []);
  const dragId = drag?.id;
  const dragLive = Boolean(drag);
  useEffect(() => {
    if (!dragId || !dragLive) return undefined;
    const place = (dx, dy) => {
      offsetRef.current = [dx, dy];
      const el = ghostRef.current;
      if (el) el.style.transform = `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px)`;
      // The flame goes with the candle in the hand (by night the room's light stays where it was).
      if (dragNow.current?.candle) flames().forEach((f) => (f.style.transform = `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px)`));
    };
    const goBack = () => {
      const d = dragNow.current;
      if (!d) return;
      if (d.candle) {
        setDrag(null);
        if (!quietNow(still)) setCandleGlides((g) => [...g, { key: `c${++glideSeq.n}`, from: d.place, to: d.place, state: room, offset: offsetRef.current, ms: GLIDE_MS }]);
        else flames().forEach((f) => (f.style.transform = ''));
        return;
      }
      // (Let go before it was clear: the books on it never moved.)
      pullNow.current.cancelPull();
      announceNow.current?.(null, { ...(arrangementRef.current?.map || {}) }, d.id);
    };
    // After a pull: the ghost's lag behind the pointer, taken up in 140 ms (eased) by an animation of its `translate`
    // (on the compositor, on the page's own clock), its `transform` following the pointer meanwhile.
    let lag = null;
    // (The pull's state, here: the drag's own object is copied by its renders.)
    let released = false;
    let low = null;
    const move = (event) => {
      const d = dragNow.current;
      if (!d) return;
      const dx = event.clientX - d.start[0];
      const dy = event.clientY - d.start[1];
      const shaped = d.pulling && !released ? pullNow.current.pullShape(dx, dy) : null;
      const residual = () => (lag && lag.playState === 'running' ? (getComputedStyle(ghostRef.current).translate || '0px 0px').split(' ').map((v) => parseFloat(v) || 0) : [0, 0]);
      if (shaped && !shaped.clear) place(shaped.gx, shaped.gy);
      else if (shaped) {
        // Clear: the books that lay on it settle; it comes across to the pointer, low (in front of the table, under the
        // stacks' spines), its sideways lag taken up in 140 ms; it rises to the hand only where that crosses no spine of
        // the stack it came from (or once the pointer is as low as it is).
        released = true;
        low = shaped.gy;
        place(dx, Math.max(low, dy));
        lag = ghostRef.current?.animate?.([{ translate: `${(shaped.gx - dx).toFixed(2)}px 0px` }, { translate: '0px 0px' }], { duration: 140, easing: 'cubic-bezier(0.33, 1, 0.68, 1)' }) || null;
        pullNow.current.releasePull();
      } else if (low != null) {
        if (dy >= low || pullNow.current.pullFree(dx)) {
          const [rx, ry] = residual();
          const lowNow = Math.max(low, dy);
          low = null;
          place(dx, dy);
          lag?.cancel();
          lag = ghostRef.current?.animate?.([{ translate: `${rx.toFixed(2)}px ${(ry + lowNow - dy).toFixed(2)}px` }, { translate: '0px 0px' }], { duration: 140, easing: 'cubic-bezier(0.33, 1, 0.68, 1)' }) || null;
        } else place(dx, Math.max(low, dy));
      } else place(dx, dy);
      const at = [(event.clientX - fitNow.current.left) / fitNow.current.scale, (event.clientY - fitNow.current.top) / fitNow.current.scale];
      const over = pickTarget(d.targets, at, 40);
      // The place under the pointer, marked on the page directly: no render of the stage while a thing is carried.
      if (over !== overRef.current) {
        overRef.current = over;
        const svg = targetRef.current;
        svg?.querySelectorAll('g[data-over]').forEach((g) => g.removeAttribute('data-over'));
        if (over) svg?.querySelector(`g[data-key="${CSS.escape(over)}"]`)?.setAttribute('data-over', '');
      }
    };
    const up = () => {
      const d = dragNow.current;
      if (!d) return;
      const target = d.targets.find((t) => t.key === overRef.current);
      if (target && target.kind !== 'own') {
        if (d.candle) {
          // Fix run 3: to its seat at once (150 ms), the room's light changing only once it has been put down.
          const to = target.to || target.place;
          setDrag(null);
          if (!quietNow(still)) setCandleGlides((g) => [...g, { key: `c${++glideSeq.n}:${d.place}>${to}`, from: d.place, to, base: d.place, state: room, offset: offsetRef.current, ms: CANDLE_SEAT_MS }]);
          else flames().forEach((f) => (f.style.transform = ''));
          onMoveCandle?.(target.place);
        } else {
          // (Let go while the lag is being taken up: from where it is drawn.)
          if (lag && lag.playState === 'running') {
            const [tx, ty] = (getComputedStyle(ghostRef.current).translate || '0px 0px').split(' ').map((v) => parseFloat(v) || 0);
            offsetRef.current = [offsetRef.current[0] + tx, offsetRef.current[1] + ty];
          }
          lag?.cancel();
          lag = null;
          pullNow.current.releasePull();
          onMove(d.id, target.to);
        }
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
      lag?.cancel();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', key);
      window.removeEventListener('keydown', key, true);
    };
  }, [dragId, dragLive, onMove, onMoveCandle, flames, still, room]);
  // A dropped candle the room never took: back to its place after a while.
  const droppedKey = drag?.dropped ? `${drag.id}>${drag.dropped.to}` : '';
  useEffect(() => {
    if (!droppedKey) return undefined;
    const timer = setTimeout(() => setDrag((cur) => (cur?.dropped ? null : cur)), 4000);
    return () => clearTimeout(timer);
  }, [droppedKey]);

  // Moves nobody announced (a save from elsewhere, a delete settling, an undo): every book whose slot changed
  // glides too, worked out in render from the slots last seen.
  const [seenPlaces, setSeenPlaces] = useState(placesNow);
  if (seenPlaces !== placesNow) {
    setSeenPlaces(placesNow);
    const moved = [...placesNow].filter(([id, slot]) => seenPlaces.has(id) && seenPlaces.get(id) !== slot && !glides.some((g) => g.id === id && g.to === slot));
    const lifting = false;
    if (moved.length && !still) {
      setGlides((was) => [
        ...was.filter((g) => !moved.some(([id]) => id === g.id)),
        ...moved.map(([id, to]) => {
          const from = seenPlaces.get(id);
          // (Fix run 2: a book lying on the one just lifted settles one level down OVER the lifted one, in 110 ms: drawn
          // under it, the lifted book's own picture (its top face, where this one lay) hid it for three frames.)
          if (lifting) return { key: `${id}:${from}>${to}:u${++glideSeq.n}`, id, from, to, offset: [0, 0], lifted: false, ms: LIFT_SETTLE_MS, state: room, over: true };
          return { key: `${id}:${from}>${to}:u${++glideSeq.n}`, id, from, to, offset: [0, 0], lifted: moved.length === 1, ms: moved.length === 1 ? GLIDE_MS : SETTLE_GLIDE_MS, state: room };
        }),
      ]);
    }
  }
  const settled = `|${glides
    .filter((g) => landed.includes(`|${g.key}|`) && placesNow.get(g.id) === g.to)
    .map((g) => g.key)
    .join('|')}|`;
  useLayoutEffect(() => {
    glides.forEach((g) => markGliding(g.id, !settled.includes(`|${g.key}|`)));
  });
  const onLanded = useCallback((key, how) => {
    if (how === 'gone') {
      setGlides((was) => was.filter((g) => g.key !== key));
      setLanded((was) => was.replace(`|${key}|`, '|'));
    } else setLanded((was) => (was.includes(`|${key}|`) ? was : `${was}${key}|`));
  }, []);
  useEffect(() => {
    if (!pending) return undefined;
    const timer = setTimeout(() => setPending(null), 3000);
    return () => clearTimeout(timer);
  }, [pending]);
  // The candle's glide when the room shows it at a new place (by night once that place's light is in).
  const [seenCandle, setSeenCandle] = useState(shownCandle);
  if (seenCandle !== shownCandle) {
    setSeenCandle(shownCandle);
    // (Put down by the hand, it is on its way or there already: no second glide.)
    if (!still && !candleGlides.some((g) => g.to === shownCandle)) {
      setCandleGlides((was) => [...was, { key: `c${++glideSeq.n}:${seenCandle}>${shownCandle}`, from: seenCandle, to: shownCandle, base: shownCandle, state: room, offset: [0, 0], ms: GLIDE_MS }]);
    }
  }
  // The flame follows the candle's own place in the commit the room moves it there (its glide had carried it there).
  useLayoutEffect(() => {
    flames().forEach((f) => {
      f.getAnimations?.().forEach((a) => a.cancel());
      f.style.transform = '';
    });
  }, [shownCandle, flames]);
  // Landed (fix run, rule 3): the candle's own picture at its new place is in the room's canvas (by night its place's
  // light state is the room's) and has been drawn, PAINT_FRAMES since; then the carried picture goes in one frame.
  const onCandleLanded = useCallback(
    (key, to) => {
      setCandleLanded((was) => (was.includes(`|${key}|`) ? was : `${was}${key}|`));
      const started = performance.now();
      const there = () => {
        const state = stageRef.current?.querySelector('.room-table-state[data-on="room"]');
        // (And the light's own change over: the new state fades in, the candle in it with it.)
        if (!state || stageRef.current?.hasAttribute('data-swapping')) return false;
        // (Its stack whole and still: the candle in it is as opaque as the carried one.)
        if (getComputedStyle(state).opacity !== '1' || state.getAnimations().some((a) => a.playState === 'running')) return false;
        const s = state.getAttribute('data-s') || '';
        if (isNightState(s)) {
          if (s.startsWith('nightC1') !== (to === 'C1')) return false;
        }
        if (TABLE_ROOM !== 'canvas') return true;
        const drawnKey = state.querySelector('canvas.room-table-canvas')?.dataset.drawn || '';
        return drawnKey.includes(isNightState(s) ? 'candle-look' : `candle-look-${to}`);
      };
      const wait = () => {
        if (there() || performance.now() - started > 6000) {
          afterFrames(PAINT_FRAMES, () => {
            setCandleGlides((was) => was.filter((g) => g.key !== key));
            setCandleLanded((was) => was.replace(`|${key}|`, '|'));
            flames().forEach((f) => (f.style.transform = ''));
          });
          return;
        }
        requestAnimationFrame(wait);
      };
      wait();
    },
    [flames],
  );

  // "+ New course" (fix run, rule 7): hidden from the start of any carry or move until the arrangement has settled
  // (no book carried or gliding, no move waiting for its save), and placed by the arrangement SHOWN, so it never
  // stands where a book has just been put.
  const moving = Boolean(drag) || glides.length > 0 || candleGlides.length > 0 || Boolean(pending) || Boolean(heldLift);
  const newSlot = useMemo(
    () => (!ghostSlot || moving || shown.more ? null : arrangeTable([...courses.map((c) => c.id), '\u0000new'], shown.map, core).map['\u0000new'] || null),
    [ghostSlot, moving, shown, courses, core],
  );

  // Which stacks follow the arrangement at once (the rest once it has been still for 600 ms): the room, the state it
  // leaves, and (fix run) the lamp's twin unless a book is lifted, so the lamp just after a move shows the new one.
  const follows = (s) => s === room || s === leaving || (s === lampTwin(room) && !liftId);
  // The bound (Fault 3): once nothing moves, in idle time, the bitmaps the room's and its lamp twin's canvases do not
  // draw are closed (a state let go composes again from its pictures when it comes back).
  useEffect(() => {
    if (moving || TABLE_ROOM !== 'canvas' || unbound()) return undefined;
    const keep = new Set([room, lampTwin(room)]);
    let idle = 0;
    const timer = setTimeout(() => {
      const run = () => trimBitmaps(keep) || (idle = setTimeout(run, 1000));
      idle = typeof window.requestIdleCallback === 'function' ? window.requestIdleCallback(run, { timeout: 2000 }) : setTimeout(run, 0);
    }, 2500);
    return () => {
      clearTimeout(timer);
      if (typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(idle);
      clearTimeout(idle);
    };
  }, [moving, room, listKey]);
  useEffect(() => () => clearTimeout(extraTimer.current), []);

  /* ── The book film ─────────────────────────────────────────────────────── */

  // From a book's slot (its spine's quad on a stack; the flat book's cover through deskFilm.js nearPose),
  // drawn through the render's own camera at the stage's fit of the moment.
  // `under`: a book lies on it (its board is not seen at its place).
  const filmGeometry = (slot) => () => {
    if (typeof window === 'undefined') return null;
    const f = fitNow.current;
    const cam = stageCamera(core, f);
    const view = { width: window.innerWidth, height: window.innerHeight };
    const level = levelOf(core, slot);
    if (!level) return null;
    if (level.cover) {
      const [sx, sy] = level.size_m;
      const { pose, t } = nearPose(cam, { x: level.origin[0], y: level.origin[1], yaw: 0, w: sx, d: sy, t: level.size_m[2] });
      return { cam, from: pose, near: true, view, t, under: false };
    }
    const s = slotOf(slot);
    const under = Boolean(s && (arrangementRef.current?.stacks?.[s.place]?.length || 0) > s.level + 1);
    const { pose, t } = pilePose(cam, level.spine, f);
    return { cam, from: pose, near: false, view, t, under };
  };
  // A course shown as the held book (deskBook.js, registered by TableDesk with the production pictures): the
  // film lands on the picture. A function, so a close made later reads the window then.
  const heldOf = (course) => {
    const registered = getDeskBook();
    if (!bookShows({ width: window.innerWidth, homeIsDesk: true }, registered)) return null;
    return () => {
      const held = registered.held(registered.stateNow?.() || room, course.color);
      if (!held) return null;
      const view = { width: window.innerWidth, height: window.innerHeight };
      const fitH = heldFit(view, held, { extent: held.extent });
      const { left: pl, right: pr } = held.pages;
      const at = (p) => [fitH.left + p[0] * fitH.scale, fitH.top + p[1] * fitH.scale];
      const spineX = (at(pl.page[1])[0] + at(pl.page[2])[0] + at(pr.page[0])[0] + at(pr.page[3])[0]) / 4;
      const topY = (at(pl.page[0])[1] + at(pr.page[1])[1]) / 2;
      const bottomY = (at(pl.page[3])[1] + at(pr.page[2])[1]) / 2;
      const dense = heldDense(fitH.scale);
      return {
        src: dense ? held.src.x2 : held.src.x1,
        surround: held.surround ? { src: dense ? held.surround.x2 : held.surround.x1, box: held.surround.box } : null,
        fit: fitH,
        ground: held.ground,
        paper: held.paper,
        spread: { x: spineX, cy: (topY + bottomY) / 2, tall: bottomY - topY },
      };
    };
  };
  const filmOf = (id) => {
    const course = byId.get(id);
    const slot = arrangement?.map?.[id];
    if (!course || !slot) return null;
    const held = heldOf(course);
    // Still and reduced motion: only the held book's wait and one-frame swap (no journey).
    if (still && !held) return null;
    const leather = leatherOf(course.color);
    const L = stateNow(room)?.layers || {};
    const strip = L[`gilt-${slot}`];
    const tones = core.tones?.[toneState(core, room)]?.[slot];
    const lk = roomLook;
    const stage = stageRef.current;
    // (Owner fixes 3: the held book is its own picture: its leather's and label's tones are not read for it.)
    const seen = held ? null : measureBook(stage, core, room, id, slot, leather);
    const look = {
      cover: seen?.leather || LEATHER_SEEN[lk][leather],
      label: seen?.label || LABEL_SEEN[lk][leather === 'black' ? 'oxblood' : 'black'],
      gilt: tones?.title?.gilt ? toHex(tones.title.gilt) : '#c9a45c',
      title: course.name,
      lines: coverLines(course.name),
      ...(lk === 'night' ? FILM_TONES.night : FILM_TONES.day),
      light: lk,
      measured: Boolean(seen?.leather),
      strip: strip ? pictureUrl(strip, 2) : '',
      held,
    };
    return {
      courseId: id,
      describe: filmGeometry(slot),
      look,
      hideBook: (on) => stage?.querySelectorAll(ownOf(id)).forEach((el) => (on ? el.setAttribute('data-filmed', '') : el.removeAttribute('data-filmed'))),
      focusBook: () => {
        const active = document.activeElement;
        if (active && active !== document.body && !active.closest('.room-page-slot')) return;
        stage?.querySelector(`.room-stage-slab-hit[data-course-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
      },
    };
  };
  // A book's held picture (and its surround) drawn at 0.4% while the pointer rests on the book: the compositor's
  // own decode at the drawn scale is done before the click (a cold first open waited on it: 117 ms + 54 ms).
  const heldFor_ = (course) => {
    const registered = getDeskBook();
    if (!course || !bookShows({ width: window.innerWidth, homeIsDesk: true }, registered)) return null;
    const held = registered.held(registered.stateNow?.() || room, course.color);
    if (!held) return null;
    const fitH = heldFit({ width: window.innerWidth, height: window.innerHeight }, held, { extent: held.extent });
    const dense = heldDense(fitH.scale);
    return { src: dense ? held.src.x2 : held.src.x1, fit: fitH, surround: held.surround ? { src: dense ? held.surround.x2 : held.surround.x1, box: held.surround.box } : null };
  };
  // (Once the pointer has rested 150 ms: a pointer passing over, or pressing at once, starts nothing the film would
  // then wait on.)
  const hoverTimer = useRef(0);
  // Owner fixes 3: idle time no longer decodes every leather's close-up, so a book's own is DECODED the moment the
  // pointer or the keyboard's focus comes to it (off the main thread, nothing drawn, once per picture: a pointer passing
  // over costs a decode, never a frame); the drawing at 0.4% still waits for the pointer's rest. (Decoded only after
  // the rest, a book not prepared in idle time opened 100 ms later in Still, where nothing is drawn ahead.)
  const decodeHeldOf = (id) => {
    if (filmRunning() || dragNow.current) return;
    const h = heldFor_(byIdNow.current.get(id));
    if (!h) return;
    decodePicture(h.src);
    if (h.surround) decodePicture(h.surround.src);
  };
  const warmHeldOf = (id) => {
    clearTimeout(hoverTimer.current);
    decodeHeldOf(id);
    hoverTimer.current = setTimeout(() => {
      if (filmRunning() || dragNow.current) return;
      const h = heldFor_(byIdNow.current.get(id));
      if (h) prepareHeld(h.src, h.fit, h.surround);
    }, 150);
  };
  const openBook = (id) => {
    if (filmRunning()) return true;
    const film = filmOf(id);
    return film ? openFilm(film) : false;
  };

  /* ── The menu ──────────────────────────────────────────────────────────── */

  const [menu, setMenu] = useState(null);
  const openMenu = (id, at) => {
    if (!byId.has(id)) return;
    primeBook(id);
    setMenu((m) => (m && m.id === id ? m : { id, at, title: byId.get(id).name }));
  };
  const openCandleMenu = (at) => {
    primeCandle();
    setMenu((m) => (m && m.id === 'candle' ? m : { id: 'candle', at, title: 'Candle' }));
  };
  const closeMenu = useCallback(
    (refocus) => {
      const id = menu?.id;
      setMenu(null);
      if (refocus && id === 'candle') stageRef.current?.querySelector('.room-stage-candle-button')?.focus();
      else if (refocus && id) stageRef.current?.querySelector(`.room-stage-slab-hit[data-course-id="${CSS.escape(id)}"]`)?.focus();
    },
    [menu],
  );
  const itemsOf = (m) => {
    if (m.id === 'candle') {
      return [
        ...['C0', 'C1']
          .filter((p) => core.candles[p])
          .map((p) => ({ key: p, label: `${core.candles[p].name[0].toUpperCase()}${core.candles[p].name.slice(1)}`, checked: p === candle, run: () => p !== candle && onMoveCandle?.(p) })),
        { key: 'light', label: lit ? 'Blow it out' : 'Light it', run: () => onToggleCandle?.() },
      ];
    }
    return [...(menuItemsOf?.(m.id) || []), { key: 'open', label: 'Open', run: () => onPick?.(m.id) }];
  };

  /* ── The marks (owner fixes, C) ────────────────────────────────────────── */

  // What is taken, and so marked: the thing in the hand; else the book (or the candle) whose menu is open; else the
  // book the keyboard holds Alt on. Kept on the page 200 ms after it ends, fading (table.css).
  const [altId, setAltId] = useState(null);
  const liveMarks =
    drag && !drag.dropped
      ? { key: `drag:${drag.id}`, targets: drag.targets }
      : menu
        ? { key: `menu:${menu.id}:${realKey}:${candle}`, targets: menu.id === 'candle' ? candleMarks(false) : arrangement?.map?.[menu.id] ? marksOf(menu.id, false) : [] }
        : altId && arrangement?.map?.[altId]
          ? { key: `alt:${altId}:${realKey}`, targets: marksOf(altId, false) }
          : null;
  const [lastMarks, setLastMarks] = useState(null);
  if (liveMarks && lastMarks?.key !== liveMarks.key) setLastMarks(liveMarks);
  const marksLive = Boolean(liveMarks);
  useEffect(() => {
    if (marksLive || !lastMarks) return undefined;
    const timer = setTimeout(() => setLastMarks(null), 200);
    return () => clearTimeout(timer);
  }, [marksLive, lastMarks]);
  const marks = liveMarks || lastMarks;

  /* ── Handlers behind names that never change ───────────────────────────── */

  const latest = useRef({});
  useEffect(() => {
    latest.current = { onPick, onKeyMove, startDrag, openMenu, primeBook, onNewCourse, warmHeldOf, decodeHeldOf };
  });
  const act = useMemo(
    () => ({
      pick: (...a) => latest.current.onPick?.(...a),
      // (A film prepared from the keyboard's focus belongs to the book's old place.)
      keyMove: (...a) => {
        clearTimeout(focusTimer.current);
        dropPreparedFilm();
        latest.current.onKeyMove?.(...a);
      },
      drag: (...a) => latest.current.startDrag?.(...a),
      menu: (...a) => latest.current.openMenu?.(...a),
      prime: (id, how) => {
        // (Owner fixes 3: the keyboard's focus decodes the book's close-up at once, as the pointer's coming does.)
        if (how === 'focus') latest.current.decodeHeldOf?.(id);
        latest.current.primeBook?.(id, how);
      },
      hover: (...a) => latest.current.warmHeldOf?.(...a),
      marks: (id, on) => setAltId((cur) => (on ? id : cur === id ? null : cur)),
      newCourse: () => latest.current.onNewCourse?.(),
    }),
    [],
  );

  // The stage's page-wide rules (desk.css html[data-desk-stage]) while it is on the screen, the scrollbar's
  // gutter measured before it goes.
  useLayoutEffect(() => {
    const rootEl = document.documentElement;
    if (!rootEl.hasAttribute('data-desk-stage')) rootEl.style.setProperty('--room-gutter-w', `${Math.max(0, Math.round((window.innerWidth - rootEl.getBoundingClientRect().width) * 100) / 100)}px`);
    rootEl.setAttribute('data-desk-stage', '');
    // (The table's own light timings, table.css: owner fixes, D.)
    rootEl.setAttribute('data-desk-table', '');
    return () => {
      rootEl.removeAttribute('data-desk-stage');
      rootEl.removeAttribute('data-desk-table');
    };
  }, []);
  // A book opens by its film however it is opened (a click or Enter: TableDesk's pick asks here first; the
  // menu's Open; Ctrl K's course rows). In idle time: the leather's grain, the course page's own room, the
  // film's first frame, and the held book's pictures for every book on the table.
  const openNow = useRef(null);
  const roomNow = useRef(room);
  const booksNow = useRef(books);
  const byIdNow = useRef(byId);
  const filmNow = useRef(null);
  const measureNow = useRef(null);
  useEffect(() => {
    filmNow.current = filmOf;
    measureNow.current = (id) => {
      const slot = arrangementRef.current?.map?.[id];
      const course = byId.get(id);
      if (slot && course) measureBook(stageRef.current, core, room, id, slot, leatherOf(course.color));
    };
    openNow.current = openBook;
    roomNow.current = room;
    booksNow.current = books;
    byIdNow.current = byId;
  });
  const primeNow = useRef(null);
  useEffect(() => {
    primeNow.current = primeCandle;
  });
  useEffect(() => subscribeSearch(() => isSearchOpen() && !getFilm() && primeNow.current?.()), []);
  useEffect(() => {
    setDeskOpener((id) => {
      const state = getFilm();
      if (state?.phase === 'shown') return false;
      if (state || filmRunning()) return true;
      return Boolean(openNow.current?.(id));
    });
    return () => setDeskOpener(null);
  }, []);
  // Once the desk shows (never before: its first view's bytes are the room's), in idle time: the film's grain,
  // the course page's own room, the film's first frame, the held book's pictures for the likely books.
  // Owner fixes 3 (cleanup): where a course opens as the held book (its own opaque page: no flying book, no room
  // behind it) nothing of the older film is prepared any more: not its grain, not the room's photograph, not every
  // book's tones, not its 3D book drawn once, and the room's backdrop is not drawn above the desk (it was, at 0.4%,
  // for 0.4 to 1 s after every load, with 53 animations running).
  useEffect(() => {
    if (!ready) return undefined;
    const prepare = () => {
      const registered = getDeskBook();
      const asBook = bookShows({ width: window.innerWidth, homeIsDesk: true }, registered);
      if (!asBook) {
        prepareGrain();
        prepareRoomPictures();
        // Fix run: every book's tones read from its picture now, one book an idle slice (a press then finds them), and
        // the film's first book drawn once in the first book's own look.
        const ids = booksNow.current.map((b) => b.id);
        const measureNext = (i) => {
          if (i >= ids.length) return;
          measureNow.current?.(ids[i]);
          if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(() => measureNext(i + 1), { timeout: 1000 });
          else setTimeout(() => measureNext(i + 1), 50);
        };
        measureNext(0);
        warmFilm(ids.length ? filmNow.current?.(ids[0])?.look : null);
      }
      // The glide's tone filter drawn once (its first use compiled on the GPU mid-glide: a 63 ms frame, Intel UHD).
      const stageEl = document.querySelector('.room-stage.room-table');
      if (stageEl) {
        const probe = document.createElement('div');
        Object.assign(probe.style, { position: 'absolute', left: '0', top: '0', width: '8px', height: '8px', background: '#888', opacity: '0.004', filter: 'brightness(0.8)', willChange: 'transform', pointerEvents: 'none' });
        stageEl.append(probe);
        const step = probe.animate([{ filter: 'brightness(1)' }, { filter: 'brightness(0.8)' }], { duration: 120 });
        step.finished.then(() => probe.remove()).catch(() => probe.remove());
      }
      if (!asBook) {
        warmRoomOnce();
        return;
      }
      // Fix run: the held book's page (its chunk and its stylesheet) and its faces fetched now, so a first open waits
      // on its pictures alone.
      import('../../CourseBook')
        .then(() => new Promise((r) => setTimeout(r, 800)))
        .then(() => Promise.all(["600 40px 'EB Garamond'", "400 20px 'EB Garamond'", "600 20px 'EB Garamond'", "400 14px 'Figtree'"].map((f) => document.fonts?.load?.(f).catch(() => null))))
        .catch(() => null);
      const s = registered.stateNow?.() || roomNow.current;
      const view = { width: window.innerWidth, height: window.innerHeight };
      // Owner fixes 3: the close-ups of the likely books only (it was every book's: one picture a leather, 7.4 MB
      // decoded each at 1x, 29.7 MB at 2x): the book opened last, the near stack's, the flat one; and the surround they
      // all share. Any other book's is read when the pointer rests on it, the keyboard's focus comes to it, or it is
      // pressed (warmHeldOf, primeBook: as before).
      const last = lastOpenedBook();
      const placeOf = (id) => slotOf(arrangementRef.current?.map?.[id])?.place;
      const likely = booksNow.current.filter((b) => b.id === last || placeOf(b.id) === NEAR || placeOf(b.id) === FLAT);
      likely.sort((a, b) => Number(b.id === last) - Number(a.id === last));
      const seen = new Set();
      const surroundOf = (held, dense) => (held.surround ? { src: dense ? held.surround.x2 : held.surround.x1, box: held.surround.box } : null);
      likely.forEach((b) => {
        const held = registered.held(s, byIdNow.current.get(b.id)?.color);
        if (!held || seen.has(held.src.x1)) return;
        seen.add(held.src.x1);
        const fitH = heldFit(view, held, { extent: held.extent });
        const dense = heldDense(fitH.scale);
        if (seen.size === 1) prepareHeld(dense ? held.src.x2 : held.src.x1, fitH, surroundOf(held, dense));
        else decodePicture(dense ? held.src.x2 : held.src.x1);
        if (held.surround) decodePicture(dense ? held.surround.x2 : held.surround.x1);
      });
      if (!seen.size && booksNow.current.length) {
        const held = registered.held(s, byIdNow.current.get(booksNow.current[0].id)?.color);
        const around = held ? surroundOf(held, heldDense(heldFit(view, held, { extent: held.extent }).scale)) : null;
        if (around) decodePicture(around.src);
      }
    };
    const idle = typeof window.requestIdleCallback === 'function' ? window.requestIdleCallback(prepare, { timeout: 3000 }) : setTimeout(prepare, 1500);
    return () => {
      if (typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(idle);
      else clearTimeout(idle);
    };
  }, [ready]);

  // The pointer near the lamp: its twin fetched now if idle time has not done it yet.
  const lampBox = useMemo(() => {
    const pts = [...core.lamp.shade.hit, ...core.lamp.pole.hit];
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    return [Math.min(...xs) - 120, Math.min(...ys) - 120, Math.max(...xs) + 120, Math.max(...ys) + 120];
  }, [core]);
  const nearedLamp = useRef('');
  const near = useRef({ lamp: false, candle: false });
  const linger = useRef(0);
  const onStageMove = (event) => {
    if (dragNow.current) return;
    const f = fitNow.current;
    const x = (event.clientX - f.left) / f.scale;
    const y = (event.clientY - f.top) / f.scale;
    const inBox = (b) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];
    const lampNear = inBox(lampBox);
    const cb = core.candles[shownCandle].box;
    const candleNear = inBox([cb[0] - 120, cb[1] - 160, cb[2] + 120, cb[3] + 80]);
    if (lampNear && nearedLamp.current !== room) {
      nearedLamp.current = room;
      primeLamp();
    }
    // (The candle's other look and place asked for as the pointer comes to it: fix run, the bound.)
    if (candleNear && !near.current.candle) primeCandle();
    if (lampNear || candleNear) {
      clearTimeout(linger.current);
      if (!near.current.lamp && !near.current.candle) warm('pointer', true);
      near.current = { lamp: lampNear, candle: candleNear };
    } else if (near.current.lamp || near.current.candle) {
      near.current = { lamp: false, candle: false };
      clearTimeout(linger.current);
      linger.current = setTimeout(() => warm('pointer', false), 1500);
    }
  };
  useEffect(() => () => clearTimeout(linger.current), []);
  // Leaving the desk (a note opened from the small notebook) lets the room's warming go.
  useEffect(() => () => warmRoomFor('pocket', false), []);
  useEffect(() => () => clearTimeout(focusTimer.current), []);

  // The table shows in ONE frame once its room is in and has been drawn (at 0.4% meanwhile, table.css), never
  // fading in (fix run, rule 1: a desk coming back from a note faded in from the wall over 600 ms, every book
  // see-through).
  const [drawnIn, setDrawnIn] = useState(false);
  useEffect(() => {
    if (!ready || drawnIn) return undefined;
    let alive = true;
    afterFrames(PAINT_FRAMES, () => alive && setDrawnIn(true));
    return () => {
      alive = false;
    };
  }, [ready, drawnIn]);

  // Fix run 3: a book gliding to a tower goes behind the big notebook and its stand as the tower's own pictures do (the
  // stacks draw the notebook after the towers): its glide is clipped out of the notebook's hull (core.json notebook.hull,
  // an even-odd path: no picture to wait for), so in the hand-over frame the part the stand hides is hidden in both
  // (T01's seated picture starts where the stand ends).
  const nbHull = core.notebook?.hull;
  const behindStyle = nbHull
    ? {
        width: px(core.stage.width * scale),
        height: px(core.stage.height * scale),
        clipPath: `path(evenodd, 'M0 0 H${(core.stage.width * scale).toFixed(1)} V${(core.stage.height * scale).toFixed(1)} H0 Z M${nbHull.map(([x, y]) => `${(x * scale).toFixed(1)} ${(y * scale).toFixed(1)}`).join(' L')} Z')`,
      }
    : null;
  const towerBound = (g) => /^T/.test(g.to || '');
  const glideEl = (g) =>
    byId.has(g.id) ? (
      <BookGlide key={g.key} glide={g} core={core} course={byId.get(g.id)} state={room} scale={scale} words={wordsOf(core, byId.get(g.id), g.from, scale)} onLanded={onLanded} settle={settled.includes(`|${g.key}|`)} />
    ) : null;
  // (Each tower-bound glide in its own masked layer, so its order against the others can change mid-glide.)
  const glideGroup = (list) =>
    list.map((g) =>
      behindStyle && towerBound(g) ? (
        <div key={`b:${g.key}`} className="room-table-behind" style={behindStyle}>
          {glideEl(g)}
        </div>
      ) : (
        glideEl(g)
      ),
    );

  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const left = Math.round(fit.left * 100) / 100;
  const top = Math.round(fit.top * 100) / 100;
  const snap = useMemo(() => ({ x: left, y: top, dpr }), [left, top, dpr]);
  const opening = core.frame?.opening;
  const openingBox = opening ? quadBox(opening) : null;
  const candleP = candlePoints(core, shownCandle);
  const stillFlameRec = isNightState(room) ? stateNow(room)?.layers?.flame : null;
  const candleTargets = ['C0', 'C1'].filter((p) => core.candles[p]).length > 1;

  return (
    <Density.Provider value={density}>
      <StageSnap.Provider value={snap}>
        <div className={`room-stage-backdrop is-table is-${roomLook}`} data-room={roomLook}>
          <div
            ref={stageRef}
            className={`room-stage room-table is-${roomLook}${drawnIn ? ' is-ready' : ''}`}
            inert={!ready}
            data-room={roomLook}
            data-state={room}
            data-swapping={leaving ? '' : undefined}
            data-leaving={leaving || undefined}
            data-swap={leaving ? swap : undefined}
            data-dragging={dragLive ? '' : undefined}
            data-bare={bare ? '' : undefined}
            onPointerMove={onStageMove}
            style={{ left: px(fit.left), top: px(fit.top), width: px(fit.width), height: px(fit.height), ...typeVars(scale) }}
          >
            {list.map((s) => (
              <TableState
                key={s}
                core={core}
                state={s}
                on={s === room ? 'room' : s === leaving ? 'leaving' : ''}
                back={swapBack}
                scale={scale}
                hasSurround={wantSurround}
                stacks={follows(s) ? stacks : quiet.stacks}
                leathers={follows(s) ? leathers : quiet.leathers}
                plates={follows(s) ? plates : quiet.plates}
                words={follows(s) ? words : quiet.words}
                onDrawn={onDrawn}
                look={look(s)}
                candle={isNightState(s) ? (s.startsWith('nightC1') ? 'C1' : 'C0') : candle}
                held={heldFor(s)}
                opening={opening}
              />
            ))}

            <div className="room-stage-overlay">
              {openingBox && (
                <div
                  className="room-stage-picture is-slot"
                  style={{ left: px(openingBox[0] * scale), top: px(openingBox[1] * scale), width: px(openingBox[2] * scale), height: px(openingBox[3] * scale), clipPath: clipPolygon(opening, openingBox, scale) }}
                >
                  <SceneSlot />
                </div>
              )}

              <div className="room-stage-piles">
                {/* "+ New course" first: under the books' own hit areas where its hull overlaps the book below. */}
                {newSlot && <TableDashed core={core} slot={newSlot} scale={scale} label="+ New course" onClick={act.newCourse} />}
                {PLACES.flatMap((p) =>
                  (stacks[p] || []).map((id, level) =>
                    byId.has(id) ? (
                      <TableHit
                        key={id}
                        core={core}
                        course={byId.get(id)}
                        slot={slotKey(p, level)}
                        count={stacks[p].length}
                        scale={scale}
                        stageRef={stageRef}
                        onPick={act.pick}
                        onKeyMove={onKeyMove ? act.keyMove : undefined}
                        onDrag={onMove ? act.drag : undefined}
                        onMenu={act.menu}
                        onPrime={act.prime}
                        onHover={act.hover}
                        onMarks={onKeyMove ? act.marks : undefined}
                      />
                    ) : null,
                  ),
                )}
              </div>

              <Switch
                polygons={[core.lamp.shade.hit, core.lamp.pole.hit]}
                scale={scale}
                className="room-table-lamp"
                label={lamp ? 'Lamp on. Turn it off' : 'Lamp off. Turn it on'}
                pressed={lamp}
                onPointerEnter={primeLamp}
                onPointerDown={primeLamp}
                onFocus={() => {
                  primeLamp();
                  warm('focus', true);
                }}
                onBlur={() => warm('focus', false)}
                onClick={() => onToggleLamp?.()}
              />
              <Switch
                polygons={[core.pocket.hit]}
                scale={scale}
                className="room-table-pocket"
                label="New note"
                onPointerEnter={() => warmRoomFor('pocket', true)}
                onPointerLeave={() => warmRoomFor('pocket', false)}
                onFocus={() => warmRoomFor('pocket', true)}
                onBlur={() => warmRoomFor('pocket', false)}
                onClick={() => onNewNote?.()}
              />

              {glideGroup(glides.filter((g) => !g.over))}
              {candleGlides.map((g) => (
                <CandleGlide key={g.key} glide={g} core={core} scale={scale} flameOf={flames} onLanded={onCandleLanded} exactState={isNightState(room) ? stateFor({ night: true, candle: g.to, lamp }) : room} />
              ))}
              {/* The thing in the hand above any book settling under it. */}
              {drag?.candle && <CandleGhost ghostRef={ghostRef} core={core} state={drag.from} place={drag.place} scale={scale} />}
              {drag && !drag.candle && byId.has(drag.id) && (
                <BookGhost
                  ghostRef={ghostRef}
                  core={core}
                  course={byId.get(drag.id)}
                  slot={drag.slot}
                  state={drag.from}
                  scale={scale}
                  words={words.get(drag.id) || wordsOf(core, byId.get(drag.id), drag.slot, scale)}
                  lifted={!drag.pulling}
                  z={drag.pulling ? 1 : 3}
                />
              )}
              {/* ... but a book that lay on the lifted one settles over it (fix run 2). */}
              {/* (Their own layer between a pulled book, under them, and a book in the hand, over them.) */}
              <div className="room-table-over">{glideGroup(glides.filter((g) => g.over))}</div>
              {/* The marks: every place the taken thing can go, above the thing itself (owner fixes, C). */}
              {marks && marks.targets.length > 0 && <TableMarks targetRef={targetRef} targets={marks.targets} on={marksLive} stage={core.stage} scale={scale} />}

              <Pages notes={notes} colorOf={colorOf} stamp={stamp} onOpen={onOpenNote} page={page} scale={scale} capacity={capacity} greeting={greeting} status={status} clock={clock} quads={pageQuads} size={pageSize} />
            </div>

            <StageCandle
              lit={lit}
              onToggle={onToggleCandle}
              still={still || bare}
              scale={scale}
              points={candleP}
              box={core.candles[shownCandle].box}
              stillFlame={stillFlameRec ? <Pic rec={stillFlameRec} scale={scale} className="room-stage-flame-still" /> : null}
              onDrag={onMoveCandle && candleTargets ? startCandleDrag : undefined}
              onMenu={onMoveCandle && candleTargets ? openCandleMenu : undefined}
              onPrime={primeCandle}
              onFocus={() => {
                primeCandle();
                warm('candle-focus', true);
              }}
              onBlur={() => warm('candle-focus', false)}
            />
          </div>
          {menu && (menu.id === 'candle' || byId.has(menu.id)) && <StageMenu menu={menu} items={itemsOf(menu)} onClose={closeMenu} />}
        </div>
      </StageSnap.Provider>
    </Density.Provider>
  );
};

export default TableStage;
