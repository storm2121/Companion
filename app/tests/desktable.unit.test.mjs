// Round eight, run 3 (M4): the production table's rules (src/room/deskTable.js): fillings, moves, settling,
// pair lookup, draw order, the light states, the fallback, the lettering's floor; and against the production
// data where it is on this machine (public/assets/desk-p1, gitignored: those tests skip without it).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_FILL,
  PLACES,
  arrangeTable,
  bookLayers,
  candleOfState,
  closerOrBack,
  countLettering,
  lampTwin,
  leathersOf,
  lookTwin,
  mergePatch,
  pairKey,
  pairsPresent,
  placeBeside,
  roomLayers,
  slotsKey,
  stateFor,
  tableFrom,
  tableLiftOut,
  tableMarks,
  tableMoveTo,
  tableShift,
  tableTargets,
  tableUsable,
  tableWish,
  titleLettering,
  wideLayers,
} from '../src/room/deskTable.js';
import { noteCourseFor } from '../src/room/deskSearch.js';
import { heldFit, pageOnWindow, quadError } from '../src/room/deskBookPages.js';
import { nearPose, poseScreen, stageCamera, modelSize } from '../src/room/deskFilm.js';
import { stageFit } from '../src/room/deskStage.js';

const CORE = {
  places: { T0: { capacity: 5 }, T1: { capacity: 5 }, T2: { capacity: 5 }, S1: { capacity: 2 }, F3: { capacity: 1 } },
  fillOrder: DEFAULT_FILL,
};
const ids = (n) => Array.from({ length: n }, (_, i) => `c${i + 1}`);

test('first visit: the courses fill the table in fillOrder, in the room\'s course order', () => {
  const a = arrangeTable(ids(5), null, CORE);
  assert.deepEqual(a.map, { c1: 'S10', c2: 'F30', c3: 'T10', c4: 'T20', c5: 'T00' });
  assert.equal(a.more, null);
  assert.equal(a.changed, false, 'nothing saved, nothing to write');
  const full = arrangeTable(ids(18), null, CORE);
  assert.equal(Object.keys(full.map).length, 18);
  assert.deepEqual(Object.values(full.map).sort(), [...DEFAULT_FILL].sort());
  PLACES.forEach((p) => assert.equal(full.stacks[p].length, CORE.places[p].capacity));
});

test('more than 18 courses: the first 18 on the table, the rest `more`', () => {
  const a = arrangeTable(ids(21), null, CORE);
  assert.equal(a.books.length, 18);
  assert.deepEqual(a.more, { count: 3, ids: ['c19', 'c20', 'c21'] });
  // A saved slot of a course past the 18th does not take the table from one within them.
  const b = arrangeTable(ids(19), { c19: 'S10' }, CORE);
  assert.equal(b.map.c19, undefined);
  assert.deepEqual(b.more.ids, ['c19']);
});

test('saved slots are kept, each stack settles from the bottom, a removed course leaves no gap', () => {
  const saved = { c1: 'T02', c2: 'T00', c3: 'T04', c4: 'S11' };
  const a = arrangeTable(['c1', 'c2', 'c3', 'c4'], saved, CORE);
  assert.deepEqual(a.stacks.T0, ['c2', 'c1', 'c3'], 'in saved order, re-levelled 0, 1, 2');
  assert.deepEqual(a.stacks.S1, ['c4']);
  assert.equal(a.map.c3, 'T02');
  assert.equal(a.changed, true, 'settling moved saved slots: written back once');
  // c1 (the middle book) removed: c3 settles onto c2.
  const b = arrangeTable(['c2', 'c3', 'c4'], a.map, CORE);
  assert.deepEqual(b.stacks.T0, ['c2', 'c3']);
  assert.equal(b.map.c3, 'T01');
});

test('a new course takes the next free slot in fillOrder; a full place sends a saved book to fill', () => {
  const a = arrangeTable(['c1', 'c2', 'c9'], { c1: 'S10', c2: 'S11' }, CORE);
  assert.equal(a.map.c9, 'F30', 'S1 is full: the next entry of fillOrder');
  const b = arrangeTable(['c1', 'c2', 'c3'], { c1: 'F30', c2: 'F30', c3: 'garbage' }, CORE);
  assert.equal(b.map.c1, 'F30', 'a place saved twice goes to the first in course order');
  assert.equal(b.map.c2, 'S10');
  assert.equal(b.map.c3, 'T10');
});

