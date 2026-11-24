import { startTransition } from 'react';
import {
  BOARD_OPEN,
  FILM_BEATS,
  FLIP_HOLD_FRAMES,
  HELD_EASE,
  HELD_SETTLE,
  HELD_WAIT_MS,
  closeMs,
  coursePath,
  filmMs,
  getFilm,
  heldMs,
  homePathOf,
  modelSize,
  openPose,
  pageRect,
  posePath,
  poseMatrix,
  setFilm,
  setNoteKeep,
  setPreview,
  sheetFrom,
} from './deskFilm';

// "Opening a book" (round eight, track M): the film itself, in the room's flight layer
// (DeskFlightLayer, hosted by RoomLayout, so it outlives the page it leaves). deskFilm.js has the
// maths and the state; this builds the book (a box of a few flat faces, drawn through the render's
// own camera), and plays ONE timeline of Web Animations on transform and opacity only — compositor
// work, so a busy main thread (the course page mounting under the film) does not stop it.
//
//   open:  0 -> 1   the book leaves its place and comes to you, its board swings open, its page
//                   grows to the window and darkens to the room's ground; at FLIP (it covers the
//                   window) the course page, mounted under the desk since the first frame, is swapped
//                   in under it (the desk kept, hidden: RoomLayout); then the sheet fades.
//   close: 1 -> 0   the same film backwards, CLOSE_SHARE of the time: the sheet comes over the course
//                   page, the desk is swapped back under it at FLIP, the page shrinks into the book,
//                   the board shuts, the book goes home and the real one shows again.
// Escape, a click elsewhere or Back while it opens turns it round from where it is (and a click on
// the book while it closes opens it again): it bends, never cuts, never queues. If the course page is
// not there yet at FLIP (its code still loading), the open page holds until it is.
// Still and reduced motion: no film (RoomDesk opens the course at once, as before).

// The sheet's opacity, all but whole: an opaque layer the size of the window hides what is under it
// from the GPU too, so the course page's photograph was first drawn (and uploaded) only as the sheet
// began to fade, a 250-380 ms stall mid-fade on a cold cache; at 99.6% it is drawn during the hold.
const SHEET = 0.996;
// The film's curves: each beat leaves at once and lands gently, none overshoots (run 2: a 200 ms film
// with ease-in beats read as a snap at the end).
const EASE_OUT = 'cubic-bezier(0.2, 0.7, 0.25, 1)';
const EASE_GROW = 'cubic-bezier(0.3, 0.25, 0.2, 1)';
const PAGE_EDGES = new URL('./assets/desk/book-pages-h.webp', import.meta.url).href;
const PAGE_EDGES_V = new URL('./assets/desk/book-pages-v.webp', import.meta.url).href;

let run = null;
let go = null;
// The harness's trace of what the film did (globalThis.__deskFilmLog, an array it makes; nothing otherwise).
// (A quiet run has no animations: its progress is not read. Owner fixes: reading it threw, and only with the log on.)
const note = (what) => globalThis.__deskFilmLog?.push?.(`${Math.round(performance.now())} ${what} p=${run?.anims?.length ? progressOf(run).toFixed(2) : '-'} rate=${run ? run.rate : '-'}`);

// RoomLayout's navigate (the film navigates when it turns round).
export const setFilmNavigate = (navigate) => {
  go = navigate;
};
// Back to the desk's address, in the same transition lane as the push to the course page: an urgent
// back() was overtaken by the push's pending transition, and the page ended on the course after all.
const back = () => startTransition(() => go(-1));

// The course page's own room (its photograph, rain, lights: RoomLayout's atmosphere, not drawn under the
// stage) shown at 0.4% above the desk while a book is pressed or opening, and once in idle time after the
// desk has settled: so its layers are drawn and its photograph on the GPU before the film swaps the pages
// (run 1: the first open after a load stalled 264-362 ms at the swap, that work done there). desk.css
// html[data-room-warm].
const warmers = new Set();
const warmRoom = (who, on) => {
  if (typeof document === 'undefined') return;
  if (on) warmers.add(who);
  else warmers.delete(who);
  document.documentElement.toggleAttribute('data-room-warm', warmers.size > 0);
};
let warmedOnce = false;
// Run 3 M4: the table's small notebook warms the room the same way while the pointer is on it (its note page shows the
// room's photograph: drawn cold, the first note after a load waited on a 271 ms GPU frame).
export const warmRoomFor = (who, on) => warmRoom(who, on);
export const warmRoomOnce = () => {
  if (warmedOnce || filmQuiet()) return;
  warmedOnce = true;
  warmRoom('idle', true);
  setTimeout(() => warmRoom('idle', false), 900);
};

// Owner fixes 3 (2026-11-23): the book opened last, remembered by this browser (beside the design's and the mood's
// own keys). Only a hint for the desk's idle time after a load: whose close-up to have ready. Nothing depends on it.
const LAST_BOOK_KEY = 'companion:desk-last-book';
let lastBook = null;
export const lastOpenedBook = () => {
  if (lastBook == null) {
    try {
      lastBook = window.localStorage.getItem(LAST_BOOK_KEY) || '';
    } catch {
      lastBook = '';
    }
  }
  return lastBook;
};
const rememberBook = (courseId) => {
  const id = String(courseId || '');
  if (!id || id === lastBook) return;
  lastBook = id;
  try {
    window.localStorage.setItem(LAST_BOOK_KEY, id);
  } catch {
    // Private windows: the hint lasts the visit.
  }
};

// The kept desk woken under the course page before the way back needs it (desk.css html[data-desk-waking]:
// its stage drawn again, at 0.4%): from a press on the Back pill, or from the close's start.
let wokeAt = 0;
const wakeDesk = (on) => {
  if (typeof document === 'undefined') return;
  if (!on) wokeAt = 0;
  else if (!document.documentElement.hasAttribute('data-desk-waking')) wokeAt = performance.now();
  document.documentElement.toggleAttribute('data-desk-waking', on);
};
let unarmWake = null;
let wakeTimer = 0;
// Fix run 2: only while the book itself is the page (RoomLayout says): a note's Back pill goes to the book, not home,
// and woke the desk over the book for good.
let wakeAllowed = true;
export const setWakeAllowed = (on) => {
  wakeAllowed = on;
  if (!on) wakeDesk(false);
};
const armWake = () => {
  unarmWake?.();
  // A press on Back, or Enter / Space on it (the keys press a button on keydown's way to its click).
  const press = (event) => {
    if (!wakeAllowed) return;
    if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
    if (event.target instanceof Element && event.target.closest('.room-back')) {
      wakeDesk(true);
      // Owner fixes (A2): a press on Back that no way home follows (let go off the pill) leaves nothing drawn over the
      // page: the desk sleeps again unless a close has begun by then. (Woken, it is inert: RoomLayout.)
      clearTimeout(wakeTimer);
      wakeTimer = setTimeout(() => {
        if (!run && getFilm()?.phase === 'shown') wakeDesk(false);
      }, event.type === 'pointerover' ? 2500 : 900);
    }
  };
  // (Owner fixes, E: the pointer coming onto Back wakes it too: its first drawing, 100 ms and more, is then done before
  // the click, and the way back shows the desk from its first frames.)
  window.addEventListener('pointerdown', press, true);
  window.addEventListener('pointerover', press, true);
  window.addEventListener('keydown', press, true);
  unarmWake = () => {
    window.removeEventListener('pointerdown', press, true);
    window.removeEventListener('pointerover', press, true);
    window.removeEventListener('keydown', press, true);
    clearTimeout(wakeTimer);
    unarmWake = null;
  };
};

