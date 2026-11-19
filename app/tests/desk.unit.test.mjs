import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  BOOKS_PER_ROW,
  BP_COMPACT,
  BP_HUGE,
  BP_PHONE,
  BP_TABLET,
  BP_WIDE,
  CLOTH_MEAN,
  CLOTH_SPREAD,
  DAY_SHADOW,
  DESK_COMPACT_MIN,
  INK_DARK,
  INK_LIGHT,
  MIN_CONTRAST,
  NIGHT_SHADE,
  NIGHT_SHADE_ALPHA,
  TITLE_MIN,
  bookTilt,
  breakpointFor,
  castShadow,
  contrast,
  coverContrast,
  coverInk,
  coverTone,
  deskLayout,
  parseColor,
  rowsFor,
  textDirection,
  titleSize,
  wordEm,
} from '../src/room/deskLayout.js';
import {
  boxOfRect,
  flightBox,
  flightProgress,
  flightSize,
  flightStyle,
  rememberPick,
  rememberReturn,
  takePick,
  takeReturn,
} from '../src/room/deskFlight.js';
import { apply, clipPolygon, homography, quadBox, quadMatrix2d, quadMatrix3d, quadSize, quadSkew, quadTaper, quadTransform, rectToQuad } from '../src/room/deskProject.js';
import {
  CROP,
  NATIVE,
  PILE_DEPTH,
  PLACES,
  arrangePiles,
  moveInPile,
  moveToOtherPile,
  pageCapacity,
  pilePlaces,
  stageFit,
  S_MIN,
  S_MAX,
  SURROUND,
  ghostPlace,
  pictureDensity,
  LEATHERS,
  SPINE_ABBREVIATIONS,
  SPINE_BASE,
  SPINE_CAP,
  SPINE_FLOOR,
  SPINE_LINE,
  abbreviateTitle,
  countMeasure,
  fitSpineCount,
  fitSpineTitle,
  labelOf,
  leatherOf,
  spareTitle,
  spineLook,
  spineMeasure,
  TYPE_MIN,
  typeFloor,
  STAGE_TYPE,
  stageType,
  spineFloor,
  moreSize,
  pileHits,
  heightAt,
  pageHeights,
  PAGE_BOX,
  MAX_ROWS,
  cardHint,
  CARD_HINTS,
  COUNT_FACE,
  COUNT_FACES,
  TOOLED_PX,
  giltSmall,
  NEAR_PLACES,
  isNearPlace,
  bringCloser,
  putBack,
  homePile,
  dragTargets,
  moveTo,
  isDrag,
  DRAG_PX,
  LONG_PRESS_MS,
  pickTarget,
  candleOf,
  candlePlaces,
  candleRing,
  isNightKey,
  nightKeyOf,
  pointInPolygon,
} from '../src/room/deskStage.js';
import { PAGE_LINE_CHARS, PAGE_LINES, pageLines } from '../src/room/deskPage.js';

// The palettes are read from their own files (read only), so the test follows them.
const readColors = (path, constName) => {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const start = source.indexOf(constName);
  assert.ok(start >= 0, `${constName} not found in ${path}`);
  const block = source.slice(start, source.indexOf('];', start));
  return [...block.matchAll(/'((?:#[0-9a-fA-F]{3,6})|(?:oklch\([^)]*\)))'/g)].map((m) => m[1]);
};

const CLASS_PALETTE = readColors('../src/components/classes/AddClassSheet.jsx', 'const CLASS_PALETTE');
const ROOM_COURSE_COLORS = readColors('../src/room/components/CourseSheet.jsx', 'const ROOM_COURSE_COLORS');
// The room's own six, plus the extremes a course colour could still be.
const FIXTURE_PALETTE = [...ROOM_COURSE_COLORS, '#ffffff', '#000000', '#808080', '#f6dc7a', '#ff0000', '#00ffcc', '#123'];

test('desk: both palettes were found', () => {
  assert.equal(CLASS_PALETTE.length, 8);
  assert.ok(CLASS_PALETTE.every((c) => c.startsWith('oklch(')));
  assert.equal(ROOM_COURSE_COLORS.length, 6);
});

test('desk: breakpoints', () => {
  assert.equal(breakpointFor(390), BP_PHONE);
  assert.equal(breakpointFor(760), BP_PHONE);
  assert.equal(breakpointFor(761), BP_TABLET);
  assert.equal(breakpointFor(DESK_COMPACT_MIN - 1), BP_TABLET);
  assert.equal(breakpointFor(DESK_COMPACT_MIN), BP_COMPACT);
  assert.equal(breakpointFor(1440), BP_WIDE);
  assert.equal(breakpointFor(1920), BP_HUGE);
});

test('desk: rows hold every book and the "+ New course" slot, three a row', () => {
  assert.equal(BOOKS_PER_ROW, 3);
  assert.equal(rowsFor(0), 1);
  assert.equal(rowsFor(2), 1);
  assert.equal(rowsFor(3), 2);
  assert.equal(rowsFor(5), 2);
  assert.equal(rowsFor(6), 3);
  assert.equal(rowsFor(12), 5);
  assert.equal(rowsFor(-4), 1);
  assert.equal(rowsFor(7, 2), 4);
  for (let n = 0; n < 40; n += 1) assert.ok(rowsFor(n) * BOOKS_PER_ROW >= n + 1);
});

test('desk: a book is never more than 1.2° askew, and never at the angle of the one before', () => {
  for (let i = 0; i < 300; i += 1) {
    assert.ok(Math.abs(bookTilt(i)) <= 1.2, `tilt ${i}`);
    assert.notEqual(bookTilt(i), bookTilt(i + 1), `tilt ${i} repeats`);
  }
});

test('desk: by candlelight a shadow falls away from the flame, longer and softer further off', () => {
  const candle = { x: 64, y: 5 };
  const slots = [
    { x: 200, y: 80, width: 120, height: 160 },
    { x: 900, y: 60, width: 120, height: 160 },
    { x: 1200, y: 420, width: 120, height: 160 },
    { x: 20, y: 500, width: 340, height: 96 },
    { x: 1100, y: -150, width: 230, height: 160 },
  ];
  slots.forEach((slot) => {
    const s = castShadow(slot, candle, { night: true });
    const away = { x: slot.x + slot.width / 2 - candle.x, y: slot.y + slot.height / 2 - candle.y };
    assert.ok(s.dx * away.x + s.dy * away.y > 0, `shadow of ${JSON.stringify(slot)} points at the candle`);
    assert.ok(s.alpha > 0 && s.alpha < 1);
    assert.ok(s.blur > 0);
  });
  const near = castShadow({ x: 150, y: 60, width: 100, height: 100 }, candle);
  const far = castShadow({ x: 1300, y: 60, width: 100, height: 100 }, candle);
  assert.ok(Math.hypot(far.dx, far.dy) > Math.hypot(near.dx, near.dy));
  assert.ok(far.blur >= near.blur);
  assert.ok(far.alpha <= near.alpha);
  // By day: short and soft, down and to the right, the same for everything.
  assert.deepEqual(castShadow(slots[1], candle, { night: false }), DAY_SHADOW);
  assert.ok(DAY_SHADOW.dx > 0 && DAY_SHADOW.dy > 0);
});

test('desk: colours parse — hex, short hex, rgb() and classic oklch()', () => {
  assert.deepEqual(parseColor('#ffffff'), [1, 1, 1]);
  assert.deepEqual(parseColor('#000'), [0, 0, 0]);
  assert.deepEqual(parseColor('rgb(255, 0, 0)'), [1, 0, 0]);
  const grey = parseColor('oklch(0.5 0 0)');
  assert.ok(Math.abs(grey[0] - grey[1]) < 0.002 && Math.abs(grey[1] - grey[2]) < 0.002);
  assert.ok(Math.abs(grey[0] - 0.389) < 0.01); // oklch L 0.5 is about #636363
  assert.equal(parseColor('not a colour'), null);
  assert.equal(Math.round(contrast([1, 1, 1], [0, 0, 0])), 21);
});

// The worst a title meets, worked out here from the exported constants rather than taken
// from coverContrast: the cloth's lightest threads by day for a light ink, its darkest
// under the night's shade for a dark one.
const worstFor = (color) => {
  const tone = parseColor(coverTone(color));
  const ink = coverInk(color);
  if (ink === INK_LIGHT) {
    return contrast(parseColor(INK_LIGHT), tone.map((v) => Math.min(1, v * CLOTH_MEAN * (1 + CLOTH_SPREAD))));
  }
  const drawn = tone.map((v, i) => v * CLOTH_MEAN * (1 - CLOTH_SPREAD) * (1 - NIGHT_SHADE_ALPHA) + NIGHT_SHADE[i] * NIGHT_SHADE_ALPHA);
  return contrast(parseColor(INK_DARK), drawn);
};

