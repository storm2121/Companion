import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BOARD_TAIL,
  DEFAULT_PIN_WIDTH,
  DEFAULT_RATIO,
  MAX_PIN_WIDTH,
  MIN_PIN_WIDTH,
  NUDGE,
  PIN_GAP,
  PIN_PAD,
  nudgeOverrides,
  pinHeight,
  resizeWidth,
  resolveRail,
  settleRail,
} from '../src/room/railLayout.js';
import { releaseVelocity, SETTLE_TIME, smoothDamp } from '../src/room/boardMotion.js';
import { designFor, resolveDesignMode } from '../src/designModes.js';
import { findInText, findLabel, locateOffset, stepIndex } from '../src/room/noteFind.js';
import {
  instantiate,
  isBlankPage,
  PAGE_TEMPLATES,
  savedTemplates,
  structureOf,
} from '../src/room/pageTemplates.js';
import {
  BLOCK_CODE,
  BLOCK_IMAGE,
  BLOCK_TEXT,
  BLOCK_TWO_COLUMN,
  diffBlocks,
  fromStored,
  pageText,
  photosOf,
  sectionsOf,
  snapshotOf,
  stripHtml,
  textBlock,
  toPdfBlocks,
  toStored,
} from '../src/room/pageBlocks.js';
import {
  calendarSummary,
  classStatus,
  cleanSchedule,
  courseMeta,
  dayEntries,
  journalRows,
  monthDays,
  monthGrid,
  monthSummary,
  quietLine,
  scheduleLine,
} from '../src/room/calendarDays.js';
import { fold, indexedText, searchDesk } from '../src/room/deskSearch.js';
import { inboxLines, titleFromLine } from '../src/room/inboxLines.js';
import {
  applySageResult,
  asTaskList,
  blockForRole,
  hasSageText,
  htmlToLines,
  sageSummary,
  toSageBlocks,
} from '../src/room/sageBridge.js';

// ── The board (railLayout.js) ─────────────────────────────────────────────────

const photo = (id, fields = {}) => ({ id, rail: true, type: BLOCK_IMAGE, ...fields });

// The one property the board exists to guarantee.
const assertNoOverlap = (pins, overrides) => {
  const { slots } = resolveRail(pins, overrides);
  const placed = Object.values(slots).sort((a, b) => a.top - b.top);
  for (let i = 1; i < placed.length; i += 1) {
    const above = placed[i - 1];
    assert.ok(
      placed[i].top >= above.top + above.h + PIN_GAP,
      `photo at ${placed[i].top} overlaps the one ending at ${above.top + above.h}`,
    );
  }
};

test('room board: a photo is exactly as tall as its width and shape say', () => {
  // 300 wide, square: (300 - 2*pad) / 1 + 2*pad.
  assert.equal(pinHeight({ w: 300, ar: 1 }), 300);
  assert.equal(pinHeight({ w: 300, ar: 2 }), Math.round((300 - 2 * PIN_PAD) / 2 + 2 * PIN_PAD));
  // Unknown shape falls back, unknown width falls back.
  assert.equal(pinHeight({}), Math.round((DEFAULT_PIN_WIDTH - 2 * PIN_PAD) / DEFAULT_RATIO + 2 * PIN_PAD));
  // Width is clamped to the rail.
  assert.equal(resolveRail([photo('a', { w: 9999, ar: 1 })]).slots.a.w, MAX_PIN_WIDTH);
  assert.equal(resolveRail([photo('a', { w: 1, ar: 1 })]).slots.a.w, MIN_PIN_WIDTH);
});

test('room board: photos stay where they were hung, pushed down only to avoid overlap', () => {
  const pins = [photo('a', { y: 0, ar: 1 }), photo('b', { y: 1000, ar: 1 })];
  const { slots } = resolveRail(pins);
  assert.equal(slots.a.top, 0);
  assert.equal(slots.b.top, 1000, 'a free photo keeps its height — the gap is kept');

  const crowded = [photo('a', { y: 0, ar: 1 }), photo('b', { y: 50, ar: 1 })];
  const pushed = resolveRail(crowded).slots;
  assert.equal(pushed.b.top, pushed.a.top + pushed.a.h + PIN_GAP, 'pushed exactly clear, no further');
});

test('room board: nothing ever overlaps, however the photos are hung', () => {
  const scenarios = [
    [photo('a', { y: 0 }), photo('b', { y: 0 }), photo('c', { y: 0 })],
    [photo('a', { y: 200, ar: 0.5 }), photo('b', { y: 210, w: 364 }), photo('c', { y: 205, ar: 3 })],
    [photo('a'), photo('b'), photo('c', { y: 12 })],
    [photo('a', { y: 400 }), photo('b', { y: 0, w: 140 }), photo('c', { y: 399, ar: 0.3 })],
  ];
  scenarios.forEach((pins) => assertNoOverlap(pins));
  // …including while a drag or a resize is being previewed.
  assertNoOverlap(scenarios[1], { b: { y: 0 } });
  assertNoOverlap(scenarios[1], { a: { w: 364 } });
});

test('room board: ties and older photos without a height stack in the order they were added', () => {
  const { slots } = resolveRail([photo('first'), photo('second'), photo('third')]);
  assert.ok(slots.first.top < slots.second.top && slots.second.top < slots.third.top);
  assert.equal(slots.first.top, 0);
});

test('room board: height and the next free spot', () => {
  assert.deepEqual(resolveRail([]), { slots: {}, end: 0, height: 0 });
  const { slots, end, height } = resolveRail([photo('a', { y: 40, ar: 1, w: 300 })]);
  assert.equal(end, slots.a.top + slots.a.h + PIN_GAP);
  assert.equal(height, slots.a.top + slots.a.h + BOARD_TAIL);
});