// The course pages on the page now (RoomCourse tells), so a film whose page was mounted by the press
// does not wait for it.
const mountedCourses = new Set();
// Fix run: the course pages (the held book) drawn under the desk with their pictures decoded, their words laid out
// in their own faces and three frames gone since (CourseBook tells): the held film's swap waits for this.
const paintedCourses = new Set();
export const filmRunning = () => Boolean(run);

export const filmQuiet = () =>
  typeof document === 'undefined' ||
  document.documentElement.getAttribute('data-motion') === 'still' ||
  Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

// A grain for the leather (no picture file: a few hundred specks drawn once, as a blob).
let grain = '';
export const prepareGrain = () => {
  if (grain || typeof document === 'undefined') return;
  grain = 'pending';
  const size = 96;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  if (!g) return;
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < 900; i += 1) {
    const dark = rnd() < 0.7;
    g.fillStyle = dark ? `rgba(0, 0, 0, ${0.05 + rnd() * 0.16})` : `rgba(255, 236, 210, ${0.03 + rnd() * 0.06})`;
    g.beginPath();
    g.ellipse(rnd() * size, rnd() * size, 0.6 + rnd() * 1.6, 0.5 + rnd() * 1.1, rnd() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }
  canvas.toBlob?.((blob) => {
    grain = blob ? URL.createObjectURL(blob) : '';
  });
};

const el = (tag, className, style) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (style) Object.assign(node.style, style);
  return node;
};

// Gilt words: the place's own gilt strip through the letters (as the stage letters its spines),
// over its solid gold where the strip has not come.
const gilt = (text, look, size, extra = {}) => {
  const span = el('span', 'room-film-gilt', {
    fontSize: `${size}px`,
    backgroundColor: look.gilt,
    backgroundImage: look.strip ? `url("${look.strip}")` : 'none',
    ...extra,
  });
  span.textContent = text;
  return span;
};

// The book: board (outside: the leather, its fillet and its label; inside: the endpaper), the first
// page, the page block's three edges and the spine, every face flat, in the model's px.
const buildBook = (look, size) => {
  const { w, h, t } = size;
  const leather = (node) => {
    node.style.backgroundColor = look.cover;
    if (grain && grain !== 'pending') node.style.backgroundImage = `url("${grain}")`;
    return node;
  };
  const book = el('div', 'room-film-book', { width: `${w}px`, height: `${h}px` });
  const page = el('div', 'room-film-face room-film-page', { width: `${w - 5}px`, height: `${h - 6}px`, left: '2px', top: '3px', backgroundColor: look.paper, transform: 'translateZ(-1.5px)' });
  const edge = (className, style) => el('div', `room-film-face room-film-edge ${className}`, { backgroundColor: look.paper, ...style });
  const fore = edge('is-fore', { left: `${w - 3}px`, top: '3px', width: `${t - 3}px`, height: `${h - 6}px`, transformOrigin: '0 50%', transform: 'rotateY(90deg)', backgroundImage: `url("${PAGE_EDGES_V}")` });
  const head = edge('is-head', { left: '2px', top: `${3 - (t - 3)}px`, width: `${w - 5}px`, height: `${t - 3}px`, transformOrigin: '50% 100%', transform: 'rotateX(90deg)', backgroundImage: `url("${PAGE_EDGES}")` });
  const tail = edge('is-tail', { left: '2px', top: `${h - 3}px`, width: `${w - 5}px`, height: `${t - 3}px`, transformOrigin: '50% 0', transform: 'rotateX(-90deg)', backgroundImage: `url("${PAGE_EDGES}")` });
  // The spine: along x 0, from the board (z 0) back to z -T; its title along it, read lying down.
  const spine = leather(el('div', 'room-film-face room-film-spine', { left: `${-t}px`, top: '0px', width: `${t}px`, height: `${h}px`, transformOrigin: '100% 50%', transform: 'rotateY(-90deg)' }));
  const spineLabel = el('div', 'room-film-spine-label', { width: `${h * 0.5}px`, height: `${t * 0.62}px`, backgroundColor: look.label });
  spineLabel.append(gilt(look.title, look, Math.round(t * 0.34)));
  spine.append(spineLabel);
  [0.06, 0.2, 0.8, 0.94].forEach((at) => spine.append(el('span', 'room-film-band', { top: `${at * 100}%`, backgroundColor: look.gilt })));
  // The board, hinged on the spine.
  const board = el('div', 'room-film-board', { width: `${w}px`, height: `${h}px` });
  const out = leather(el('div', 'room-film-face room-film-board-out'));
  out.append(el('span', 'room-film-fillet', { borderColor: look.gilt }));
  const label = el('div', 'room-film-cover-label', { backgroundColor: look.label, borderColor: look.gilt });
  (look.lines?.length ? look.lines : [look.title]).forEach((line) => label.append(gilt(line, look, Math.round(w * 0.072), { display: 'block' })));
  out.append(label);
  // Inside the board: the leather turned in at its edges, the pasted-down endpaper.
  const inside = leather(el('div', 'room-film-face room-film-board-in'));
  inside.append(el('span', 'room-film-pastedown', { backgroundColor: look.inside }));
  board.append(out, inside);
  // The first page: the course's title, as a title page, in the page's ink.
  const titlePage = el('div', 'room-film-title-page', { color: look.ink });
  const heading = el('span', 'room-film-title-words', { fontSize: `${Math.round(w * 0.075)}px` });
  heading.textContent = look.title;
  titlePage.append(heading, el('span', 'room-film-title-rule', { backgroundColor: look.ink }));
  page.append(titlePage);
  book.append(page, fore, head, tail, spine, board);
  return { book, board, out, titlePage };
};

// The room's own pictures for the course page (the Candlelight scene, room.css): fetched and decoded
// while the desk is idle, so the page the film turns into has its picture at once (on the desk the
// room's atmosphere is not drawn, and a CSS picture is not fetched until it is).
const ROOM_PICTURES = [new URL('./assets/candlelight.webp', import.meta.url).href, new URL('./assets/candlelight-2x.webp', import.meta.url).href];
let roomPictures = null;
export const prepareRoomPictures = () => {
  if (roomPictures || typeof Image === 'undefined') return;
  // (Owner fixes 3: only where the room shows that photograph: the candlelight scene. It was read in every mood.)
  if (typeof document !== 'undefined' && !document.querySelector('.room-cl-stage')) return;
  const dense = (window.devicePixelRatio || 1) > 1;
  const src = dense ? ROOM_PICTURES[1] : ROOM_PICTURES[0];
  const img = new Image();
  img.decoding = 'async';
  img.src = src;
  roomPictures = [img];
  // (Round eight tried drawing it once at 0.4% as well, to have it on the GPU before the first film:
  // the first open after a load still stalled at the swap, and once far longer: left out.)
  img.decode?.().catch(() => null);
};