test('moves: onto another place\'s top, within a stack, taken while dragged', () => {
  const a = arrangeTable(ids(9), null, CORE);
  // c5 is T00, c9 is T01: move T0's bottom book to the middle stack.
  assert.equal(a.map.c9, 'T01');
  const m = tableMoveTo(a, 'c5', 'T1', CORE);
  assert.equal(m.c5, 'T12', 'on top of T1 (c3 T10, c7 T11)');
  assert.equal(m.c9, 'T00', 'the book above it settled down a level');
  assert.equal(tableMoveTo(a, 'c5', 'F3', CORE), null, 'F3 holds one: full');
  assert.equal(tableMoveTo(a, 'c9', 'T0', CORE), null, 'already on top of its own place');
  assert.equal(tableMoveTo(a, 'c5', 'T0', CORE).c5, 'T01', 'to the top of its own stack');
  const up = tableShift(a, 'c5', 1);
  assert.equal(up.c5, 'T01');
  assert.equal(up.c9, 'T00');
  assert.equal(tableShift(a, 'c9', 1), null, 'on top');
  assert.equal(tableShift(a, 'c5', -1), null, 'at the bottom');
  const lifted = tableLiftOut(a, 'c5');
  assert.equal(lifted.map.c5, undefined);
  assert.equal(lifted.map.c9, 'T00');
  assert.ok(lifted.books.every((b) => b.id !== 'c5'));
});

test('targets of a drag: its own slot, its stack\'s top, every place with room', () => {
  const a = arrangeTable(ids(9), null, CORE);
  const t = tableTargets(a, 'c5', CORE);
  assert.deepEqual(
    t.map((x) => `${x.kind}:${x.slot}`),
    ['own:T00', 'top:T01', 'place:T12', 'place:T22'],
    'S1 and F3 are full (c1 S10, c6 S11; c2 F30)',
  );
});

test('the marks of a taken book: every place that can take it, a full place nothing, its own slot only while carried', () => {
  const a = arrangeTable(ids(9), null, CORE);
  // c5 lies at T00 under c9; S1 (c1, c6) and F3 (c2) are full.
  const carried = tableMarks(a, 'c5', CORE);
  assert.deepEqual(
    carried.map((m) => `${m.key}@${m.slot}`),
    ['own:T0@T00', 'place:T0@T01', 'place:T1@T12', 'place:T2@T22'],
    'carried: its own slot, its own stack\'s top, the two towers with room; nothing on S1 or F3',
  );
  assert.ok(carried.every((m) => m.kind === 'own' || m.kind === 'place'));
  assert.equal(new Set(carried.map((m) => m.key)).size, carried.length, 'each mark has its own key');
  // From the menu or the keyboard: only where it can go.
  assert.deepEqual(tableMarks(a, 'c5', CORE, { carried: false }).map((m) => m.key), ['place:T0', 'place:T1', 'place:T2']);
  // A book already on top of its stack has no "top of its own stack".
  assert.deepEqual(tableMarks(a, 'c9', CORE, { carried: false }).map((m) => m.key), ['place:T1', 'place:T2']);
  // A book taken from the near stack: the towers; the flat place (full) shows nothing.
  assert.deepEqual(tableMarks(a, 'c6', CORE).map((m) => `${m.key}@${m.slot}`), ['own:S1@S11', 'place:T0@T02', 'place:T1@T12', 'place:T2@T22']);
  // With the flat place free it is marked at its only level.
  const b = arrangeTable(['c1', 'c2', 'c3'], { c1: 'T00', c2: 'T10', c3: 'T20' }, CORE);
  assert.ok(tableMarks(b, 'c1', CORE).some((m) => m.key === 'place:F3' && m.slot === 'F30'));
  // A book that is not on the table: no marks.
  assert.deepEqual(tableMarks(a, 'nobody', CORE), []);
});

test('Alt + Left / Right walk the places across the screen; Alt + Enter closer and back', () => {
  const a = arrangeTable(ids(5), null, CORE);
  // T0 c5, S1 c1, T1 c3, F3 c2, T2 c4.
  assert.equal(placeBeside(a, 'c5', 1, CORE), 'S1');
  assert.equal(placeBeside(a, 'c3', 1, CORE), 'T2', 'F3 is full: skipped');
  assert.equal(placeBeside(a, 'c5', -1, CORE), null, 'nothing left of T0');
  assert.equal(closerOrBack(a, 'c3', {}, CORE), 'S1');
  assert.equal(closerOrBack(a, 'c1', { c1: 'T0' }, CORE), 'T0', 'back where it came from');
  assert.equal(closerOrBack(a, 'c1', {}, CORE), 'T1', 'else the first tower with room');
  const full = arrangeTable(ids(18), null, CORE);
  assert.equal(closerOrBack(full, 'c3', {}, CORE), null);
});