test('room board: settling writes back only what moved, and always what was touched', () => {
  const pins = [photo('a', { y: 0, w: 300, ar: 1 }), photo('b', { y: 322, w: 300, ar: 1 })];
  assert.deepEqual(settleRail(pins), [], 'an already-settled board changes nothing');

  // Growing `a` pushes `b`; both come back, nothing else.
  const grown = settleRail(pins, { a: { w: 364 } });
  assert.deepEqual(grown.map((pin) => pin.id).sort(), ['a', 'b']);
  const { slots } = resolveRail(pins, { a: { w: 364 } });
  grown.forEach((pin) => assert.equal(pin.y, slots[pin.id].top));

  // A shape change is kept even when nothing moves.
  const learned = settleRail([photo('a', { y: 0, w: 300 })], { a: { ar: 1.5 } });
  assert.equal(learned.length, 1);
  assert.equal(learned[0].ar, 1.5);
});

test('room board: settling returns patches, never whole photos', () => {
  // `b` overlaps `a`, so it is pushed — but the patch must not carry `value` or `ar`: a
  // whole-object write from a stale snapshot is how one photo's learned shape got undone
  // by another photo's commit.
  const pins = [
    photo('a', { y: 0, w: 300, ar: 1, value: 'a.jpg' }),
    photo('b', { y: 10, w: 300, ar: 1, value: 'b.jpg' }),
  ];
  const [patch] = settleRail(pins);
  assert.deepEqual(Object.keys(patch).sort(), ['id', 'w', 'y']);
  assert.equal(patch.id, 'b');
});

test('room board: resizing keeps the shape and stays inside the rail', () => {
  // Follows whichever axis moved further; height is derived, so the shape cannot change.
  assert.equal(resizeWidth(300, 1, 40, 5), 340);
  assert.equal(resizeWidth(300, 2, 5, 20), 340, 'a vertical pull converts through the ratio');
  assert.equal(resizeWidth(300, 1, 1000, 0), MAX_PIN_WIDTH);
  assert.equal(resizeWidth(300, 1, -1000, 0), MIN_PIN_WIDTH);
  const w = resizeWidth(300, 1.5, 30, 0);
  assert.equal(pinHeight({ w, ar: 1.5 }), Math.round((w - 2 * PIN_PAD) / 1.5 + 2 * PIN_PAD));
});

test('room board: arrow keys nudge, and swap places when a neighbour is in the way', () => {
  const pins = [photo('a', { y: 0, w: 300, ar: 1 }), photo('b', { y: 800, w: 300, ar: 1 })];
  assert.deepEqual(nudgeOverrides(pins, 'b', -1), { b: { y: 800 - NUDGE } });
  assert.deepEqual(nudgeOverrides(pins, 'a', 1), { a: { y: NUDGE } });

  const packed = [photo('a', { y: 0, w: 300, ar: 1 }), photo('b', { y: 322, w: 300, ar: 1 })];
  const up = resolveRail(packed, nudgeOverrides(packed, 'b', -1)).slots;
  assert.ok(up.b.top < up.a.top, 'moving up past a neighbour swaps them');
  const down = resolveRail(packed, nudgeOverrides(packed, 'a', 1)).slots;
  assert.ok(down.b.top < down.a.top, 'moving down past a neighbour swaps them');
  assertNoOverlap(packed, nudgeOverrides(packed, 'b', -1));
});

test('room board: photos swap when their centres cross, not their edges', () => {
  // Two 300px photos. Dragging the lower one up swaps them once ITS middle passes the
  // other's — not only once its top edge clears the other's top.
  const pins = [photo('a', { y: 100, w: 300, ar: 1 }), photo('b', { y: 500, w: 300, ar: 1 })];
  const justShort = resolveRail(pins, { b: { y: 101 } }).slots; // b's centre 251 > a's 250
  assert.ok(justShort.a.top < justShort.b.top, 'not past the middle yet: no swap');
  const past = resolveRail(pins, { b: { y: 99 } }).slots; // b's centre 249 < a's 250
  assert.ok(past.b.top < past.a.top, 'past the middle: swapped');
  assertNoOverlap(pins, { b: { y: 99 } });
});

test('room board: the photo being moved wins a tie, so the top slot is always reachable', () => {
  // The top photo sits at y=0; the dragged one is clamped at 0 and can only TIE it.
  const pins = [photo('a', { y: 0, w: 300, ar: 1 }), photo('b', { y: 322, w: 300, ar: 1 })];
  const slots = resolveRail(pins, { b: { y: 0 } }).slots;
  assert.equal(slots.b.top, 0);
  assert.ok(slots.a.top > slots.b.top);
});

// ── Motion (boardMotion.js) ───────────────────────────────────────────────────

const run = (from, to, velocity, frames, dt = 1 / 60) => {
  let value = from;
  let v = velocity;
  const trail = [];
  for (let i = 0; i < frames; i += 1) {
    ({ value, velocity: v } = smoothDamp(value, to, v, SETTLE_TIME, dt));
    trail.push(value);
  }
  return { value, v, trail };
};

test('room motion: a photo settles on its slot and never passes it', () => {
  [
    [0, 400, 0],
    [400, 0, 0],
    [0, 400, 3000], // thrown hard towards the slot
    [0, 400, -500], // thrown the wrong way
  ].forEach(([from, to, velocity]) => {
    const { value, trail } = run(from, to, velocity, 240);
    assert.ok(Math.abs(value - to) < 0.5, `settled at ${value}, wanted ${to}`);
    const passed = trail.some((y) => (to > from ? y > to + 1e-9 : y < to - 1e-9));
    assert.equal(passed, false, 'nothing bounces: the target is never overshot');
  });
});

test('room motion: a big frame (a backgrounded tab) still cannot overshoot', () => {
  const { value } = smoothDamp(0, 400, 5000, SETTLE_TIME, 0.5);
  assert.ok(value <= 400);
});

