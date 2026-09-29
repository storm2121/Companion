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
import { DESIGN_DEFAULT_MODE, designFor, resolveDesignMode } from '../src/designModes.js';
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
  breakOn,
  calendarSummary,
  classStatus,
  cleanBreaks,
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
import { courseFromPath, fold, indexedText, matchActions, searchDesk } from '../src/room/deskSearch.js';
import {
  cleanTag,
  cleanTags,
  hasTag,
  splitTags,
  suggestTags,
  tagCounts,
  TAGS_PER_NOTE,
  withoutTag,
  withTags,
} from '../src/room/noteTags.js';
import { inboxLines, titleFromLine } from '../src/room/inboxLines.js';
import {
  applySageResult,
  asTaskList,
  blockForRole,
  hasSageText,
  htmlToLines,
  sageScope,
  sageSummary,
  sectionBounds,
  toPageBlocks,
  toSageBlocks,
} from '../src/room/sageBridge.js';
import {
  canvasToMarkdown,
  crc32,
  htmlToMarkdown,
  noteToMarkdown,
  pageToMarkdown,
  safeName,
  storedBlocks,
  uniqueNamer,
  zipFiles,
} from '../src/room/markdownExport.js';
import { shortcutFor, SHORTCUT_HINTS } from '../src/room/shortcutPatterns.js';
import { Fragment, Schema, Slice } from '@tiptap/pm/model';
import { cleanPastedText, clipboardFragment, isFromProseMirror, keptStyle, tidyPastedSlice } from '../src/room/pasteClean.js';
import { imageSize, imageTilt, isUploadedImage } from '../src/room/pageImages.js';
import { cleanTex, formulaRows } from '../src/room/mathText.js';
import { fillSnippet, MATH_GROUPS } from '../src/room/mathSymbols.js';

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
  assert.deepEqual(searchDesk({ query: '   ', courses, notes, texts }), { courses: [], notes: [], tags: [] });
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

// ── Markdown export (markdownExport.js) ───────────────────────────────────────

test('markdown: the editor HTML reads as plain Markdown — marks, links, code, breaks', () => {
  assert.equal(
    htmlToMarkdown('<h2>Trees</h2><p>A <strong>bold</strong> and <em>it</em> word, <s>gone</s>, <code>x_y</code>, <a href="https://e.x">link</a>.</p>'),
    '## Trees\n\nA **bold** and *it* word, ~~gone~~, `x_y`, [link](https://e.x).',
  );
  assert.equal(htmlToMarkdown('<p>a &lt; b &amp; c*d</p>'), 'a < b & c\\*d');
  assert.equal(htmlToMarkdown('<p>line one<br>line two</p>'), 'line one  \nline two');
  assert.equal(htmlToMarkdown('<blockquote><p>quoted</p></blockquote>'), '> quoted');
  assert.equal(htmlToMarkdown('<pre><code>def f():\n    return 1</code></pre>'), '```\ndef f():\n    return 1\n```');
  assert.equal(htmlToMarkdown('<p><strong>bold </strong>after</p>'), '**bold** after');
});

test('markdown: lists nest, ordered lists keep their start, task lists keep their ticks', () => {
  assert.equal(
    htmlToMarkdown('<ul><li><p>one</p></li><li><p>two</p><ul><li><p>deep</p></li></ul></li></ul><ol start="3"><li><p>c</p></li><li><p>d</p></li></ol>'),
    '- one\n- two\n  - deep\n\n3. c\n4. d',
  );
  // The HTML TipTap writes for a task list, label and checkbox included.
  assert.equal(
    htmlToMarkdown('<ul data-type="taskList"><li data-checked="true" data-type="taskItem"><label><input type="checkbox" checked="checked"><span></span></label><div><p>read ch 4</p></div></li><li data-type="taskItem" data-checked="false"><p>set 2</p></li></ul>'),
    '- [x] read ch 4\n- [ ] set 2',
  );
  assert.equal(
    htmlToMarkdown('<table><tbody><tr><th><p>Term</p></th><th><p>Meaning</p></th></tr><tr><td><p>BST</p></td><td><p>a | tree</p></td></tr></tbody></table>'),
    '| Term | Meaning |\n| --- | --- |\n| BST | a \\| tree |',
  );
});

