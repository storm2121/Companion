// "Opening a book" (round eight, track M) — PURE: the film's timing, the room's camera, the book's
// poses and the film's state. No DOM (deskFilmRun.js builds and plays it; tests/desk.unit.test.mjs
// runs this).
//
// The stage is Blender's render of the room from one camera (scene.json camera: focal, sensor,
// location; horizonY is the principal point's row). The film draws its book through THE SAME camera:
// the film's root gets CSS perspective = the camera's focal length in css px, its perspective-origin
// the principal point on the screen, and a point the camera sees at depth Zc (metres, forward), Xc
// right and Yc down of its axis is placed at css (ox + Xc f, oy + Yc f, (1 - Zc) f): CSS perspective
// then draws it at ox + f Xc / Zc, oy + f Yc / Zc, the pinhole's own projection. So the film's book
// lies exactly where the render's book lies, and moves through the room in true perspective.
//
// The book is a box in its own px (MODEL px per mm): the front board (W x H at z 0, spine at x 0,
// head at y 0), the page block behind it to z -T, the spine face along x 0. Three poses (rotation R,
// columns = the model's x, y, z axes in css world; T = where the model's origin is, css px):
//   - on a pile: lying cover up, spine to the camera, head to the left (pilePose, from the spine's
//     quad: its length gives its depth);
//   - the near place: lying cover up, yawed, spine on the left (nearPose, scene.json nearPlaces);
//   - open in front of you: upright facing the camera, spine on the window's middle (openPose).
// The film is ONE timeline, progress 0 (the book closed at its place) to 1 (the course page shown):
// played forward it opens, backward it closes; an interruption turns it round from where it is.

/* ── Timing ──────────────────────────────────────────────────────────────── */

// The opening's length (ms), click to the course page shown. Run 2 (the owner: "supersonic opening,
// fast enough but not killing"): 200 shipped, 160 and 240 recorded beside it (the harness sets
// globalThis.__deskFilmMs).
export const FILM_SPEEDS = { quick: 160, ship: 200, slow: 240 };
export const FILM_MS = FILM_SPEEDS.ship;
// The close takes this share of the opening (the same film backwards, a little quicker).
export const CLOSE_SHARE = 0.8;

export const filmMs = (override) => {
  const v = Number(override);
  return Number.isFinite(v) && v >= 120 && v <= 2000 ? v : FILM_MS;
};
export const closeMs = (open) => Math.round(open * CLOSE_SHARE);

// Where things happen along the timeline (0..1). From a pile the book comes forward and turns to you
// while its board starts to swing; from the near place the board lifts first, in place, and the book
// rises after. The page (a flat sheet over the open book's page) then grows to the window while it
// darkens to the room's ground; FLIP is where it covers everything: the course page is swapped in
// under it (or, closing, the desk). Both ways the film holds there until a frame comes in time again
// (whatever the swap costs, the course page's photograph's first upload, the desk drawn again, happens
// under a still sheet, never mid-motion: closing without the hold, a busy main thread let the compositor
// shrink the sheet over the course page it was meant to have left); then it goes on.
// Run 2: the pages are swapped once the sheet covers the window (sheet[1], a little before FLIP, where the
// book goes), and the sheet's fade after the swap is not part of the timeline any more: the page's own
// clock starts it once the swap has been drawn (deskFilmRun fadeSheet), and a close first covers the
// course page with it before the desk comes back. The compositor runs the timeline on its own thread and
// drew frames ahead of the page's clock: with the fade in the timeline, 11-84% of the sheet was gone for a
// frame at the swap, the desk showing through, then back.
export const FLIP_HOLD_FRAMES = 1;
export const FILM_BEATS = {
  pile: { pose: [0, 0.46], board: [0.16, 0.58], sheet: [0.48, 0.64], flip: 0.68 },
  near: { pose: [0.14, 0.5], board: [0, 0.4], sheet: [0.5, 0.64], flip: 0.68 },
};
// Run 3, the held book: the sheet is the held picture itself, coming in over the desk while the book is
// still on its way (a longer crossfade than a page growing), whole by the same beat.
export const BOOK_SHEET = [0.34, 0.64];