test('room motion: a new target bends the path instead of restarting from rest', () => {
  // Mid-glide towards 400, the slot moves to 600. The speed carries over — a CSS
  // transition would have dropped it to zero and started again.
  const halfway = run(0, 400, 0, 6);
  const next = smoothDamp(halfway.value, 600, halfway.v, SETTLE_TIME, 1 / 60);
  assert.ok(halfway.v > 0 && next.velocity > 0, 'still moving the same way');
});

test('room motion: a release keeps speed only when it points at the slot', () => {
  assert.equal(releaseVelocity(100, 300, 800), 800);
  assert.equal(releaseVelocity(100, 300, -800), 0, 'pointing away would mean a bounce back');
  assert.equal(releaseVelocity(300, 300, 800), 0, 'already there');
});

// ── The page (pageBlocks.js) ──────────────────────────────────────────────────

test('room page: outline text comes out of HTML without a DOM', () => {
  assert.equal(stripHtml('<p>Left &lt; Root &amp; Right</p><p>next</p>'), 'Left < Root & Right next');
  assert.equal(stripHtml('It&#39;s &#x27;fine&#x27;&nbsp;here'), "It's 'fine' here");
  assert.equal(stripHtml('<p>cut <strong class="x'), 'cut', 'a tag cut off mid-way is dropped');
  assert.equal(stripHtml('<ul><li>one</li><li>two</li></ul>'), 'one two');
  assert.equal(stripHtml(''), '');
});

test('room page: § numbers are derived from position, and photos are never sections', () => {
  const blocks = [
    { id: '1', type: BLOCK_TEXT, value: '<p>Rule: left is smaller.</p>', section: true },
    { id: '2', type: BLOCK_TEXT, value: '<p>not a section</p>', section: false },
    photo('p', { section: true }),
    {
      id: '3',
      type: BLOCK_TWO_COLUMN,
      value: '',
      section: true,
      colA: [{ id: 'c', type: BLOCK_TEXT, value: '<p>Traversal orders</p>' }],
      colB: [],
    },
    { id: '4', type: BLOCK_TEXT, value: '', section: true },
  ];
  assert.deepEqual(sectionsOf(blocks), [
    { id: '1', index: 1, title: 'Rule' },
    { id: '3', index: 2, title: 'Traversal orders' },
    { id: '4', index: 3, title: 'Section 3' },
  ]);
});

test('room page: an old two-column block moves its text into its columns', () => {
  const legacy = { id: 't', type: BLOCK_TWO_COLUMN, value: '<p>left</p>', valueB: '<p>right</p>' };
  const block = fromStored(legacy, 3);
  assert.equal(block.colA[0].value, '<p>left</p>');
  assert.equal(block.colB[0].value, '<p>right</p>');
  assert.equal(block.value, '', 'cleared, or the outline would keep reading the old text');
  assert.equal('valueB' in block, false);
  assert.equal(sectionsOf([{ ...block, section: true }])[0].title, 'left');
});

test('room page: the first page block opens §1, a photo never does', () => {
  assert.equal(fromStored({ id: 'a', type: BLOCK_TEXT }, 0).section, true);
  assert.equal(fromStored({ id: 'b', type: BLOCK_TEXT }, 1).section, false);
  assert.equal(fromStored(photo('p'), 0).section, false);
});

test('room page: saves carry only live fields', () => {
  const stored = toStored({
    id: 'p',
    type: BLOCK_IMAGE,
    value: 'https://x/y.jpg',
    rail: true,
    y: 40,
    w: 300,
    ar: 1.5,
    // Retired pin fields and canvas coordinates must never be written.
    pinnedTo: 's1',
    keep: true,
    dy: 18,
    h: 200,
    x: 660,
  });
  assert.deepEqual(stored, {
    id: 'p',
    type: BLOCK_IMAGE,
    value: 'https://x/y.jpg',
    section: false,
    rail: true,
    y: 40,
    w: 300,
    ar: 1.5,
  });
});

test('room page: the save diff writes one path per changed block', () => {
  const blocks = [
    { id: 'a', type: BLOCK_TEXT, value: 'one', section: true },
    { id: 'b', type: BLOCK_TEXT, value: 'two', section: false },
  ];
  const saved = snapshotOf(blocks);
  assert.equal(diffBlocks(blocks, saved).changed, false);

  const edited = diffBlocks([blocks[0], { ...blocks[1], value: 'three' }], saved);
  assert.deepEqual(Object.keys(edited.changedBlocks), ['b']);

  const removed = diffBlocks([blocks[0]], saved);
  assert.deepEqual(removed.removedBlockIds, ['b']);
  assert.deepEqual(removed.order, ['a']);
});

test('room page: PDF export prints the page, then the photos top to bottom', () => {
  const blocks = [
    photo('low', { value: 'low.jpg', y: 900 }),
    { id: 'a', type: BLOCK_TEXT, value: '<p>page</p>' },
    photo('high', { value: 'high.jpg', y: 10 }),
    { id: 'c', type: BLOCK_CODE, value: 'if a < b:' },
    {
      id: 't',
      type: BLOCK_TWO_COLUMN,
      colA: [{ id: 'l', type: BLOCK_TEXT, value: '<p>L</p>' }],
      colB: [{ id: 'r', type: BLOCK_CODE, value: 'x > y' }],
    },
  ];
  assert.deepEqual(toPdfBlocks(blocks), [
    { type: 'text', value: '<p>page</p>' },
    { type: 'text', value: '<pre>if a &lt; b:</pre>' },
    { type: 'text', value: '<p>L</p>' },
    { type: 'text', value: '<pre>x &gt; y</pre>' },
    { type: 'image', value: 'high.jpg' },
    { type: 'image', value: 'low.jpg' },
  ]);
});

// ── Which design renders where (designModes.js) ───────────────────────────────