test('markdown: a room page — every block type, columns in order, board photos last and top-down', () => {
  const photo = (url) => url.replace('https://x/', 'photos/');
  const md = pageToMarkdown(
    [
      { id: 't', type: 'text', section: true, value: '<h2>Trees</h2><p>Short.</p>' },
      { id: 'c', type: 'callout', label: 'Prof said', value: '<p>On the midterm.</p>' },
      { id: 'k', type: 'code', lang: 'python', value: 'x = 1' },
      { id: 'm', type: 'math', value: 'O(log n)' },
      { id: 'w', type: 'twoColumn', colA: [{ id: 'a', type: 'text', value: '<p>left</p>' }], colB: [{ id: 'b', type: 'text', value: '<p>right</p>' }] },
      { id: 'i', type: 'image', value: 'https://x/p.webp', alt: 'board' },
      { id: 'r2', type: 'image', rail: true, value: 'https://x/low.webp', y: 300 },
      { id: 'r1', type: 'image', rail: true, value: 'https://x/high.webp', y: 10 },
    ],
    photo,
  );
  assert.equal(
    md,
    [
      '## Trees\n\nShort.',
      '> **Prof said**\n>\n> On the midterm.',
      '```python\nx = 1\n```',
      '$$\nO(log n)\n$$',
      'left\n\nright',
      '![board](photos/p.webp)',
      '## Photos',
      '![](photos/high.webp)',
      '![](photos/low.webp)',
    ].join('\n\n'),
  );
});

test('markdown: a classic note reads top to bottom, left to right, without its default titles', () => {
  assert.equal(
    canvasToMarkdown([
      { type: 'text', title: 'Text 2', value: '<p>second</p>', x: 0, y: 200 },
      { type: 'text', title: 'Key idea', value: '<p>first</p>', x: 700, y: 10 },
      { type: 'text', title: '', value: '<p>beside</p>', x: 10, y: 10 },
      { type: 'image', value: 'https://x/c.png', x: 0, y: 400 },
    ]),
    'beside\n\n### Key idea\n\nfirst\n\nsecond\n\n![](https://x/c.png)',
  );
});

test('markdown: a whole note file, from either schema the note may be stored in', () => {
  assert.deepEqual(
    storedBlocks({ content: { blocks: { b: { id: 'b' }, a: { id: 'a' }, z: { id: 'z' } }, order: ['a', 'b'] } }).map((b) => b.id),
    ['a', 'b', 'z'],
  );
  assert.deepEqual(storedBlocks({ content: null, blocks: [{ id: 'legacy' }] }).map((b) => b.id), ['legacy']);
  const when = new Date(2026, 8, 26).getTime();
  const page = { title: 'Binary search trees', format: 'page', kind: 'Lecture', updatedAtMs: when, content: { blocks: { t: { id: 't', type: 'text', value: '<p>Hi</p>' } }, order: ['t'] } };
  assert.equal(noteToMarkdown(page, 'Paradigm'), '# Binary search trees\n\n*Paradigm · Lecture · updated 26 Sep 2026*\n\nHi\n');
  const classic = { title: 'Old', updatedAtMs: when, content: { blocks: { t: { id: 't', type: 'text', value: '<p>Canvas</p>', x: 0, y: 0 } }, order: ['t'] } };
  assert.equal(noteToMarkdown(classic, 'Paradigm'), '# Old\n\n*Paradigm · classic desk · updated 26 Sep 2026*\n\nCanvas\n');
});

test('markdown: file names every system accepts, and no two alike in a folder', () => {
  assert.equal(safeName('a/b:c*?'), 'a-b-c--');
  assert.equal(safeName('notes. '), 'notes');
  assert.equal(safeName('CON'), 'CON-');
  assert.equal(safeName('   '), 'Untitled');
  assert.equal(safeName('a\u0001b'), 'ab');
  const name = uniqueNamer();
  assert.equal(name('Paradigm', 'Notes', '.md'), 'Paradigm/Notes.md');
  assert.equal(name('Paradigm', 'Notes', '.md'), 'Paradigm/Notes (2).md');
  assert.equal(name('Paradigm', 'notes', '.md'), 'Paradigm/notes (3).md');
  assert.equal(name('', 'Inbox', '.md'), 'Inbox.md');
});

test('zip: CRC-32 is the standard one, and the archive is laid out as the format says', () => {
  const encode = (text) => new TextEncoder().encode(text);
  assert.equal(crc32(encode('123456789')), 0xcbf43926);
  const bytes = zipFiles([
    { path: 'A/x.md', data: 'hello' },
    { path: 'b.txt', data: new Uint8Array([1, 2, 3]) },
  ]);
  const view = new DataView(bytes.buffer);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  assert.equal(view.getUint32(14, true), crc32(encode('hello')));
  assert.equal(new TextDecoder().decode(bytes.slice(30, 36)), 'A/x.md');
  const end = bytes.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50);
  assert.equal(view.getUint16(end + 10, true), 2);
  assert.equal(view.getUint32(end + 16, true), 79); // the central directory starts after both entries
  assert.equal(view.getUint32(end + 12, true), 103);
  assert.equal(bytes.length, 204);
});

