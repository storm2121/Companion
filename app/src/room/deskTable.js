// The desk's table (round eight, run 3) — PURE: the production stage's rules, from its data (core.json and
// one file per light state, written by app/scripts/desk-pictures.mjs from Blender's prod1/scene2.json; its
// README says how a light state is stacked). No DOM, no React: tests/desktable.unit.test.mjs runs it.
//
// Layout "B without F1": three towers at the back (T0, T1, T2: up to 5 books each, spines to the chair), the
// near stack S1 (up to 2, spines to the chair) and the flat book F3 (1, cover up, its title on its cover's
// label): 18 books. A book's place is a SLOT, `<place><level>` ('T02': tower T0's third book from the bottom),
// saved per person in roomPrefs.deskTable (courseId -> slot). Six light states: night (the candle at C0) and
// nightC1 (at C1), each with the lamp off or on (`…Lamp`), day and dayLamp (the candle drawn on its own at its
// place). Every picture is a real render: a book is the picture of its leather at its slot (no dye, no mask).
//
// Shared rules come from deskStage.js (the stage's fit, the spine's lettering rules, the leathers): imported,
// never copied.

import { SPINE_BASE, SPINE_FLOOR, abbreviateTitle, fitSpineCount, fitSpineTitle, labelOf, leatherOf, spineMeasure, spareTitle, typeFloor } from './deskStage.js';

/* ── Places ──────────────────────────────────────────────────────────────── */

// The places in the order pairs are named (scene2: "p before q in T0, T1, T2, S1, F3").
export const PLACES = ['T0', 'T1', 'T2', 'S1', 'F3'];
// Far to near: the room's layers (shadows, pairs) and the books (with the big notebook among them).
export const ROOM_ORDER = ['T2', 'T1', 'T0', 'F3', 'S1'];
export const DRAW_ORDER = ['T2', 'T1', 'T0', 'notebook', 'F3', 'S1'];
export const CAPACITY = { T0: 5, T1: 5, T2: 5, S1: 2, F3: 1 };
export const TABLE_BOOKS = 18;
// Their names, as the room says them (the menu, Ctrl K, the undo line, a screen reader).
export const PLACE_NAMES = {
  T0: 'the left stack',
  T1: 'the middle stack',
  T2: 'the right stack',
  S1: 'the near stack',
  F3: 'the flat place',
};
// Across the screen, left to right (each place's bottom spine's middle: T0 930, S1 1114, T1 1208, F3 1246,
// T2 1465 stage px): Alt + Left / Right walk this way.
export const SCREEN_ORDER = ['T0', 'S1', 'T1', 'F3', 'T2'];
// Bringing a book closer puts it on the near stack.
export const NEAR = 'S1';
// The flat place (one book, lying open-side up).
export const FLAT = 'F3';

const PLACE_SET = new Set(PLACES);
export const slotKey = (place, level) => `${place}${level}`;
export const slotOf = (slot) => {
  const s = String(slot || '');
  const place = s.slice(0, 2);
  const level = Number(s.slice(2));
  return PLACE_SET.has(place) && Number.isInteger(level) && level >= 0 ? { place, level } : null;
};
export const capacityOf = (core, place) => Number(core?.places?.[place]?.capacity) || CAPACITY[place] || 0;
const tableSize = (core) => PLACES.reduce((sum, p) => sum + capacityOf(core, p), 0);

/* ── The arrangement ─────────────────────────────────────────────────────── */