test('design switch: shared pages render the chosen design at their own address', () => {
  // No redirect: /dashboard IS the room's home when the room is chosen.
  ['/dashboard', '/settings', '/calendar', '/class/abc123', '/dashboard/'].forEach((path) => {
    assert.equal(designFor(path, 'room'), 'room', path);
    assert.equal(designFor(path, 'classic'), 'classic', path);
  });
});

test('design switch: room addresses are always the room, classic-only pages always classic', () => {
  ['/room', '/room/you', '/room/note/c/n'].forEach((path) => {
    assert.equal(designFor(path, 'classic'), 'room', path);
  });
  // Only the canvas editor can show a canvas note or build a template — even with the
  // room chosen, these stay classic.
  ['/class/abc/note/xyz', '/template/new'].forEach((path) => {
    assert.equal(designFor(path, 'room'), 'classic', path);
  });
  // A prefix that merely looks similar is not the room.
  assert.equal(designFor('/roomy', 'classic'), 'classic');
});

test('design switch: no preference, or an unknown one, means classic', () => {
  assert.equal(designFor('/dashboard', undefined), 'classic');
  assert.equal(designFor('/dashboard', 'something-else'), 'classic');
  assert.equal(resolveDesignMode(undefined), 'classic');
});

// ── Find (noteFind.js) ────────────────────────────────────────────────────────

test('room find: matches ignore case and never overlap', () => {
  assert.deepEqual(findInText('Tree, tree, TREE', 'tree'), [
    [0, 4],
    [6, 10],
    [12, 16],
  ]);
  assert.deepEqual(findInText('aaaaaa', 'aaa'), [
    [0, 3],
    [3, 6],
  ]);
  assert.deepEqual(findInText('anything', ''), []);
});

test('room find: a word split by formatting is still found', () => {
  // "hel" is plain and "lo world" is bold: two text nodes, one word.
  const segments = [
    { start: 0, length: 3 },
    { start: 3, length: 8 },
  ];
  const [[start, end]] = findInText('hel' + 'lo world', 'hello');
  assert.deepEqual(locateOffset(segments, start), { index: 0, offset: 0 });
  assert.deepEqual(locateOffset(segments, end, true), { index: 1, offset: 2 });
});

test('room find: a match never starts at the very end of a node', () => {
  const segments = [
    { start: 0, length: 3 },
    { start: 3, length: 3 },
  ];
  assert.deepEqual(locateOffset(segments, 3), { index: 1, offset: 0 }, 'a start belongs to the next node');
  assert.deepEqual(locateOffset(segments, 3, true), { index: 0, offset: 3 }, 'an end stays in its node');
});

test('room find: the count reads naturally and stepping wraps', () => {
  assert.equal(findLabel(1, 7), '2 of 7');
  assert.equal(findLabel(0, 0), 'No match');
  assert.equal(stepIndex(6, 7, 1), 0, 'past the last goes back to the first');
  assert.equal(stepIndex(0, 7, -1), 6, 'before the first goes to the last');
  assert.equal(stepIndex(0, 0, 1), 0);
});

// ── Templates (pageTemplates.js) ──────────────────────────────────────────────

test('room templates: a template becomes fresh blocks whose headings title the outline', () => {
  const lecture = PAGE_TEMPLATES.find((template) => template.id === 'lecture');
  const blocks = instantiate(lecture.blocks);
  assert.equal(blocks[0].section, true, 'the first block always opens §1');
  assert.deepEqual(
    sectionsOf(blocks).map((section) => section.title),
    ['Key ideas', 'Definitions', 'To review'],
  );
  const again = instantiate(lecture.blocks);
  assert.notEqual(blocks[0].id, again[0].id, 'every use gets new ids');
  assert.notEqual(blocks[2].colA[0].id, again[2].colA[0].id, 'column children too');
});

test('room templates: offered only on a truly blank note', () => {
  const empty = [{ id: 'a', type: BLOCK_TEXT, value: '<p></p>' }];
  assert.equal(isBlankPage(empty, 0), true);
  assert.equal(isBlankPage([{ id: 'a', type: BLOCK_TEXT, value: '<p>x</p>' }], 0), false, 'typed');
  assert.equal(isBlankPage(empty, 1), false, 'a photo is on the board');
  assert.equal(isBlankPage([...empty, { id: 'b', type: BLOCK_TEXT }], 0), false, 'two blocks');
});

test("room templates: saving a note's structure keeps its shape and none of its words", () => {
  const note = [
    { id: '1', type: BLOCK_TEXT, section: true, value: '<h2>Trees</h2><p>Left is smaller.</p>' },
    { id: '2', type: BLOCK_CODE, lang: 'python', value: 'def insert(root):' },
    { id: '3', type: 'checklist', value: '<h2>Todo</h2><ul data-type="taskList"><li data-checked="true"><p>done</p></li></ul>' },
    {
      id: '4',
      type: BLOCK_TWO_COLUMN,
      colA: [{ id: 'l', type: BLOCK_TEXT, value: '<h3>Left</h3><p>secret</p>' }],
      colB: [{ id: 'r', type: 'callout', label: 'Prof said', value: '<p>secret</p>' }],
    },
  ];
  const shape = structureOf(note);
  const text = JSON.stringify(shape);
  assert.ok(!/smaller|insert|done|secret/.test(text), 'nothing that was written survives');
  assert.equal(shape[0].value, '<h2>Trees</h2><p></p>');
  assert.equal(shape[1].lang, 'python');
  assert.equal(shape[1].value, '');
  assert.ok(shape[2].value.startsWith('<h2>Todo</h2>'));
  assert.equal(shape[3].colB[0].label, 'Prof said');
  assert.ok(!('id' in shape[0]), 'ids are made fresh when the template is used');
});

