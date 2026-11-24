// Round eight, run 3: the course as the opened book (src/room/deskBook.js, deskBookPages.js) and the
// film's slots for it (deskFilm.js). Pure maths and rules only; the pictures live in the harness.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bookLight, bookShows, getDeskBook, setDeskBook } from '../src/room/deskBook.js';
import { applyH, bookTitle, gridAt, heldFit, homography, lineFix, nextClass, pageOnWindow, quadError } from '../src/room/deskBookPages.js';
import { noteOfFilm, openPoseAt, poseScreen, slotsFor, modelSize } from '../src/room/deskFilm.js';

// A page like the held book's: a text area 500 x 760 px seen a little in perspective, its lines bowing
// (the paper's cup) by up to `bow` px.
const pageWith = (bow = 2) => {
  const quad = [
    [336, 138],
    [832, 157],
    [832, 903],
    [336, 921],
  ];
  const H = homography(
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    quad,
  );
  const grid = Array.from({ length: 17 }, (_, i) =>
    Array.from({ length: 13 }, (_, j) => {
      const [x, y] = applyH(H, [j / 12, i / 16]);
      return [x, y + bow * Math.sin((Math.PI * j) / 12) * (1 - Math.abs(i / 8 - 1) * 0.3)];
    }),
  );
  return { quad, grid };
};

test('the book shows only when registered, the desk is Home (or forced) and the window is the stage', () => {
  assert.equal(getDeskBook(), null, 'nothing registered by the app');
  assert.equal(bookShows({ width: 1536, homeIsDesk: true }), false);
  const book = { held: () => null };
  assert.equal(bookShows({ width: 1536, homeIsDesk: true }, book), true);
  assert.equal(bookShows({ width: 1536, homeIsDesk: false }, book), false, 'the papers Home keeps the course page');
  assert.equal(bookShows({ width: 1536, homeIsDesk: false }, { ...book, forceDesk: true }), true);
  assert.equal(bookShows({ width: 700, homeIsDesk: true }, book), false, 'tablets and phones keep the course page');
  setDeskBook(book);
  assert.equal(bookShows({ width: 1536, homeIsDesk: true }), true);
  setDeskBook(null);
  assert.equal(bookLight('nightC1'), 'night');
  assert.equal(bookLight('day'), 'day');
});

test('the held picture: the book whole, its words clear of the top line, the window covered when it can be', () => {
  const held = { frame: [1800, 1080], box: [252, 40, 1550, 1036], pages: { left: { quad: pageWith().quad }, right: { quad: pageWith().quad } } };
  for (const [width, height] of [
    [1280, 650],
    [1536, 750],
    [1920, 1080],
    [2560, 1080],
  ]) {
    const fit = heldFit({ width, height }, held);
    const box = [fit.left + 252 * fit.scale, fit.top + 40 * fit.scale, fit.left + 1550 * fit.scale, fit.top + 1036 * fit.scale];
    assert.ok(box[0] >= -0.5 && box[2] <= width + 0.5 && box[1] >= -0.5 && box[3] <= height + 0.5, `the book on ${width}x${height}`);
    assert.ok(fit.top + 138 * fit.scale >= 75.5, `its words below the top line on ${width}x${height}`);
    if (!fit.bars) assert.ok(fit.left <= 0.5 && fit.top <= 0.5 && fit.left + fit.width >= width - 0.5 && fit.top + fit.height >= height - 0.5);
  }
  assert.equal(heldFit({ width: 1920, height: 1080 }, held).bars, false);
});