test('pairs: named p before q in T0, T1, T2, S1, F3, only where both hold books', () => {
  assert.equal(pairKey('S1', 2, 'T0', 3), 'T03-S12');
  assert.equal(pairKey('T1', 1, 'T2', 5), 'T11-T25');
  const present = pairsPresent({ T0: 1, T1: 0, T2: 4, S1: 0, F3: 1 });
  assert.deepEqual(present.map((p) => p.key), ['T01-T24', 'T01-F31', 'T24-F31']);
});

// A state's data with every layer the rules may name.
const fakeState = () => {
  const layers = {};
  const add = (n) => (layers[n] = { x1: `${n}.webp`, x2: `${n}@2x.webp`, box: [0, 0, 10, 10] });
  ['shadow-SN', 'pocket', 'candle-look', 'candle-away', 'notebook', 'shadow-wide-SN'].forEach(add);
  PLACES.forEach((p) =>
    [0, 1, 2, 3, 4].forEach((i) => {
      add(`shadow-${p}${i}`);
      add(`shade-${p}${i}`);
      add(`shadow-wide-${p}${i}`);
      ['navy', 'tan', 'black'].forEach((l) => {
        add(`book-${p}${i}-${l}`);
        add(`plate-${p}${i}-black`);
        add(`plate-${p}${i}-oxblood`);
      });
    }),
  );
  add('shadow-S10-tan');
  const pairs = {};
  ['T01-T12', 'T01-S11', 'T12-S11'].forEach((k) => {
    const [a, b] = k.split('-');
    pairs[k] = { room: `pair-${k}`, [`on${a.slice(0, 2)}`]: `pairshade-${k}-on-${a.slice(0, 2)}`, [`on${b.slice(0, 2)}`]: `pairshade-${k}-on-${b.slice(0, 2)}` };
    add(`pair-${k}`);
    add(`pairshade-${k}-on-${a.slice(0, 2)}`);
    add(`pairshade-${k}-on-${b.slice(0, 2)}`);
  });
  return { layers, pairs };
};

test('draw order: the room far to near, each pair right after the nearer of its places', () => {
  const data = fakeState();
  const leathers = { T0: ['navy'], T1: ['tan', 'navy'], T2: [], S1: ['tan'], F3: [] };
  const night = roomLayers(data, leathers, { look: 'night', candle: 'C0' });
  assert.deepEqual(night, ['shadow-SN', 'pocket', 'candle-look', 'shadow-T10', 'shadow-T11', 'shadow-T00', 'pair-T01-T12', 'shadow-S10-tan', 'pair-T01-S11', 'pair-T12-S11']);
  assert.equal(roomLayers(data, leathers, { look: 'night', held: true })[2], 'candle-away', 'the candle in the hand: none left behind');
  const day = roomLayers(data, leathers, { look: 'day', candle: 'C1' });
  assert.deepEqual(day.slice(0, 2), ['shadow-SN', 'pocket'], 'no day candle pictures in this fake: none named');
  assert.deepEqual(wideLayers(data, leathers, {}), ['shadow-wide-SN', 'shadow-wide-T10', 'shadow-wide-T11', 'shadow-wide-T00', 'shadow-wide-S10']);
});

test('draw order: the books far to near, the notebook after the towers, shades and plates where they belong', () => {
  const data = fakeState();
  const leathers = { T0: ['navy'], T1: ['tan', 'black'], T2: [], S1: ['tan'], F3: [] };
  const list = bookLayers(data, leathers, { T11: true });
  assert.deepEqual(
    list.map((b) => (b.kind === 'book' ? `${b.slot}:${b.book}:${b.shade || ''}:${b.plate || ''}` : `${b.kind}:${b.name}`)),
    [
      'T10:book-T10-tan::',
      'T11:book-T11-black:shade-T11:plate-T11-oxblood',
      'pairshade:pairshade-T01-T12-on-T1',
      'pairshade:pairshade-T12-S11-on-T1',
      'T00:book-T00-navy::',
      'pairshade:pairshade-T01-T12-on-T0',
      'pairshade:pairshade-T01-S11-on-T0',
      'notebook:notebook',
      'S10:book-S10-tan::',
      'pairshade:pairshade-T01-S11-on-S1',
      'pairshade:pairshade-T12-S11-on-S1',
    ],
  );
  assert.deepEqual(leathersOf({ T0: ['a'], T1: [], T2: [], S1: [], F3: [] }, () => '#2f5fb8').T0, ['navy']);
});

