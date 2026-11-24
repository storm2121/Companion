// Round eight, track M: the book film's pure parts (deskFilm.js) and the book's look (deskStage.js
// filmLook): the camera the film shares with the render, the poses, the timing, the slots RoomLayout
// draws while a film is on.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  BOOK_M,
  CLOSE_SHARE,
  FILM_BEATS,
  FILM_MS,
  FILM_SPEEDS,
  IDENTITY,
  PILE_R,
  closeMs,
  coursePath,
  coverLines,
  filmMs,
  fromQuat,
  getFilm,
  modelSize,
  nearPose,
  openCourseOnDesk,
  openPose,
  pageRect,
  pilePose,
  poseMatrix,
  posePath,
  poseScreen,
  setDeskOpener,
  setFilm,
  slerp,
  slotsFor,
  stageCamera,
  subscribeFilm,
  toQuat,
  travelEase,
} from '../src/room/deskFilm.js';
import { arrangePiles, arrangementFrom, filmLook, isNightKey, liftOut, placesKey } from '../src/room/deskStage.js';
import { quadBox } from '../src/room/deskProject.js';

const SCENE = JSON.parse(readFileSync(new URL('../src/room/assets/desk/scene.json', import.meta.url), 'utf8'));
// The owner's window: the stage at 0.7 (S_MIN), placed as stageFit would (the numbers only have to be
// some fit: every check below is relative to it).
const FIT = { left: -128, top: -54, scale: 0.7 };
const CAM = stageCamera(SCENE, FIT);
const onScreen = ([x, y]) => [FIT.left + x * FIT.scale, FIT.top + y * FIT.scale];
const near = (a, b, tol) => Math.abs(a - b) <= tol;

test('desk film: the timing — three speeds offered, 200 shipped, the close quicker (about 160)', () => {
  assert.deepEqual(FILM_SPEEDS, { quick: 160, ship: 200, slow: 240 });
  assert.equal(FILM_MS, 200);
  assert.equal(filmMs(undefined), 200);
  assert.equal(filmMs(160), 160);
  assert.equal(filmMs(5), 200);
  assert.equal(filmMs('nonsense'), 200);
  assert.equal(closeMs(200), Math.round(200 * CLOSE_SHARE));
  assert.equal(closeMs(200), 160);
  // The course page turns in by FLIP, and is fully there by the end: readable within 350 ms at 320.
  for (const beats of Object.values(FILM_BEATS)) {
    assert.ok(beats.flip > beats.sheet[1], 'the sheet covers the window before the pages are swapped');
    assert.ok(beats.board[1] <= beats.sheet[1] && beats.pose[1] <= beats.flip);
    assert.ok(FILM_MS * 1 <= 350);
  }
});

test('desk film: the camera is the render\'s — the near book\'s cover lands on its own quad', () => {
  // scene.json nearPlaces.N0 through the film's pose and CSS perspective: each corner within 2 css px of
  // the quad Blender wrote for its cover.
  const { pose, t } = nearPose(CAM, SCENE.nearPlaces.N0);
  const size = modelSize(t);
  const corners = [[0, 0, 0], [size.w, 0, 0], [size.w, size.h, 0], [0, size.h, 0]].map((p) => poseScreen(CAM, pose, p));
  SCENE.quads.covers.N0.map(onScreen).forEach((q, i) => {
    assert.ok(near(corners[i][0], q[0], 2) && near(corners[i][1], q[1], 2), `corner ${i}: ${corners[i]} vs ${q}`);
  });
});

test('desk film: a pile book starts as its spine — its face where the stage draws the spine, as long', () => {
  for (const place of ['L0', 'L3', 'R1', 'R5']) {
    const quad = SCENE.quads.spines[place];
    const { pose, t } = pilePose(CAM, quad, FIT);
    const size = modelSize(t);
    // The spine face (model x 0) spans head to tail along y, from the board back to the page block's back.
    const head = poseScreen(CAM, pose, [0, 0, -size.t / 2]);
    const tail = poseScreen(CAM, pose, [0, size.h, -size.t / 2]);
    const [bx, by, bw, bh] = quadBox(quad.map(onScreen));
    const mid = [(head[0] + tail[0]) / 2, (head[1] + tail[1]) / 2];
    assert.ok(near(mid[0], bx + bw / 2, 3) && near(mid[1], by + bh / 2, 3), `${place}: middle ${mid} vs ${[bx + bw / 2, by + bh / 2]}`);
    assert.ok(near(Math.hypot(tail[0] - head[0], tail[1] - head[1]), bw, bw * 0.06), `${place}: length`);
    assert.ok(t >= 0.03 && t <= 0.06);
  }
});