test('room templates: saved ones read oldest first, and junk is ignored', () => {
  const list = savedTemplates({
    b: { id: 'b', name: 'B', blocks: [], createdAt: 2 },
    a: { id: 'a', name: 'A', blocks: [], createdAt: 1 },
    broken: { name: 'no id', blocks: [] },
    alsoBroken: { id: 'x', name: 'no blocks' },
  });
  assert.deepEqual(list.map((template) => template.id), ['a', 'b']);
  assert.deepEqual(savedTemplates(undefined), []);
});

// ── Course schedules and the calendar (calendarDays.js) ───────────────────────
// 2026-09-25 is a Friday; 2026-09-26/27 the weekend; 2026-09-28 a Monday.

const COURSES = [
  { id: 'stats', name: 'Statistics', color: '#c24a6e', schedule: { days: [5], time: '11:00' } },
  { id: 'ds', name: 'Data Structures', color: '#2e8b6a', schedule: { days: [1, 3, 5], time: '' } },
  { id: 'la', name: 'Linear Algebra', color: '#2f7bb8', schedule: { days: [1, 4], time: '09:00' } },
  { id: 'studio', name: 'Design Studio', color: '#b08a12' },
];

test('course schedule: reads the way the design writes it', () => {
  assert.equal(scheduleLine({ days: [2, 4], time: '10:00' }), 'Tue & Thu 10:00');
  assert.equal(scheduleLine({ days: [5, 3, 1] }), 'Mon, Wed & Fri');
  assert.equal(scheduleLine({ days: [5], time: '11:00' }), 'Fri 11:00');
  assert.equal(scheduleLine({ days: [1, 2, 3, 4, 5], time: '9:05' }), 'Weekdays 09:05');
  // A student's week runs Monday to Sunday.
  assert.equal(scheduleLine({ days: [0, 1] }), 'Mon & Sun');
});

test('course schedule: nothing set means nothing shown, and bad values are dropped', () => {
  assert.equal(scheduleLine(undefined), '');
  assert.equal(scheduleLine({ days: [] , time: '10:00' }), '');
  assert.equal(scheduleLine('Tue & Thu'), '');
  assert.equal(cleanSchedule({ days: ['2', 9, 2], time: '25:00' }).time, '');
  assert.deepEqual(cleanSchedule({ days: ['2', 9, 2] }).days, [2]);
  assert.equal(courseMeta({ schedule: { days: [2, 4] }, room: ' Room 204 ', professor: 'Dr. Haddad' }), 'Tue & Thu · Room 204');
  assert.equal(
    courseMeta({ schedule: { days: [2, 4] }, room: 'Room 204', professor: 'Dr. Haddad' }, { professor: true }),
    'Tue & Thu · Room 204 · Dr. Haddad',
  );
  assert.equal(courseMeta({ name: 'Bare' }), '');
});

test('calendar day: classes come from schedules; timed first, then classes, then your things', () => {
  const events = [
    { id: 'e1', date: '2026-09-25', title: 'Quiz 2', courseId: 'stats' },
    { id: 'e2', date: '2026-09-25', title: 'Coffee', time: '08:30' },
    { id: 'e3', date: '2026-09-25', title: 'Orphan', courseId: 'gone' },
    { id: 'e4', date: '2026-09-24', title: 'Elsewhere' },
  ];
  const friday = dayEntries('2026-09-25', { courses: COURSES, events });
  assert.deepEqual(
    friday.map((entry) => entry.title),
    ['Coffee', 'Statistics', 'Data Structures', 'Orphan', 'Quiz 2'],
  );
  assert.equal(friday.find((entry) => entry.title === 'Quiz 2').courseName, 'Statistics');
  assert.equal(friday.find((entry) => entry.title === 'Orphan').courseName, '');
  assert.equal(friday.find((entry) => entry.title === 'Statistics').time, '11:00');
  assert.deepEqual(dayEntries('2026-09-26', { courses: COURSES, events }), []);
});

test('calendar journal: empty days merge into one quiet line, kept days stay strips', () => {
  const entriesOf = (key) => dayEntries(key, { courses: COURSES });
  const rows = journalRows('2026-09-25', '2026-09-28', entriesOf, ['2026-09-25']);
  assert.deepEqual(
    rows.map((row) => (row.type === 'quiet' ? `quiet:${row.keys.join(',')}` : `${row.type}:${row.key}`)),
    ['day:2026-09-25', 'quiet:2026-09-26,2026-09-27', 'day:2026-09-28'],
  );
  assert.equal(quietLine(rows[1].keys), 'Saturday 26 · Sunday 27 — weekend, nothing planned.');
  // A kept day is a strip even when empty — there has to be a + to press.
  const kept = journalRows('2026-09-26', '2026-09-27', () => [], ['2026-09-27']);
  assert.deepEqual(kept.map((row) => row.type), ['quiet', 'day']);
  assert.deepEqual(journalRows('2026-09-28', '2026-09-25', entriesOf), []);
});

test('calendar journal: a new month gets a divider, and no quiet run crosses it', () => {
  const rows = journalRows('2026-09-29', '2026-10-02', () => []);
  assert.deepEqual(
    rows.map((row) => row.type),
    ['quiet', 'month', 'quiet'],
  );
  assert.equal(rows[1].key, '2026-10-01');
  assert.equal(quietLine(['2026-10-01', '2026-10-02', '2026-10-03']), 'Thursday 1 to Saturday 3 — nothing planned.');
});

test('calendar month: the dot-month and the wall grid start on Sunday', () => {
  const { blanks, keys } = monthDays(2026, 8);
  assert.equal(blanks, 2); // September 2026 opens on a Tuesday, as the design draws it
  assert.equal(keys.length, 30);
  assert.equal(keys[0], '2026-09-01');
  const grid = monthGrid(2026, 8);
  assert.equal(grid.length, 42);
  assert.equal(grid[0], '2026-08-30');
  assert.equal(grid[2], '2026-09-01');
});