test('breaks: a break silences every class on its days, and the journal says which break it is', () => {
  const breaks = cleanBreaks([
    { id: 'fall', name: 'Fall break', from: '2026-10-16', until: '2026-10-12' }, // reversed on purpose
    { id: 'one', from: '2026-10-21' }, // a one-day break, unnamed
    { from: 'soon' }, // not a date: dropped
  ]);
  assert.deepEqual(breaks.map((b) => [b.id, b.from, b.until]), [['fall', '2026-10-12', '2026-10-16'], ['one', '2026-10-21', '2026-10-21']]);
  assert.equal(breakOn(breaks, '2026-10-14').name, 'Fall break');
  assert.equal(breakOn(breaks, '2026-10-17'), null);

  // Monday 12 Oct has Data Structures and Linear Algebra — not during the break.
  assert.deepEqual(dayEntries('2026-10-12', { courses: COURSES, breaks }), []);
  const kept = dayEntries('2026-10-12', { courses: COURSES, breaks, events: [{ id: 'e', date: '2026-10-12', title: 'Essay due' }] });
  assert.deepEqual(kept.map((e) => e.title), ['Essay due']);

  const entriesOf = (key) => dayEntries(key, { courses: COURSES, breaks });
  const rows = journalRows('2026-10-09', '2026-10-19', entriesOf, [], (key) => breakOn(breaks, key));
  const quiet = rows.filter((row) => row.type === 'quiet');
  // Sat–Sun before the break, the break itself (weekend included), then back to classes.
  assert.deepEqual(quiet.map((row) => [row.keys[0], row.keys.at(-1), row.breakName]), [
    ['2026-10-10', '2026-10-11', null],
    ['2026-10-12', '2026-10-16', 'Fall break'],
    ['2026-10-17', '2026-10-18', null],
  ]);
  assert.equal(quietLine(quiet[1].keys, quiet[1].breakName), 'Monday 12 to Friday 16 — Fall break, no classes.');
  assert.equal(quietLine(['2026-10-21'], ''), 'Wednesday 21 — a break, no classes.');

  // Home says so, and still finds the next class after it.
  assert.equal(
    classStatus({ courses: COURSES, now: new Date(2026, 9, 14, 10, 0), breaks }),
    'Fall break — no classes today. Linear Algebra is next, Monday morning. Nothing before then.',
  );
});

test('design default: a NEW account starts in the room; a profile with no preference stays classic', () => {
  // DESIGN_DEFAULT_MODE only seeds new profiles. Pre-seam profiles carry no designMode and
  // have always used classic — they must not be moved.
  assert.equal(DESIGN_DEFAULT_MODE, 'room');
  assert.equal(resolveDesignMode(undefined), 'classic');
  assert.equal(resolveDesignMode(DESIGN_DEFAULT_MODE), 'room');
  assert.equal(designFor('/dashboard', undefined), 'classic');
  assert.equal(designFor('/dashboard', DESIGN_DEFAULT_MODE), 'room');
});

// ── Shortcuts and the math toolbar ────────────────────────────────────────────

test('shortcuts: each room block has its marker, finished by a space; ordinary text is left alone', () => {
  assert.equal(shortcutFor('``` ').kind, 'code');
  assert.equal(shortcutFor('```python ').match[1], 'python');
  assert.equal(shortcutFor('$$ ').kind, 'math');
  assert.equal(shortcutFor('>> ').kind, 'callout');
  assert.equal(shortcutFor('|| ').kind, 'columns');
  assert.equal(shortcutFor('§ ').kind, 'section');
  assert.equal(shortcutFor('---').kind, 'divider'); // fires on the third dash, like a rule
  assert.equal(shortcutFor('--- '), null);
  // TipTap's own quote rule keeps "> "; nothing here claims it, or text that merely starts alike.
  assert.equal(shortcutFor('> '), null);
  assert.equal(shortcutFor('$$x '), null);
  assert.equal(shortcutFor('```'), null); // no space yet
  assert.deepEqual(Object.keys(SHORTCUT_HINTS).sort(), ['callout', 'checklist', 'code', 'math', 'twoColumn']);
});

test('math toolbar: a snippet takes the selection in its first slot and parks the caret in the next', () => {
  assert.deepEqual(fillSnippet(String.raw`\frac{#}{#}`), { text: String.raw`\frac{}{}`, caret: 6 });
  assert.deepEqual(fillSnippet(String.raw`\frac{#}{#}`, 'a+b'), { text: String.raw`\frac{a+b}{}`, caret: 11 });
  assert.deepEqual(fillSnippet(String.raw`\alpha `), { text: String.raw`\alpha `, caret: 7 });
  assert.deepEqual(fillSnippet('^{#}', 'n'), { text: '^{n}', caret: 4 });
  // Never a wall of buttons: every group stays small.
  MATH_GROUPS.forEach((group) => assert.ok(group.items.length <= 18, group.id));
});

// ── Tags and ⌘K actions ───────────────────────────────────────────────────────