// Where every course's book lies (roomPrefs.deskTable: courseId -> slot). Only the first 18 courses in the
// room's own order (the table's places) are on the table; the rest are `more` (reached as today's stage
// reaches its overflow: All notes). A saved slot is kept where its place has room (a place's books keep the
// order of their saved levels, the course order breaking a tie) and each stack SETTLES: books lie from the
// bottom, so a course that went leaves no gap. Every other course (first visit, a new course, a slot that
// is not a place or a full place) takes the next free slot in `fillOrder` (scene2: S10, F30, T10, T20, T00,
// S11, T11, ...): the first entry whose level is the place's next one, else the first place with room.
// Returns:
//   stacks:  { T0: [courseId bottom -> top], ... }
//   map:     courseId -> slot (every book on the table)
//   books:   [{ id, slot, place, level }] in course order
//   more:    { count, ids } | null
//   changed: a saved slot moved (then `map` is written back, once)
export const arrangeTable = (courseIds, saved, core = null, fillOrder = core?.fillOrder) => {
  const ids = (Array.isArray(courseIds) ? courseIds : []).filter((id) => id != null).map(String);
  const stored = saved && typeof saved === 'object' ? saved : {};
  const size = core ? tableSize(core) : TABLE_BOOKS;
  const onTable = ids.slice(0, size);
  const rest = ids.slice(size);
  const cap = (p) => (core ? capacityOf(core, p) : CAPACITY[p]);
  const order = new Map(onTable.map((id, i) => [id, i]));
  // Saved slots, per place, in their saved order.
  const wish = Object.fromEntries(PLACES.map((p) => [p, []]));
  const loose = [];
  onTable.forEach((id) => {
    const slot = slotOf(stored[id]);
    if (slot) wish[slot.place].push({ id, level: slot.level });
    else loose.push(id);
  });
  const stacks = Object.fromEntries(PLACES.map((p) => [p, []]));
  PLACES.forEach((p) => {
    wish[p]
      .sort((a, b) => a.level - b.level || order.get(a.id) - order.get(b.id))
      .forEach(({ id }) => {
        if (stacks[p].length < cap(p)) stacks[p].push(id);
        else loose.push(id);
      });
  });
  loose.sort((a, b) => order.get(a) - order.get(b));
  const fill = (Array.isArray(fillOrder) && fillOrder.length ? fillOrder : DEFAULT_FILL).map(slotOf).filter(Boolean);
  loose.forEach((id) => {
    const next = fill.find(({ place, level }) => stacks[place].length === level && level < cap(place)) || fill.find(({ place }) => stacks[place].length < cap(place));
    if (next) stacks[next.place].push(id);
  });
  const map = {};
  PLACES.forEach((p) => stacks[p].forEach((id, level) => (map[id] = slotKey(p, level))));
  const books = onTable.filter((id) => map[id]).map((id) => ({ id, slot: map[id], ...slotOf(map[id]) }));
  const left = [...onTable.filter((id) => !map[id]), ...rest];
  const changed = ids.some((id) => Object.prototype.hasOwnProperty.call(stored, id) && stored[id] !== map[id]);
  return { stacks, map, books, more: left.length ? { count: left.length, ids: left } : null, changed };
};
// scene2's fillOrder, for a core without one.
export const DEFAULT_FILL = ['S10', 'F30', 'T10', 'T20', 'T00', 'S11', 'T11', 'T21', 'T01', 'T12', 'T22', 'T02', 'T13', 'T23', 'T03', 'T14', 'T24', 'T04'];

// The arrangement from a map of slots (a move announced before it is saved), the rest as `base`.
export const tableFrom = (map, base = {}) => {
  const stacks = Object.fromEntries(PLACES.map((p) => [p, []]));
  Object.entries(map || {})
    .map(([id, slot]) => ({ id, ...slotOf(slot) }))
    .filter((b) => b.place)
    .sort((a, b) => a.level - b.level)
    .forEach((b) => stacks[b.place].push(b.id));
  const settled = {};
  PLACES.forEach((p) => stacks[p].forEach((id, level) => (settled[id] = slotKey(p, level))));
  return { ...base, stacks, map: settled, books: Object.keys(settled).map((id) => ({ id, slot: settled[id], ...slotOf(settled[id]) })), changed: false };
};

// One key for a map of slots, whatever its keys' order.
export const slotsKey = (map) =>
  Object.keys(map || {})
    .sort()
    .map((id) => `${id}:${map[id]}`)
    .join(',');

const counts = (arr) => Object.fromEntries(PLACES.map((p) => [p, arr?.stacks?.[p]?.length || 0]));
export const countsOf = counts;
const placeOf = (arr, id) => slotOf(arr?.map?.[id])?.place || null;

// The stacks with `id` taken off (the books above it settle one level down); its own place given back.
const without = (arr, id) => {
  const stacks = Object.fromEntries(PLACES.map((p) => [p, (arr.stacks[p] || []).filter((x) => x !== id)]));
  return stacks;
};
const mapOf = (stacks) => {
  const map = {};
  PLACES.forEach((p) => stacks[p].forEach((id, level) => (map[id] = slotKey(p, level))));
  return map;
};