test('draw order: a shade by the leather under it, a pair\'s shade by the top book\'s leather where listed', () => {
  const data = fakeState();
  const add = (n) => (data.layers[n] = { x1: `${n}.webp`, x2: `${n}@2x.webp`, box: [0, 0, 10, 10] });
  add('shade-S11-tan');
  add('pair-S12-F31');
  add('pairshade-S12-F31-on-F3-navy');
  add('pairshade-S12-F31-on-S1');
  data.pairs['S12-F31'] = { room: 'pair-S12-F31', 'onF3-navy': 'pairshade-S12-F31-on-F3-navy', onS1: 'pairshade-S12-F31-on-S1' };
  const list = bookLayers(data, { T0: [], T1: [], T2: [], S1: ['tan', 'black'], F3: ['navy'] }, {});
  const names = list.map((b) => (b.kind === 'book' ? `${b.slot}:${b.shade || ''}` : b.name));
  assert.deepEqual(names, ['notebook', 'F30:', 'pairshade-S12-F31-on-F3-navy', 'S10:', 'S11:shade-S11-tan', 'pairshade-S12-F31-on-S1']);
  const other = bookLayers(data, { T0: [], T1: [], T2: [], S1: ['tan', 'black'], F3: ['tan'] }, {});
  assert.ok(!other.some((b) => b.name === 'pairshade-S12-F31-on-F3-navy'), 'none listed for F3\'s leather: nothing');
});

test('the light states: night or day, the candle\'s place, the lamp; their twins', () => {
  assert.equal(stateFor({ night: true, candle: 'C0', lamp: false }), 'night');
  assert.equal(stateFor({ night: true, candle: 'C1', lamp: true }), 'nightC1Lamp');
  assert.equal(stateFor({ night: false, candle: 'C1', lamp: true }), 'dayLamp');
  assert.equal(lampTwin('nightC1'), 'nightC1Lamp');
  assert.equal(lampTwin('dayLamp'), 'day');
  assert.equal(lookTwin('nightC1Lamp'), 'dayLamp');
  assert.equal(lookTwin('day', 'C1'), 'nightC1');
  assert.equal(candleOfState('nightC1Lamp'), 'C1');
});

test('the fallback: the table only with its core and the state\'s file read', () => {
  const core = { stage: {}, states: {}, places: Object.fromEntries(PLACES.map((p) => [p, { levels: [{}] }])) };
  assert.equal(tableUsable({ core, state: { layers: {} } }), true);
  assert.equal(tableUsable({ core: null, state: { layers: {} } }), false);
  assert.equal(tableUsable({ core, state: null }), false);
  assert.equal(tableUsable({ core, state: { layers: {} }, failed: true }), false);
  assert.equal(tableUsable({ core: { ...core, places: { T0: { levels: [{}] } } }, state: { layers: {} } }), false);
});

test('lettering: 13 css px tall on the screen at the least scale, a flat cover\'s squash counted', () => {
  const spine = [[0, 0], [138, 0], [138, 33], [0, 33]];
  const t = titleLettering('Linear Algebra', spine, 0.7, { spineHeight: 47 });
  assert.ok(t.onScreen >= 13 - 1e-6);
  // A cover's label seen lying down: 169 x 61 in its own plane, 37.7 px tall on the screen.
  const cover = [[1232.85, 611.42], [1392.91, 611.42], [1450, 649.11], [1271.41, 649.11]];
  const c = titleLettering('Comparative Politics of the Middle East & Africa', cover, 0.7);
  assert.ok(c.box.squash < 0.7, `squash ${c.box.squash}`);
  // Fix run: "Comparative" alone is wider than this label at the floor: lettered whole (12.3 css px), never "Comparati.".
  assert.equal(c.rule, 'word-under-floor');
  assert.deepEqual(c.lines, ['Comparative']);
  assert.ok(c.onScreen >= 12 - 1e-6, `on the screen ${c.onScreen}`);
  const d = titleLettering('Comparative Politics of the Middle East & Africa', cover, 0.85);
  assert.ok(d.onScreen >= 13 - 1e-6 && !/\.$/.test(d.lines[0]), `at 0.85: ${d.lines.join(' / ')} ${d.onScreen}`);
  assert.ok(c.lines.length >= 1);
  assert.equal(countLettering('', spine, 1).text, '');
});