test('tags: one spelling everywhere — lower-case, one word, any script', () => {
  assert.equal(cleanTag('#Week 3!'), 'week-3');
  assert.equal(cleanTag('  ##Mid--Term  '), 'mid-term');
  assert.equal(cleanTag('Été'), 'été');
  assert.equal(cleanTag('تاريخ'), 'تاريخ');
  assert.equal(cleanTag('ask_prof'), 'ask_prof');
  assert.equal(cleanTag('!!!'), '');
  assert.equal(cleanTag(null), '');
  assert.ok(cleanTag('x'.repeat(60)).length <= 24);
  // Cut to length, it never ends on a hyphen.
  assert.ok(!cleanTag('abcdefghijklmnopqrstuvw xyz').endsWith('-'));
});

test('tags: a note keeps each tag once, in order, and only so many', () => {
  assert.deepEqual(cleanTags(['Exam', 'exam', '#EXAM', ' week 3 ', '', null]), ['exam', 'week-3']);
  assert.deepEqual(cleanTags('not a list'), []);
  const many = Array.from({ length: 30 }, (_, i) => `t${i}`);
  assert.equal(cleanTags(many).length, TAGS_PER_NOTE);
  // A comma or a hash ends a tag; a space stays inside one.
  assert.deepEqual(splitTags('exam, week 3 #proofs'), ['exam', 'week-3', 'proofs']);
  assert.deepEqual(withTags(['exam'], 'Exam, proofs'), ['exam', 'proofs']);
  assert.deepEqual(withoutTag(['exam', 'proofs'], '#Exam'), ['proofs']);
  assert.equal(hasTag({ tags: ['Week 3'] }, '#week-3'), true);
  assert.equal(hasTag({ tags: ['exam'] }, ''), false);
});

test('tags: the ones in use, most used first, and suggestions that start as typed', () => {
  const notes = [{ tags: ['exam', 'proofs'] }, { tags: ['exam'] }, { tags: ['week-3', 'exam'] }, {}];
  assert.deepEqual(tagCounts(notes), [
    { tag: 'exam', count: 3 },
    { tag: 'proofs', count: 1 },
    { tag: 'week-3', count: 1 },
  ]);
  const known = ['exam', 'proofs', 'week-3', 'example-sheet'];
  // Starts-with before contains; never one the note has, never the text itself.
  assert.deepEqual(suggestTags('ex', known, []), ['exam', 'example-sheet']);
  assert.deepEqual(suggestTags('ex', known, ['exam']), ['example-sheet']);
  assert.deepEqual(suggestTags('oof', known, []), ['proofs']);
  assert.deepEqual(suggestTags('exam', known, []), ['example-sheet']);
  assert.deepEqual(suggestTags('', known, ['exam'], 2), ['proofs', 'week-3']);
});

test('search: tags answer "#" queries, and a plain word finds a tagged note after the titles', () => {
  const notes = [
    { id: 'n1', classId: 'c1', title: 'Hashing', tags: ['exam'] },
    { id: 'n2', classId: 'c1', title: 'Trees', tags: ['exam', 'week-3'] },
    { id: 'n3', classId: 'c2', title: 'Exam logistics', tags: [] },
    { id: 'n4', classId: 'c2', title: 'Essay', tags: ['examples'] },
  ];
  const courses = [{ id: 'c1', name: 'Exam prep' }];

  const hash = searchDesk({ query: '#ex', courses, notes });
  assert.deepEqual(hash.tags, [
    { tag: 'exam', count: 2 },
    { tag: 'examples', count: 1 },
  ]);
  assert.deepEqual(hash.notes.map((hit) => [hit.note.id, hit.tag]), [['n1', 'exam'], ['n2', 'exam'], ['n4', 'examples']]);
  assert.deepEqual(hash.courses, []);
  // A bare "#" lists every tag and no notes.
  assert.equal(searchDesk({ query: '#', notes }).notes.length, 0);
  assert.equal(searchDesk({ query: '#', notes }).tags.length, 3);

  const word = searchDesk({ query: 'exam', courses, notes });
  assert.deepEqual(word.notes.map((hit) => [hit.note.id, hit.where]), [['n3', 'title'], ['n1', 'tag'], ['n2', 'tag'], ['n4', 'tag']]);
  assert.deepEqual(word.courses.map((course) => course.id), ['c1']);
});

test('actions: every typed word starts a word of the label or keywords; label matches rank first', () => {
  const actions = [
    { id: 'cal', label: 'Open the calendar', keywords: ['schedule', 'exams'] },
    { id: 'new', label: 'New note in Statistics', keywords: ['create'] },
    { id: 'rain', label: 'Switch to the rain mood', keywords: ['day', 'light'] },
    { id: 'event', label: 'Add something to the calendar', keywords: ['new', 'exam'] },
  ];
  const ids = (query) => matchActions(query, actions).map((hit) => hit.action.id);
  assert.deepEqual(ids('cal'), ['cal', 'event']);
  assert.deepEqual(ids('new no stat'), ['new']);
  assert.deepEqual(ids('new'), ['new', 'event']);
  assert.deepEqual(ids('light'), ['rain']);
  assert.deepEqual(ids('xyz'), []);
  assert.deepEqual(ids('   '), []);
  // Found through the label: strong. Only through the keywords: weak, listed after notes.
  assert.deepEqual(matchActions('new', actions).map((hit) => hit.strong), [true, false]);
  assert.equal(matchActions('exams', actions)[0].strong, false);
  assert.equal(matchActions('cal', actions, 1).length, 1);
});