// A book taken while it is dragged: the room as it shows meanwhile (the books above it settled one level
// down); the book itself on no slot.
export const tableLiftOut = (arr, id) => {
  if (!arr?.map?.[id]) return arr;
  const stacks = without(arr, id);
  const map = mapOf(stacks);
  return { ...arr, stacks, map, books: (arr.books || []).filter((b) => b.id !== id).map((b) => ({ ...b, slot: map[b.id], ...slotOf(map[b.id]) })), changed: false };
};

// A book onto the top of `place` (its own place: to its top). The place it leaves settles. Null when it
// cannot go (no room, unknown place, or it is on top of that place already).
export const tableMoveTo = (arr, id, place, core = null) => {
  const from = placeOf(arr, id);
  if (!from || !PLACE_SET.has(place)) return null;
  const stack = arr.stacks[place] || [];
  if (place === from) {
    if (stack[stack.length - 1] === id) return null;
  } else if (stack.length >= (core ? capacityOf(core, place) : CAPACITY[place])) return null;
  const stacks = without(arr, id);
  stacks[place].push(id);
  return mapOf(stacks);
};

// One level up (+1) or down (-1) its own stack, changing places with the book there. Null at an end.
export const tableShift = (arr, id, step) => {
  const place = placeOf(arr, id);
  if (!place || !step) return null;
  const stack = [...arr.stacks[place]];
  const at = stack.indexOf(id);
  const to = at + Math.sign(step);
  if (to < 0 || to >= stack.length) return null;
  [stack[at], stack[to]] = [stack[to], stack[at]];
  return mapOf({ ...arr.stacks, [place]: stack });
};

// Alt + Left / Right: the next place across the screen that has room (`dir` -1 left, +1 right), else null.
export const placeBeside = (arr, id, dir, core = null) => {
  const from = placeOf(arr, id);
  if (!from) return null;
  const i = SCREEN_ORDER.indexOf(from);
  for (let k = i + Math.sign(dir); k >= 0 && k < SCREEN_ORDER.length; k += Math.sign(dir)) {
    const p = SCREEN_ORDER[k];
    if ((arr.stacks[p] || []).length < (core ? capacityOf(core, p) : CAPACITY[p])) return p;
  }
  return null;
};

// Alt + Enter: a book brought closer (onto the near stack), or a near book put back (where it came from,
// `from[id]`, when that place has room, else the first tower with room in fill order). The place, or null.
export const closerOrBack = (arr, id, from = {}, core = null) => {
  const place = placeOf(arr, id);
  if (!place) return null;
  const room = (p) => (arr.stacks[p] || []).length < (core ? capacityOf(core, p) : CAPACITY[p]);
  if (place !== NEAR) return room(NEAR) ? NEAR : null;
  const home = from?.[id];
  if (PLACE_SET.has(home) && home !== NEAR && room(home)) return home;
  return ['T1', 'T2', 'T0', 'F3'].find(room) || null;
};

// The table's local wish (fix run): a move shows at once and the next one starts from it, however late its save
// lands; it holds until the saved arrangement says the same (saves of earlier moves landing in between change
// nothing). `ids` the courses now: under Firestore's deep merge a saved key of a deleted course stays, and is ignored.
export const tableWish = (ids, saved, wish, core = null) => {
  const savedArr = arrangeTable(ids, saved, core);
  if (!wish?.map) return { arrangement: savedArr, done: false };
  const wished = arrangeTable(ids, wish.map, core);
  const done = slotsKey(savedArr.map) === slotsKey(wished.map);
  return { arrangement: done ? savedArr : wished, done };
};
// A patch that takes `before` to `after` under a deep merge (fix run): a key `before` has and `after` has not is
// written as null (a key left out is NOT removed on the server); readers take null as absent.
export const mergePatch = (before, after) => ({
  ...Object.fromEntries(Object.keys(before || {}).filter((k) => !Object.prototype.hasOwnProperty.call(after || {}, k)).map((k) => [k, null])),
  ...(after || {}),
});