test('a homography takes the four corners where they go, and the page box onto its text area', () => {
  const src = [
    [0, 0],
    [10, 0],
    [10, 20],
    [0, 20],
  ];
  const dst = [
    [3, 4],
    [15, 5],
    [16, 30],
    [2, 27],
  ];
  const H = homography(src, dst);
  src.forEach((p, i) => {
    const q = applyH(H, p);
    assert.ok(Math.hypot(q[0] - dst[i][0], q[1] - dst[i][1]) < 1e-6);
  });
  const page = pageWith(0);
  const pw = pageOnWindow(page, { scale: 0.7, left: 10, top: 20 });
  const corner = applyH(pw.H, [pw.w, pw.h]);
  assert.ok(Math.hypot(corner[0] - (10 + 832 * 0.7), corner[1] - (20 + 903 * 0.7)) < 1e-6);
  assert.match(pw.css, /^matrix3d\(/);
});

test("each line's own fix follows the cup: within 1.5 css px where one quad alone is not", () => {
  const page = pageWith(2.2);
  for (const scale of [0.7, 1]) {
    const alone = quadError(page, scale, { fixed: false });
    const fixed = quadError(page, scale);
    assert.ok(fixed < alone, `the fix helps at ${scale}`);
    assert.ok(fixed <= 1.5, `per line within 1.5 css px at ${scale} (${fixed.toFixed(2)})`);
  }
  // A flat page: one quad is exact, and a line's fix is (all but) the identity.
  const flat = pageWith(0);
  assert.ok(quadError(flat, 1, { fixed: false }) < 1e-6);
  const A = lineFix(pageOnWindow(flat, { scale: 1, left: 0, top: 0 }), 100, 20);
  [1, 0, 0, 1, 0, 0].forEach((v, i) => assert.ok(Math.abs(A[i] - v) < (i < 4 ? 1e-3 : 0.05), `fix ${i}: ${A[i]}`));
  assert.deepEqual(gridAt(flat.grid, 0, 0), flat.grid[0][0]);
});

test("the course's name: one or two lines, then smaller, then the spine's cut", () => {
  const measure = (text, size) => text.length * size * 0.5;
  assert.deepEqual(bookTitle('Paradigm', { width: 300, size: 30, small: 20, measure }), { lines: ['Paradigm'], size: 30 });
  const two = bookTitle('History of the Arab World', { width: 260, size: 30, small: 20, measure });
  assert.equal(two.lines.length, 2);
  assert.equal(two.size, 30);
  const smaller = bookTitle('Comparative Politics of the Middle East & Africa', { width: 260, size: 30, small: 20, measure });
  assert.equal(smaller.size, 20);
  assert.ok(smaller.lines.length <= 2);
  const cut = bookTitle('Comparative Politics of the Middle East and North Africa Today', { width: 200, size: 30, small: 20, measure });
  assert.ok(cut.lines.length <= 2 && cut.lines.every((line) => measure(line, 20) <= 200 + 1e-6), 'cut to fit');
});

test('the next class, from a schedule and the breaks', () => {
  const course = { schedule: { days: [1, 3], time: '13:30' } };
  // Sunday 22 Nov 2026, 19:00: Monday's class is next.
  assert.equal(nextClass(course, new Date(2026, 10, 22, 19, 0)), 'Tomorrow 13:30');
  // Monday 13:00: today's is still to come; at 14:00 Wednesday's.
  assert.equal(nextClass(course, new Date(2026, 10, 23, 13, 0)), 'Today 13:30');
  assert.equal(nextClass(course, new Date(2026, 10, 23, 14, 0)), 'Wednesday 13:30');
  assert.equal(nextClass(course, new Date(2026, 10, 22, 19, 0), [{ id: 'b', name: 'Break', from: '2026-11-23', until: '2026-11-27' }]), 'Monday 13:30');
  assert.equal(nextClass({}, new Date()), '');
});

test('the film lands on the picture: openPoseAt puts the spine and the height where the spread is', () => {
  // The stage's camera at some fit (its focal length and principal point on the window).
  const cam = { f: 1100, ox: 768, oy: 330, at: [0, -0.45, 1.1] };
  const spread = { x: 760, cy: 380, tall: 640 };
  const { pose } = openPoseAt(cam, spread);
  const size = modelSize();
  const top = poseScreen(cam, pose, [0, 0, 0]);
  const bottom = poseScreen(cam, pose, [0, size.h, 0]);
  assert.ok(Math.abs(top[0] - spread.x) < 1, 'the spine on the spread');
  assert.ok(Math.abs(bottom[1] - top[1] - spread.tall) < 2, 'its height');
  assert.ok(Math.abs((top[1] + bottom[1]) / 2 - spread.cy) < 1, 'its middle');
});

test("a note of the book's course keeps the desk; anything else lets it go", () => {
  const state = { courseId: 'c3', cover: 'course', phase: 'shown' };
  assert.equal(noteOfFilm(state, '/room/note/c3/n1'), true);
  assert.equal(noteOfFilm(state, '/room/note/c4/n1'), false);
  assert.deepEqual(slotsFor(state, '/room/note/c3/n1', ['/room'], null, true), { home: 'kept', page: 'live', pageInert: false });
  assert.deepEqual(slotsFor(state, '/room/note/c3/n1', ['/room'], null, false), { home: null, page: 'live', pageInert: false });
});

// Owner fixes (2026-11-23, E): the open book's own outline (the film's book is the held picture cut to it).
test("the book's outline: two halves that meet on the spine, the pages inside them, whole device pixels", async () => {
  const { BOOK_EDGE, bookOutline, outlineClip } = await import('../src/room/deskBookPages.js');
  // prod1's held pages (core.json held.pages, the paper's corners in the picture's px).
  const pages = {
    left: { page: [[276.689, 65.261], [902.822, 103.001], [902.842, 976.659], [276.454, 1015.25]] },
    right: { page: [[897.178, 103.001], [1528.562, 60.465], [1528.877, 1020.105], [897.158, 976.659]] },
  };
  const fit = { left: 0, top: 0, scale: 1 };
  const o = bookOutline(pages, fit);
  // The halves share the spine's edge, top and foot.
  assert.deepEqual(o.left.poly[1], o.right.poly[0]);
  assert.deepEqual(o.left.poly[2], o.right.poly[3]);
  assert.ok(Math.abs(o.spine - 900) < 0.01, `the spine between the two pages (${o.spine})`);
  // The boards pass the paper on every side (the measured edge).
  assert.ok(o.left.box[0] <= 276.454 - BOOK_EDGE.outLeft + 0.01);
  assert.ok(o.right.box[0] + o.right.box[2] >= 1528.877 + BOOK_EDGE.outRight - 0.01);
  assert.ok(o.left.box[1] < 65.261 && o.right.box[1] < 60.465);
  assert.ok(o.left.box[1] + o.left.box[3] > 1015.25 && o.right.box[1] + o.right.box[3] > 1020.105);
  // Shut, the left half turned over the spine lies on the right half: the same width within a few px.
  assert.ok(Math.abs(o.left.box[2] - o.right.box[2]) < 12, `${o.left.box[2]} against ${o.right.box[2]}`);
  // On a window: scaled and placed with the fit; with a device pixel ratio, each box on whole device pixels, never
  // smaller than the outline.
  const fit2 = { left: 13.3, top: -41.7, scale: 0.8533 };
  const plain = bookOutline(pages, fit2);
  const snapped = bookOutline(pages, fit2, undefined, 1.25);
  for (const side of ['left', 'right']) {
    const [x, y, w, h] = snapped[side].box;
    for (const v of [x, y, x + w, y + h]) assert.ok(Math.abs(v * 1.25 - Math.round(v * 1.25)) < 1e-6, `${side}: ${v} is on a device pixel`);
    assert.ok(x <= plain[side].box[0] + 1e-9 && y <= plain[side].box[1] + 1e-9);
    assert.ok(x + w >= plain[side].box[0] + plain[side].box[2] - 1e-6 && y + h >= plain[side].box[1] + plain[side].box[3] - 1e-6);
    assert.deepEqual(snapped[side].poly, plain[side].poly, 'the outline itself is not moved');
  }
  // The clip in the half's own box.
  const clip = outlineClip(o.left);
  assert.match(clip, /^polygon\(/);
  const first = clip.slice(8).split(',')[0].trim().split(' ').map(parseFloat);
  assert.ok(Math.abs(first[0] - (o.left.poly[0][0] - o.left.box[0])) < 0.01 && Math.abs(first[1] - (o.left.poly[0][1] - o.left.box[1])) < 0.01);
});