test('desk: every title holds 4.5:1 on its cloth — the room palette, extremes and classic CLASS_PALETTE', () => {
  [...FIXTURE_PALETTE, ...CLASS_PALETTE].forEach((color) => {
    const ink = coverInk(color);
    assert.ok(ink === INK_LIGHT || ink === INK_DARK, `${color}: ink ${ink}`);
    assert.match(coverTone(color), /^#[0-9a-f]{6}$/);
    assert.ok(coverContrast(color) >= MIN_CONTRAST, `${color}: ${coverContrast(color).toFixed(2)}`);
    assert.ok(worstFor(color) >= MIN_CONTRAST - 1e-9, `${color}: recomputed ${worstFor(color).toFixed(2)}`);
  });
  // A course with no colour (or a broken one) still gets a readable book.
  assert.ok(coverContrast(undefined) >= MIN_CONTRAST);
  assert.ok(coverContrast('nonsense') >= MIN_CONTRAST);
});

test('desk: a title steps down rather than break inside a word', () => {
  const width = 90;
  [
    'Paradigm',
    'Data Structures',
    'History of the Arab World',
    'Théorie économique avancée',
    'Comparative Politics of the Middle East & Africa',
    'Internationalisation',
    'تاريخ العالم العربي',
  ].forEach((name) => {
    const size = titleSize(name, width);
    assert.ok(size >= TITLE_MIN && size <= 18.5, `${name}: ${size}`);
    const widest = Math.max(...name.split(/\s+/).map(wordEm));
    if (size > TITLE_MIN) assert.ok(widest * size <= width, `${name}: ${widest * size}px in ${width}px`);
  });
  assert.equal(titleSize('Paradigm'), 18.5);
  assert.ok(titleSize('Comparative Politics of the Middle East & Africa') < titleSize('History of the Arab World'));
});

test('desk: Arabic and Hebrew titles read right to left', () => {
  assert.equal(textDirection('تاريخ العالم العربي'), 'rtl');
  assert.equal(textDirection('תולדות'), 'rtl');
  assert.equal(textDirection('Théorie économique avancée'), 'ltr');
  assert.equal(textDirection('2025 — تاريخ'), 'rtl');
  assert.equal(textDirection(''), 'ltr');
});

test('desk flight: the cloth\'s box, size and clip — moved and cut, never scaled', () => {
  const from = { x: 600, y: 300, w: 130, h: 185 };
  const to = { x: 56, y: 90, w: 360, h: 52 };
  assert.deepEqual(flightBox(from, to, 0), from);
  assert.deepEqual(flightBox(from, to, 1), to);
  assert.deepEqual(flightBox(from, to, 0.5), { x: 328, y: 195, w: 245, h: 118.5 });
  assert.deepEqual(flightBox(from, to, 7), to, 'clamped');
  const size = flightSize(from, to);
  assert.deepEqual(size, { w: 360, h: 185 });
  assert.equal(flightProgress(from, to, from), 0);
  assert.equal(flightProgress(from, to, to), 1);
  const style = flightStyle(from, size);
  assert.equal(style.transform, 'translate3d(600.00px, 300.00px, 0)');
  assert.equal(style.clipPath, 'inset(0px 230.00px 0.00px 0px round 6px)');
  assert.deepEqual(boxOfRect({ left: 1, top: 2, width: 3, height: 4 }), { x: 1, y: 2, w: 3, h: 4 });
});

test('desk flight: the way home is taken once, only fresh', () => {
  rememberReturn({ left: 56, top: 90, width: 360, height: 52 }, 'c2', 1000);
  assert.deepEqual(takeReturn(1500), { rect: { left: 56, top: 90, width: 360, height: 52 }, courseId: 'c2', at: 1000 });
  assert.equal(takeReturn(1500), null);
  rememberReturn({ left: 1, top: 2, width: 3, height: 4 }, 'c2', 1000);
  assert.equal(takeReturn(9000), null, 'stale');
});

test('desk: the flow desks lay nothing out themselves, but still know where the light is', () => {
  [BP_PHONE, BP_TABLET].forEach((breakpoint) => {
    const layout = deskLayout({ count: 5, breakpoint });
    assert.equal(layout.flow, true);
    assert.equal(layout.books.length, 5);
    assert.ok(layout.candle && Number.isFinite(layout.candle.x));
    assert.equal(layout.light, null);
  });
});

test('deskFlight: a pick is taken once, only fresh, only for its own course', () => {
  rememberPick({ left: 10, top: 20, width: 120, height: 160, extra: 'dropped' }, 'c2', 1000);
  assert.deepEqual(takePick(undefined, 1500), {
    rect: { left: 10, top: 20, width: 120, height: 160 },
    courseId: 'c2',
    at: 1000,
    look: null,
  });
  rememberPick({ left: 1, top: 2, width: 3, height: 4 }, 'c5', 1000, { cover: '#123456', title: 'Statistics' });
  assert.deepEqual(takePick('c5', 1200).look, { cover: '#123456', title: 'Statistics' });
  assert.equal(takePick(undefined, 1500), null);

  rememberPick({ left: 1, top: 2, width: 3, height: 4 }, 'c2', 1000);
  assert.equal(takePick('c9', 1100), null);
  assert.equal(takePick('c2', 1100), null, 'a mismatched take still clears it');

  rememberPick({ left: 1, top: 2, width: 3, height: 4 }, 'c3', 1000);
  assert.equal(takePick('c3', 4000), null, 'stale');

  rememberPick(null, 'c3', 1000);
  assert.equal(takePick(), null);
  rememberPick({ left: 'x' }, 'c4', 1000);
  assert.deepEqual(takePick('c4', 1000).rect, { left: 0, top: 0, width: 0, height: 0 });
});

/* ── The notebook's open page (deskPage.js) ───────────────────────────────────── */

test('desk page: each heading, paragraph and item is a line; marks and entities read as text', () => {
  const blocks = [
    { type: 'text', value: '<h2>What a heap promises</h2><p>The <mark data-color="#f6dc7a">smallest</mark> key &amp; <a href="https://example.com">more</a></p>' },
    { type: 'checklist', value: '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Read chapter 6</p></li></ul>' },
  ];
  assert.deepEqual(pageLines(blocks), ['What a heap promises', 'The smallest key & more', 'Read chapter 6']);
  assert.deepEqual(pageLines([{ type: 'text', value: '<p>one<br>two   <strong>three</strong></p>' }]), ['one', 'two three']);
});

test('desk page: prose only, a callout with its label, two columns left then right', () => {
  const blocks = [
    { type: 'callout', label: 'Prof said', value: '<p></p>' },
    { type: 'code', value: 'def f():\n    return 1' },
    { type: 'math', value: 'x^2 + y^2 = r^2' },
    { type: 'image', value: 'https://example.com/a.png', alt: 'a photo' },
    { type: 'text', rail: true, value: '<p>pinned beside the page</p>' },
    { type: 'callout', label: 'Prof said', value: '<p>Heapify is O(n).</p>' },
    { type: 'twoColumn', colA: [{ type: 'text', value: '<h2>Min-heap</h2>' }], colB: [{ type: 'text', value: '<h2>Max-heap</h2>' }] },
  ];
  assert.deepEqual(pageLines(blocks), ['Prof said: Heapify is O(n).', 'Min-heap', 'Max-heap']);
});

test('desk page: four lines at most, a long line cut, nothing at all for an empty page', () => {
  const many = Array.from({ length: 9 }, (_, i) => ({ type: 'text', value: `<p>line ${i}</p>` }));
  assert.equal(pageLines(many).length, PAGE_LINES);
  assert.deepEqual(pageLines(many).slice(0, 2), ['line 0', 'line 1']);
  const long = pageLines([{ type: 'text', value: `<p>${'word '.repeat(200)}</p>` }])[0];
  assert.ok(long.length <= PAGE_LINE_CHARS && long.endsWith('…'));
  assert.deepEqual(pageLines([]), []);
  assert.deepEqual(pageLines(undefined), []);
  assert.deepEqual(pageLines([{ type: 'text', value: '<p>   </p><h2></h2>' }]), []);
});

/* ── The stage (wide screens): Blender's render, the page's words ─────────────────── */

const SCENE = JSON.parse(readFileSync(new URL('../src/room/assets/desk/scene.json', import.meta.url), 'utf8'));
const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// A CSS matrix3d (column-major) applied to a point of the element.
const through = (css, [x, y]) => {
  const m = css.slice(9, -1).split(',').map(Number);
  const w = m[3] * x + m[7] * y + m[15];
  return [(m[0] * x + m[4] * y + m[12]) / w, (m[1] * x + m[5] * y + m[13]) / w];
};

test('desk project: a homography takes each corner to its corner, and lines stay lines', () => {
  const quads = [
    [[0, 0], [100, 0], [100, 50], [0, 50]],
    [[12, 30], [212, 34], [208, 90], [10, 84]],
    [[420, 240], [680, 240], [701, 590], [395, 590]], // a page: wider at its foot
    [[1071, 557], [1356, 561], [1356, 604], [1071, 600]], // a spine
  ];
  quads.forEach((quad) => {
    const [w, h] = [300, 140];
    const H = rectToQuad(quad, w, h);
    [[0, 0], [w, 0], [w, h], [0, h]].forEach((corner, i) => {
      const [x, y] = apply(H, corner);
      assert.ok(close(x, quad[i][0], 1e-6) && close(y, quad[i][1], 1e-6), `${JSON.stringify(quad)} corner ${i}`);
    });
    // Points along a straight line of the element land on one straight line.
    [[[0, 0], [w, h]], [[0, h / 3], [w, h / 3]], [[w / 5, 0], [w / 2, h]]].forEach(([a, b]) => {
      const pts = [0, 0.13, 0.5, 0.71, 1].map((t) => apply(H, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]));
      const [p0, p1] = [pts[0], pts[pts.length - 1]];
      const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
      pts.forEach((pt) => {
        const cross = ((p1[0] - p0[0]) * (pt[1] - p0[1]) - (p1[1] - p0[1]) * (pt[0] - p0[0])) / len;
        assert.ok(Math.abs(cross) < 1e-6, `off the line by ${cross}`);
      });
    });
  });
  // Degenerate: three corners on one line.
  assert.equal(homography([[0, 0], [1, 0], [2, 0], [0, 1]], [[0, 0], [1, 0], [1, 1], [0, 1]]), null);
  assert.equal(quadMatrix3d([[0, 0], [1, 0], [2, 0], [3, 0]], 10, 10), 'none');
});