// Where a dragged book may go (each { place, kind, slot }): the top of every other place with room ('place'),
// the top of its own stack when it is not on top ('top'), and its own slot ('own': dropping there changes
// nothing). The slot is where it would lie, so its outline is that level's.
export const tableTargets = (arr, id, core = null) => {
  const from = slotOf(arr?.map?.[id]);
  if (!from) return [];
  const out = [{ place: from.place, kind: 'own', slot: slotKey(from.place, from.level) }];
  PLACES.forEach((p) => {
    const stack = arr.stacks[p] || [];
    if (p === from.place) {
      if (stack[stack.length - 1] !== id) out.push({ place: p, kind: 'top', slot: slotKey(p, stack.length - 1) });
      return;
    }
    if (stack.length < (core ? capacityOf(core, p) : CAPACITY[p])) out.push({ place: p, kind: 'place', slot: slotKey(p, stack.length) });
  });
  return out;
};

// Owner fixes (2026-11-23, C): the places MARKED while a book is taken. Every place that can take it shows its landing
// outline (the would-be book's hull at `slot`); a place that cannot (full) shows nothing. Carried by the pointer
// (`carried`), its own slot is marked too (let go there, it goes back); from the menu or the keyboard, only where it
// can go. Each { key, place, kind, slot }.
export const tableMarks = (arr, id, core = null, { carried = true } = {}) =>
  tableTargets(arr, id, core)
    .filter((t) => carried || t.kind !== 'own')
    .map((t) => ({ key: `${t.kind === 'own' ? 'own' : 'place'}:${t.place}`, place: t.place, kind: t.kind === 'own' ? 'own' : 'place', slot: t.slot }));

// What the desk says when a move cannot happen (a book already on top, a full place).
export const cannotMoveBook = (arr, id, how, name) => {
  const slot = slotOf(arr?.map?.[id]);
  if (!slot) return '';
  const stack = arr.stacks[slot.place] || [];
  if (how === 'up') return stack.length < 2 ? `${name} is alone on ${PLACE_NAMES[slot.place]}.` : `${name} is already on top.`;
  if (how === 'down') return stack.length < 2 ? `${name} is alone on ${PLACE_NAMES[slot.place]}.` : `${name} is already at the bottom.`;
  if (how === 'left' || how === 'right') return `There is no room ${how === 'left' ? 'to the left' : 'to the right'} of ${PLACE_NAMES[slot.place]}.`;
  if (how === 'closer') return slot.place === NEAR ? 'There is no room to put it back.' : 'The near stack is full.';
  if (PLACE_SET.has(how)) return `${PLACE_NAMES[how][0].toUpperCase()}${PLACE_NAMES[how].slice(1)} is full.`;
  return '';
};

// What a move says on the undo line: where the book is now.
export const movedLine = (name, slot) => {
  const s = slotOf(slot);
  return s ? `${name} is on ${PLACE_NAMES[s.place]} now.` : '';
};

/* ── The light states ─────────────────────────────────────────────────────── */

export const STATES = ['night', 'nightLamp', 'nightC1', 'nightC1Lamp', 'day', 'dayLamp'];
// The state the room is in: night or day (the candle's light, roomPrefs.mood), the candle's place by
// night, the lamp.
export const stateFor = ({ night = true, candle = 'C0', lamp = false } = {}) =>
  night ? `${candle === 'C1' ? 'nightC1' : 'night'}${lamp ? 'Lamp' : ''}` : lamp ? 'dayLamp' : 'day';
export const isNightState = (state) => String(state || '').startsWith('night');
export const lampOn = (state) => String(state || '').endsWith('Lamp');
export const candleOfState = (state) => (String(state || '').startsWith('nightC1') ? 'C1' : 'C0');
// The state the lamp's switch goes to, and the one the candle's (night <-> day, the lamp kept).
export const lampTwin = (state) => (lampOn(state) ? state.replace(/Lamp$/, '') : `${state}Lamp`);
export const lookTwin = (state, candle = candleOfState(state)) => stateFor({ night: !isNightState(state), candle, lamp: lampOn(state) });
// The held pictures' light: the state itself (the held book exists in all six).
export const toneState = (core, state) => core?.states?.[state]?.tones || state.replace(/Lamp$/, '');

// The table can be drawn: its core read and well formed, and the light state's own file read. Anything
// else, and the desk draws round seven's stage (RoomDesk), loaded only then.
export const tableUsable = ({ core, state, failed } = {}) =>
  !failed && Boolean(core?.places && core?.states && core?.stage && state?.layers) && PLACES.every((p) => core.places[p]?.levels?.length);

/* ── Drawing one light state (prod1/README.md "How to stack one light state") ── */