test('actions: the course a room address is about', () => {
  assert.equal(courseFromPath('/room/course/c1'), 'c1');
  assert.equal(courseFromPath('/room/note/c2/n9'), 'c2');
  assert.equal(courseFromPath('/room/note/a%20b/n9'), 'a b');
  assert.equal(courseFromPath('/room/calendar'), '');
  assert.equal(courseFromPath('/room'), '');
  assert.equal(courseFromPath(undefined), '');
});

// ── Sage, the room's page path (client side) ─────────────────────────────────

// Two sections: §1 opens at t1, §2 at s2.
const SAGE_TWO = [
  ...SAGE_PAGE.slice(0, 2),
  { id: 's2', type: 'text', section: true, value: '<h2>Rotations</h2><p>Left and right.</p>' },
  { id: 's3', type: 'text', value: '<p>The double ones.</p>' },
  SAGE_PAGE.at(-1),
];

test('sage page out: every block goes as its own type; code and math as plain text; the board never goes', () => {
  const out = toPageBlocks(SAGE_PAGE);
  assert.deepEqual(
    out.map((b) => [b.id, b.type]),
    [
      ['t1', 'text'],
      ['c1', 'callout'],
      ['k1', 'code'],
      ['m1', 'math'],
      ['x1', 'checklist'],
      ['wa', 'text'],
      ['wb', 'text'],
      ['i1', 'image'],
    ],
  );
  assert.deepEqual(out[2], { id: 'k1', type: 'code', lang: 'python', value: 'if a < b:\n    return a' });
  assert.equal(out[1].label, 'Prof said');
  assert.deepEqual(out[7], { id: 'i1', type: 'image' }); // no address
});

test('sage scope: a section runs from its opening block to the next one', () => {
  assert.deepEqual(sectionBounds(SAGE_TWO, ''), [0, 5]);
  assert.deepEqual(sectionBounds(SAGE_TWO.slice(0, 4), 's2'), [2, 4]);
  assert.deepEqual(sectionBounds(SAGE_TWO.slice(0, 4), 't1'), [0, 2]);
  assert.equal(sectionBounds(SAGE_TWO, 'gone'), null);
  assert.deepEqual(sageScope(SAGE_TWO, 's2').map((b) => b.id), ['s2', 's3']);
  assert.deepEqual(sageScope(SAGE_TWO).map((b) => b.id), ['t1', 'c1', 's2', 's3']); // never the board
});

test('sage page back, quick edit: code stays literal, a callout takes its new label, the note and tags ride along', () => {
  const applied = applySageResult(SAGE_PAGE, {
    format: 'page',
    mode: 'patch',
    changed: [
      { id: 'k1', value: 'if a < b and c > d:\n    return a' },
      { id: 'm1', value: '<p>O(\\log n)</p>' }, // HTML anyway → read as lines
      { id: 'c1', value: '<p>Rotations ARE on it.</p>', label: 'Watch out' },
    ],
    note: 'Fixed the comparison.',
    tags: ['bst'],
  });
  const byId = new Map(applied.blocks.map((b) => [b.id, b]));
  assert.equal(byId.get('k1').value, 'if a < b and c > d:\n    return a');
  assert.equal(byId.get('m1').value, 'O(\\log n)');
  assert.equal(byId.get('c1').label, 'Watch out');
  assert.equal(applied.note, 'Fixed the comparison.');
  assert.deepEqual(applied.tags, ['bst']);
  assert.equal(applied.changed, 3);
});

test('sage page back, additions: typed as asked; the top of a section is just under its heading', () => {
  const tldr = { after: '', type: 'callout', label: 'TL;DR', value: '<ul><li>short</li></ul>' };
  const whole = applySageResult(SAGE_TWO, {
    format: 'page',
    mode: 'reflow',
    changed: [],
    added: [tldr, { after: 't1', type: 'math', value: 'h = O(\\log n)' }],
  });
  assert.equal(whole.blocks[0].type, 'callout'); // the very top of the page
  assert.equal(whole.blocks[0].section, true); // the page always opens a section
  assert.equal(whole.blocks[2].type, 'math');
  assert.equal(whole.blocks[2].value, 'h = O(\\log n)');

  const section = applySageResult(SAGE_TWO, { format: 'page', mode: 'reflow', changed: [], added: [tldr] }, { sectionId: 's2' });
  assert.deepEqual(
    section.blocks.map((b) => b.id === 's2' || b.id === 's3' || b.id === 't1' || b.id === 'c1' || b.id === 'r1' ? b.id : b.type),
    ['t1', 'c1', 's2', 'callout', 's3', 'r1'],
  );
  assert.equal(section.blocks[3].section, false); // §2 keeps its heading as its title
});