/* ── The held book's film (the owner's second look, 2026-11-23) ───────────────── */

// A plain dissolve from the desk to the close-up and back (deskFilmRun.js: see there). The run before had the book
// rise, turn to face you and open on its spine while the desk slid: "kinda motion sickening" (the owner). Nothing
// turns now, nothing travels, the desk does not move.
//   Calm: HELD_MS, the open book settling by HELD_SETTLE (a few pixels down to its place, a percent and a half of
//   size), eased out on HELD_EASE; the same length back.
//   Still (the planner's decision): HELD_STILL_MS, no movement at all.
//   The system's reduced motion: a cut (no film).
export const HELD_MS = 280;
export const HELD_STILL_MS = 150;
export const heldMs = (override, still = false) => {
  const v = Number(override);
  if (Number.isFinite(v) && v >= 100 && v <= 4000) return v;
  return still ? HELD_STILL_MS : HELD_MS;
};
export const HELD_SETTLE = { lift: 10, scale: 0.985 };
export const HELD_EASE = [0.2, 0.7, 0.25, 1];
// The desk stands this long for a page that is not whole yet (its code, its data, its faces, its pictures) before the
// page is shown as it is: a page that cannot come, not a slow one (a slow one was shown half-made after 2.5 s).
export const HELD_WAIT_MS = 12000;

/* ── The book ────────────────────────────────────────────────────────────── */

// The stage's books (round six/seven: 0.28 m spine, 0.19 m board; near N0's thickness 0.046 m).
export const BOOK_M = { w: 0.19, h: 0.28, t: 0.046 };
export const MODEL = 2; // model px per mm: the faces are drawn at about the size they reach open
export const modelSize = (t = BOOK_M.t) => ({ w: Math.round(BOOK_M.w * 1000 * MODEL), h: Math.round(BOOK_M.h * 1000 * MODEL), t: Math.round(t * 1000 * MODEL) });
// The board swings open this far (deg about its spine; negative: toward you, then to the left).
export const BOARD_OPEN = -168;
// The table's top (scene.py; the near place's cover lies at TABLE_TOP + its thickness).
export const TABLE_TOP = 0.74;

/* ── The camera ──────────────────────────────────────────────────────────── */

// The render's camera on the screen at the stage's fit ({ left, top, scale }): f (css px at 1 m),
// the principal point (ox, oy) in window px, and where the camera stands in the room (Blender world).
export const stageCamera = (scene, fit) => {
  const c = scene.camera || {};
  const px = c.render_px?.[0] || scene.stage.width;
  const focal = (px * (c.focal_mm || 22)) / (c.sensor_mm?.[0] || 36);
  const cy = Number.isFinite(scene.horizonY) ? scene.horizonY : scene.stage.height / 2;
  return {
    f: focal * fit.scale,
    ox: fit.left + (scene.stage.width / 2) * fit.scale,
    oy: fit.top + cy * fit.scale,
    at: c.location || [0, -0.45, 1.1],
  };
};

// A room point (Blender world: x right, y away, z up) as the camera sees it: [right, down, forward].
export const toCamera = (cam, [x, y, z]) => [x - cam.at[0], cam.at[2] - z, y - cam.at[1]];
// A room direction (no translation).
export const dirToCss = ([x, y, z]) => [x, -z, -y];
// A camera point as css world px (the film's root, its perspective on).
export const cssOf = (cam, [xc, yc, zc]) => [cam.ox + xc * cam.f, cam.oy + yc * cam.f, (1 - zc) * cam.f];
// A css world point as the screen shows it (the projection CSS perspective makes).
export const project = (cam, [x, y, z]) => {
  const k = cam.f / Math.max(1e-6, cam.f - z);
  return [cam.ox + (x - cam.ox) * k, cam.oy + (y - cam.oy) * k];
};
// A screen point at a depth (m) as a camera point.
export const unproject = (cam, [u, v], zc) => [((u - cam.ox) * zc) / cam.f, ((v - cam.oy) * zc) / cam.f, zc];