test('a Home note goes to the course on the screen, else the one written in last, else the first', () => {
  const courses = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const notes = [{ classId: 'b', t: 5 }, { classId: 'c', t: 9 }];
  const time = (n) => n.t;
  assert.equal(noteCourseFor(courses, notes, 'a', time).id, 'a');
  assert.equal(noteCourseFor(courses, notes, '', time).id, 'c');
  assert.equal(noteCourseFor(courses, [], '', time).id, 'a');
  assert.equal(noteCourseFor([], notes, '', time), null);
});

test('slots key and an arrangement from a map', () => {
  const t = tableFrom({ b: 'T01', a: 'T00', c: 'S10' });
  assert.deepEqual(t.stacks.T0, ['a', 'b']);
  assert.equal(slotsKey({ b: 'T01', a: 'T00' }), 'a:T00,b:T01');
});

/* ── Against the production data (skipped where it is not on this machine) ── */

const CORE_FILE = fileURLToPath(new URL('../public/assets/desk-p1/core.json', import.meta.url));
const prod = existsSync(CORE_FILE) ? JSON.parse(readFileSync(CORE_FILE, 'utf8')) : null;

test('quick moves add up: the second move starts from the first (the local wish), whatever save lands between', () => {
  const ids5 = ids(5);
  const a = arrangeTable(ids5, null, CORE);
  // T0 c5, S1 c1, T1 c3, F3 c2, T2 c4: c5 two places right is T1 (S1 has room: c5 goes there first).
  const first = tableMoveTo(a, 'c5', placeBeside(a, 'c5', 1, CORE), CORE);
  const wish1 = { map: first };
  const now1 = tableWish(ids5, a.map, wish1, CORE).arrangement;
  assert.equal(now1.map.c5.slice(0, 2), 'S1');
  const second = tableMoveTo(now1, 'c5', placeBeside(now1, 'c5', 1, CORE), CORE);
  const wish2 = { map: second };
  assert.equal(tableWish(ids5, a.map, wish2, CORE).arrangement.map.c5.slice(0, 2), 'T1', 'two places from where it was');
  // The first move's save lands while the second waits for its own: the second still shows.
  const between = tableWish(ids5, first, wish2, CORE);
  assert.equal(between.done, false);
  assert.equal(between.arrangement.map.c5.slice(0, 2), 'T1');
  // The second's save lands: the wish is done, the saved table shown.
  const after = tableWish(ids5, second, wish2, CORE);
  assert.equal(after.done, true);
  assert.equal(slotsKey(after.arrangement.map), slotsKey(between.arrangement.map));
});

test('deep merge: a saved key of a deleted course and a stale deskTableFrom key change nothing', () => {
  const ids5 = ids(5);
  const a = arrangeTable(ids5, null, CORE);
  // The server keeps keys a write left out: a deleted course's slot, and "from" of a book no longer near.
  const saved = { ...a.map, gone: 'T01' };
  const b = arrangeTable(ids5, saved, CORE);
  assert.equal(slotsKey(b.map), slotsKey(a.map));
  assert.equal(b.changed, false, 'nothing to write back');
  assert.ok(!b.books.some((book) => book.id === 'gone'));
  // c3 is on T1 (not near): a stale "from" is not read; c1 is near with its "from" written as null: first with room.
  assert.equal(closerOrBack(a, 'c3', { c3: 'T2' }, CORE), 'S1');
  assert.equal(closerOrBack(a, 'c1', { c1: null }, CORE), 'T1');
  assert.equal(closerOrBack(a, 'c1', { c1: 'S1' }, CORE), 'T1', 'a "from" naming the near stack itself is not a way back');
  // A patch that takes one "from" to another under the merge writes the dropped key as null.
  assert.deepEqual(mergePatch({ c1: 'T0', c2: 'T1' }, { c2: 'T2' }), { c1: null, c2: 'T2' });
  assert.deepEqual(tableWish(ids5, saved, { map: { ...a.map, gone: 'T02' } }, CORE).done, true, 'a wish differing only in a deleted course is done');
});