test('sage page back, rebuild: one section rebuilt in place — pairs tiled, the rest of the page untouched', () => {
  const applied = applySageResult(
    SAGE_TWO,
    {
      format: 'page',
      mode: 'layout',
      blocks: [
        { id: 's2', type: 'text', value: '<h2>Rotations</h2><p>Left, right.</p>', section: true },
        { id: null, type: 'text', value: '<p><b>LL</b> — single right</p>', pair: true },
        { id: null, type: 'text', value: '<p><b>LR</b> — left, then right</p>', pair: true },
        { id: null, type: 'code', lang: 'python', value: 'rotate_right(node)' },
      ],
      note: 'Paired the four cases.',
    },
    { sectionId: 's2', sent: new Set(['s2', 's3']) },
  );
  const ids = applied.blocks.map((b) => b.id);
  assert.deepEqual(ids.slice(0, 3), ['t1', 'c1', 's2']); // §1 untouched, §2 still opens where it did
  assert.equal(applied.blocks[3].type, 'twoColumn');
  assert.equal(applied.blocks[4].type, 'code');
  assert.equal(applied.blocks[4].lang, 'python');
  assert.ok(!ids.includes('s3')); // Sage merged it away — it was sent, so that is its call
  assert.equal(ids.at(-1), 'r1'); // the board rides along
  assert.equal(applied.mode, 'layout');

  // A section that vanished while Sage worked is not guessed at.
  assert.equal(applySageResult(SAGE_TWO, { format: 'page', mode: 'layout', blocks: [] }, { sectionId: 'gone' }), null);
});

test('sage back: a classic answer still lands, and only inside the section it was asked about', () => {
  const applied = applySageResult(
    SAGE_TWO,
    { mode: 'patch', changed: [{ id: 's3', value: '<p>The double ones, fixed.</p>' }, { id: 't1', value: '<p>outside</p>' }] },
    { sectionId: 's2' },
  );
  const byId = new Map(applied.blocks.map((b) => [b.id, b]));
  assert.equal(byId.get('s3').value, '<p>The double ones, fixed.</p>');
  assert.equal(byId.get('t1').value, SAGE_TWO[0].value); // not in the section: left alone
  assert.equal(applied.note, '');
});

// ── Paste from outside ─────────────────────────────────────────────────────────

const pasteSchema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    bulletList: { group: 'block', content: 'listItem+' },
    listItem: { content: 'paragraph block*' },
    table: { group: 'block', content: 'tableRow+', tableRole: 'table', isolating: true },
    tableRow: { content: 'tableCell+', tableRole: 'row' },
    tableCell: { content: 'paragraph+', tableRole: 'cell', isolating: true },
    text: { group: 'inline' },
    hardBreak: { group: 'inline', inline: true },
  },
});
const list = (...items) =>
  pasteSchema.node('bulletList', null, items.map((kids) => pasteSchema.node('listItem', null, kids)));
const table = (...cells) =>
  pasteSchema.node('table', null, [pasteSchema.node('tableRow', null, cells.map((cell) => pasteSchema.node('tableCell', null, [cell])))]);
const para = (...kids) =>
  pasteSchema.node('paragraph', null, kids.map((kid) => (typeof kid === 'string' ? pasteSchema.text(kid) : kid)));
const lineBreak = () => pasteSchema.node('hardBreak');
const sliceOf = (...nodes) => Slice.maxOpen(Fragment.fromArray(nodes), false);
const textsOf = (slice) => {
  const out = [];
  slice.content.forEach((node) => out.push(node.type.name === 'paragraph' ? node.textContent : node.type.name));
  return out;
};

test('paste: only formatting the room can express survives, and only when it says something', () => {
  assert.equal(keptStyle('font-size:11pt;font-family:Arial,sans-serif;color:#000000;font-weight:400;'), '');
  assert.equal(keptStyle('font-weight: 700; color: rgb(55, 65, 81)'), 'font-weight: 700');
  assert.equal(keptStyle('line-height:1.38; text-align: center'), 'text-align: center');
  assert.equal(keptStyle('text-align: left'), ''); // the default says nothing
  assert.equal(keptStyle('font-style: italic; text-decoration: underline'), 'font-style: italic; text-decoration: underline');
  assert.equal(keptStyle('font-style: normal'), '');
  assert.equal(keptStyle('FONT-WEIGHT: BOLD !important'), 'FONT-WEIGHT: BOLD !important');
  // A normal weight says something only inside bold, where it un-bolds.
  assert.equal(keptStyle('font-weight: 400'), '');
  assert.equal(keptStyle('font-weight: 400', { insideBold: true }), 'font-weight: 400');
  assert.equal(keptStyle(''), '');
});