test('calendar sentence: says what today holds and what comes next', () => {
  const entriesOf = (key) => dayEntries(key, { courses: COURSES });
  // The design's own line.
  assert.equal(calendarSummary({ todayKey: '2026-09-25', entriesOf }), 'Two classes today, then a free weekend.');
  assert.equal(
    calendarSummary({ todayKey: '2026-09-27', entriesOf }),
    'Nothing today. Linear Algebra tomorrow.',
  );
  assert.equal(
    calendarSummary({ todayKey: '2026-09-26', entriesOf }),
    'Nothing today. Linear Algebra on Monday.',
  );
  assert.equal(calendarSummary({ todayKey: '2026-09-25', entriesOf: () => [] }), 'Nothing in the next two weeks.');
  // On a Saturday the free day ahead is Sunday alone.
  const saturday = (key) =>
    dayEntries(key, { courses: COURSES, events: [{ id: 's', date: '2026-09-26', title: 'Quiz 2' }] });
  assert.equal(calendarSummary({ todayKey: '2026-09-26', entriesOf: saturday }), 'One thing today, then a free Sunday.');
  const withThing = (key) =>
    dayEntries(key, { courses: [], events: [{ id: 'a', date: '2026-09-25', title: 'Deadline' }] });
  assert.equal(
    calendarSummary({ todayKey: '2026-09-25', entriesOf: withThing }),
    'One thing today, and nothing else for two weeks.',
  );
  assert.equal(monthSummary({ year: 2026, month: 9, events: [] }), 'Nothing added for October yet.');
  assert.equal(
    monthSummary({ year: 2026, month: 9, events: [{ date: '2026-10-02' }, { date: '2026-10-09' }, { date: '2026-11-01' }] }),
    'Two things added for October.',
  );
});

test('home status: the day, once courses carry times — and nothing invented before that', () => {
  const friday = (h, m) => new Date(2026, 8, 25, h, m);
  assert.equal(
    classStatus({ courses: COURSES, now: friday(10, 15) }),
    'Two classes today — Statistics, then Data Structures. The rest of the day is yours.',
  );
  assert.equal(
    classStatus({ courses: COURSES, now: friday(21, 40) }),
    "Friday's done. Linear Algebra is next, Monday morning. Nothing before then.",
  );
  // A class in progress still counts; an untimed one is over once the teaching day is.
  assert.equal(
    classStatus({ courses: COURSES, now: friday(18, 30) }),
    "Friday's done. Linear Algebra is next, Monday morning. Nothing before then.",
  );
  assert.equal(
    classStatus({ courses: [COURSES[0]], now: friday(11, 40) }),
    'Statistics at 11:00. The rest of the day is yours.',
  );
  assert.equal(classStatus({ courses: [{ id: 'x', name: 'No times' }], now: friday(10, 0) }), '');
});

// ── Search (deskSearch.js) ────────────────────────────────────────────────────

test('search: folding ignores case and accents without moving any index', () => {
  assert.equal(fold('Éclair Été'), 'eclair ete');
  assert.equal(fold('ÀBÇ').length, 3);
  assert.equal(fold('plain Text'), 'plain text');
});

test('search: titles first, then bodies, courses by name; empty query finds nothing', () => {
  const notes = [
    { id: 'n1', classId: 'c1', title: 'Hash tables' },
    { id: 'n2', classId: 'c1', title: 'Trees' },
    { id: 'n3', classId: 'c2', title: 'Résumé tips' },
  ];
  const texts = new Map([
    ['n2', indexedText('A BST degrades to a list. Hashing is faster on average.')],
    ['n3', indexedText('Nothing relevant')],
  ]);
  const courses = [{ id: 'c1', name: 'Data Structures' }, { id: 'c2', name: 'Career' }];

  const hash = searchDesk({ query: 'HASH', courses, notes, texts });
  assert.deepEqual(hash.notes.map((hit) => [hit.note.id, hit.where]), [['n1', 'title'], ['n2', 'body']]);
  assert.equal(hash.notes[1].snippet.match, 'Hash');
  assert.equal(hash.notes[1].snippet.before, 'A BST degrades to a list. ');
  assert.ok(hash.notes[1].snippet.after.startsWith('ing is faster'));

  assert.deepEqual(searchDesk({ query: 'resume', courses, notes, texts }).notes.map((hit) => hit.note.id), ['n3']);
  assert.deepEqual(searchDesk({ query: 'data', courses, notes, texts }).courses.map((c) => c.id), ['c1']);
  assert.deepEqual(searchDesk({ query: '   ', courses, notes, texts }), { courses: [], notes: [] });
  // A body not read yet simply does not match — yet.
  assert.deepEqual(searchDesk({ query: 'faster', courses, notes, texts: new Map() }).notes, []);
});

test('search: a page reads as its text — columns, callouts, code — and never its photos', () => {
  const blocks = [
    { id: 'a', type: 'text', value: '<p>Intro &amp; <b>bold</b></p>' },
    { id: 'b', type: 'callout', label: 'Prof said', value: '<p>on the exam</p>' },
    { id: 'c', type: 'code', value: 'x = 1' },
    {
      id: 'd',
      type: 'twoColumn',
      colA: [{ id: 'd1', type: 'text', value: '<p>left</p>' }],
      colB: [{ id: 'd2', type: 'text', value: '<p>right</p>' }],
    },
    { id: 'e', type: 'image', rail: true, value: 'photo.jpg', alt: 'whiteboard' },
  ];
  assert.equal(pageText(blocks), 'Intro & bold\nProf said on the exam\nx = 1\nleft\nright');
});

// ── Inbox (inboxLines.js) ──────────────────────────────────────────────────────

test('inbox: newest line first; blank or broken entries are not lines', () => {
  const lines = inboxLines({
    a: { id: 'a', text: 'older', createdAt: 1 },
    b: { id: 'b', text: 'newer', createdAt: 2 },
    c: { id: 'c', text: '   ', createdAt: 3 },
    d: { text: 'no id', createdAt: 4 },
    e: null,
  });
  assert.deepEqual(lines.map((line) => line.id), ['b', 'a']);
  assert.deepEqual(inboxLines(undefined), []);
});