test('desk project: matrix3d draws the element on its quad, at the stage scale', () => {
  const quad = [[420.5, 240.25], [681, 238], [702.5, 591], [394, 592.5]];
  [1, 0.7638, 1.3333].forEach((scale) => {
    const css = quadMatrix3d(quad, 250, 348, scale);
    assert.match(css, /^matrix3d\(/);
    [[0, 0], [250, 0], [250, 348], [0, 348]].forEach((corner, i) => {
      const [x, y] = through(css, corner);
      assert.ok(close(x, quad[i][0] * scale, 1e-4) && close(y, quad[i][1] * scale, 1e-4), `scale ${scale} corner ${i}: ${x},${y}`);
    });
  });
  assert.deepEqual(quadBox([[1, 2], [5, 1], [6, 9], [0, 8]]), [0, 1, 6, 8]);
  assert.deepEqual(quadSize([[0, 0], [10, 0], [10, 4], [0, 4]]), { width: 10, height: 4 });
  assert.ok(close(quadTaper([[10, 0], [20, 0], [21, 10], [9, 10]]), 1.2));
  assert.equal(clipPolygon([[10, 10], [20, 10], [20, 20]], [5, 5], 2), 'polygon(10px 10px, 30px 10px, 30px 30px)');
});

test('desk stage: every window shows the most room it can hold — the crop inside, a floor for reading, the surround, no bars', () => {
  const near = (a, b, tol = 0.06) => Math.abs(a - b) <= tol;
  // Round seven: the least scale is 0.7 (was 0.9; the planner's pick over 0.6), so the owner's
  // 1536 x 750 window holds the frame's height but 9 px; the words keep 13 css px on their own
  // (typeFloor), not through the scale.
  assert.equal(S_MIN, 0.7);
  assert.equal(S_MAX, 2.4);
  // window: [scale, region x, y, w, h (stage px), the surround wanted, the whole crop shows]
  const table = {
    '1280x650': [0.7, -14.3, 88, 1828.6, 928.6, true, true],
    '1366x705': [0.7, -75.7, 72.9, 1951.4, 1007.1, true, true],
    '1536x750': [0.7, -197.1, 8.6, 2194.3, 1071.4, true, true],
    '1440x810': [0.7, -128.6, 42.9, 2057.1, 1157.1, true, true],
    '1440x900': [0.7, -128.6, -85.7, 2057.1, 1285.7, true, true],
    '1600x900': [0.7, -242.9, -85.7, 2285.7, 1285.7, true, true],
    '1680x1050': [1050 / 1320, -156, -120, 2112, 1320, true, true],
    '1920x950': [950 / 1320, -433.9, -120, 2667.8, 1320, true, true],
    '1920x1080': [1080 / 1320, -273.3, -120, 2346.7, 1320, true, true],
    '2560x1080': [1080 / 1320, -664.4, -120, 3128.9, 1320, true, true],
    '2560x1440': [1440 / 1320, -273.3, -120, 2346.7, 1320, true, true],
    '2560x1600': [1600 / 1320, -156, -120, 2112, 1320, true, true],
    '3440x1440': [1440 / 1320, -676.7, -120, 3153.3, 1320, true, true],
    '3840x2160': [2160 / 1320, -273.3, -120, 2346.7, 1320, true, true],
    '5120x1440': [5120 / 3900, -1050, 88, 3900, 1096.9, true, true],
    '1440x1080': [1080 / 1320, 20, -120, 1760, 1320, true, true],
    '1600x1200': [1200 / 1320, 20, -120, 1760, 1320, true, true],
    '1280x1024': [1024 / 1320, 75, -120, 1650, 1320, true, true],
  };
  Object.entries(table).forEach(([key, [scale, x, y, rw, rh, wanted, whole]]) => {
    const [w, h] = key.split('x').map(Number);
    const fit = stageFit(w, h, NATIVE, CROP, SURROUND);
    assert.ok(near(fit.scale, scale, 1e-3), `${key}: scale ${fit.scale}`);
    assert.ok(fit.scale >= S_MIN - 1e-9 && fit.scale <= S_MAX + 1e-9, `${key}: within the floor and the cap`);
    // The type floor rides with the fit: 13 css px whatever the scale.
    assert.ok(near(fit.floor * fit.scale, TYPE_MIN, 1e-9), `${key}: the floor ${fit.floor}`);
    const r = fit.region;
    assert.ok(near(r.x, x, 0.1) && near(r.y, y, 0.1) && near(r.width, rw, 0.1) && near(r.height, rh, 0.1), `${key}: region ${JSON.stringify(r)}`);
    assert.equal(fit.surround, wanted, `${key}: the surround`);
    // No bars anywhere from 32:9 to 5:4 once the surround is in.
    Object.entries(fit.bars).forEach(([side, size]) => assert.ok(size < 0.5, `${key}: a bar ${side} ${size}`));
    // The window and the region are one picture: the frame's box is the region drawn at the scale.
    assert.ok(near(fit.left, -x * fit.scale, 0.2) && near(fit.top, -y * fit.scale, 0.2), `${key}: the frame's box`);
    assert.ok(near(fit.width, NATIVE.width * fit.scale) && near(fit.height, NATIVE.height * fit.scale), `${key}: the frame keeps its shape`);
    // The crop: centred across, wholly inside whenever the floor allows it, its foot always in.
    assert.ok(near(fit.crop.left + fit.crop.width / 2, w / 2, 0.2), `${key}: the crop is centred`);
    const inside = fit.crop.left >= -0.5 && fit.crop.top >= -0.5 && fit.crop.left + fit.crop.width <= w + 0.5 && fit.crop.top + fit.crop.height <= h + 0.5;
    assert.equal(inside, whole, `${key}: the whole crop shows`);
    assert.ok(fit.crop.top + fit.crop.height <= h + 0.5, `${key}: the near table never goes`);
    // A region that fits in the plain frame never leaves it (no surround wanted there).
    if (rw <= NATIVE.width && rh <= NATIVE.height) assert.ok(r.x >= -0.5 && r.y >= -0.5 && r.x + r.width <= NATIVE.width + 0.5 && r.y + r.height <= NATIVE.height + 0.5, `${key}: inside the frame`);
  });
  // Before the surround is in, the plain frame: a 32:9 window has bars at its sides until it is.
  const plain = stageFit(5120, 1440, NATIVE, CROP);
  assert.ok(plain.bars.left > 100 && plain.bars.right > 100 && plain.surround, '5120x1440 before the surround');
  // The owner's own window (about 1536 x 750 at 125%): the floor, the frame's height but 9 px, its
  // whole width and 197 px of the surround each side.
  const own = stageFit(1536, 750, NATIVE, CROP, SURROUND);
  assert.ok(own.region.width > CROP.width + 200 && own.region.height > CROP.height, '1536x750 shows more than the crop');
  assert.ok(own.region.height >= NATIVE.height - 9 && own.region.width >= NATIVE.width, '1536x750 shows the frame but 9 px of its height');
  assert.ok(near(typeFloor(0.7), 18.571, 1e-3) && near(typeFloor(0.6), 21.667, 1e-3) && near(typeFloor(0.9), 14.444, 1e-3) && near(typeFloor(1), 13, 1e-9));
  // Pictures: 2x from 1.25 device px a stage px, 1x below and when saving data.
  assert.equal(pictureDensity(0.7, 1.25), 1, 'the owner: 1x pictures, drawn down (sharp)');
  assert.equal(pictureDensity(0.9, 1), 1);
  assert.equal(pictureDensity(0.9, 1.25), 1);
  assert.equal(pictureDensity(1.0667, 1.25), 2);
  assert.equal(pictureDensity(0.9, 2), 2);
  assert.equal(pictureDensity(2.1333, 1), 2);
  assert.equal(pictureDensity(2.1333, 1, true), 1);
});

test('desk stage: courses alternate between the piles, twelve each, then "and N more"; "+ New course" is the ghost of the next book', () => {
  assert.equal(PILE_DEPTH, 12);
  assert.equal(PLACES.length, 2 * PILE_DEPTH);
  assert.deepEqual(pilePlaces(0), { books: [], more: null });
  assert.deepEqual(pilePlaces(1), { books: ['L0'], more: null });
  assert.deepEqual(pilePlaces(3), { books: ['L0', 'R0', 'L1'], more: null });
  assert.equal(pilePlaces(16).books.length, 16);
  assert.equal(pilePlaces(24).books.length, 24);
  assert.equal(pilePlaces(24).more, null);
  assert.deepEqual(pilePlaces(25).more, { place: 'R11', count: 2 });
  assert.deepEqual(pilePlaces(30).more, { place: 'R11', count: 7 });
  for (let n = 0; n < 40; n += 1) {
    const p = pilePlaces(n);
    const used = [...p.books, ...(p.more ? [p.more.place] : [])];
    assert.equal(new Set(used).size, used.length, `${n}: a place used twice`);
    used.forEach((place) => assert.ok(PLACES.includes(place)));
    assert.equal(p.books.length + (p.more ? p.more.count : 0), n, `${n}: every course is a book or counted`);
    // The ghost: on the shorter pile's next place, never on a place in use; none past twenty-four.
    const ghost = ghostPlace(p.books, p.more);
    if (n >= 24) assert.equal(ghost, null, `${n}: no ghost when the piles are full`);
    else assert.ok(ghost && !used.includes(ghost) && PLACES.includes(ghost), `${n}: ghost ${ghost}`);
  }
  assert.equal(ghostPlace([]), 'L0', 'the empty desk: the ghost alone at L0');
  assert.equal(ghostPlace(['L0']), 'R0');
  assert.equal(ghostPlace(['L0', 'R0']), 'L1');
  assert.equal(ghostPlace(['L0', 'L1', 'L2']), 'R0', 'the shorter pile');
  const twelve = Array.from({ length: 12 }, (_, i) => `L${i}`);
  assert.equal(ghostPlace([...twelve, 'R0', 'R1']), 'R2');
  assert.equal(ghostPlace([...twelve, ...twelve.map((p) => p.replace('L', 'R'))]), null);
  assert.equal(ghostPlace(['L0'], { place: 'R11', count: 3 }), null);
});

test('desk stage: a course binds in one of six leathers by its hue; its label contrasts', () => {
  const colours = [...FIXTURE_PALETTE, ...CLASS_PALETTE, undefined, 'nonsense'];
  colours.forEach((colour) => {
    const leather = leatherOf(colour);
    assert.ok(LEATHERS.includes(leather), `${colour}: ${leather}`);
    assert.ok(['black', 'oxblood'].includes(labelOf(leather)));
    assert.notEqual(labelOf(leather), leather, `${colour}: a label in its own leather`);
  });
  assert.equal(leatherOf('#c0392b'), 'oxblood');
  assert.equal(leatherOf('#e67e22'), 'chestnut');
  assert.equal(leatherOf('#f1c40f'), 'tan');
  assert.equal(leatherOf('#27ae60'), 'bottle');
  assert.equal(leatherOf('#2980b9'), 'navy');
  assert.equal(leatherOf('#808080'), 'black', 'no hue: black morocco');
  assert.equal(leatherOf('oklch(0.62 0.13 250)'), 'navy', "classic's oklch palette");
});

test('desk stage: every gilt title and count holds 4.5:1 on its dyed label, by night and by day, every pile and near place', () => {
  const colours = [...FIXTURE_PALETTE, ...CLASS_PALETTE, undefined, 'nonsense'];
  ['night', 'day'].forEach((mood) => {
    [...PLACES, ...NEAR_PLACES].forEach((place) => {
      colours.forEach((colour) => {
        const look = spineLook(SCENE, mood, place, colour);
        [look.tint, look.labelTint, look.cover, look.gilt].forEach((hex) => assert.match(hex, /^#[0-9a-f]{6}$/));
        assert.ok(look.contrast.title >= MIN_CONTRAST, `${mood} ${place} ${colour} (${look.leather}, ${look.label} label): title ${look.contrast.title}`);
        assert.ok(look.contrast.count >= MIN_CONTRAST, `${mood} ${place} ${colour} (${look.leather}, ${look.label} label): count ${look.contrast.count}`);
      });
    });
  });
});

// A title's fit holds what it promises: every line inside the label at its size, the lines inside
// its height, the size between the floor and the base, at most SPINE_CAP letters, no ellipsis.
const holds = (fit, { width, height }, title) => {
  assert.ok(fit.size >= SPINE_FLOOR - 1e-6 && fit.size <= SPINE_BASE + 1e-6, `${title}: size ${fit.size}`);
  fit.lines.forEach((line) => assert.ok(spineMeasure(line, fit.size) <= width + 1e-6, `${title}: "${line}" too wide at ${fit.size}`));
  assert.ok(fit.lines.length * fit.size * SPINE_LINE <= height + 1e-6, `${title}: ${fit.lines.length} lines too tall`);
  assert.ok(fit.lines.join(' ').length <= SPINE_CAP, `${title}: ${fit.lines.join(' ').length} letters`);
  fit.lines.forEach((line) => assert.ok(!/…|\.\.\./.test(line), `${title}: an ellipsis`));
};

test('desk stage: a spine title is generous and logical — one line, two, smaller, shortened, cut at a word', () => {
  const label = { width: 122, height: 30, spineHeight: 44 };
  const thin = { width: 122, height: 22, spineHeight: 36 };
  // (1) One line at the base size when it fits.
  assert.deepEqual(fitSpineTitle('Ethics', label), { lines: ['Ethics'], size: SPINE_BASE, rule: 'one' });
  assert.deepEqual(fitSpineTitle('  Calculus   II ', label), { lines: ['Calculus II'], size: SPINE_BASE, rule: 'one' });
  // (2) Two lines broken at a word, balanced, on a spine of 40px or more.
  const two = fitSpineTitle('Organic Chemistry', label);
  assert.equal(two.rule, 'two');
  assert.deepEqual(two.lines, ['Organic', 'Chemistry']);
  holds(two, label, 'Organic Chemistry');
  const three = fitSpineTitle('Introduction to Algorithms', label);
  assert.equal(three.rule, 'two');
  assert.equal(three.lines.join(' '), 'Introduction to Algorithms');
  // Balanced: no other break of the same words holds a larger size.
  const words = 'Introduction to Algorithms'.split(' ');
  for (let k = 1; k < words.length; k += 1) {
    const lines = [words.slice(0, k).join(' '), words.slice(k).join(' ')];
    const size = Math.min(SPINE_BASE, ...lines.map((line) => (100 * label.width) / spineMeasure(line, 100)), label.height / (2 * SPINE_LINE));
    assert.ok(size <= three.size + 1e-6, `${lines.join(' / ')} would hold ${size} > ${three.size}`);
  }
  // Under 40px the spine keeps one line: (3) smaller, down to the floor.
  const shrink = fitSpineTitle('Data Structures', thin);
  assert.equal(shrink.rule, 'shrink');
  assert.deepEqual(shrink.lines, ['Data Structures']);
  holds(shrink, thin, 'Data Structures');
  // (4) Shortened by the table when it would not fit at the floor.
  const short = fitSpineTitle('Introduction to Organic Chemistry', label);
  assert.ok(short.rule.startsWith('abbrev'), short.rule);
  assert.equal(short.lines.join(' '), 'Intro. to Org. Chem.');
  holds(short, label, 'Introduction to Organic Chemistry');
  // (4b) Then without its function words (of, the, a, an, to, for, in, on; "and" as "&"), before any
  // cut: "Hist. Arab World" on L1's own label, not a cut "Hist. of the Arab". (Run two's Spectral SC
  // cut it to "Hist. Arab"; EB Garamond's small caps hold it again.)
  const l1Box = quadSize(SCENE.quads.spineLabels.L1);
  const l1 = { width: l1Box.width - 2, height: l1Box.height, spineHeight: quadSize(SCENE.quads.spines.L1).height };
  const arab = fitSpineTitle('History of the Arab World', l1);
  assert.equal(arab.lines.join(' '), 'Hist. Arab World');
  assert.ok(arab.rule.startsWith('spare'), arab.rule);
  holds(arab, l1, 'History of the Arab World');
  const oneLine = (width) => ({ width, height: 22, spineHeight: 36 });
  [
    ['Introduction to Linear Algebra', 160, 'Intro. Linear Algebra'],
    ['Principles of Organic Chemistry', 130, 'Princ. Org. Chem.'],
    ['Foundations of Modern Physics', 150, 'Found. Modern Phys.'],
    ['History of the Arab World', 130, 'Hist. Arab World'],
  ].forEach(([name, width, want]) => {
    const fit = fitSpineTitle(name, oneLine(width));
    assert.equal(fit.lines.join(' '), want, `${name} on ${width}px`);
    assert.ok(fit.rule.startsWith('spare'), `${name}: ${fit.rule}`);
    holds(fit, oneLine(width), name);
  });
  assert.equal(spareTitle('Science and Society in the Ancient World'), 'Science & Society Ancient World');
  assert.equal(spareTitle('The'), 'The', 'a title of function words alone stays');
  // (5) Cut at the last word that fits, no ellipsis, never on "&"; one word sooner where a phrase
  // ends ("Comparative Politics", not "Comparative Politics Middle").
  const cut = fitSpineTitle('Introduction to Computer Science and Programming in Python', thin);
  assert.ok(cut.rule.startsWith('cut'), cut.rule);
  assert.equal(cut.lines.join(' '), 'Intro. Comp. Sci.');
  holds(cut, thin, 'Introduction to Computer Science and Programming in Python');
  assert.deepEqual(fitSpineTitle('Comparative Politics of the Middle East & Africa', label).lines, ['Comparative', 'Politics']);
  // A lone word too long for the floor: its letters that fit and an abbreviation's stop.
  const word = fitSpineTitle('Pneumonoultramicroscopicsilicovolcanoconiosis', thin);
  assert.equal(word.rule, 'cut-word');
  assert.match(word.lines[0], /^Pneumonoul\w*\.$/);
  assert.ok(spineMeasure(word.lines[0], SPINE_FLOOR) <= thin.width);
  // The cap: never more than 32 letters, a long title shortened and spared before it is cut.
  const long = fitSpineTitle('Advanced Principles of Organic Chemistry Laboratory Techniques', { width: 400, height: 30, spineHeight: 44 });
  assert.ok(long.lines.join(' ').length <= SPINE_CAP);
  assert.equal(long.lines.join(' '), 'Adv. Princ. Org. Chem. Lab.');
  // The table, and a stop never doubled.
  assert.equal(abbreviateTitle('History of Science.'), 'Hist. of Sci.');
  assert.equal(abbreviateTitle('physics and chemistry, organic'), 'Phys. and Chem., Org.');
  assert.equal(Object.keys(SPINE_ABBREVIATIONS).length, 23);
  assert.deepEqual(fitSpineTitle('', label), { lines: [], size: SPINE_BASE, rule: 'empty' });
  // Every real title on every spine of the render: it holds.
  const titles = ['Paradigm', 'Data Structures', 'History of the Arab World', 'Linear Algebra', 'Statistics', 'Organic Chemistry',
    'Philosophy of Mind', 'Thermodynamics', 'Microeconomics', 'Introduction to Psychology', 'Advanced Engineering Mathematics',
    'Fundamentals of Computer Science', 'الكيمياء العضوية', 'Électromagnétisme', 'A', 'Introduction to Linear Algebra',
    'Principles of Organic Chemistry', 'Foundations of Modern Physics',
    // The harness's hardest names (?worst=1).
    'Comparative Politics of the Middle East & Africa', 'تاريخ العالم العربي', 'Théorie économique avancée'];
  Object.keys(SCENE.quads.spineLabels).forEach((place) => {
    const box = quadSize(SCENE.quads.spineLabels[place]);
    const size = { width: box.width - 2, height: box.height, spineHeight: quadSize(SCENE.quads.spines[place]).height };
    titles.forEach((title) => {
      const fit = fitSpineTitle(title, size);
      if (fit.rule !== 'cut-word') holds(fit, size, `${place} ${title}`);
      // Once spared or cut, no function word is left, and no line ends on one.
      if (/^(spare|cut)/.test(fit.rule)) {
        fit.lines.forEach((line) => assert.ok(!/(^| )(of|the|a|an|to|for|in|on|and)( |$)/i.test(line), `${place} ${title}: "${line}"`));
      }
      fit.lines.forEach((line) => assert.ok(!/ (&|and|the|a|an)$/i.test(line), `${place} ${title}: "${line}" ends on an article or "and"`));
    });
    // The common long words of course names fit whole on every label (run two's Spectral SC cut the
    // 14-letter ones; EB Garamond's small caps hold them, as round six's Cormorant did).
    ['Thermodynamics', 'Microeconomics', 'Organizational', 'Biochemistry'].forEach((longWord) => {
      assert.notEqual(fitSpineTitle(longWord, size).rule, 'cut-word', `${place}: ${longWord} cut`);
    });
  });
});

test('desk stage: the candle stands at one of its places, each with its own night, by day its own shadow', () => {
  assert.equal(candleOf(SCENE, undefined), 'C0');
  assert.equal(candleOf(SCENE, 'C9'), 'C0', 'an unknown place: the first');
  assert.equal(nightKeyOf(SCENE, 'C0'), 'night');
  assert.ok(isNightKey('night') && isNightKey('nightC1') && !isNightKey('day'));
  const places = candlePlaces(SCENE);
  assert.ok(places.includes('C0'));
  places.forEach((place) => {
    const c = SCENE.candles[place];
    assert.ok(SCENE.images[c.night], `${place}: its night`);
    assert.equal(candleOf(SCENE, place), place);
    assert.equal(nightKeyOf(SCENE, place), c.night);
    // Its box inside the frame with 20 px to spare (the planner's rule), its wick and flame in it.
    const [x0, y0, x1, y1] = c.box;
    assert.ok(x0 >= 20 && x1 <= SCENE.stage.width - 20 && y1 <= SCENE.stage.height, `${place} box ${c.box}`);
    const [wx, wy] = c.points.wick;
    assert.ok(wx > x0 && wx < x1 && wy > y0 && wy < y1, `${place} wick`);
    // By day: its picture and its shadow on the room (a link, half the stage's px).
    assert.ok(c.day?.candle, `${place}: its day picture`);
    if (c.day.link) assert.equal(c.day.link.res, 0.5);
    // Its ring for a drag: around its dish, on the table.
    const ring = candleRing(c.box);
    assert.equal(ring.length, 28);
    ring.forEach(([x, y]) => assert.ok(x >= x0 - 6 && x <= x1 + 6 && y >= y0 && y <= y1 + 6, `${place} ring`));
  });
  // A place whose night is not rendered is not offered.
  const partial = { candles: { C0: { night: 'night' }, C1: { night: 'nightC1' } }, images: { night: {} } };
  assert.deepEqual(candlePlaces(partial), ['C0']);
  assert.equal(candleOf(partial, 'C1'), 'C0');
  assert.equal(nightKeyOf(partial, 'C1'), 'night');
});

test('desk stage: the frame is behind pile R from its ninth book up (its picture controls then absent)', () => {
  const [x, y, w, h] = quadBox(SCENE.quads.frameOpening);
  const centre = [x + w / 2, y + h / 2];
  const silhouette = (place) => {
    const top = SCENE.quads.tops[place];
    const spine = SCENE.quads.spines[place];
    return [top[0], top[1], spine[1], spine[2], spine[3], spine[0]];
  };
  const covering = PLACES.filter((place) => pointInPolygon(silhouette(place), centre));
  assert.ok(covering.length > 0 && covering.every((p) => p[0] === 'R' && Number(p.slice(1)) >= 8), covering.join(','));
  assert.equal(pointInPolygon([[0, 0], [10, 0], [10, 10], [0, 10]], [5, 5]), true);
  assert.equal(pointInPolygon([[0, 0], [10, 0], [10, 10], [0, 10]], [15, 5]), false);
});

test('desk stage: a near place holds one book, only the student puts one there, the piles settle around it', () => {
  const ids = Array.from({ length: 12 }, (_, i) => `c${i}`);
  assert.deepEqual(NEAR_PLACES, ['N0']);
  assert.ok(SCENE.nearPlaces.N0 && SCENE.quads.covers.N0 && SCENE.quads.coverLabels.N0 && SCENE.quads.coverCounts.N0 && SCENE.quads.nearHulls.N0);
  // arrangePiles never fills a near place by itself.
  const plain = arrangePiles(ids, null);
  assert.ok(plain.books.every(({ place }) => !isNearPlace(place)));
  assert.ok(Array.from({ length: 30 }, (_, n) => arrangePiles(ids.slice(0, n), null)).every((a) => Object.values(a.map).every((p) => !isNearPlace(p))));
  // A saved map may hold N0 (or N1, ignored while there is no N1): kept; one book a place.
  const saved = arrangePiles(ids, { c3: 'N0', c5: 'N0', c7: 'N1' });
  assert.equal(saved.map.c3, 'N0');
  assert.notEqual(saved.map.c5, 'N0');
  assert.ok(!isNearPlace(saved.map.c7));
  assert.equal(Object.values(saved.map).filter(isNearPlace).length, 1);
  assert.equal(saved.books.length, 12);
  assert.equal(saved.changed, true, 'the second N0 and the N1 moved');
  // The piles hold the rest, settled from the bottom (no gap where c3 was).
  ['L', 'R'].forEach((side) => {
    const levels = Object.values(saved.map).filter((p) => p[0] === side).map((p) => Number(p.slice(1))).sort((a, b) => a - b);
    assert.deepEqual(levels, levels.map((_, i) => i), side);
  });
  // The ghost of the next book never takes a near place, and counts only the piles.
  assert.ok(!isNearPlace(ghostPlace(saved.books.map((b) => b.place), saved.more)));
  assert.equal(ghostPlace(['N0']), 'L0');
  // "and N more" counts only what is shown nowhere: 25 courses, one near, all on the desk.
  const many = Array.from({ length: 26 }, (_, i) => `m${i}`);
  const full = arrangePiles(many.slice(0, 25), { m0: 'N0' });
  assert.equal(full.more, null);
  assert.equal(full.books.length, 25);
  const over = arrangePiles(many, { m0: 'N0' });
  assert.equal(over.more.count, 2, 'twenty-three on the piles and one near');
  assert.ok(!isNearPlace(over.more.place));
  // A book there keeps its course's colour (its leather and label from the course, its look the place's).
  ['night', 'day'].forEach((mood) => {
    const look = spineLook(SCENE, mood, 'N0', '#c9711f');
    assert.equal(look.leather, leatherOf('#c9711f'));
    assert.equal(look.label, labelOf(look.leather));
  });
});

test('desk stage: bring closer, put back, the other pile, drag targets and drops', () => {
  const ids = Array.from({ length: 12 }, (_, i) => `c${i}`);
  const arr = arrangePiles(ids, null);
  // c2 lies on pile L (L1): brought closer, pile L settles, where it lay is remembered.
  assert.equal(arr.map.c2, 'L1');
  const closer = bringCloser(arr, 'c2', {});
  assert.equal(closer.map.c2, 'N0');
  assert.equal(closer.from.c2, 'L');
  assert.equal(closer.map.c4, 'L1', 'the books above dropped');
  assert.equal(Object.values(closer.map).filter((p) => p[0] === 'L').length, 5);
  assert.equal(bringCloser({ map: closer.map }, 'c2', closer.from), null, 'already near');
  // Put back: on top of the pile it came from.
  const back = putBack({ map: closer.map }, 'c2', closer.from);
  assert.equal(back.map.c2, 'L5');
  assert.equal(back.from.c2, undefined);
  assert.equal(putBack(arr, 'c2', {}), null, 'not near');
  // N0 taken: the book there goes back to its pile's next free slot first.
  const swap = bringCloser({ map: closer.map }, 'c1', closer.from);
  assert.equal(swap.map.c1, 'N0');
  assert.equal(swap.map.c2, 'L5');
  assert.equal(swap.from.c1, 'R');
  assert.equal(Object.values(swap.map).filter(isNearPlace).length, 1);
  ['L', 'R'].forEach((side) => {
    const levels = Object.values(swap.map).filter((p) => p[0] === side).map((p) => Number(p.slice(1))).sort((a, b) => a - b);
    assert.deepEqual(levels, levels.map((_, i) => i), side);
  });
  // Unknown pile: the shorter (the left on a tie).
  assert.equal(homePile({ map: { a: 'N0', b: 'L0', c: 'R0', d: 'R1' } }, 'a', {}), 'L');
  // A near book to "the other pile": the one it did not come from.
  assert.equal(moveToOtherPile({ map: closer.map }, 'c2', closer.from).c2, 'R6');
  // Alt + arrows do not move a near book within a pile.
  assert.equal(moveInPile({ map: closer.map }, 'c2', 1), null);
  // Drag targets: its own place, the next free slot on each pile (its own pile's top only where it
  // is not the top), the near place.
  assert.deepEqual(dragTargets(arr, 'c2'), [
    { place: 'L1', kind: 'own' },
    { place: 'L6', kind: 'pile' },
    { place: 'R6', kind: 'pile' },
    { place: 'N0', kind: 'near' },
  ]);
  assert.deepEqual(dragTargets(arr, 'c10').map((t) => t.place), ['L5', 'R6', 'N0'], 'the top of its pile: no own-pile target');
  assert.deepEqual(dragTargets({ map: closer.map }, 'c2').map((t) => t.place), ['N0', 'L5', 'R6']);
  // Drops.
  assert.equal(moveTo(arr, 'c2', 'L1'), null, 'its own place: nothing');
  assert.equal(moveTo(arr, 'c2', 'N0').map.c2, 'N0');
  assert.equal(moveTo(arr, 'c2', 'R6').map.c2, 'R6');
  const top = moveTo(arr, 'c2', 'L6').map;
  assert.equal(top.c2, 'L5', 'the top of its own pile, the pile settled');
  assert.equal(top.c4, 'L1');
  assert.equal(moveTo({ map: closer.map }, 'c2', 'R6', closer.from).map.c2, 'R6');
  // The threshold: under 6 css px a click, from 6 a drag; a touch drag after a long press.
  assert.equal(DRAG_PX, 6);
  assert.equal(LONG_PRESS_MS, 350);
  assert.equal(isDrag(3, 4), false);
  assert.equal(isDrag(5.9, 0), false);
  assert.equal(isDrag(6, 0), true);
  assert.equal(isDrag(-4.3, 4.3), true);
  // Target choice: the polygon under the pointer, else the nearest centre within reach, else none.
  const square = (x, y, s, place) => ({ place, polygon: [[x, y], [x + s, y], [x + s, y + s], [x, y + s]] });
  const targets = [square(0, 0, 100, 'L6'), square(300, 0, 100, 'R6'), square(150, 300, 120, 'N0')];
  assert.equal(pickTarget(targets, [50, 50]), 'L6');
  assert.equal(pickTarget(targets, [200, 360]), 'N0');
  assert.equal(pickTarget(targets, [405, 50]), 'R6', 'near enough');
  assert.equal(pickTarget(targets, [800, 800]), null);
});

test('desk stage: the gilt is tooled by its size on the screen, and drawn flat where its label is flat', () => {
  assert.equal(TOOLED_PX, 18);
  // The owner's window (the stage at 0.7, 1.25 device px a css px): a 18.6px title is 16.3 device px.
  assert.equal(giltSmall(18.6, 0.7, 1.25), true);
  assert.equal(giltSmall(17, 1, 1), true);
  assert.equal(giltSmall(17, 1, 2), false, 'a 2x screen: the full tooled look');
  assert.equal(giltSmall(18.6, 0.7, 2), false);
  assert.equal(giltSmall(17, 1.1, 1), false, 'a big window');
  // Every spine label is flat enough for a 2D matrix at every density; its corners within half a
  // device px of the homography's.
  Object.values(SCENE.quads.spineLabels).forEach((quad) => {
    const { width, height } = quadSize(quad);
    [1, 1.25, 2].forEach((dpr) => {
      assert.match(quadTransform(quad, width, height, 1, { x: 0, y: 0, dpr }), /^matrix\(/);
    });
    assert.ok(quadSkew(quad) / 4 <= 0.25, `skew ${quadSkew(quad)}`);
  });
  // The 2D matrix through the mean edges: the centre exact, corners within a quarter of the skew.
  const quad = SCENE.quads.spineLabels.L3;
  const { width, height } = quadSize(quad);
  const m = quadMatrix2d(quad, width, height, 1).slice(7, -1).split(',').map(Number);
  const at = ([u, v]) => [m[0] * u + m[2] * v + m[4], m[1] * u + m[3] * v + m[5]];
  [[0, 0], [width, 0], [width, height], [0, height]].forEach((corner, i) => {
    const [x, y] = at(corner);
    assert.ok(Math.hypot(x - quad[i][0], y - quad[i][1]) <= quadSkew(quad) / 4 + 1e-6, `corner ${i}`);
  });
  // Snapped: the origin on a whole device px.
  const snapped = quadMatrix2d(quad, width, height, 0.7, { x: 10.3, y: 20.45, dpr: 1.25 }).slice(7, -1).split(',').map(Number);
  assert.ok(Math.abs(((10.3 + snapped[4]) * 1.25) % 1) < 1e-6 || Math.abs(((10.3 + snapped[4]) * 1.25) % 1) > 1 - 1e-6);
  assert.ok(Math.abs(((20.45 + snapped[5]) * 1.25) % 1) < 1e-6 || Math.abs(((20.45 + snapped[5]) * 1.25) % 1) > 1 - 1e-6);
  // A tapered quad (the notebook's page) keeps the homography.
  const page = SCENE.quads.pageL;
  assert.match(quadTransform(page, 274, 375, 1, { x: 0, y: 0, dpr: 1 }), /^matrix3d\(/);
});

test('desk stage: a count fits its label in heavy figures, one or two at a title size on every place, never under the floor', () => {
  [1, 0.85, S_MIN].forEach((scale) => {
    const floor = spineFloor(scale);
    Object.keys(SCENE.quads.spineCounts).forEach((place) => {
      const box = quadSize(SCENE.quads.spineCounts[place]);
      const size = { width: box.width - 1, height: box.height, floor };
      ['1', '3', '12', '99', '128'].forEach((count) => {
        const fit = fitSpineCount(count, size);
        assert.equal(fit.face, COUNT_FACE);
        if (!fit.text) {
          // Dropped (round seven: no narrower face) only where it would be under the floor; the count
          // stays in the book's name. One or two figures are never dropped from 0.85 up (at the least
          // scale, two of Spectral SC 700's figures miss L9's label by 0.4px).
          assert.ok(count.length === 3 || scale < 0.85, `${place} ${count} at ${scale} dropped`);
          assert.ok(countMeasure(count, floor) > size.width, `${place} ${count} would have fitted`);
          return;
        }
        assert.ok(fit.size >= floor - 0.05, `${place} ${count}: ${fit.size}`);
        assert.ok(countMeasure(count, fit.size) <= size.width + 1e-6, `${place} ${count}`);
        // One or two figures always at a title's size (17px, or the floor where that is larger).
        if (count.length <= 2) assert.equal(fit.size, Math.max(17, floor), `${place} ${count} at ${scale}`);
      });
    });
  });
  assert.deepEqual(fitSpineCount(null, { width: 20 }), { text: '', size: 17, face: COUNT_FACE });
  assert.deepEqual(fitSpineCount('128', { width: 22, height: 30 }), { text: '', size: SPINE_FLOOR, face: COUNT_FACE, dropped: true });
  // The figures are tabular: every one the face's advance.
  assert.equal(countMeasure('0123456789', 100) / 1.02, COUNT_FACES[COUNT_FACE] * 1000);
});

test('desk stage: a page holds whole lines only, fewer where the words are large against the picture, the day first', () => {
  // The pages are laid out at the left page's own size at 1x (DeskStage PAGE).
  const page = quadSize(SCENE.quads.pageL);
  assert.deepEqual(PAGE_BOX, { width: Math.round(page.width), height: Math.round(page.height) });
  assert.deepEqual(pageCapacity(0.6), { rows: 2, sentence: 2, lines: 4, clamp: 4, tags: true });
  assert.deepEqual(pageCapacity(0.7), { rows: 3, sentence: 2, lines: 4, clamp: 6, tags: true }, 'the least scale: three rows');
  assert.deepEqual(pageCapacity(0.9), { rows: 4, sentence: 2, lines: 4, clamp: 8, tags: true });
  assert.deepEqual(pageCapacity(1.0), { rows: 4, sentence: 2, lines: 4, clamp: 8, tags: true });
  assert.deepEqual(pageCapacity(1.5), { rows: 4, sentence: 2, lines: 4, clamp: 8, tags: true });
  [0.6, 0.65, 0.7, 0.8, 0.9, 1, 1.5, 2.4].forEach((scale) => {
    const cap = pageCapacity(scale);
    const h = pageHeights(cap, scale);
    // Everything shown fits the page: no line is cut through.
    assert.ok(h.left <= PAGE_BOX.height + 1e-6 && h.right <= PAGE_BOX.height + 1e-6, `${scale}: ${JSON.stringify(h)}`);
    // And it is the most that fits: one more row, or one more line, would not.
    if (cap.rows < MAX_ROWS) assert.ok(pageHeights({ ...cap, rows: cap.rows + 1 }, scale).left > PAGE_BOX.height, `${scale}: a row more would fit`);
    assert.ok(pageHeights({ ...cap, clamp: cap.clamp + 1 }, scale).right > PAGE_BOX.height, `${scale}: a line more would fit`);
    assert.ok(cap.rows >= 1 && cap.sentence >= 1 && cap.clamp >= 3, `${scale}: the page still says something`);
    assert.ok(cap.lines <= 4 && cap.lines <= cap.clamp);
  });
  // A smaller scale never holds more.
  assert.ok(pageCapacity(0.6).rows <= pageCapacity(0.7).rows && pageCapacity(0.7).rows <= pageCapacity(1).rows);
});

test('desk stage: no word the page draws is under 13 css px at the least scale, nor at any other', () => {
  // Every kind of word on the stage, at its own size and at the floor: each takes the larger.
  const kinds = {
    greeting: 22, clock: 14.5, sentence: 14.5, heading: 16, rowTitle: 14.5, rowStamp: 14.5, meta: 14.5, pageTitle: 21,
    lines: 14.5, tags: 14.5, action: 14.5, empty: 14.5, cardInput: 16, cardFoot: 14.5, ghost: 17, frameAdd: 20,
  };
  assert.deepEqual(STAGE_TYPE, kinds, 'the table of kinds');
  [S_MIN, 0.65, 0.7, 0.8, 0.9, 1, 1.5, S_MAX].forEach((scale) => {
    Object.entries(kinds).forEach(([kind, size]) => {
      const drawn = stageType(kind, scale);
      assert.ok(drawn * scale >= TYPE_MIN - 1e-9, `${kind} at ${scale}: ${drawn * scale} css px`);
      assert.ok(drawn >= size, `${kind} at ${scale}: never under its own size`);
      if (size * scale >= TYPE_MIN) assert.equal(drawn, size, `${kind} at ${scale}: its own size where that is enough`);
    });
    // "and N more" on every spine.
    Object.values(SCENE.quads.spines).forEach((quad) => assert.ok(moreSize(quadSize(quad).height, scale) * scale >= TYPE_MIN - 1e-9));
  });
  // desk.css draws each kind at its custom property (DeskStage sets them from stageType).
  const css = readFileSync(new URL('../src/room/desk.css', import.meta.url), 'utf8');
  Object.keys(kinds).forEach((kind) => {
    const name = `--room-stage-type-${kind.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
    assert.ok(new RegExp(`font-size: var\\(${name}[,)]`).test(css), `desk.css draws ${kind} at ${name}`);
  });
  // Every title and count on every label at the least scale: 13 css px or more, or not drawn.
  const titles = ['Paradigm', 'Data Structures', 'History of the Arab World', 'Linear Algebra', 'Organic Chemistry', 'Morning Momo',
    'Comparative Politics of the Middle East & Africa', 'تاريخ العالم العربي', 'Théorie économique avancée', 'Pneumonoultramicroscopicsilicovolcanoconiosis'];
  [S_MIN, 0.7, 0.9].forEach((scale) => {
    const floor = spineFloor(scale);
    assert.ok(floor * scale >= TYPE_MIN - 1e-9 && floor >= SPINE_FLOOR);
    Object.keys(SCENE.quads.spineLabels).forEach((place) => {
      const box = quadSize(SCENE.quads.spineLabels[place]);
      const size = { width: box.width - 2, height: box.height, spineHeight: quadSize(SCENE.quads.spines[place]).height, floor };
      titles.forEach((title) => {
        const fit = fitSpineTitle(title, size);
        if (!fit.lines.length) return;
        assert.ok(fit.size * scale >= TYPE_MIN - 1e-6, `${scale} ${place} ${title}: ${fit.size * scale} css px`);
        assert.ok(fit.lines.length * fit.size * SPINE_LINE <= size.height + 1e-6, `${scale} ${place} ${title}: too tall`);
        if (fit.rule !== 'cut-word') fit.lines.forEach((line) => assert.ok(spineMeasure(line, fit.size) <= size.width + 1e-6, `${scale} ${place} "${line}"`));
      });
      const cbox = quadSize(SCENE.quads.spineCounts[place]);
      ['1', '12', '128'].forEach((count) => {
        const fit = fitSpineCount(count, { width: cbox.width - 1, height: cbox.height, floor });
        if (!fit.text) return;
        assert.ok(fit.size * scale >= TYPE_MIN - 0.02, `${scale} ${place} count ${count}: ${fit.size * scale} css px`);
        assert.ok(countMeasure(count, fit.size, fit.face) <= cbox.width - 1 + 1e-6, `${scale} ${place} count ${count}: too wide`);
      });
    });
  });
  // Every label holds one line at the least scale's floor; a lower one would hold no title.
  Object.keys(SCENE.quads.spineLabels).forEach((place) => {
    const box = quadSize(SCENE.quads.spineLabels[place]);
    assert.ok(box.height / SPINE_LINE >= spineFloor(S_MIN), `${place}: ${box.height}px`);
  });
  assert.deepEqual(fitSpineTitle('Paradigm', { width: 120, height: 12, floor: 21.7 }), { lines: [], size: 21.7, rule: 'none' });
  // A count that will not fit at the floor is dropped (the title keeps its place).
  assert.equal(fitSpineCount('128', { width: 23, height: 24, floor: spineFloor(0.6) }).text, '');
  assert.equal(fitSpineCount('3', { width: 23, height: 24, floor: spineFloor(0.6) }).text, '3');
  // The card says less on a small scale rather than cut a word.
  const line = SCENE.quads.scrap && Math.round(quadSize(SCENE.quads.scrap).width) - 28;
  assert.equal(cardHint(line, stageType('cardInput', 1)), 'Jot something down');
  assert.equal(cardHint(line, stageType('cardInput', S_MIN)), 'Jot it down');
  assert.equal(cardHint(line, stageType('cardInput', 0.6)), 'Jot it down');
  CARD_HINTS.forEach(([hint, em], i) => assert.ok(i === 0 || em < CARD_HINTS[i - 1][1], hint));
});

test('desk stage: a book is at least 24 css px tall to point at, at any scale, never over its neighbour\'s label', () => {
  // Inside a polygon (even-odd).
  const inside = (poly, [x, y]) => {
    let hit = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
      const [xi, yi] = poly[i];
      const [xj, yj] = poly[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
  };
  [S_MIN, 0.7, 0.9, 1, 1.5].forEach((scale) => {
    const need = 24 / scale;
    ['L', 'R'].forEach((side) => {
      for (let n = 1; n <= PILE_DEPTH; n += 1) {
        [false, true].forEach((dashed) => {
          if (dashed && n === PILE_DEPTH) return;
          const places = Array.from({ length: n + (dashed ? 1 : 0) }, (_, i) => `${side}${i}`);
          const hits = pileHits(SCENE.quads, places, need);
          places.forEach((place, k) => {
            const label = SCENE.quads.spineLabels[place];
            const mid = (label[0][0] + label[1][0]) / 2;
            const tall = heightAt(hits[place], mid);
            assert.ok(tall >= need - 0.01, `${scale} ${side}x${n}${dashed ? '+dashed' : ''} ${place}: ${tall.toFixed(1)} < ${need.toFixed(1)}`);
            // Its own title label is its own; no other place's label (title or count) is under it.
            const centre = (q) => [(q[0][0] + q[2][0]) / 2, (q[0][1] + q[2][1]) / 2];
            assert.ok(inside(hits[place], centre(label)), `${scale} ${place}: its own label`);
            places.forEach((other, j) => {
              if (j === k) return;
              ['spineLabels', 'spineCounts'].forEach((key) => {
                const q = SCENE.quads[key][other];
                [...q.map((p) => [p[0] + (p[0] < centre(q)[0] ? 1 : -1), p[1] + (p[1] < centre(q)[1] ? 0.5 : -0.5)]), centre(q)].forEach((p) =>
                  assert.ok(!inside(hits[place], p), `${scale} ${side}x${n} ${place} covers ${other}'s ${key} at ${p.map((v) => v.toFixed(1))}`),
                );
              });
            });
          });
        });
      }
    });
  });
  // Where the books are tall enough already, a book is hit where it is drawn: at scale 1 the boundary
  // between two books is the upper one's spine's foot.
  const hits = pileHits(SCENE.quads, ['L0', 'L1', 'L2'], 24);
  const foot = SCENE.quads.spines.L1[3][1];
  assert.ok(Math.abs(hits.L0[0][1] - foot) < 0.6, `L0's top ${hits.L0[0][1]} vs L1's foot ${foot}`);
});