test('paste: text keeps its lines but not the newlines at its ends; a ProseMirror copy is recognised', () => {
  assert.equal(cleanPastedText('\r\npasted value\r\n\r\n'), 'pasted value');
  assert.equal(cleanPastedText('a\r\nb\rc'), 'a\nb\nc');
  assert.equal(cleanPastedText('    indented code\n'), '    indented code');
  assert.equal(isFromProseMirror('<p data-pm-slice="1 1 []">mine</p>'), true);
  assert.equal(isFromProseMirror('<meta charset="utf-8"><p>theirs</p>'), false);
});

test('paste: no empty lines around what was pasted, none in between, and a single line still joins its line', () => {
  // Google Docs: the text, then a paragraph holding only its trailing <br>.
  const docs = tidyPastedSlice(sliceOf(para('pasted value'), para(lineBreak())));
  assert.deepEqual(textsOf(docs), ['pasted value']);
  assert.equal(docs.openStart, 1); // still merges into the line the caret is on
  assert.equal(docs.openEnd, 1);
  // Word: &nbsp; paragraphs either side. Plain text: empty ones.
  assert.deepEqual(textsOf(tidyPastedSlice(sliceOf(para(' '), para('pasted value'), para(' ')))), ['pasted value']);
  assert.deepEqual(textsOf(tidyPastedSlice(sliceOf(para(), para('a'), para(), para('b'), para()))), ['a', 'b']);
  // Breaks at a paragraph's edges go; a break inside one is the writer's.
  const edges = tidyPastedSlice(sliceOf(para(lineBreak(), 'x', lineBreak())));
  assert.equal(edges.content.firstChild.childCount, 1);
  const inside = sliceOf(para('a', lineBreak(), 'b'));
  assert.equal(tidyPastedSlice(inside), inside); // nothing to do: the very same slice
  // Nothing but blank lines: nothing at all.
  assert.equal(tidyPastedSlice(sliceOf(para(), para(lineBreak()))).size, 0);
  // A table stays closed, as ProseMirror leaves any paste from outside.
  const pastedTable = tidyPastedSlice(sliceOf(table(para('cell')), para()));
  assert.deepEqual(textsOf(pastedTable), ['table']);
  assert.equal(pastedTable.openStart, 0);
});

test('paste: no empty line survives any paste — around it, inside it, nested, invisible or made of breaks', () => {
  // A selection dragged over a line took the empty lines around it along: the owner's case.
  const dragged = tidyPastedSlice(new Slice(Fragment.fromArray([para(), para('pasted line'), para()]), 1, 1));
  assert.deepEqual(textsOf(dragged), ['pasted line']);
  assert.equal(dragged.openStart, 1); // joins the line it is pasted on, so no gap above or below
  assert.equal(dragged.openEnd, 1);
  // A line copied with its break (open start, closed empty end).
  assert.deepEqual(textsOf(tidyPastedSlice(new Slice(Fragment.fromArray([para('x'), para()]), 1, 0))), ['x']);
  // Several lines copied from a note that already had gaps: the gaps do not come along.
  assert.deepEqual(textsOf(tidyPastedSlice(sliceOf(para('a'), para(), para(lineBreak()), para('b')))), ['a', 'b']);
  // "Empty" lines that hold only an invisible character.
  assert.deepEqual(textsOf(tidyPastedSlice(sliceOf(para('\u200b'), para('pasted'), para('\ufeff\u00a0')))), ['pasted']);
  // A run of line breaks is an empty line: it collapses to one break; edge breaks go.
  const runs = tidyPastedSlice(sliceOf(para('one', lineBreak(), lineBreak(), lineBreak(), 'two', lineBreak())));
  assert.deepEqual(
    runs.content.firstChild.content.content.map((node) => node.type.name),
    ['text', 'hardBreak', 'text'],
  );
  // Inside a list: an empty item goes, a list with nothing left goes with it.
  const listed = tidyPastedSlice(sliceOf(list([para('first')], [para()], [para('second')])));
  assert.equal(listed.content.firstChild.childCount, 2);
  assert.equal(tidyPastedSlice(sliceOf(list([para()]), para('after'))).content.childCount, 1);
  // A table keeps its empty cells: they are its shape.
  const cells = sliceOf(table(para('x'), para()));
  assert.equal(tidyPastedSlice(cells), cells);
});