// The pair key for two places holding books: "<p><h>-<q><k>", p before q in PLACES.
export const pairKey = (p, h, q, k) => {
  const [a, b] = PLACES.indexOf(p) <= PLACES.indexOf(q) ? [[p, h], [q, k]] : [[q, k], [p, h]];
  return `${a[0]}${a[1]}-${b[0]}${b[1]}`;
};
// Every two places that both hold books: [{ p, q, key }], p before q.
export const pairsPresent = (n) =>
  PLACES.flatMap((p, i) => PLACES.slice(i + 1).filter((q) => n[p] && n[q]).map((q) => ({ p, q, key: pairKey(p, n[p], q, n[q]) })));

const has = (layers, name) => Boolean(name && layers?.[name]);

// The room under the books, in draw order (step 3 on: the small notebook, the candle, every place's layers
// far to near with each pair right after the nearer of its two places). Names of layers that exist.
//   `leathers`: { T0: [leather bottom -> top], ... }; `held`: the candle in the hand (night: candle-away).
// (Steps 1 and 2, the room itself, its light, its breath and the wall frame, are drawn apart: they never
// change with the arrangement.)
export const roomLayers = (stateData, leathers, { look = 'night', candle = 'C0', held = false } = {}) => {
  const L = stateData?.layers || {};
  const pairs = stateData?.pairs || {};
  const n = Object.fromEntries(PLACES.map((p) => [p, leathers?.[p]?.length || 0]));
  const out = [];
  const push = (name) => has(L, name) && out.push(name);
  push('shadow-SN');
  push('pocket');
  if (look === 'night') push(held && has(L, 'candle-away') ? 'candle-away' : 'candle-look');
  else if (!held) {
    push(`candle-link-${candle}`);
    push(`candle-look-${candle}`);
  }
  const present = pairsPresent(n);
  const done = new Set();
  ROOM_ORDER.forEach((r) => {
    for (let i = 0; i < n[r]; i += 1) {
      const own = `shadow-${r}${i}-${leathers[r][i]}`;
      push(has(L, own) ? own : `shadow-${r}${i}`);
    }
    done.add(r);
    present.forEach(({ p, q, key }) => {
      if ((r === p || r === q) && done.has(p) && done.has(q)) push(pairs[key]?.room);
    });
  });
  return out;
};

// The shadows past the frame (step 6, with the surround only): every book's, the small notebook's, and by
// day the candle's at C1 where it reaches past the frame.
export const wideLayers = (stateData, leathers, { look = 'night', candle = 'C0', held = false } = {}) => {
  const L = stateData?.layers || {};
  const out = [];
  if (has(L, 'shadow-wide-SN')) out.push('shadow-wide-SN');
  if (look !== 'night' && !held && has(L, `shadow-wide-candle-${candle}`)) out.push(`shadow-wide-candle-${candle}`);
  ROOM_ORDER.forEach((r) => {
    for (let i = 0; i < (leathers?.[r]?.length || 0); i += 1) if (has(L, `shadow-wide-${r}${i}`)) out.push(`shadow-wide-${r}${i}`);
  });
  return out;
};

// The books over the room, far to near (step 7 on): per place bottom up, each book with the shade it puts on
// the books under it, its picture and its plate (only where a count is lettered: `plates[slot]`), then the
// pairs' shades on that place; the big notebook after the towers. Each entry:
//   { kind: 'book', place, level, slot, shade, book, plate } | { kind: 'pairshade', place, name } |
//   { kind: 'notebook', name }
export const bookLayers = (stateData, leathers, plates = {}) => {
  const L = stateData?.layers || {};
  const pairs = stateData?.pairs || {};
  const n = Object.fromEntries(PLACES.map((p) => [p, leathers?.[p]?.length || 0]));
  const present = pairsPresent(n);
  const out = [];
  DRAW_ORDER.forEach((p) => {
    if (p === 'notebook') {
      if (has(L, 'notebook')) out.push({ kind: 'notebook', name: 'notebook' });
      return;
    }
    for (let i = 0; i < n[p]; i += 1) {
      const slot = slotKey(p, i);
      const leather = leathers[p][i];
      const label = labelOf(leather);
      // A level's shade on the book under it: by that book's leather where the set has one (S1), else the one.
      const under = i > 0 ? `shade-${slot}-${leathers[p][i - 1]}` : null;
      out.push({
        kind: 'book',
        place: p,
        level: i,
        slot,
        leather,
        shade: i > 0 ? (has(L, under) ? under : has(L, `shade-${slot}`) ? `shade-${slot}` : null) : null,
        book: has(L, `book-${slot}-${leather}`) ? `book-${slot}-${leather}` : null,
        plate: plates[slot] && has(L, `plate-${slot}-${label}`) ? `plate-${slot}-${label}` : null,
      });
    }
    // The pairs' shades on this place: by the leather of its top book where the pair lists one (F3 with T1, T2,
    // S1: a tower hides the window's sheen on its cover, a hue no black shade can make), else the plain one.
    const top = leathers[p][n[p] - 1];
    present.forEach(({ p: a, q: b, key }) => {
      if (p === a || p === b) {
        const own = pairs[key]?.[`on${p}-${top}`];
        const name = has(L, own) ? own : pairs[key]?.[`on${p}`];
        if (has(L, name)) out.push({ kind: 'pairshade', place: p, name });
      }
    });
  });
  return out;
};