test('desk stage: the render keeps its promises in the design crop — horizon, far edge, pages, spines, margins', () => {
  const crop = SCENE.crop;
  assert.equal(SCENE.stage.width, NATIVE.width);
  assert.equal(SCENE.stage.height, NATIVE.height);
  assert.ok(crop.width === 1440 && crop.height === 810 && crop.x === (NATIVE.width - 1440) / 2, 'a 1440 x 810 crop, centred');
  const h = (SCENE.horizonY - crop.y) / crop.height;
  const e = (SCENE.farEdgeY - crop.y) / crop.height;
  assert.ok(h >= 0.24 && h <= 0.26, `horizon ${h}`);
  assert.ok(e >= 0.44 && e <= 0.5, `far edge ${e}`);
  const inside = ([x, y], m = 10) => x >= crop.x + m && x <= crop.x + crop.width - m && y >= crop.y + m && y <= crop.y + crop.height - m;
  ['pageL', 'pageR'].forEach((key) => {
    const quad = SCENE.quads[key];
    const size = quadSize(quad);
    assert.ok(quadTaper(quad) <= 1.1, `${key} taper ${quadTaper(quad)}`);
    assert.ok(size.width >= 230 && size.height >= 300, `${key} ${size.width}x${size.height}`);
  });
  Object.entries(SCENE.quads.spines).forEach(([place, quad]) => {
    const tall = Math.min(quad[3][1] - quad[0][1], quad[2][1] - quad[1][1]);
    assert.ok(tall >= 28, `${place}: ${tall}px`);
    quad.forEach((p) => assert.ok(inside(p), `${place} at ${p}`));
  });
  ['scrap', 'frameOuter', 'pageL', 'pageR'].forEach((key) =>
    SCENE.quads[key].forEach((p) => assert.ok(inside(p), `${key} at ${p}`)),
  );
  // The candle (the room's light switch) and the notebook on its stand: inside the crop too.
  [SCENE.boxes.candle, SCENE.boxes.notebook].forEach(([x0, y0, x1, y1]) => {
    assert.ok(inside([x0, y0]) && inside([x1, y1]), `box ${[x0, y0, x1, y1]}`);
  });
});