test('paste: Chrome on Windows wraps every copy in a page — only the fragment is the copy (the owner’s gaps)', () => {
  // The owner's real clipboard, as the page receives it.
  const wrapped =
    '<html>\r\n<body>\r\n<!--StartFragment--><p data-pm-slice="1 1 []">only the ones at the edges go.</p><!--EndFragment-->\r\n</body>\r\n</html>';
  assert.equal(clipboardFragment(wrapped), '<p data-pm-slice="1 1 []">only the ones at the edges go.</p>');
  assert.equal(clipboardFragment('<p>no markers at all</p>'), '<p>no markers at all</p>');
  assert.equal(clipboardFragment('<!--EndFragment--> backwards <!--StartFragment-->'), '<!--EndFragment--> backwards <!--StartFragment-->');
  // What those newlines became before: line breaks loose at the top, beside the paragraph.
  const loose = tidyPastedSlice(
    new Slice(Fragment.fromArray([lineBreak(), lineBreak(), para('only'), lineBreak(), lineBreak()]), 0, 0),
  );
  assert.deepEqual(textsOf(loose), ['only']);
  assert.equal(loose.openStart, 1); // and the line joins the one it is pasted on
  // A break BETWEEN two pieces of copied text is the writer's own: kept, once.
  const inline = tidyPastedSlice(
    new Slice(Fragment.fromArray([pasteSchema.text('a'), lineBreak(), lineBreak(), pasteSchema.text('b')]), 0, 0),
  );
  assert.deepEqual(
    inline.content.content.map((node) => node.type.name),
    ['text', 'hardBreak', 'text'],
  );
});

// ── Photos on the page, math text, and Sage's new placements ──────────────────

test('page photos: a share of the page width and a small tilt, never past their limits', () => {
  assert.equal(imageSize(undefined), 100); // nothing set: the full width
  assert.equal(imageSize(60), 60);
  assert.equal(imageSize(3), 25);
  assert.equal(imageSize(180), 100);
  assert.equal(imageTilt(undefined), 0);
  assert.equal(imageTilt(-1.53), -1.5);
  assert.equal(imageTilt(40), 6);
  assert.equal(imageTilt(-40), -6);
  assert.equal(isUploadedImage('https://firebasestorage.googleapis.com/v0/b/x/o/notes%2Fa.webp?alt=media'), true);
  assert.equal(isUploadedImage('https://example.com/cat.png'), false); // a link from before uploads
  assert.equal(isUploadedImage(''), false);
});

test('math: an environment written over several lines stays one formula; delimiters and broken escapes are fixed', () => {
  assert.deepEqual(formulaRows('a = b\n\nc = d'), ['a = b', 'c = d']);
  assert.deepEqual(formulaRows(String.raw`\begin{aligned}` + '\n' + String.raw`x &= 1 \\` + '\n' + String.raw`y &= 2` + '\n' + String.raw`\end{aligned}` + '\nz = 3'), [
    String.raw`\begin{aligned}` + '\n' + String.raw`x &= 1 \\` + '\n' + String.raw`y &= 2` + '\n' + String.raw`\end{aligned}`,
    'z = 3',
  ]);
  assert.deepEqual(formulaRows(String.raw`\begin{cases} x`), [String.raw`\begin{cases} x`]); // never dropped
  // \frac, \theta, \beta, \rho parsed as JSON's \f, \t, \b, \r — put back.
  assert.equal(cleanTex('\frac{1}{2} + \theta + \beta + \rho'), String.raw`\frac{1}{2} + \theta + \beta + \rho`);
  // \nabla and \neq parsed as a newline — put back; a real newline between formulas stays.
  assert.equal(cleanTex('\nabla f \neq 0\nx = 1'), String.raw`\nabla f \neq 0` + '\nx = 1');
  // Delimiters come off.
  assert.equal(cleanTex('$$x^2$$\n' + String.raw`\[ y \]` + '\n' + String.raw`\(z\)` + '\n$w$'), 'x^2\ny\nz\nw');
});

test('sage page back: "end" lands at the very end, in order, and an added block can open a section', () => {
  const applied = applySageResult(SAGE_TWO, {
    format: 'page',
    mode: 'reflow',
    changed: [],
    added: [
      { after: 'end', type: 'callout', label: 'Test yourself', value: '<ol><li>Why?</li></ol>' },
      { after: 'end', type: 'callout', label: 'Answers', value: '<ol><li>Because.</li></ol>' },
      { after: 't1', type: 'text', value: '<h2>A new topic</h2><p>Heaps.</p>', section: true },
      { after: 't1', type: 'math', value: '\frac{a}{b}' },
    ],
  });
  const page = applied.blocks.filter((block) => !block.rail);
  assert.deepEqual(page.slice(-2).map((block) => block.label), ['Test yourself', 'Answers']);
  const topic = page.find((block) => block.type === 'text' && /A new topic/.test(block.value));
  assert.equal(topic.section, true);
  assert.equal(page.find((block) => block.type === 'math').value, String.raw`\frac{a}{b}`);
  // Scoped to a section, "end" is that section's end — not the page's.
  const scoped = applySageResult(
    SAGE_TWO,
    { format: 'page', mode: 'reflow', changed: [], added: [{ after: 'end', type: 'text', value: '<p>last in §1</p>' }] },
    { sectionId: 't1' },
  );
  const ids = scoped.blocks.map((block) => (block.value === '<p>last in §1</p>' ? 'NEW' : block.id));
  assert.deepEqual(ids, ['t1', 'c1', 'NEW', 's2', 's3', 'r1']);
});