// Each place's leathers bottom to top, from the stacks and each course's colour (deskStage.js leatherOf).
export const leathersOf = (stacks, colourOf) =>
  Object.fromEntries(PLACES.map((p) => [p, (stacks?.[p] || []).map((id) => leatherOf(colourOf(id)))]));

/* ── The lettering on a label ─────────────────────────────────────────────── */

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
// A label quad's layout size (its mean edges, the box the words are set in) and how much of that height
// the screen shows (a cover lying flat is seen foreshortened: F3's title label shows 0.62 of its height).
export const labelBox = (quad) => {
  const width = (dist(quad[0], quad[1]) + dist(quad[3], quad[2])) / 2;
  const height = (dist(quad[0], quad[3]) + dist(quad[1], quad[2])) / 2;
  const ys = quad.map((p) => p[1]);
  const seen = Math.max(...ys) - Math.min(...ys);
  return { width, height, squash: Math.min(1, seen / Math.max(1e-6, height)) };
};

// A title's lettering on a label at a scale: the spine rule (deskStage.js fitSpineTitle: one line, two,
// smaller, shortened, cut at a word), its floor such that the letters stand 13 css px tall ON THE SCREEN
// (a foreshortened label's floor is higher by its squash), never under the spines' 14.5 stage px. Its base
// grows with the label (a near spine is larger than a far one): 0.42 of the label's height, 17 to 30.
// `spineHeight`: two lines are allowed on a spine 40 px tall or more (a cover: always).
export const titleLettering = (name, quad, scale, { spineHeight = Infinity } = {}) => {
  const box = labelBox(quad);
  const floor = Math.max(SPINE_FLOOR, typeFloor(scale) / box.squash);
  const base = Math.max(floor, Math.min(30, Math.max(SPINE_BASE, box.height * 0.42)));
  const fit = fitSpineTitle(name, { width: box.width - 4, height: box.height - 2, spineHeight, base, floor });
  // Fix run: never cut inside a word (the spine rule's last resort, "Comparati.", on F3's foreshortened cover at the
  // least scales): a first word wider than the label at the floor is lettered whole, at the size the label's width
  // holds (under the floor: reported, for the picture builder's label size).
  if (fit.rule === 'cut-word') {
    const first = spareTitle(abbreviateTitle(String(name || '').trim().replace(/\s+/g, ' '))).split(' ')[0] || '';
    const size = Math.min(floor, ((box.width - 4) * 100) / Math.max(1, spineMeasure(first, 100)), (box.height - 2) / 0.94);
    return { lines: first ? [first] : [], size, rule: 'word-under-floor', floor, base, box, onScreen: size * scale * box.squash };
  }
  return { ...fit, floor, base, box, onScreen: fit.size * scale * box.squash };
};
// A count on its plate at a scale (deskStage.js fitSpineCount, its floor by the plate's squash): '' where
// it will not fit (the title wins; the plate is then not drawn).
export const countLettering = (count, quad, scale) => {
  const box = labelBox(quad);
  const floor = Math.max(SPINE_FLOOR, typeFloor(scale) / box.squash);
  return { ...fitSpineCount(count, { width: box.width - 1, height: box.height, floor }), box };
};

/* ── The held book ─────────────────────────────────────────────────────────── */

// The held picture of a course: its leather's, in the light state showing.
export const heldName = (colour) => `held-${leatherOf(colour)}`;