/* ── Rotations (3x3, row-major; columns = the model's axes in css world) ───── */

const mul = (A, v) => [0, 1, 2].map((r) => A[r * 3] * v[0] + A[r * 3 + 1] * v[1] + A[r * 3 + 2] * v[2]);
const fromColumns = (x, y, z) => [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]];
export const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export const toQuat = (R) => {
  const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = R;
  const tr = m00 + m11 + m22;
  let q;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, s / 4];
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = [s / 4, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = [(m01 + m10) / s, s / 4, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = [(m02 + m20) / s, (m12 + m21) / s, s / 4, (m10 - m01) / s];
  }
  const n = Math.hypot(...q);
  return q.map((v) => v / n);
};

export const fromQuat = ([x, y, z, w]) => [
  1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
  2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
  2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
];

export const slerp = (a, b, t) => {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const bb = d < 0 ? b.map((v) => -v) : b;
  d = Math.abs(d);
  if (d > 0.9995) {
    const q = a.map((v, i) => v + (bb[i] - v) * t);
    const n = Math.hypot(...q);
    return q.map((v) => v / n);
  }
  const th = Math.acos(d);
  const s = Math.sin(th);
  const wa = Math.sin((1 - t) * th) / s;
  const wb = Math.sin(t * th) / s;
  return a.map((v, i) => v * wa + bb[i] * wb);
};

/* ── Poses ───────────────────────────────────────────────────────────────── */

// The model's origin placed so that a model point `anchor` (model px) lands on the css point `at`.
const placed = (R, cam, anchor, at) => {
  const m = cam.f / (1000 * MODEL);
  const r = mul(R, anchor).map((v) => v * m);
  return { R, T: [at[0] - r[0], at[1] - r[1], at[2] - r[2]] };
};