test('desk film: open, the book faces you on the window\'s middle, and its page is upright and inside the window', () => {
  for (const view of [{ width: 1536, height: 750 }, { width: 1280, height: 650 }, { width: 1920, height: 950 }, { width: 2560, height: 1300 }]) {
    const open = openPose(CAM, view);
    assert.deepEqual(open.pose.R, IDENTITY);
    const size = modelSize();
    const spineTop = poseScreen(CAM, open.pose, [0, 0, 0]);
    assert.ok(near(spineTop[0], view.width / 2, 1), 'the spine on the middle');
    const rect = pageRect(CAM, open.pose, size);
    assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.w <= view.width && rect.y + rect.h <= view.height, `${view.width}: page inside`);
    assert.ok(near(rect.h / rect.w, BOOK_M.h / BOOK_M.w, 0.05));
  }
});

test('desk film: the path between poses is rotations only (no shear), eased, from the one pose to the other', () => {
  const from = pilePose(CAM, SCENE.quads.spines.L2, FIT).pose;
  const to = openPose(CAM, { width: 1536, height: 750 }).pose;
  const path = posePath(from, to, 12, travelEase, 30);
  assert.equal(path.length, 13);
  assert.deepEqual(path[0].T.map((v) => Math.round(v * 1000)), from.T.map((v) => Math.round(v * 1000)));
  assert.ok(path[12].T.every((v, k) => near(v, to.T[k], 1e-6)));
  path.forEach(({ R }) => {
    // Orthonormal: columns of unit length, perpendicular.
    const col = (j) => [R[j], R[3 + j], R[6 + j]];
    [0, 1, 2].forEach((j) => assert.ok(near(Math.hypot(...col(j)), 1, 1e-9)));
    assert.ok(near(col(0).reduce((s, v, k) => s + v * col(1)[k], 0), 0, 1e-9));
  });
  // quaternion round trip, slerp ends
  const q = toQuat(PILE_R);
  fromQuat(q).forEach((v, i) => assert.ok(near(v, PILE_R[i], 1e-9)));
  assert.ok(slerp(q, toQuat(IDENTITY), 0).every((v, i) => near(v, q[i], 1e-9)));
  // the easing leaves at once and never overshoots
  let last = 0;
  for (let i = 1; i <= 20; i += 1) {
    const e = travelEase(i / 20);
    assert.ok(e >= last && e <= 1 + 1e-9);
    last = e;
  }
  assert.match(poseMatrix(CAM, to), /^matrix3d\(/);
});

test('desk film: the slots RoomLayout draws — the desk kept while its course is open, nothing else changed', () => {
  // No film: one page at the address, as before.
  assert.deepEqual(slotsFor(null, '/room'), { home: 'live', page: null, pageInert: false });
  assert.deepEqual(slotsFor(null, '/room/course/c1'), { home: null, page: 'live', pageInert: false });
  assert.deepEqual(slotsFor(null, '/room/calendar'), { home: null, page: 'live', pageInert: false });
  // Opening: the course page mounted under the desk, out of reach; then the desk kept under it.
  const opening = { courseId: 'c1', cover: 'desk', phase: 'opening' };
  assert.deepEqual(slotsFor(opening, '/room/course/c1'), { home: 'live', page: 'under', pageInert: true });
  assert.deepEqual(slotsFor({ ...opening, cover: 'course' }, '/room/course/c1'), { home: 'kept', page: 'live', pageInert: false });
  assert.deepEqual(slotsFor({ ...opening, cover: 'course', phase: 'shown' }, '/room/course/c1'), { home: 'kept', page: 'live', pageInert: false });
  // Closing: home again, the course page held until the film covers it, then the desk live.
  assert.deepEqual(slotsFor({ courseId: 'c1', cover: 'course', phase: 'closing' }, '/room'), { home: 'kept', page: 'held', pageInert: false });
  assert.deepEqual(slotsFor({ courseId: 'c1', cover: 'desk', phase: 'closing' }, '/room'), { home: 'live', page: null, pageInert: false });
  // Run 2: a pressed book's course page is mounted under the desk before its click, and stays while
  // the film starts, until the address moves to it.
  assert.deepEqual(slotsFor(null, '/room', undefined, 'c1'), { home: 'live', page: 'preview', pageInert: true });
  assert.deepEqual(slotsFor(null, '/room/calendar', undefined, 'c1'), { home: null, page: 'live', pageInert: false });
  assert.deepEqual(slotsFor({ courseId: 'c1', cover: 'desk', phase: 'opening' }, '/room'), { home: 'live', page: 'preview', pageInert: true });
  // The room's /dashboard is a Home address too.
  assert.equal(slotsFor({ courseId: 'c1', cover: 'course', phase: 'closing' }, '/dashboard').home, 'kept');
  // Another course or another page: the desk is let go.
  assert.deepEqual(slotsFor({ courseId: 'c1', cover: 'course', phase: 'shown' }, '/room/course/c2'), { home: null, page: 'live', pageInert: false });
  assert.deepEqual(slotsFor({ courseId: 'c1', cover: 'course', phase: 'shown' }, '/room/note/c1/n1'), { home: null, page: 'live', pageInert: false });
  assert.equal(coursePath('c9'), '/room/course/c9');
});

test('desk film: the state store and the desk opener (Ctrl K asks the desk first)', () => {
  let heard = 0;
  const off = subscribeFilm(() => (heard += 1));
  setFilm({ courseId: 'c1', cover: 'desk', phase: 'opening' });
  setFilm({ cover: 'course' });
  assert.deepEqual(getFilm(), { courseId: 'c1', cover: 'course', phase: 'opening' });
  setFilm(null);
  assert.equal(getFilm(), null);
  assert.equal(heard, 3);
  off();
  assert.equal(openCourseOnDesk('c1'), false);
  setDeskOpener((id) => id === 'c1');
  assert.equal(openCourseOnDesk('c1'), true);
  assert.equal(openCourseOnDesk('c2'), false);
  setDeskOpener(null);
});

test('desk film: the book wears its own leather, label and gilt; its title on one line or two', () => {
  assert.deepEqual(coverLines('Logic'), ['Logic']);
  assert.deepEqual(coverLines('History of the Arab World'), ['History of', 'the Arab World']);
  assert.deepEqual(coverLines('Notes on the Theory'), ['Notes on', 'the Theory']);
  assert.ok(coverLines('Introduction to Probability and Statistics').length === 2);
  for (const mood of ['night', 'day', 'nightC1']) {
    const look = filmLook(SCENE, mood, 'L1', { name: 'Data Structures', color: '#2f7bb8' });
    assert.match(look.cover, /^#[0-9a-f]{6}$/);
    assert.match(look.label, /^#[0-9a-f]{6}$/);
    assert.match(look.gilt, /^#[0-9a-f]{6}$/);
    assert.equal(look.title, 'Data Structures');
    // The page and ground by the mood: the night's page is the candle's warm paper, the day's pale.
    const lum = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).reduce((a, b) => a + b, 0);
    if (isNightKey(mood)) assert.ok(lum(look.paper) < lum('#c4bfb8'));
    assert.ok(lum(look.ink) < lum(look.paper), 'the title page\'s ink is darker than its paper');
  }
});

test('desk moves: a book lifted off its pile leaves the books above it one place lower; a near book none', () => {
  const r = arrangePiles(['a', 'b', 'c', 'd', 'e'], { a: 'L0', b: 'L1', c: 'L2', d: 'R0', e: 'N0' });
  const lifted = liftOut(r, 'b');
  assert.equal(lifted.map.b, undefined);
  assert.equal(lifted.map.a, 'L0');
  assert.equal(lifted.map.c, 'L1');
  assert.equal(lifted.map.d, 'R0');
  assert.equal(lifted.map.e, 'N0');
  assert.ok(lifted.books.every((x) => x.id !== 'b'));
  const nearLift = liftOut(r, 'e');
  assert.equal(nearLift.map.c, 'L2');
  assert.equal(liftOut(r, 'nobody'), r);
  // An announced map drawn as an arrangement; keys independent of order.
  const next = arrangementFrom({ c: 'L1', a: 'L0', b: 'R1', d: 'R0', e: 'N0' }, r);
  assert.equal(next.books.length, 5);
  assert.equal(placesKey({ b: 'L1', a: 'L0' }), placesKey({ a: 'L0', b: 'L1' }));
});

// Owner fixes (2026-11-23): the held book's film as one motion, and the film's Home address.
test('held film: a plain dissolve: Calm 280 ms with a small settle, Still 150 ms, the same length back', async () => {
  const { HELD_EASE, HELD_MS, HELD_SETTLE, HELD_STILL_MS, HELD_WAIT_MS, bezier, heldMs } = await import('../src/room/deskFilm.js');
  // The brief: Calm about 0.25 to 0.3 s, Still about 0.15 s.
  assert.ok(HELD_MS >= 250 && HELD_MS <= 300);
  assert.equal(HELD_STILL_MS, 150);
  assert.equal(heldMs(), HELD_MS);
  assert.equal(heldMs(undefined, true), HELD_STILL_MS);
  assert.equal(heldMs('nonsense'), HELD_MS);
  assert.equal(heldMs(600), 600, 'the harness may ask for another length');
  assert.equal(heldMs(600, true), 600);
  assert.equal(heldMs(20), HELD_MS, 'out of bounds: the default');
  // The open book's settle is small: a few pixels, a few percent, and it only ever comes to rest (eased out, never past).
  assert.ok(HELD_SETTLE.lift > 0 && HELD_SETTLE.lift <= 12);
  assert.ok(HELD_SETTLE.scale >= 0.97 && HELD_SETTLE.scale < 1);
  const e = bezier(...HELD_EASE);
  let last = 0;
  for (let t = 0; t <= 1.0001; t += 0.05) {
    const v = e(Math.min(1, t));
    assert.ok(v >= last - 1e-9 && v <= 1 + 1e-9, `never back, never past (t ${t.toFixed(2)})`);
    last = v;
  }
  assert.ok(e(0.5) > 0.7, 'eased out: most of the way in the first half');
  // The desk stands for a page that is not whole yet far longer than a slow page needs.
  assert.ok(HELD_WAIT_MS >= 8000);
});

test('held film: closing or turned round, the page stays under the desk, out of reach, while the film holds it', () => {
  const closing = { courseId: 'c3', cover: 'desk', phase: 'closing' };
  assert.deepEqual(slotsFor(closing, '/room'), { home: 'live', page: null, pageInert: false });
  assert.deepEqual(slotsFor({ ...closing, holdPage: true }, '/room'), { home: 'live', page: 'preview', pageInert: true });
  // From the shown page: the course over the kept desk until the book is home (deskFilmRun changes the page directly).
  assert.deepEqual(slotsFor({ courseId: 'c3', cover: 'course', phase: 'closing' }, '/room'), { home: 'kept', page: 'held', pageInert: false });
});

test('the film\'s Home address: the book\'s way back goes to the Home the desk is kept at', async () => {
  const { HOME_PATHS, filmHome, homePathOf } = await import('../src/room/deskFilm.js');
  assert.deepEqual(HOME_PATHS, ['/room', '/dashboard']);
  assert.equal(homePathOf('/dashboard'), '/dashboard');
  assert.equal(homePathOf('/room'), '/room');
  assert.equal(homePathOf('/room/course/c3'), '/room');
  assert.equal(homePathOf(undefined), '/room');
  assert.equal(filmHome({ home: '/dashboard' }), '/dashboard');
  assert.equal(filmHome({}), '/room');
  assert.equal(filmHome(null), '/room');
});