test('inbox: a filed line becomes a titled note whose first paragraph is the line', () => {
  assert.equal(titleFromLine('Ask about AVL rotations'), 'Ask about AVL rotations');
  assert.equal(
    titleFromLine('Ask the professor whether the left-right case is on the midterm or only the final'),
    'Ask the professor whether the left-right case is on the…',
  );
  assert.equal(titleFromLine('   '), 'Untitled');
  const block = textBlock('a < b & c', { section: true });
  assert.equal(block.value, '<p>a &lt; b &amp; c</p>');
  assert.equal(block.type, BLOCK_TEXT);
  assert.equal(block.section, true);
  assert.ok(block.id);
});

test('outline: a section is titled by its first line, never a heading run into its paragraph', () => {
  const [section] = sectionsOf([
    { id: 'a', section: true, value: '<h2>Trees that stay short</h2><p>A degenerate tree is a list.</p>' },
  ]);
  assert.equal(section.title, 'Trees that stay short');
  const [empty] = sectionsOf([{ id: 'b', section: true, value: '<p></p><p>Second line wins</p>' }]);
  assert.equal(empty.title, 'Second line wins');
});

test('course term: classes run only between its first and last day, when those are set', () => {
  const term = { id: 't', name: 'Paradigm', schedule: { days: [2], time: '10:00', from: '2026-09-01', until: '2026-12-15' } };
  assert.equal(dayEntries('2026-09-29', { courses: [term] }).length, 1); // a Tuesday in term
  assert.equal(dayEntries('2026-08-25', { courses: [term] }).length, 0); // a Tuesday before it
  assert.equal(dayEntries('2026-12-22', { courses: [term] }).length, 0); // a Tuesday after it
  assert.equal(cleanSchedule({ days: [2], from: '2026-12-01', until: '2026-09-01' }).until, undefined);
  assert.equal(cleanSchedule({ days: [2], from: 'soon' }).from, undefined);
  // Dates never change how the week reads.
  assert.equal(scheduleLine(term.schedule), 'Tue 10:00');
});

test('course files: every photo on a note — board, page and columns — and nothing still uploading', () => {
  const photos = photosOf([
    { id: 'a', type: 'image', rail: true, value: 'https://x/board.webp', ar: 1.5 },
    { id: 'b', type: 'image', value: 'https://x/page.webp', alt: 'whiteboard' },
    { id: 'c', type: 'image', value: '' },
    { id: 'd', type: 'twoColumn', colA: [{ id: 'd1', type: 'image', value: 'https://x/col.webp' }], colB: [] },
    { id: 'e', type: 'text', value: '<p>https://x/not-a-photo</p>' },
  ]);
  assert.deepEqual(photos.map((photo) => photo.id), ['a', 'b', 'd1']);
  assert.equal(photos[1].alt, 'whiteboard');
});

// ── Sage in the room (sageBridge.js) ──────────────────────────────────────────

const SAGE_PAGE = [
  { id: 't1', type: 'text', section: true, value: '<h2>Trees</h2><p>A degenrate tree is a list.</p>' },
  { id: 'c1', type: 'callout', label: 'Prof said', value: '<p>Rotations are on the midterm.</p>' },
  { id: 'k1', type: 'code', lang: 'python', value: 'if a < b:\n    return a' },
  { id: 'm1', type: 'math', value: 'O(log n)' },
  { id: 'x1', type: 'checklist', value: '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>read ch 4</p></li><li data-type="taskItem" data-checked="false"><p>do set 2</p></li></ul>' },
  {
    id: 'w1',
    type: 'twoColumn',
    colA: [{ id: 'wa', type: 'text', value: '<p>left side</p>' }],
    colB: [{ id: 'wb', type: 'text', value: '<p>right side</p>' }],
  },
  { id: 'i1', type: 'image', value: 'https://x/page.webp' },
  { id: 'r1', type: 'image', rail: true, value: 'https://x/board.webp', y: 0, w: 300, ar: 1.5 },
];

test('sage out: every page block goes as text or image; columns go as their children; the board never goes', () => {
  const out = toSageBlocks(SAGE_PAGE);
  assert.deepEqual(out.map((b) => b.id), ['t1', 'c1', 'k1', 'm1', 'x1', 'wa', 'wb', 'i1']);
  assert.ok(out.every((b) => b.type === 'text' || b.type === 'image'));
  assert.equal(out.find((b) => b.id === 'c1').title, 'Prof said');
  assert.equal(out.find((b) => b.id === 'k1').value, '<pre><code>if a &lt; b:\n    return a</code></pre>');
  assert.equal(out.find((b) => b.id === 'i1').value, '');
  assert.equal(hasSageText(out), true);
  assert.equal(hasSageText([{ id: 'e', type: 'text', value: '<p>hi</p>' }]), false);
});