// Lying on a pile, cover up, spine to the camera, head to the left: model x (spine -> fore-edge) goes
// away, model y (head -> tail) to the right, model z (the cover's face) up.
export const PILE_R = fromColumns([0, 0, -1], [1, 0, 0], [0, -1, 0]);

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
// From a pile book's spine quad (stage px, TL TR BR BL) at the fit: its depth from its length on the
// screen (the spine is BOOK_M.h long), its thickness from its height there. Returns { pose, t }.
export const pilePose = (cam, quad, fit) => {
  const q = quad.map(([x, y]) => [fit.left + x * fit.scale, fit.top + y * fit.scale]);
  const len = (dist(q[0], q[1]) + dist(q[3], q[2])) / 2;
  const tall = (dist(q[0], q[3]) + dist(q[1], q[2])) / 2;
  const zc = (cam.f * BOOK_M.h) / Math.max(1, len);
  const t = Math.min(0.06, Math.max(0.03, (tall * zc) / cam.f));
  const centre = [(q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4, (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4];
  const size = modelSize(t);
  // The spine face's centre: model (0, H/2, -T/2).
  return { pose: placed(PILE_R, cam, [0, size.h / 2, -size.t / 2], cssOf(cam, unproject(cam, centre, zc))), t };
};

// The near place (scene.json nearPlaces.<place>: x, y on the table, yaw deg, w and d (the board's
// width and the spine's length, m), t): lying cover up, spine on its left, head away from you.
export const nearPose = (cam, near) => {
  const yaw = ((near.yaw || 0) * Math.PI) / 180;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const ux = [c, s, 0];
  const uy = [s, -c, 0];
  const R = fromColumns(dirToCss(ux), dirToCss(uy), dirToCss([0, 0, 1]));
  const w = near.d ?? BOOK_M.w;
  const h = near.w ?? BOOK_M.h;
  const z = TABLE_TOP + (near.t ?? BOOK_M.t);
  // The board's top-left (the spine's head end), in the room.
  const corner = [near.x - (w / 2) * ux[0] - (h / 2) * uy[0], near.y - (w / 2) * ux[1] - (h / 2) * uy[1], z];
  return { pose: placed(R, cam, [0, 0, 0], cssOf(cam, toCamera(cam, corner))), t: near.t ?? BOOK_M.t };
};

// Open in front of you: upright, facing the camera, the board's height `share` of the window's (within
// bounds), its spine on the window's middle, its middle a little above the window's.
export const openPose = (cam, view, t = BOOK_M.t) => {
  const tall = Math.max(260, Math.min(620, view.height * 0.62, view.width * 0.5 * (BOOK_M.h / BOOK_M.w)));
  const zc = (cam.f * BOOK_M.h) / tall;
  const wide = (tall * BOOK_M.w) / BOOK_M.h;
  const centre = [view.width / 2 + wide / 2, view.height * 0.52];
  const size = modelSize(t);
  return { pose: placed(IDENTITY, cam, [size.w / 2, size.h / 2, 0], cssOf(cam, unproject(cam, centre, zc))), tall, wide };
};

// Open where a picture shows the book open (round eight, run 3: the held book): upright, facing the camera,
// its board `spread.tall` px high, its spine on `spread.x`, its middle on `spread.cy` (window px).
export const openPoseAt = (cam, spread, t = BOOK_M.t) => {
  const tall = spread.tall;
  const zc = (cam.f * BOOK_M.h) / tall;
  const wide = (tall * BOOK_M.w) / BOOK_M.h;
  const size = modelSize(t);
  return { pose: placed(IDENTITY, cam, [size.w / 2, size.h / 2, 0], cssOf(cam, unproject(cam, [spread.x + wide / 2, spread.cy], zc))), tall, wide };
};

// A pose as a CSS matrix3d (transform-origin 0 0 0): css = R (model * m) + T.
export const poseMatrix = (cam, { R, T }) => {
  const m = cam.f / (1000 * MODEL);
  const v = [R[0] * m, R[3] * m, R[6] * m, 0, R[1] * m, R[4] * m, R[7] * m, 0, R[2] * m, R[5] * m, R[8] * m, 0, T[0], T[1], T[2], 1];
  return `matrix3d(${v.map((n) => Number(n.toPrecision(9))).join(', ')})`;
};

// A model point through a pose, on the screen.
export const poseScreen = (cam, { R, T }, p) => {
  const m = cam.f / (1000 * MODEL);
  const r = mul(R, p);
  return project(cam, [T[0] + r[0] * m, T[1] + r[1] * m, T[2] + r[2] * m]);
};

// Eases (the same curves CSS has, as numbers for the poses sampled between keyframes).
export const bezier = (x1, y1, x2, y2) => (x) => {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  let lo = 0;
  let hi = 1;
  let t = x;
  for (let i = 0; i < 24; i += 1) {
    const cx = 3 * (1 - t) * (1 - t) * t * x1 + 3 * (1 - t) * t * t * x2 + t * t * t;
    if (Math.abs(cx - x) < 1e-5) break;
    if (cx < x) lo = t;
    else hi = t;
    t = (lo + hi) / 2;
  }
  return 3 * (1 - t) * (1 - t) * t * y1 + 3 * (1 - t) * t * t * y2 + t * t * t;
};
// The book's travel: leaves at once, settles softly, never overshoots.
// Leaves at once (steep at 0), lands gently (flat at 1), never past 1: no overshoot, no bounce.
export const TRAVEL = [0.2, 0.7, 0.25, 1];
export const travelEase = bezier(...TRAVEL);

// The path from one pose to another: `n` + 1 poses, eased; the book rises `lift` (css px, up) at
// the middle of its way, so it leaves the pile upward before it comes to you.
export const posePath = (from, to, n = 12, ease = travelEase, lift = 0) => {
  const qa = toQuat(from.R);
  const qb = toQuat(to.R);
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = ease(i / n);
    const up = lift * Math.sin(Math.PI * t);
    return {
      R: fromQuat(slerp(qa, qb, t)),
      T: [0, 1, 2].map((k) => from.T[k] + (to.T[k] - from.T[k]) * t - (k === 1 ? up : 0)),
    };
  });
};