test('production: every title readable at every place and level at scale 0.7 (48 characters, Arabic)', { skip: !prod && 'no public/assets/desk-p1' }, () => {
  const names = ['Comparative Politics of the Middle East & Africa', 'تاريخ العالم العربي الحديث والمعاصر', 'Linear Algebra'];
  PLACES.forEach((p) =>
    prod.places[p].levels.forEach((level) => {
      const quad = level.coverTitle || level.label;
      const tall = level.cover ? Infinity : Math.hypot(level.spine[3][0] - level.spine[0][0], level.spine[3][1] - level.spine[0][1]);
      names.forEach((name) => {
        const t = titleLettering(name, quad, 0.7, { spineHeight: tall });
        assert.ok(t.lines.length > 0 && t.lines.join(' ').length > 0, `${level.key}: something lettered for ${name}`);
        // Fix run: never cut inside a word. Where a first word is wider than the label at the floor (F3's cover at the
        // least scale) it is lettered whole under the floor: reported, with the label size that would hold it.
        assert.notEqual(t.rule, 'cut-word', `${level.key} ${name}: cut inside a word`);
        if (t.rule === 'word-under-floor') {
          assert.ok(name.split(' ').includes(t.lines[0]), `${level.key} ${name}: ${t.lines[0]} is a whole word`);
          assert.ok(t.onScreen >= 12 - 1e-6, `${level.key} ${name}: ${t.onScreen.toFixed(2)} css px`);
        } else assert.ok(t.onScreen >= 13 - 1e-6, `${level.key} ${name}: ${t.onScreen.toFixed(2)} css px on the screen`);
      });
    }),
  );
});

test('production: the flat book\'s film starts on its cover', { skip: !prod && 'no public/assets/desk-p1' }, () => {
  const level = prod.places.F3.levels[0];
  const fit = stageFit(1536, 750, prod.stage, prod.crop);
  const cam = stageCamera(prod, fit);
  const { pose, t } = nearPose(cam, { x: level.origin[0], y: level.origin[1], yaw: 0, w: level.size_m[0], d: level.size_m[1], t: level.size_m[2] });
  const size = modelSize(t);
  // The board's corners (head-spine, head-fore, tail-fore, tail-spine) against the cover's quad (TL TR BR BL).
  const corners = [[0, 0, 0], [size.w, 0, 0], [size.w, size.h, 0], [0, size.h, 0]].map((p) => poseScreen(cam, pose, p));
  const cover = level.cover.map(([x, y]) => [fit.left + x * fit.scale, fit.top + y * fit.scale]);
  const worst = Math.max(...corners.map((c) => Math.min(...cover.map((q) => Math.hypot(c[0] - q[0], c[1] - q[1])))));
  assert.ok(worst < 12, `the box book's corners within ${worst.toFixed(1)} css px of the cover's`);
});

test('production: the held book, one flat quad per page within 1.5 css px, no bars 32:9 to 5:4', { skip: !prod && 'no public/assets/desk-p1' }, () => {
  ['left', 'right'].forEach((side) => {
    const page = { quad: prod.held.pages[side].text, grid: prod.held.pages[side].grid };
    [0.7, 1].forEach((s) => {
      const e = quadError(page, s, { fixed: false });
      assert.ok(e <= 1.5, `${side} at ${s}: ${e.toFixed(2)} css px`);
    });
  });
  const c = prod.held.crop;
  const held = { frame: [prod.held.frame.width, prod.held.frame.height], box: [c.x, c.y, c.x + c.width, c.y + c.height], pages: { left: { quad: prod.held.pages.left.text }, right: { quad: prod.held.pages.right.text } } };
  [[2560, 720], [2560, 1080], [1920, 1080], [1536, 750], [1280, 650], [1280, 1024], [1440, 900]].forEach(([w, h]) => {
    const fit = heldFit({ width: w, height: h }, held, { extent: prod.held.surround });
    assert.equal(fit.bars, false, `${w}x${h}: bars`);
    assert.ok(fit.left + c.x * fit.scale >= 0 && fit.left + (c.x + c.width) * fit.scale <= w + 0.5, `${w}x${h}: the book across inside`);
    const pw = pageOnWindow({ quad: prod.held.pages.left.text, grid: prod.held.pages.left.grid }, fit);
    assert.ok(pw.w > 200, `${w}x${h}: a page ${pw.w.toFixed(0)} css px wide`);
  });
});