test('sage back, quick edit: each answer keeps its block shape, in place — columns included', () => {
  const applied = applySageResult(SAGE_PAGE, {
    mode: 'patch',
    changed: [
      { id: 't1', title: 'ignored', value: '<h2>Trees</h2><p>A degenerate tree is a list.</p>' },
      { id: 'c1', title: 'The professor said', value: '<p>Rotations ARE on the midterm.</p>' },
      { id: 'k1', value: '<pre><code>if a &lt; b:\n    return b</code></pre>' },
      { id: 'x1', value: '<ul><li>read chapter 4</li><li>do problem set 2</li><li>review</li></ul>' },
      { id: 'wb', value: '<p>right side, fixed</p>' },
      { id: 'i1', value: '<p>an image cannot become text</p>' },
      { id: 'nope', value: '<p>invented</p>' },
    ],
  });
  const byId = new Map(applied.blocks.map((b) => [b.id, b]));
  assert.equal(applied.changed, 5);
  assert.equal(byId.get('t1').value, '<h2>Trees</h2><p>A degenerate tree is a list.</p>');
  assert.equal(byId.get('c1').label, 'The professor said');
  assert.equal(byId.get('k1').value, 'if a < b:\n    return b');
  assert.equal(byId.get('k1').type, 'code');
  assert.match(byId.get('x1').value, /^<ul data-type="taskList">/);
  assert.match(byId.get('x1').value, /data-checked="true"><p>read chapter 4<\/p>/);
  assert.match(byId.get('x1').value, /data-checked="false"><p>review<\/p>/);
  assert.equal(byId.get('w1').colB[0].value, '<p>right side, fixed</p>');
  assert.equal(byId.get('w1').colA[0].value, '<p>left side</p>');
  assert.equal(byId.get('i1').value, 'https://x/page.webp');
  assert.equal(applied.blocks.at(-1).id, 'r1'); // the board rides along untouched
  assert.equal(sageSummary(applied), 'Sage changed 5 blocks.');
});

test('sage back, additions: new blocks land after the block Sage names, typed by role', () => {
  const applied = applySageResult(SAGE_PAGE, {
    mode: 'reflow',
    changed: [],
    added: [
      { afterId: 't1', title: 'Careful', value: '<p>Duplicates break this.</p>', role: 'caveat' },
      { afterId: 't1', title: 'Say it again', value: '<p>second after t1</p>', role: 'concept' },
      { afterId: 'wa', title: '', value: '<pre><code>x = 1</code></pre>', role: 'example' },
      { afterId: '', title: '', value: '<p>n^2 + 1</p>', role: 'formula' },
      { afterId: 'm1', title: '', value: '   ', role: 'concept' },
    ],
  });
  const order = applied.blocks.map((b) => b.type + (b.label ? `:${b.label}` : ''));
  assert.deepEqual(order.slice(0, 5), ['math', 'text', 'callout:Careful', 'text', 'callout:Prof said']);
  assert.equal(applied.blocks[0].section, true); // the page still opens a section
  assert.equal(applied.blocks[3].value, '<h3>Say it again</h3><p>second after t1</p>');
  const afterColumns = applied.blocks.findIndex((b) => b.id === 'w1') + 1;
  assert.equal(applied.blocks[afterColumns].type, 'code');
  assert.equal(applied.blocks[afterColumns].value, 'x = 1');
  assert.equal(applied.added, 4);
});

test('sage back, rebuild: reading order, terms become two columns, a heading opens a section, photos survive', () => {
  const applied = applySageResult(SAGE_PAGE, {
    mode: 'layout',
    blocks: [
      { ref: 'a', id: '', title: 'Balanced trees', value: '<p>Why height matters.</p>', role: 'lead' },
      { ref: 'b', id: 't1', title: 'Degenerate trees', value: '<p>A degenerate tree is a list.</p>', role: 'concept' },
      { ref: 'c', id: '', title: 'AVL', value: '<p>Rotates.</p>', role: 'terms' },
      { ref: 'd', id: '', title: 'Red-black', value: '<p>Recolours.</p>', role: 'terms' },
      { ref: 'e', id: '', title: 'Splay', value: '<p>Moves to root.</p>', role: 'terms' },
      { ref: 'f', id: 'c1', title: 'Prof said', value: '<p>On the midterm.</p>', role: 'caveat' },
      { ref: 'g', id: 'k1', title: 'Code', value: '<pre><code>rotate()</code></pre>', role: 'example' },
    ],
  });
  const page = applied.blocks.filter((b) => !b.rail);
  assert.deepEqual(page.map((b) => b.type), ['text', 'text', 'twoColumn', 'callout', 'code', 'image']);
  assert.equal(page[0].value, '<h2>Balanced trees</h2><p>Why height matters.</p>');
  assert.equal(page[0].section, true);
  assert.equal(page[1].value, '<h3>Degenerate trees</h3><p>A degenerate tree is a list.</p>');
  assert.equal(page[1].section, false);
  assert.equal(page[2].colA.length, 2);
  assert.equal(page[2].colB.length, 1);
  assert.equal(page[4].value, 'rotate()');
  assert.equal(page[5].id, 'i1'); // left out by Sage, kept anyway
  assert.equal(applied.blocks.at(-1).id, 'r1');
  assert.equal(applied.changed, 3);
  assert.equal(applied.added, 4);
});

test('sage back: an unusable answer is refused, and small helpers read the way they say', () => {
  assert.equal(applySageResult(SAGE_PAGE, null), null);
  assert.equal(applySageResult(SAGE_PAGE, { mode: 'layout', blocks: [] }), null);
  assert.equal(applySageResult(SAGE_PAGE, { mode: 'weird' }), null);
  assert.equal(htmlToLines('<p>a</p><p>b &amp; c</p>'), 'a\nb & c');
  assert.equal(blockForRole('formula', '', '<ul><li>long</li></ul>').type, 'text');
  assert.equal(blockForRole('summary', '', '<p>tl;dr</p>').label, 'In short');
  assert.equal(asTaskList('<p>just words</p>', ''), '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>just words</p></li></ul>');
});

test('sage back, rebuild: a block written while Sage was working is kept, not lost', () => {
  const sent = new Set(toSageBlocks(SAGE_PAGE).map((b) => b.id));
  const now = [...SAGE_PAGE.slice(0, 1), { id: 'late', type: 'text', value: '<p>typed during the run</p>' }, ...SAGE_PAGE.slice(1)];
  const applied = applySageResult(now, { mode: 'layout', blocks: [{ ref: 'a', id: 't1', title: '', value: '<p>kept</p>', role: 'concept' }] }, { sent });
  const page = applied.blocks.filter((b) => !b.rail).map((b) => b.id);
  assert.deepEqual(page, ['t1', 'i1', 'late']);
});