// The sheet (the open book's page, flat, above the film) from the page's rect on the screen to the
// window: translate + scale of a window-sized sheet, transform-origin 0 0.
export const sheetFrom = (rect, view) => `translate(${rect.x.toFixed(2)}px, ${rect.y.toFixed(2)}px) scale(${(rect.w / view.width).toFixed(5)}, ${(rect.h / view.height).toFixed(5)})`;

// The open page's rect on the screen (the board's footprint in the open pose, a little inside it).
export const pageRect = (cam, pose, size) => {
  const pts = [[2, 3], [size.w - 3, 3], [size.w - 3, size.h - 3], [2, size.h - 3]].map(([x, y]) => poseScreen(cam, pose, [x, y, -1.5]));
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
};

/* ── The book's look ─────────────────────────────────────────────────────── */

// The page and the room under the candle or the day (the notebook's page as the render draws it: night
// 133,83,37 / day 186,182,180, measured; the course page's ground: its mean at the owner's window,
// measured on the course page itself, night #29221b and day #cfd5d8; run 2: the day's had been a guess,
// a dark grey, and the film cut from it to the light day page at the swap).
export const FILM_TONES = {
  night: { paper: '#8f5d2c', inside: '#6d4626', ground: '#29221b', ink: '#2b1708' },
  day: { paper: '#c4bfb8', inside: '#a9a094', ground: '#cfd5d8', ink: '#2c2723' },
};

// A title on the board's label: one line, or two balanced at a space (never more).
export const coverLines = (title, max = 16) => {
  const words = String(title || '').trim().split(/\s+/).filter(Boolean);
  if (words.join(' ').length <= max || words.length < 2) return [words.join(' ')];
  // As the spines' rule: never a line ending on an article (one that would is a last resort).
  let best = null;
  for (let i = 1; i < words.length; i += 1) {
    const a = words.slice(0, i).join(' ');
    const b = words.slice(i).join(' ');
    const score = Math.max(a.length, b.length) + (/^(a|an|the)$/i.test(words[i - 1]) ? 100 : 0);
    if (!best || score < best.score) best = { lines: [a, b], score };
  }
  return best.lines;
};

// (The book's leather, label and gilt come from deskStage.js filmLook: what the stage draws there.)

/* ── The film's state (a module store: RoomLayout, RoomCourse, the desk and ⌘K share it) ── */
// { courseId, cover: 'desk' | 'course', phase: 'opening' | 'shown' | 'closing', pushed } or null.
//   cover: which page is on the screen under the film (the other is mounted, hidden: the desk kept
//   while its course is open, the course page mounted under the desk while the book opens).

let film = null;
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());
export const subscribeFilm = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
export const getFilm = () => film;
export const setFilm = (next) => {
  film = next ? { ...(film || {}), ...next } : null;
  emit();
};
export const coursePath = (courseId) => `/room/course/${courseId}`;
// Owner fixes (2026-11-23): the Home address the film's desk is kept at (the room's /room, or /dashboard in the room's
// design): the book's own way back goes THERE, so the kept desk is the page that comes back (the other Home address is
// another route: its desk would be mounted anew under the closing book).
export const HOME_PATHS = ['/room', '/dashboard'];
export const homePathOf = (pathname) => (HOME_PATHS.includes(pathname) ? pathname : '/room');
export const filmHome = (state = film) => homePathOf(state?.home);

// The course page held under the film: true while a film is on its way to it (opening) or from it.
// A note of the film's course (its address), for the book's keep (RoomLayout).
export const noteOfFilm = (state, pathname) => Boolean(state?.courseId) && String(pathname || '').startsWith(`/room/note/${state.courseId}/`);

export const filmShowsCourse = (state, pathname) => Boolean(state && pathname === coursePath(state.courseId));