test('desk stage: a spine label never runs under the book above it', () => {
  // The title's label and the count's sit on the spine's face; the book above may overhang the
  // spine, never into either label (where the page letters).
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  ['L', 'R'].forEach((side) => {
    for (let k = 0; k + 1 < PILE_DEPTH; k += 1) {
      const above = SCENE.quads.spines[`${side}${k + 1}`];
      // The book above's bottom edge, at the label's corners' x.
      const bottomAt = (x) => {
        const u = (x - above[3][0]) / (above[2][0] - above[3][0]);
        return lerp(above[3], above[2], Math.min(1, Math.max(0, u)))[1];
      };
      ['spineLabels', 'spineCounts'].forEach((key) => {
        const [tl, tr] = SCENE.quads[key][`${side}${k}`];
        [tl, tr].forEach((p) => assert.ok(bottomAt(p[0]) <= p[1] + 0.5, `${side}${k + 1} reaches into ${side}${k}'s ${key} at ${p}: ${bottomAt(p[0])}`));
      });
    }
  });
});

test('desk stage: every picture is there, in the stage, within its mood budget', () => {
  const dir = new URL('../src/room/assets/desk/', import.meta.url);
  // Day, today's night and every other candle place's night (run three: nightC1).
  Object.keys(SCENE.images).forEach((mood) => {
    const imgs = SCENE.images[mood];
    const all = [...Object.entries(imgs).filter(([k]) => k !== 'slabs' && k !== 'near').map(([, v]) => v), ...Object.values(imgs.slabs)];
    all.forEach((rec) => {
      [rec.x1, rec.x2].forEach((name) => assert.ok(readFileSync(new URL(name, dir)).length > 0, name));
      const [x, y, w, h] = rec.box;
      assert.ok(x >= 0 && y >= 0 && x + w <= SCENE.stage.width && y + h <= SCENE.stage.height, `${rec.x1} box`);
    });
    Object.values(imgs.slabs).forEach((rec) => {
      // Each book: its object, its leather's and its label's dye masks, its gilt strips (title and
      // count) and its shadow (drawn up from a quarter size, `res` 0.25).
      [rec.leather, rec.label, rec.gilt.title, rec.gilt.count].forEach((r) =>
        [r.x1, r.x2].forEach((name) => assert.ok(readFileSync(new URL(name, dir)).length > 0, name)),
      );
      ['leatherBox', 'labelBox'].forEach((key) => {
        const [bx, by, bw, bh] = rec[key];
        const [ox, oy, ow, oh] = rec.box;
        assert.ok(bx >= ox && by >= oy && bx + bw <= ox + ow && by + bh <= oy + oh, `${rec.x1} ${key} inside the book`);
      });
      assert.ok(rec.shadow, `${rec.x1} has no shadow`);
      [rec.shadow.x1, rec.shadow.x2].forEach((name) => assert.ok(readFileSync(new URL(name, dir)).length > 0, name));
      assert.equal(rec.shadow.res, 0.25);
      const [sx, sy, sw, sh] = rec.shadow.box;
      assert.ok(sx >= 0 && sy >= 0 && sx + sw <= SCENE.stage.width && sy + sh <= SCENE.stage.height, `${rec.shadow.x1} box`);
      // Run three: its shadow past the frame, over the surround (rendered without the piles), drawn
      // with the surround only: an eighth of the stage's px, never past the surround's extent (its
      // grid aside), reaching past the frame.
      if (rec.shadowWide) {
        const ext = SCENE.surround.extent;
        const [wx, wy, ww, wh] = rec.shadowWide.box;
        [rec.shadowWide.x1, rec.shadowWide.x2].forEach((name) => assert.ok(readFileSync(new URL(name, dir)).length > 0, name));
        assert.equal(rec.shadowWide.res, 0.125);
        assert.ok(wx >= ext.x - 8 && wy >= ext.y - 8 && wx + ww <= ext.x + ext.width + 8 && wy + wh <= ext.y + ext.height + 8, `${rec.shadowWide.x1} box`);
        assert.ok(wx < 0 || wy < 0 || wx + ww > SCENE.stage.width || wy + wh > SCENE.stage.height, `${rec.shadowWide.x1} reaches past the frame`);
      }
      // Its count's plate, its own picture (run three), inside the book's box.
      assert.ok(rec.plate, `${rec.x1} has no plate`);
      [rec.plate.x1, rec.plate.x2].forEach((name) => assert.ok(readFileSync(new URL(name, dir)).length > 0, name));
    });
    // By day the candle is its place's (scene.json candles); by night each place's set has its own.
    const candle = mood === 'day' ? SCENE.candles?.C0?.day?.candle || imgs.candle : imgs.candle;
    assert.ok(imgs.notebook && candle && imgs.scrap && imgs.frame, `${mood}: what never moves (its shadows are in the base)`);
    assert.ok(SCENE.budget[mood]['1x'] <= 1.3e6, `${mood} 1x ${SCENE.budget[mood]['1x']}`);
    assert.ok(SCENE.budget[mood]['2x'] <= 2.6e6, `${mood} 2x ${SCENE.budget[mood]['2x']}`);
  });
  assert.equal(Object.keys(SCENE.images.night.slabs).length, PILE_DEPTH * 2);
  assert.equal(Object.keys(SCENE.images.day.slabs).length, PILE_DEPTH * 2);
});