// Run 3: the held book's picture, decoded and drawn once at 0.4% for a moment in idle time (and again by
// every press: the prepared film draws it), so the first opening finds it on the GPU.
// Run 3 M4: `surround` ({ src, box }) is drawn with it, and the same picture may be warmed again once its last
// warming is over (the production table warms a book's held picture while the pointer rests on the book: the
// compositor's own decode at the drawn scale is what a cold first open waited on, 117 ms + a 54 ms raster).
let heldWarm = '';
// Owner fixes 3 (2026-11-23): in Still and reduced motion too (it left there). Nothing of it can be seen or moves, and
// without it the first open of a visit waited on the compositor's own decode of the two pictures (traced: 62 ms and
// 186 ms on its workers, an 80 ms frame 0.23 s after the click: Still's first open 483-500 ms). That wait had been
// hidden until now by the backdrop's rain, which kept the page drawing at rest (Atmosphere useWindowRain).
export const prepareHeld = (src, fit, surround = null) => {
  if (!src || heldWarm === src || typeof document === 'undefined') return;
  const host = document.querySelector('[data-desk-flight]');
  if (!host) return;
  heldWarm = src;
  const picture = (url, left, top, width, height) => {
    const img = el('img', 'room-film-sheet is-held is-warming', { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px`, opacity: '0.004' });
    img.alt = '';
    img.decoding = 'async';
    img.src = url;
    return img;
  };
  const imgs = [picture(src, fit.left, fit.top, fit.width, fit.height)];
  if (surround) imgs.unshift(picture(surround.src, fit.left + surround.box[0] * fit.scale, fit.top + surround.box[1] * fit.scale, surround.box[2] * fit.scale, surround.box[3] * fit.scale));
  const root = el('div', 'room-film is-warming', { opacity: '1' });
  root.append(...imgs);
  Promise.all(imgs.map((img) => (img.decode?.() || Promise.resolve()).catch(() => null))).then(() => {
    // (Not while a book is on its way: its upload would hold the film's frames.)
    if (run) {
      if (heldWarm === src) heldWarm = '';
      return;
    }
    host.append(root);
    setTimeout(() => {
      root.remove();
      if (heldWarm === src) heldWarm = '';
    }, 900);
  });
};

// The film's root in the flight layer (made once, kept: see make).
const filmRoot = (host) => {
  let root = host.querySelector(':scope > .room-film:not(.is-warming)');
  if (!root) {
    root = el('div', 'room-film');
    host.append(root);
  }
  return root;
};

// The first film after a load drew its first frame slowly (its 3D faces' first raster and the GPU's
// first perspective draws): one book is drawn once, all but unseen, in idle time on the desk.
let warmed = false;
// Fix run: `real` (a book's own look: its leather, label, gilt strip and title) is drawn instead of a stand-in, so the
// strip, the grain and the lettering are rastered in idle time too (the first press after a load spent a 58 ms GPU
// task on them, the film's first frames waiting).
export const warmFilm = (real = null) => {
  if (warmed || typeof document === 'undefined') return;
  const host = document.querySelector('[data-desk-flight]');
  if (!host) return;
  warmed = true;
  filmRoot(host);
  const stand = { cover: '#5a2e22', label: '#1d1712', gilt: '#c9a45c', title: 'A', lines: ['A'], paper: '#8f5d2c', inside: '#6d4626', ink: '#2b1708', ground: '#29221b', strip: '' };
  const look = real ? { ...stand, ...real, held: undefined } : stand;
  const size = modelSize();
  const { book, board } = buildBook(look, size);
  // Drawn at 0.4% (under half a level), for two frames, in the window's middle.
  const root = el('div', 'room-film is-warming', { perspective: '800px', perspectiveOrigin: '50% 50%', opacity: '0.004' });
  book.style.transform = `translate3d(${Math.round(window.innerWidth / 2 - size.w / 2)}px, ${Math.round(window.innerHeight / 2 - size.h / 2)}px, 0) rotateX(30deg) rotateY(-20deg)`;
  board.style.transform = `rotateY(${BOARD_OPEN / 2}deg)`;
  root.append(book);
  host.append(root);
  setTimeout(() => root.remove(), 600);
};

// One run of the film. `describe()` gives the geometry NOW (the desk is mounted: kept while its course
// is open), so a window resized meanwhile closes onto the right place.
const make = ({ courseId, describe, look, ms, hideBook, focusBook }) => {
  const host = document.querySelector('[data-desk-flight]');
  const geo = describe();
  if (!host || !geo) return null;
  const { cam, from, near, view, t } = geo;
  const size = modelSize(t);
  // (A course shown as the held book has its own film: makeHeld.)
  const beats = near ? FILM_BEATS.near : FILM_BEATS.pile;
  const open = openPose(cam, view, t);
  const D = ms;

  // One root for every film, kept in the flight layer between films: a new root (a new 3D context the
  // size of the window) made the GPU redraw the whole stage under it at the film's first frame (47 ms on
  // the Intel UHD); now only the book's own faces are new.
  const root = filmRoot(host);
  Object.assign(root.style, { perspective: `${cam.f.toFixed(2)}px`, perspectiveOrigin: `${cam.ox.toFixed(2)}px ${cam.oy.toFixed(2)}px` });
  root.classList.remove('is-closing');
  root.classList.add('is-playing');
  const { book, board, out, titlePage } = buildBook(look, size);
  const sheet = el('div', 'room-film-sheet', { width: `${view.width}px`, height: `${view.height}px` });
  const paper = el('div', 'room-film-sheet-paper', { backgroundColor: look.paper });
  const ground = el('div', 'room-film-sheet-ground', { backgroundColor: look.ground });
  sheet.append(paper, ground);
  root.append(book, sheet);

  // The book's way: still at its place until its beat, then the path (sampled: true slerp and a lift
  // out of the pile), then still, open; at FLIP it goes (the sheet covers it).
  const [p0, p1] = beats.pose;
  const path = posePath(from, open.pose, 12, undefined, near ? 0 : view.height * 0.04);
  const frames = [{ offset: 0, transform: poseMatrix(cam, from) }];
  path.forEach((pose, i) => frames.push({ offset: p0 + ((p1 - p0) * i) / (path.length - 1), transform: poseMatrix(cam, pose) }));
  frames.push({ offset: beats.flip, transform: poseMatrix(cam, open.pose) });
  frames.push({ offset: beats.flip, transform: 'matrix3d(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1)' });
  frames.push({ offset: 1, transform: 'matrix3d(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1)' });
  const timing = { duration: D, fill: 'both', easing: 'linear' };
  const anims = [book.animate(dedupe(frames), timing)];
  const [b0, b1] = beats.board;
  anims.push(
    board.animate(
      [
        { offset: 0, transform: 'rotateY(0deg)' },
        { offset: b0, transform: 'rotateY(0deg)', easing: EASE_OUT },
        { offset: b1, transform: `rotateY(${BOARD_OPEN}deg)` },
        { offset: 1, transform: `rotateY(${BOARD_OPEN}deg)` },
      ],
      timing,
    ),
  );
  // On a pile the book above hides its board: it shows as the book leaves (the film draws no book
  // above it). The title page's words go just before the page grows (the sheet has none).
  if (!near) anims.push(out.animate([{ offset: 0, opacity: 0 }, { offset: 0.1, opacity: 1 }, { offset: 1, opacity: 1 }], timing));
  const [s0w] = beats.sheet;
  anims.push(titlePage.animate([{ offset: 0, opacity: 1 }, { offset: Math.max(0, s0w - 0.07), opacity: 1 }, { offset: s0w, opacity: 0 }, { offset: 1, opacity: 0 }], timing));
  // The page, flat over the open book's page, grows to the window (accelerating, as you go into it),
  // darkening to the room's ground. Run 2: in the timeline it then STAYS over the window; it fades (the
  // course page is there) only once the swap has been made and drawn (revealFade), so a frame the
  // compositor draws ahead of the page's clock can never show what lies under it before the swap.
  const [s0, s1] = beats.sheet;
  const rect = pageRect(cam, open.pose, size);
  const startSheet = sheetFrom(rect, view);
  anims.push(
    sheet.animate(
      [
        { offset: 0, transform: startSheet, opacity: 0 },
        { offset: s0, transform: startSheet, opacity: 0 },
        { offset: s0, transform: startSheet, opacity: SHEET, easing: EASE_GROW },
        { offset: s1, transform: 'translate(0px, 0px) scale(1, 1)', opacity: SHEET },
        { offset: 1, transform: 'translate(0px, 0px) scale(1, 1)', opacity: SHEET },
      ],
      timing,
    ),
  );
  anims.push(
    ground.animate(
      [
        { offset: 0, opacity: 0 },
        { offset: s0, opacity: 0, easing: EASE_GROW },
        { offset: s1, opacity: 1 },
        { offset: 1, opacity: 1 },
      ],
      timing,
    ),
  );
  anims.forEach((a) => a.pause());
  // The fade after the swap: what is left of the film once the sheet is whole, less the frame the swap
  // is held for (so the whole still takes about D).
  return { root, book, sheet, anims, D, flip: beats.flip, full: s1, fadeMs: Math.max(40, (1 - s1) * D - 1000 / 60), fade: null, courseId, describe, look, hideBook, focusBook };
};

// Two keyframes at one offset are a jump; three or more there keep only the first and the last.
const dedupe = (frames) => frames.filter((f, i) => !(i > 0 && i < frames.length - 1 && frames[i - 1].offset === f.offset && frames[i + 1].offset === f.offset));

const progressOf = (r) => Math.max(0, Math.min(1, (Number(r.anims[0].currentTime) || 0) / r.D));

const setRate = (r, rate) => r.anims.forEach((a) => a.updatePlaybackRate?.(rate) ?? (a.playbackRate = rate));

const end = (r) => {
  if (run === r) run = null;
  cancelAnimationFrame(r.raf);
  r.raf = 0;
  r.unlisten?.();
  r.unlisten = null;
  letGo(r);
  r.fade?.cancel();
  r.fade = null;
  r.root.replaceChildren();
  r.root.classList.remove('is-playing', 'is-closing', 'is-ready');
};
// A film's animations cancelled, and what it had laid on the page and the desk taken off again.
const letGo = (r) => {
  r.anims.forEach((a) => a.cancel());
  if (r.page) {
    r.page.classList.remove('is-filming');
    r.page = null;
  }
};

/* ── The held book (round eight, run 3; a plain dissolve since the owner's second look, 2026-11-23) ──
   With the production table the course IS the held book (CourseBook): its picture shows the book open on its rest.
   Opening it is a DISSOLVE, nothing else (the owner found the book rising, turning and opening while the desk slid
   "kinda motion sickening"; all of that is gone, not kept behind a flag):
     Calm    the page (the close-up: the held view and the open book, its words on it) comes in over the desk on its
             own opacity, even, in HELD_MS; the desk does not move; the open book settles into its place by a few
             pixels and a percent and a half of size, eased out. Closing: the same, backwards, the same length.
     Still   the same dissolve in HELD_STILL_MS, nothing moving at all.
     The system's reduced motion (quiet): one frame swaps the pages each way, as before.
   What the film waits for, with the desk standing as it is: the page drawn WHOLE under the desk (CourseBook
   filmPagePainted: its code, the course's data, its faces, its pictures decoded, three frames since). It never shows
   a page that is not whole: the old escape (2.5 s, then the page as it was) put the room's own backdrop and then a
   book without its picture at the book's address whenever the data, the chunk or the machine was slow (the owner's
   "opens somehow a note of this address and disappears"); the wait is HELD_WAIT_MS now, a page that truly cannot come.
   At the dissolve's end ONE frame makes the page the page (swapIn: no picture changes, only the top line, the
   address and whose input it is). */
// Frames between a change and the frame that may rely on it having been drawn (a commit waits for the last
// tree's raster to be done, so the third frame's commit comes after the first's raster).
const PAINT_FRAMES = 3;
const afterFrames = (n, fn) => {
  const step = (k) => requestAnimationFrame(() => (k <= 1 ? fn() : step(k - 1)));
  step(n);
};
const htmlEl = () => document.documentElement;
const reducedNow = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
const stillNow = () => typeof document !== 'undefined' && document.documentElement.getAttribute('data-motion') === 'still';
const SETTLE_CURVE = `cubic-bezier(${HELD_EASE.join(', ')})`;

const paintedListeners = new Set();
export const subscribePainted = (fn) => {
  paintedListeners.add(fn);
  return () => paintedListeners.delete(fn);
};
export const filmPagePainted = (courseId) => {
  paintedCourses.add(String(courseId));
  [run, ready?.r].forEach((r) => {
    if (!r?.held || r.courseId !== String(courseId)) return;
    r.painted = true;
    joinPage(r);
  });
  paintedListeners.forEach((fn) => fn(String(courseId)));
};

const makeHeld = ({ courseId, describe, look, hideBook, focusBook }) => {
  const host = document.querySelector('[data-desk-flight]');
  if (!host || !look?.held?.()) return null;
  const still = stillNow();
  return { held: true, quiet: reducedNow(), still, courseId: String(courseId), describe, look, hideBook, focusBook, D: heldMs(globalThis.__deskFilmMs, still), rate: 1, anims: [], painted: false, root: filmRoot(host), page: null };
};

// The page takes its part: its own opacity (the whole close-up as one layer: nothing shows through anything but the
// desk under it), and in Calm the open book's small settle. Paused at the start (the page as it lies under the desk).
const attachPage = (r) => {
  if (!r || r.quiet || r.page) return false;
  const el = document.querySelector(`.room-page-slot .room-book[data-course="${CSS.escape(r.courseId)}"]`);
  const object = el?.querySelector('.room-book-object');
  if (!el || typeof el.animate !== 'function') return false;
  const made = [el.animate([{ opacity: 0.004 }, { opacity: 1 }], { duration: r.D, fill: 'both', easing: 'linear' })];
  if (!r.still && object) {
    made.push(object.animate([{ transform: `translateY(${HELD_SETTLE.lift}px) scale(${HELD_SETTLE.scale})` }, { transform: 'translateY(0px) scale(1)' }], { duration: r.D, fill: 'both', easing: SETTLE_CURVE }));
  }
  made.forEach((a) => a.pause());
  r.anims = made;
  r.page = el;
  el.classList.add('is-filming');
  note('attached');
  return true;
};
// Its page drawn after the click: it joins, and the dissolve begins.
const joinPage = (r) => {
  if (r.page || !attachPage(r)) return;
  if (run === r && r.playing) {
    setRate(r, r.rate);
    r.anims.forEach((a) => a.play());
  }
};
// Its page gone from the page: its part taken out.
const detachPage = (r) => {
  if (!r?.page) return;
  r.anims.forEach((a) => a.cancel());
  r.anims = [];
  r.page.classList.remove('is-filming');
  r.page = null;
};

// The held film's watch: the page joining, the dissolve's end (swapIn), the way back's end (closedHeld).
const watchHeld = (r) => {
  const tick = () => {
    r.raf = 0;
    if (run !== r) return;
    const now = performance.now();
    if (r.rate > 0 && !r.closing) {
      r.askedAt = r.askedAt || now;
      // (A page that cannot come: its code or its picture unreadable. The desk has stood long enough.)
      const late = now - r.askedAt > HELD_WAIT_MS;
      if (r.quiet) {
        if (r.painted || late) {
          swapIn(r);
          return;
        }
      } else {
        if (!r.page && (r.painted || late)) joinPage(r);
        if (r.page ? progressOf(r) >= 1 - 1e-4 : late) {
          swapIn(r);
          return;
        }
      }
    } else if (r.rate < 0 && !r.closing) {
      if (!r.anims.length || (progressOf(r) <= 1e-4 && r.anims[0].playState !== 'running')) {
        closedHeld(r);
        return;
      }
    }
    r.raf = requestAnimationFrame(tick);
  };
  if (!r.raf) r.raf = requestAnimationFrame(tick);
};

const playHeld = (r, forward) => {
  r.rate = forward ? 1 : -1;
  r.playing = true;
  if (forward) r.askedAt = 0;
  setRate(r, r.rate);
  r.anims.forEach((a) => a.play());
  watchHeld(r);
};

// Owner fixes (2026-11-23, A1-A3): the swap itself makes the book REAL: the film's state carries its course whether or
// not the film's own first steps have run, and the address is the book's in this same frame. (A page already drawn when
// the book was picked, still or reduced motion, swapped in the click's first frame, before those steps: the screen was
// the book, the address still the desk's, the book's "Desk" pill a way to where it already was, and the desk, woken by
// that press at 0.4% over the page, took the presses meant for the book.) The page's slot is made live and the desk's
// inert in this frame too (RoomLayout's own render says the same a task later).
const swapIn = (r) => {
  note(`swap-in painted=${r.painted}`);
  const root = htmlEl();
  root.setAttribute('data-film-swap', '');
  root.setAttribute('data-desk-book', r.look?.light === 'day' ? 'day' : 'night');
  root.removeAttribute('data-desk-stage');
  document.querySelector('.room-page-slot[data-under]')?.removeAttribute('inert');
  document.querySelector('.room-home-slot')?.setAttribute('inert', '');
  const state = r.stateOf?.() || {};
  r.statePending = false;
  r.push?.();
  end(r);
  warmRoom('film', false);
  rememberBook(r.courseId);
  // (Owner fixes 3: the room's photograph is no longer read after every load of the desk, where nothing shows it. A
  // note opened from this book does: it is read now, once the book is up, in idle time.)
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(() => prepareRoomPictures(), { timeout: 2500 });
  else setTimeout(prepareRoomPictures, 1200);
  setTimeout(() => {
    setFilm({ ...state, phase: 'shown', cover: 'course' });
    setPreview(null);
    armWake();
    afterFrames(1, () => root.removeAttribute('data-film-swap'));
  }, 0);
};

// The way back is over (the page unseen under the desk again): the film ends, React learns the desk is Home's page.
const closedHeld = (r) => {
  note('home');
  end(r);
  warmRoom('film', false);
  wakeDesk(false);
  unarmWake?.();
  setFilm(null);
  setPreview(null);
  // (Once the desk is in reach again: it is inert until the film's state has gone.)
  setTimeout(() => r.focusBook?.(), 0);
};

// Closing, the swap: the desk (drawn again at 0.4% over the page since the pointer came to Back, or for PAINT_FRAMES)
// is put whole UNDER the page, which still covers it: no picture changes in this frame but the top line, the desk's
// own again. Then the page goes, on its opacity. All of it on the page directly: React learns of it when the way back
// is over (closedHeld), so no render of the room falls in the dissolve (its commit was a 100 ms frame mid-close).
// Meanwhile the film's state still says "the course over the kept desk, closing": RoomLayout keeps the page mounted
// and both slots inert, and writes none of these attributes again.
const swapOut = (r) => {
  note('swap-out');
  const root = htmlEl();
  r.closing = false;
  if (r.quiet) {
    root.setAttribute('data-desk-back', '');
    root.setAttribute('data-desk-stage', '');
    root.removeAttribute('data-desk-book');
    end(r);
    setTimeout(() => {
      setFilm(null);
      afterFrames(1, () => {
        root.removeAttribute('data-desk-back');
        wakeDesk(false);
      });
      setTimeout(() => r.focusBook?.(), 0);
    }, 0);
    return;
  }
  root.setAttribute('data-desk-stage', '');
  root.removeAttribute('data-desk-book');
  const slot = r.page?.closest('.room-page-slot');
  document.querySelector('.room-home-slot')?.removeAttribute('data-kept');
  slot?.setAttribute('data-under', '');
  slot?.setAttribute('inert', '');
  wakeDesk(false);
  playHeld(r, false);
};

// Fix run 2: back home from a note opened from the desk itself (kept under it, no film): the note page is held
// (RoomLayout, slotsFor `returning`) while the desk is drawn at 0.4% over it for PAINT_FRAMES, then ONE frame shows the
// desk whole (data-desk-back) and the note goes.
export const returnToKeptDesk = () => {
  if (typeof document === 'undefined') return;
  setNoteKeep({ phase: 'returning', atNote: true });
  wakeDesk(true);
  afterFrames(PAINT_FRAMES, () => {
    const root = htmlEl();
    root.setAttribute('data-desk-back', '');
    root.setAttribute('data-desk-stage', '');
    setTimeout(() => {
      setNoteKeep(null);
      afterFrames(1, () => {
        root.removeAttribute('data-desk-back');
        wakeDesk(false);
      });
    }, 0);
  });
};
// A note opened from the desk: the desk's page-wide rules off in the frame the note shows (it is kept, unseen).
export const leaveDeskForNote = () => {
  if (typeof document !== 'undefined') htmlEl().removeAttribute('data-desk-stage');
};

// The address went home while the held book was shown (the pill, Escape, the browser's Back): the page is ready to go
// (its dissolve pinned at its end), the desk is drawn again unseen, then swapOut.
const closeHeld = (state) => {
  const r = makeHeld({ courseId: state.courseId, describe: state.describe, look: state.look, hideBook: state.hideBook, focusBook: state.focusBook });
  if (!r) return false;
  run = r;
  r.pushedCourse = false;
  r.leftCourse = true;
  r.closing = true;
  r.rate = -1;
  // (The desk has been woken by the pointer coming to Back, three frames or more ago: drawn already.)
  const drawn = wokeAt > 0 && performance.now() - wokeAt > 55;
  if (!r.quiet) {
    r.painted = true;
    if (attachPage(r)) {
      pin(r, r.D);
      r.root.classList.add('is-playing', 'is-closing');
      listen(r);
    } else r.quiet = true;
  }
  unarmWake?.();
  setFilm({ phase: 'closing' });
  wakeDesk(true);
  afterFrames(drawn ? 1 : PAINT_FRAMES, () => run === r && r.closing && swapOut(r));
  return true;
};

// Closing (or turned round), at FLIP: the desk comes back under the sheet, which holds still until the
// swap has been drawn (else, the main thread busy restyling the desk, the compositor shrank the sheet over
// the course page it was meant to have left).
const unflip = (r) => {
  r.flipped = false;
  note('unflip');
  // The sheet is whole over the window (its cover fade is done): the timeline takes it from here, the
  // book under it again from FLIP.
  r.fade?.cancel();
  r.fade = null;
  pin(r, r.flip * r.D);
  document.documentElement.setAttribute('data-desk-stage', '');
  wakeDesk(false);
  setFilm({ cover: 'desk' });
  // Turned round on the way in: the address goes back home with it.
  if (r.pushedCourse && go && getFilm()?.phase === 'opening') {
    r.pushedCourse = false;
    r.leftCourse = true;
    back();
  }
  holdAtFlip(r);
};

// The timeline paused at a time (ms).
const pin = (r, t) =>
  r.anims.forEach((a) => {
    a.pause();
    a.currentTime = t;
  });
// Where the sheet is whole over the window (from sheet[1] on): the time the compositor reached if it is
// there already (no step back), else the first such time.
const stillAt = (r) => Math.max(r.full * r.D, Number(r.anims[0].currentTime) || 0);
const holdAtFlip = (r) => {
  r.hold = FLIP_HOLD_FRAMES;
};
// The sheet's own fade (run 2): to 0 (the course page shown: opening) or to whole (closing), from where it
// is; opening takes the time FLIP-to-end took, closing that share of the close.
const fadeSheet = (r, to, from = Number(getComputedStyle(r.sheet).opacity)) => {
  r.fade?.cancel();
  const share = Math.abs(to - from) / SHEET;
  const ms = Math.max(1, r.fadeMs * share * (to > from ? closeMs(r.D) / r.D : 1));
  r.fade = r.sheet.animate([{ opacity: from }, { opacity: to }], { duration: ms, easing: EASE_OUT, fill: 'both' });
  // From this moment (no wait for the next frame to start it).
  r.fade.startTime = performance.now();
  return r.fade;
};
const fadeDone = (r) => !r.fade || r.fade.playState === 'finished';
// Its direction, the timeline left as it is (paused or not).
const setDirection = (r, forward) => {
  r.rate = forward ? 1 : -(r.D / closeMs(r.D));
  setRate(r, r.rate);
};

// The film's first frame (the click's own, or Back's): between half a frame and one frame of the film in,
// whatever the page's clock said at the click (run 2: document.timeline's time was the last frame's, up
// to 43 ms old on an idle desk, and a slow first frame skipped as much: 11-22% of a 200 ms film at once).
const FIRST_FRAME = 1000 / 60;
const firstFrame = (r) => {
  r.anchor = false;
  const forward = r.rate > 0;
  const k = Math.abs(r.rate);
  if (r.fade && !forward) {
    const t = Number(r.fade.currentTime) || 0;
    const want = Math.min(FIRST_FRAME, Math.max(FIRST_FRAME / 2, t));
    if (Math.abs(want - t) > 0.5) r.fade.currentTime = want;
    return;
  }
  r.anims.forEach((a) => {
    const t = Number(a.currentTime);
    const done = Number.isFinite(t) ? (forward ? t : r.D - t) : 0;
    const want = Math.min(FIRST_FRAME * k, Math.max((FIRST_FRAME / 2) * k, done));
    if (Math.abs(want - done) > 0.5) a.currentTime = forward ? want : r.D - want;
  });
};

// Watching the timeline (one rAF read a frame): FLIP in either direction, the hold, the ends.
const watch = (r) => {
  const tick = () => {
    r.raf = 0;
    if (run !== r) return;
    if (r.anchor) firstFrame(r);
    // Held at FLIP for a couple of frames: the pages were just swapped under the opaque sheet.
    // It goes on once a frame has come in time again (a swap's first raster or a picture's first upload
    // can stall the GPU for a while), at most ~20 frames.
    if (r.hold > 0) {
      const now = performance.now();
      const gap = r.heldAt ? now - r.heldAt : 0;
      r.heldAt = now;
      r.holdTicks = (r.holdTicks || 0) + 1;
      if (r.hold > 1) r.hold -= 1;
      else if (gap < 40 || r.holdTicks > 20) {
        r.hold = 0;
        r.heldAt = 0;
        r.holdTicks = 0;
        // Opening: the sheet fades, the course page is there. Closing: the book goes home.
        if (r.rate > 0) fadeSheet(r, 0);
        else r.anims.forEach((a) => a.play());
      }
      r.raf = requestAnimationFrame(tick);
      return;
    }
    const p = progressOf(r);
    const forward = r.rate > 0;
    // The swap, opening: once the sheet covers the window (sheet[1]); the timeline stops there (the book
    // gone from FLIP on) and the reveal waits for the swap to be drawn.
    if (forward && !r.flipped && p >= r.full - 1e-4) {
      if (!r.ready) {
        // The course page is not there yet: the open page holds.
        pin(r, stillAt(r));
        r.holding = true;
        return;
      }
      r.flipped = true;
      note('flip');
      pin(r, Math.max(stillAt(r), r.flip * r.D));
      document.documentElement.removeAttribute('data-desk-stage');
      warmRoom('film', false);
      setFilm({ cover: 'course' });
      holdAtFlip(r);
      r.raf = requestAnimationFrame(tick);
      return;
    }
    // Closing from the course page: once the sheet is whole over it again, the desk comes back under it.
    if (!forward && r.flipped && fadeDone(r)) {
      unflip(r);
      r.raf = requestAnimationFrame(tick);
      return;
    }
    const state = r.anims[0].playState;
    const opened = forward && r.flipped && r.fade && fadeDone(r);
    if (opened || (!forward && !r.flipped && p <= 0 && state !== 'running')) {
      note(forward ? 'end-open' : 'end-close');
      if (forward) {
        end(r);
        warmRoom('film', false);
        armWake();
        setFilm({ phase: 'shown', cover: 'course' });
      } else {
        r.hideBook?.(false);
        end(r);
        warmRoom('film', false);
        wakeDesk(false);
        unarmWake?.();
        setFilm(null);
        r.focusBook?.();
      }
      return;
    }
    r.raf = requestAnimationFrame(tick);
  };
  r.raf = requestAnimationFrame(tick);
};

const play = (r, forward) => {
  r.hold = 0;
  r.holding = false;
  setDirection(r, forward);
  if (r.flipped) {
    // The course page is under the sheet: opening, it fades (the reveal); closing, it covers the window
    // again, then the desk comes back under it (the tick) and the timeline takes the book home.
    if (forward) fadeSheet(r, 0);
    else fadeSheet(r, SHEET);
  } else r.anims.forEach((a) => a.play());
  if (!r.raf) watch(r);
};

// While it opens: Escape, a press anywhere, turn it round.
const listen = (r) => {
  const key = (event) => {
    note(`key ${event.key}`);
    // Owner fixes (A): while the film plays, the desk under it hears no key (a book moved by Alt + arrow mid-flight); the
    // browser's own keys are left alone.
    if (event.key !== 'Escape' && !event.ctrlKey && !event.metaKey && event.key !== 'Tab' && !/^F\d+$/.test(event.key)) event.stopPropagation();
    if (event.key !== 'Escape' || r.rate < 0) return;
    event.preventDefault();
    event.stopPropagation();
    turnRound(r);
  };
  const press = (event) => {
    note('press');
    if (r.rate < 0) {
      // Closing: a press on the book (or the page still over it) opens it again.
      if (event.target instanceof Element && event.target.closest('.room-film-book, .room-film-sheet')) {
        event.preventDefault();
        reopen(r);
      }
      return;
    }
    // A press on the book itself, opening: it goes on.
    if (event.target instanceof Element && event.target.closest('.room-film-book')) return;
    event.preventDefault();
    event.stopPropagation();
    // (Owner fixes 2: the held book has no film book to press; a second press on the SAME book on the desk, a double
    // click, goes on too: it called the opening off.)
    if (r.held && document.elementsFromPoint(event.clientX, event.clientY).some((node) => node.matches?.(`.room-stage-slab-hit[data-course-id="${CSS.escape(r.courseId)}"]`))) {
      const drop = (e) => {
        e.preventDefault();
        e.stopPropagation();
      };
      window.addEventListener('click', drop, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', drop, true), 600);
      return;
    }
    // The click this press ends with does nothing else (it was a press "elsewhere").
    const swallow = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', swallow, true), 600);
    turnRound(r);
  };
  window.addEventListener('keydown', key, true);
  window.addEventListener('pointerdown', press, true);
  r.unlisten = () => {
    window.removeEventListener('keydown', key, true);
    window.removeEventListener('pointerdown', press, true);
  };
};

// An opening turned round (Escape, a press, Back): it closes from where it is.
const turnRound = (r) => {
  note('turnRound');
  if (run !== r || r.rate < 0) return;
  if (r.held) {
    // Before the swap (after it, the page is shown and Back closes it): the page goes again from where its dissolve
    // is; it stays under the desk until it is unseen (deskFilm.js slotsFor `holdPage`; before the film's state was
    // set, RoomLayout's preview holds it).
    if (r.statePending) {
      r.statePending = false;
      if (r.quiet || !r.anims.length) {
        setPreview(null);
        end(r);
        return;
      }
      r.root.classList.add('is-closing');
      playHeld(r, false);
      return;
    }
    if (r.pushedCourse && go) {
      r.pushedCourse = false;
      r.leftCourse = true;
      back();
    }
    setFilm({ phase: 'closing', holdPage: Boolean(r.page) });
    if (r.quiet || !r.anims.length) {
      end(r);
      setFilm(null);
      return;
    }
    r.root.classList.add('is-closing');
    playHeld(r, false);
    return;
  }
  setFilm({ phase: 'opening' });
  if (!r.flipped && r.pushedCourse && go) {
    // The course page never showed: the address goes home now (it was mounted, hidden, under the desk).
    r.pushedCourse = false;
    r.leftCourse = true;
    back();
  }
  r.root.classList.add('is-closing');
  // Past the swap (the course page under the sheet): the sheet covers it whole again (at once if it still
  // does), then the desk comes back under it (the tick).
  play(r, false);
};

// A closing book pressed: it opens again, to its course.
const reopen = (r) => {
  note('reopen');
  if (run !== r || r.rate > 0) return;
  if (r.held) {
    r.root.classList.remove('is-closing');
    r.painted = Boolean(r.page);
    setFilm({ phase: 'opening', cover: 'desk', holdPage: false });
    // Its course page mounts under the desk again (it went with the close's swap).
    if (go && r.leftCourse) {
      r.leftCourse = false;
      r.pushedCourse = true;
      startTransition(() => go(coursePath(r.courseId)));
    }
    playHeld(r, true);
    return;
  }
  r.root.classList.remove('is-closing');
  setFilm({ phase: 'opening' });
  // The address had gone home: it goes to the course again (its page mounts, or is still held, under the
  // film; the film waits for it at FLIP).
  if (go && r.leftCourse) {
    r.leftCourse = false;
    r.pushedCourse = true;
    // Still held under the film (not swapped back yet): it is there already; else it mounts again.
    r.ready = r.flipped;
    startTransition(() => go(coursePath(r.courseId)));
  }
  play(r, true);
};

// The desk: a book picked (click, Enter, the menu's Open, ⌘K). Returns false when no film can play
// (still, reduced motion, nothing to draw it in): the caller then opens the course at once.
// A press on a book builds its film ahead of the click (unseen: the root hidden, the animations paused),
// so the click's own frame only shows it and starts it. Dropped if no click follows (a drag, another
// press, a second and a half).
let ready = null;
const dropReady = () => {
  if (!ready) return;
  clearTimeout(ready.timer);
  clearTimeout(ready.preview);
  if (!ready.r) {
    if (!run) setPreview(null);
  } else if (run !== ready.r) {
    letGo(ready.r);
    ready.r.root.replaceChildren();
    ready.r.root.classList.remove('is-ready');
    setPreview(null);
    warmRoom('press', false);
  }
  ready = null;
};
// `previewAfter` (ms, run 3 M4: the production table passes 110): the course page is mounted under the desk only
// if the press is still a press then (a drag starts within it: mounting the course and dropping it again cost a
// drag 17-30 ms of rendering on the Intel UHD). A click before it mounts the page at its film's first frame.
// `keepMs` (fix run 2): how long a prepared film waits for its click (a keyboard's focus keeps it longer than a press).
export const prepareFilm = ({ courseId, describe, look, hideBook, focusBook }, { previewAfter = 0, keepMs = 1500 } = {}) => {
  if (run || !go || typeof document === 'undefined') return;
  const quiet = filmQuiet();
  // (Still and reduced motion: only a held book has a film, its page's wait and its dissolve or swap.)
  if (quiet && !look?.held) return;
  if (ready?.courseId === String(courseId)) return;
  dropReady();
  if (!look?.held) prepareGrain();
  const ms = filmMs(globalThis.__deskFilmMs);
  if (look?.held) {
    // The held book: everything from the press, so the dissolve starts in the frame after the click: its page mounted
    // under the desk and, once drawn, in the film (paused at its start).
    const r = makeHeld({ courseId, describe, look, hideBook, focusBook });
    ready = { courseId: String(courseId), r, timer: setTimeout(dropReady, keepMs) };
    if (r && paintedCourses.has(String(courseId))) {
      r.painted = true;
      attachPage(r);
    }
    const mountHeld = () => {
      if (!ready || ready.courseId !== String(courseId) || run) return;
      setPreview(courseId);
    };
    if (previewAfter > 0) ready.preview = setTimeout(mountHeld, previewAfter);
    else mountHeld();
    return;
  }
  const r = make({ courseId, describe, look, ms, hideBook, focusBook });
  if (!r) return;
  r.root.classList.remove('is-playing');
  r.root.classList.add('is-ready');
  ready = { courseId: String(courseId), r, timer: setTimeout(dropReady, 1500) };
  // Its course page mounted under the desk now (RoomLayout, in a transition), its room warmed (the held book's page
  // covers the room's own: nothing to warm).
  const mount = () => {
    if (ready?.r !== r || run) return;
    setPreview(courseId);
    if (!r.held) warmRoom('press', true);
  };
  if (previewAfter > 0) ready.preview = setTimeout(mount, previewAfter);
  else mount();
};
export const dropPreparedFilm = dropReady;

const openHeld = ({ courseId, describe, look, hideBook, focusBook }) => {
  let r = null;
  if (ready?.courseId === String(courseId)) {
    clearTimeout(ready.timer);
    clearTimeout(ready.preview);
    r = ready.r;
    ready = null;
  } else dropReady();
  if (!r) r = makeHeld({ courseId, describe, look, hideBook, focusBook });
  if (!r) return false;
  run = r;
  r.rate = 1;
  r.playing = true;
  r.painted = paintedCourses.has(String(courseId));
  // The film's state (and with it the address) only once its course page is mounted under the desk, never in the
  // click's own frames: mounted by the film's state, the page rendered at once and held the film's first frame
  // (140 ms, fix run's first take). The press mounts it (RoomLayout's preview, in a transition); a click without a
  // press long enough mounts it now, the same way.
  r.statePending = true;
  // (Owner fixes: what the film's state is, and the push, each done once, by whoever comes first: the film's own steps
  // below, or the swap itself.)
  const home = homePathOf(typeof location !== 'undefined' ? location.pathname : '');
  r.stateOf = () => ({ courseId: String(courseId), describe, look, hideBook, focusBook, home });
  r.push = () => {
    if (r.pushedCourse || !go) return;
    r.pushedCourse = true;
    note('push');
    startTransition(() => go(coursePath(courseId)));
  };
  r.begin = () => {
    if (run !== r || !r.statePending || r.rate < 0) return;
    r.statePending = false;
    setFilm({ ...r.stateOf(), cover: 'desk', phase: 'opening' });
    setPreview(null);
    requestAnimationFrame(() =>
      setTimeout(() => {
        if (run !== r || r.rate < 0) return;
        r.push();
      }, 0),
    );
  };
  if (mountedCourses.has(String(courseId))) requestAnimationFrame(() => setTimeout(r.begin, 0));
  else setPreview(courseId);
  note('click');
  // Escape or a press elsewhere meanwhile calls it off (the page goes again from where its dissolve is).
  listen(r);
  if (r.quiet) {
    // The system's reduced motion: the desk stays as it is until the page has been drawn whole, then one frame swaps.
    watchHeld(r);
    return true;
  }
  // The desk stands as it is (nothing of it moves or is taken out) while the page comes in over it: at once if the
  // page has been drawn whole (the press mounted it), else as soon as it has (watchHeld, filmPagePainted).
  r.root.classList.add('is-playing');
  if (r.painted) joinPage(r);
  if (r.page) {
    setRate(r, 1);
    r.anims.forEach((a) => a.play());
  }
  watchHeld(r);
  return true;
};

export const openFilm = ({ courseId, describe, look, hideBook, focusBook }) => {
  if (run || !go) return false;
  if (look?.held) return openHeld({ courseId, describe, look, hideBook, focusBook });
  if (filmQuiet()) return false;
  prepareGrain();
  let r = null;
  if (ready?.courseId === String(courseId)) {
    r = ready.r;
    clearTimeout(ready.timer);
    clearTimeout(ready.preview);
    ready = null;
    r.root.classList.remove('is-ready');
    r.root.classList.add('is-playing');
  } else {
    dropReady();
    r = make({ courseId, describe, look, ms: filmMs(globalThis.__deskFilmMs), hideBook, focusBook });
  }
  if (!r) return false;
  run = r;
  r.ready = mountedCourses.has(String(courseId));
  r.flipped = false;
  hideBook?.(true);
  warmRoom('film', true);
  warmRoom('press', false);
  setFilm({ courseId: String(courseId), cover: 'desk', phase: 'opening', describe, look, hideBook, focusBook });
  setPreview(null);
  listen(r);
  play(r, true);
  // Its clock starts at the click (this moment, not the last frame's time); its first frame is set in
  // that frame's own tick (firstFrame).
  const now = performance.now();
  r.anims.forEach((a) => (a.startTime = now));
  r.anchor = true;
  // The course page is mounted under the desk once the film's first frame is out (React renders it
  // in a transition, in slices).
  requestAnimationFrame(() =>
    setTimeout(() => {
      if (run !== r || r.rate < 0) return;
      r.pushedCourse = true;
      note('push');
      startTransition(() => go(coursePath(courseId)));
    }, 0),
  );
  return true;
};

// The course page under the film is on the page: the open page may turn into it.
export const filmPageReady = (courseId) => {
  mountedCourses.add(String(courseId));
  const r = run;
  if (!r || r.courseId !== String(courseId)) return;
  if (r.held) {
    if (r.statePending) setTimeout(r.begin, 0);
    return;
  }
  r.ready = true;
  if (r.holding) play(r, true);
};

export const filmPageGone = (courseId) => {
  mountedCourses.delete(String(courseId));
  paintedCourses.delete(String(courseId));
  [run, ready?.r].forEach((r) => {
    if (!r?.held || r.courseId !== String(courseId)) return;
    r.painted = false;
    detachPage(r);
  });
};

// The address went home while the film's course was open (the Back pill, the browser's Back): the
// film closes onto the book (RoomLayout holds the course page until the sheet covers it). While it
// was still opening, it turns round.
export const filmWentHome = () => {
  note('wentHome');
  const state = getFilm();
  if (!state) return;
  if (run && run.rate > 0) {
    run.pushedCourse = false;
    run.leftCourse = true;
    turnRound(run);
    return;
  }
  if (run || state.phase !== 'shown') return;
  if (state.look?.held && closeHeld(state)) return;
  const describe = state.describe;
  // Home without a film (still or reduced motion by now, nothing to draw it from): the desk at once.
  const atOnce = () => {
    document.documentElement.setAttribute('data-desk-stage', '');
    state.hideBook?.(false);
    setFilm(null);
  };
  if (!describe || filmQuiet()) {
    atOnce();
    return;
  }
  const r = make({ courseId: state.courseId, describe, look: state.look, ms: filmMs(globalThis.__deskFilmMs), hideBook: state.hideBook, focusBook: state.focusBook });
  if (!r) {
    atOnce();
    return;
  }
  run = r;
  r.ready = true;
  r.flipped = true;
  r.pushedCourse = false;
  r.leftCourse = true;
  // The timeline at its end (the book gone, the sheet whole over the window), held; the sheet's own fade
  // brings it over the course page first.
  pin(r, r.D);
  r.root.classList.add('is-closing');
  unarmWake?.();
  setFilm({ phase: 'closing' });
  listen(r);
  setDirection(r, false);
  fadeSheet(r, SHEET, 0);
  if (!r.raf) watch(r);
  r.anchor = true;
  // Its clock started now, its first frame set in that frame's tick (firstFrame); the kept desk is woken
  // once that first frame is out (unless a press on Back woke it already), so its restyling never holds
  // the close's first frame.
  requestAnimationFrame(() => wakeDesk(true));
};

// The address went back to the film's course while it was closing (the browser's Forward): it opens.
export const filmWentToCourse = () => {
  note('wentToCourse');
  if (run?.held && run.rate < 0) {
    run.leftCourse = false;
    reopen(run);
    return;
  }
  if (run && run.rate < 0) {
    run.root.classList.remove('is-closing');
    setFilm({ phase: 'opening' });
    play(run, true);
  }
};

// The film's course page was left for another page: the film is over (the desk is let go).
export const filmLeft = () => {
  const state = getFilm();
  if (run) end(run);
  warmRoom('film', false);
  wakeDesk(false);
  ['data-film-swap', 'data-desk-back'].forEach((name) => htmlEl().removeAttribute(name));
  unarmWake?.();
  state?.hideBook?.(false);
  setFilm(null);
};

// For the harness: the film held at a progress (0..1) to draw it, or let go (null).
export const holdFilmAt = (p) => {
  if (!run) return false;
  if (p == null) {
    if (run.held) playHeld(run, run.rate >= 0);
    else play(run, run.rate >= 0);
    return true;
  }
  run.anims.forEach((a) => {
    a.pause();
    a.currentTime = Math.max(0, Math.min(1, p)) * run.D;
  });
  return true;
};