// Which of the two pages RoomLayout draws, and which it keeps hidden (PURE, unit-tested):
//   home: the Home page's slot ('live' | 'kept' | null); page: the other slot ('live' | 'under' |
//   'preview' | 'held' | null): under = the film's course page mounted under the desk while the book opens,
//   preview = a pressed book's course page mounted under the desk before its click (run 2: the course
//   page's work done before the film), held = the course page drawn after the address went home, until the
//   film covers it; pageInert: the course page out of reach while it is under the desk (the film takes
//   every press meanwhile).
// `keep` (run 3, the course as the held book): a note opened from the book is shown while the desk stays
// kept under it, so coming back from the note finds the book, and leaving it closes onto the desk.
// Fix run 2: `keep` with no film (a note opened from the desk itself: the small notebook, the notebook's pages) keeps
// the desk the same way; `returning` (back home from such a note) holds the note page while the desk is drawn again
// (deskFilmRun returnToKeptDesk), as a close holds the course page.
export const slotsFor = (state, pathname, homePaths = ['/room', '/dashboard'], preview = null, keep = false, returning = false) => {
  const atHome = homePaths.includes(pathname);
  if (keep && !atHome) return { home: 'kept', page: 'live', pageInert: false };
  if (!state && returning && atHome) return { home: 'kept', page: 'held', pageInert: false };
  if (!state) {
    if (atHome && preview) return { home: 'live', page: 'preview', pageInert: true };
    return { home: atHome ? 'live' : null, page: atHome ? null : 'live', pageInert: false };
  }
  const onCourse = filmShowsCourse(state, pathname);
  if (atHome) {
    if (state.cover === 'course') return { home: 'kept', page: 'held', pageInert: false };
    // Opening, before the address has moved: the course page already mounted (by the press) stays. `holdPage` (owner
    // fixes, E): closing, the page stays under the desk, out of reach, while the film's book is still its own picture.
    const stays = state.phase === 'opening' || Boolean(state.holdPage);
    return { home: 'live', page: stays ? 'preview' : null, pageInert: stays };
  }
  if (onCourse) return { home: state.cover === 'desk' ? 'live' : 'kept', page: state.cover === 'desk' ? 'under' : 'live', pageInert: state.cover === 'desk' };
  return { home: null, page: 'live', pageInert: false };
};

// Fix run 2: a note opened from the desk keeps the desk mounted under it (the decision: every note opened from the
// desk). { phase: 'note' | 'returning' } or null; RoomLayout reads it, deskFilmRun brings the desk back.
let noteKeep = null;
const keepListeners = new Set();
export const getNoteKeep = () => noteKeep;
export const setNoteKeep = (next) => {
  noteKeep = next;
  keepListeners.forEach((fn) => fn());
};
export const subscribeNoteKeep = (fn) => {
  keepListeners.add(fn);
  return () => keepListeners.delete(fn);
};
export const isNotePath = (pathname) => String(pathname || '').startsWith('/room/note/');

// The course whose page a press on its book mounted under the desk ahead of the click (or null).
let preview = null;
const previewListeners = new Set();
export const getPreview = () => preview;
export const setPreview = (courseId) => {
  const next = courseId ? String(courseId) : null;
  if (next === preview) return;
  preview = next;
  previewListeners.forEach((fn) => fn());
};
export const subscribePreview = (fn) => {
  previewListeners.add(fn);
  return () => previewListeners.delete(fn);
};

// The desk, while it is on the screen, opens a course by its film (⌘K's course rows ask it first).
let opener = null;
export const setDeskOpener = (fn) => {
  opener = fn;
};
export const openCourseOnDesk = (courseId) => Boolean(opener && opener(courseId));

// The stage, while it is on the screen, takes a move announced before it is saved (RoomDesk: the menu,
// Ctrl K, the keys, a drop): its books start gliding in that frame (DeskStage), the save follows.
let announcer = null;
export const setMoveAnnouncer = (fn) => {
  announcer = fn;
};
export const announceMoves = (fromMap, toMap, primary) => {
  if (announcer) announcer(fromMap, toMap, primary);
};