test('desk arrangement: saved places are kept, the rest fill in order, each pile settles from the bottom', () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];
  // Nothing saved: the order of today (L0, R0, L1, ...), and nothing to write.
  const plain = arrangePiles(ids, {});
  assert.deepEqual(plain.books.map((b) => b.place), ['L0', 'R0', 'L1', 'R1', 'L2']);
  assert.equal(plain.changed, false);
  assert.deepEqual(plain.books.map((b) => b.place), pilePlaces(5).books);
  // Saved places honoured; the others take the free places in course order.
  const kept = arrangePiles(ids, { c: 'L0', a: 'R0' });
  assert.equal(kept.map.c, 'L0');
  assert.equal(kept.map.a, 'R0');
  assert.deepEqual([kept.map.b, kept.map.d, kept.map.e], ['L1', 'R1', 'L2']);
  assert.equal(kept.changed, false);
  // A gap (the course saved at L1 is gone): the books above settle down, and the map is written.
  const gap = arrangePiles(['a', 'c'], { a: 'L0', b: 'L1', c: 'L2' });
  assert.deepEqual(gap.map, { a: 'L0', c: 'L1' });
  assert.equal(gap.changed, true);
  // A book saved in mid-air settles onto the pile.
  const air = arrangePiles(['a', 'b'], { a: 'R5' });
  assert.equal(air.map.a, 'R0');
  assert.equal(air.changed, true);
  // A place saved twice: the first course in course order keeps it; the other is placed afresh.
  const twice = arrangePiles(['a', 'b'], { a: 'L0', b: 'L0' });
  assert.equal(twice.map.a, 'L0');
  assert.notEqual(twice.map.b, 'L0');
  assert.equal(twice.changed, true);
  // Places that are not pile places are ignored.
  const odd = arrangePiles(['a', 'b'], { a: 'X3', b: 'L12' });
  assert.deepEqual(odd.books.map((b) => b.place), ['L0', 'R0']);
  // Every place once, at most eight a pile, piles without gaps.
  for (let n = 0; n <= 30; n += 1) {
    const many = Array.from({ length: n }, (_, i) => `c${i}`);
    const saved = Object.fromEntries(many.map((id, i) => [id, PLACES[(i * 7) % PLACES.length]]));
    const r = arrangePiles(many, saved);
    const places = r.books.map((b) => b.place);
    assert.equal(new Set(places).size, places.length, `${n}: a place used twice`);
    ['L', 'R'].forEach((side) => {
      const levels = places.filter((p) => p[0] === side).map((p) => Number(p.slice(1))).sort((x, y) => x - y);
      levels.forEach((level, i) => assert.equal(level, i, `${n}: pile ${side} has a gap`));
      assert.ok(levels.length <= PILE_DEPTH);
    });
    assert.equal(r.books.length + (r.more ? r.more.count : 0), n, `${n}: every course is a book or counted`);
    if (r.more) assert.ok(!places.includes(r.more.place) && PLACES.includes(r.more.place));
  }
});

test('desk arrangement: more courses than places leave "and N more" on the next free place', () => {
  const ids = Array.from({ length: 30 }, (_, i) => `c${i}`);
  const r = arrangePiles(ids, {});
  assert.equal(r.books.length, 23);
  assert.deepEqual(r.more, { place: 'R11', count: 7 });
  // Saved courses keep their places even past the twenty-third.
  const late = arrangePiles(ids, { c29: 'L0' });
  assert.equal(late.map.c29, 'L0');
  assert.equal(late.books.length, 23);
});

test('desk arrangement: a book moves to the top of the other pile, or one place up or down its own', () => {
  const r = arrangePiles(['a', 'b', 'c', 'd'], {});
  assert.deepEqual(r.map, { a: 'L0', b: 'R0', c: 'L1', d: 'R1' });
  // Across: to the other pile's top; the pile it left settles.
  const across = moveToOtherPile(r, 'a');
  assert.deepEqual(across, { a: 'R2', b: 'R0', c: 'L0', d: 'R1' });
  // Up: swaps with the book above; down from the bottom: nothing to do.
  assert.deepEqual(moveInPile(r, 'a', 1), { a: 'L1', b: 'R0', c: 'L0', d: 'R1' });
  assert.equal(moveInPile(r, 'a', -1), null);
  assert.equal(moveInPile(r, 'c', 1), null);
  // A full pile takes no more.
  const full = arrangePiles(Array.from({ length: 24 }, (_, i) => `c${i}`), {});
  assert.equal(moveToOtherPile(full, 'c0'), null);
  // Every move is a map the arrangement keeps as it is.
  const again = arrangePiles(['a', 'b', 'c', 'd'], across);
  assert.deepEqual(again.map, across);
  assert.equal(again.changed, false);
});
