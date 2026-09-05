// Sage's layout engine.
//
// Layout used to be the model's job: the prompt shipped 3,371 characters of geometry
// equations (charsPerLine, `h = 64 + lines * 24`, a formal non-overlap inequality, a
// six-pattern row library, a worked example and a random seed) and the answer's numbers
// were then clamped by the server and repaired by the client anyway. It cost a reasoning
// trace of ~15k tokens per restructure to produce coordinates that were mostly
// overwritten, and it could not work in principle: heights depend on rendered text, and
// the model cannot measure rendered text.
//
// So the three jobs are now split by who can actually do them:
//   - the MODEL reads the note and tags each block with a semantic role (+ what it
//     belongs to). That needs comprehension, which only it has.
//   - this ENGINE composes roles into a page. That needs design rules, which are
//     deterministic, tunable, and identical for every note.
//   - the BROWSER measures heights (see sageMeasure.js). It owns the fonts and the
//     stylesheet, so it is the only correct answer.
//
// Design intent, for anyone tuning the numbers below: a single left rail at x=660 holds
// the page together (every row starts there, so the eye has one edge to follow), while
// widths vary per role so the right edge stays ragged instead of boxed. Asides swing
// left and right down the page, and a `formula`/`caveat` on the right hangs into the
// margin — the one deliberate break of the band, used to mark a kind of content rather
// than for decoration. Spacing is a 3-step scale, so proximity means something.

// Node's ESM loader (the unit tests import this module directly) does not do Vite's
// extensionless resolution, so relative imports here carry their extension.
import { measureTextBlockHeights } from './sageMeasure.js';

const SAFE_BLOCK_ID = /^[A-Za-z0-9_-]{1,128}$/;

const RAIL = 660; // the left rail: every row begins here
const BAND_W = 1080;
const BAND_RIGHT = RAIL + BAND_W; // 1740
// The column gutter. Every SLOT below is laid out exactly this far from its neighbour,
// so a row is gutter-tight by construction rather than by a runtime check.
const GUTTER = 20;
// The tightest gap the engine ever designs with, and therefore the smallest gap the
// overlap guard below may treat as a collision. Using GUTTER here instead would rewrite
// every deliberate 8px pairing back to 20 and flatten the spacing scale.
const MIN_GAP = 8;
const TOP_Y = 56;
const BOTTOM_PAD = 120;
const MIN_CANVAS_HEIGHT = 720;
const MAX_BLOCKS = 160; // mirrors MAX_BLOCKS in functions/index.js
// How far a right-hand margin note hangs past the band. Bounded so the canvas (2400,
// and it grows to fit anyway) always contains it.
const BREAKOUT = 110;

// A 3-step spacing scale instead of one 20px gutter everywhere. Uniform spacing is the
// definition of no hierarchy; this is what makes proximity readable.
const SPACE = { tight: 8, normal: 20, section: 48 };

// A reading column at a single width, and a margin rail that always sits on the right.
// An earlier version varied the reading column between 710 and 880 and swung the rail
// left and right for "variety": three different right edges over five blocks read as
// nothing lining up, and a rail that moves cannot flow independently of the column
// beside it. One column plus one fixed rail is the textbook/magazine idiom — where a
// block has no margin note the rail is simply empty, which reads as intended.
const SLOT = {
  full: { x: RAIL, w: BAND_W }, // lead / summary — a strong top and bottom edge
  main: { x: RAIL, w: 710 }, // the reading column, always this wide
  aside: { x: 1390, w: 350 }, // the margin rail, always here
  half: [
    { x: RAIL, w: 530 },
    { x: 1210, w: 530 },
  ],
  third: [
    { x: RAIL, w: 346 },
    { x: 1026, w: 346 },
    { x: 1392, w: 346 },
  ],
};

/**
 * The role vocabulary. Deliberately small — every extra role is one more judgment the
 * model can get wrong, and the engine can express plenty with eight.
 *
 *   flow  'full'  own row, full band          'main'  the reading column
 *         'aside' a narrow companion column    'group' tiles with its siblings
 *   space the gap that opens BEFORE this block's row
 */
export const SAGE_ROLES = {
  lead: { flow: 'full', space: 'section' },
  concept: { flow: 'main', space: 'normal' },
  steps: { flow: 'main', space: 'normal' },
  example: { flow: 'aside', space: 'tight' },
  caveat: { flow: 'aside', space: 'tight', breakout: true },
  formula: { flow: 'aside', space: 'tight', breakout: true },
  terms: { flow: 'group', space: 'normal' },
  summary: { flow: 'full', space: 'section' },
};

export const SAGE_ROLE_IDS = Object.keys(SAGE_ROLES);
const DEFAULT_ROLE = 'concept';
const FIGURE_ROLE = 'concept'; // images flow in the reading column

export const resolveRole = (role) => (SAGE_ROLES[role] ? role : DEFAULT_ROLE);

const createBlockId = () =>
  globalThis.crypto?.randomUUID?.() || `block-${Date.now()}-${Math.random().toString(16).slice(2)}`;

// A block already shows its title in its header bar, so a model that ALSO opens the
// value with a heading of the same text prints the name twice and burns 30-40px of the
// block on the repeat. The prompt asks it not to; this removes it deterministically when
// it does anyway — and only on an exact text match, so a heading that genuinely says
// something else is left alone.
const normalizeHeadingText = (value) =>
  value
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/[\s:—–-]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

export const stripDuplicateHeading = (value, title) => {
  if (typeof value !== 'string' || !title) return typeof value === 'string' ? value : '';
  const match = value.match(/^\s*<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>\s*/i);
  if (!match) return value;
  if (normalizeHeadingText(match[1]) !== normalizeHeadingText(title)) return value;
  return value.slice(match[0].length);
};

const asInt = (value, fallback) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? n : fallback;
};

// ---------------------------------------------------------------------------
// Row building: semantic items -> rows of positioned slots
// ---------------------------------------------------------------------------

const buildRows = (items) => {
  const byId = new Map(items.map((item) => [item.id, item]));
  const isAside = (item) => SAGE_ROLES[item.role]?.flow === 'aside';
  const isMainFlow = (item) => {
    const flow = SAGE_ROLES[item.role]?.flow;
    return flow === 'main';
  };

  // Bucket every aside onto a parent: its declared `attachTo` when that points at a
  // real main-flow block, otherwise the nearest main-flow block above it. An aside with
  // no parent at all is promoted to the reading column rather than left as an orphaned
  // narrow box (a 350px column alone on the page reads as a mistake).
  const asidesByParent = new Map();
  const consumed = new Set();
  let lastMainId = '';
  items.forEach((item) => {
    if (isMainFlow(item)) {
      lastMainId = item.id;
      return;
    }
    if (!isAside(item)) return;
    const declared = item.attachTo && byId.get(item.attachTo);
    const parentId = declared && isMainFlow(declared) ? declared.id : lastMainId;
    if (!parentId) return; // stays in the flow, promoted below
    if (!asidesByParent.has(parentId)) asidesByParent.set(parentId, []);
    asidesByParent.get(parentId).push(item);
    consumed.add(item.id);
  });

  const rows = [];

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (consumed.has(item.id)) continue;
    const role = SAGE_ROLES[item.role] || SAGE_ROLES[DEFAULT_ROLE];

    if (role.flow === 'full') {
      rows.push({ kind: 'full', space: role.space, cells: [{ item, slot: SLOT.full }] });
      continue;
    }

    if (role.flow === 'group') {
      // Consecutive tiles lay out as a triptych (3+) or a twin (2). A lone tile has
      // nothing to be parallel with, so it just reads as a concept.
      const run = [item];
      let j = i + 1;
      while (j < items.length && !consumed.has(items[j].id) && SAGE_ROLES[items[j].role]?.flow === 'group') {
        run.push(items[j]);
        j += 1;
      }
      i = j - 1;
      if (run.length === 1) {
        rows.push({ kind: 'main', space: role.space, cells: [{ item: run[0], slot: SLOT.main }] });
        continue;
      }
      const perRow = run.length % 3 === 0 || run.length > 4 ? 3 : 2;
      for (let k = 0; k < run.length; k += perRow) {
        const chunk = run.slice(k, k + perRow);
        const slots = chunk.length === 3 ? SLOT.third : SLOT.half;
        rows.push({
          kind: 'group',
          space: k === 0 ? role.space : 'tight',
          cells: chunk.map((cell, index) => ({ item: cell, slot: slots[index] || slots[slots.length - 1] })),
        });
      }
      continue;
    }

    // Main flow: a reading-column block, with any asides in the rail beside it.
    const asides = asidesByParent.get(item.id) || [];
    const mainSlot =
      item.type === 'image' ? { x: RAIL, w: Math.min(item.w, SLOT.main.w) } : SLOT.main;
    rows.push({
      kind: 'main',
      space: role.space,
      cells: [
        { item, slot: mainSlot },
        ...asides.map((aside) => ({ item: aside, slot: SLOT.aside, aside: true })),
      ],
    });
  }

  return rows;
};

// ---------------------------------------------------------------------------
// Flow: rows -> final geometry, using measured heights
// ---------------------------------------------------------------------------

// The two columns flow INDEPENDENTLY. Every row used to be a full-width band that ended
// at the bottom of its tallest cell, so a short concept carrying two tall margin notes
// left a void of dead air beneath itself while the next block waited for the rail to
// finish. Tracking a bottom per column is what turns that band into real column flow.
// A full-band row (lead, summary, tiles) spans both columns, so it clears both.
const flowRows = (rows, heightOf) => {
  const placed = [];
  let mainBottom = TOP_Y;
  let asideBottom = TOP_Y;
  let first = true;

  rows.forEach((row) => {
    const gap = first ? 0 : (SPACE[row.space] ?? SPACE.normal);
    first = false;

    const mainCells = row.cells.filter((cell) => !cell.aside);
    const asideCells = row.cells.filter((cell) => cell.aside);
    const spansBand = row.kind !== 'main';

    const y = (spansBand ? Math.max(mainBottom, asideBottom) : mainBottom) + gap;

    let bottom = y;
    mainCells.forEach((cell) => {
      const h = heightOf(cell.item, cell.slot.w);
      placed.push({ item: cell.item, x: cell.slot.x, y, w: cell.slot.w, h });
      bottom = Math.max(bottom, y + h);
    });
    mainBottom = bottom;
    if (spansBand) asideBottom = bottom;

    // Asides top-align with their main block and stack tightly under one another, so a
    // short margin note sits beside the TOP of a tall concept rather than being centred
    // or pushed into a band of its own. The breakout shifts the whole rail together —
    // applied per block it shingled the asides instead of hanging them into the margin.
    if (!asideCells.length) return;
    const breakout = asideCells.some((cell) => SAGE_ROLES[cell.item.role]?.breakout) ? BREAKOUT : 0;
    // Never let a margin note float above the block it belongs to, and never let it
    // collide with the rail entry above it.
    let asideY = Math.max(y, asideBottom + SPACE.tight);
    asideCells.forEach((cell) => {
      const h = heightOf(cell.item, cell.slot.w);
      placed.push({ item: cell.item, x: cell.slot.x + breakout, y: asideY, w: cell.slot.w, h });
      asideY += h + SPACE.tight;
    });
    asideBottom = asideY - SPACE.tight;
  });

  return placed;
};

// ---------------------------------------------------------------------------
// Public: compose a whole page from semantic blocks
// ---------------------------------------------------------------------------

// The provider addresses blocks by `ref` — a handle it invents — because a brand-new
// block has no id yet and still needs to be a legal `attachTo` target. Ids are resolved
// first, then refs are mapped onto them, so attachment survives the renaming.
const normalizeSemantic = (items, originalsById) => {
  const list = (Array.isArray(items) ? items : []).filter((raw) => raw && typeof raw === 'object');
  const refToId = new Map();
  const claimed = new Set();

  const resolved = list.reduce((acc, raw) => {
    const declaredId = typeof raw.id === 'string' && SAFE_BLOCK_ID.test(raw.id) ? raw.id : '';
    const original = declaredId && !claimed.has(declaredId) ? originalsById.get(declaredId) : null;
    if (original) claimed.add(original.id);
    const type = original?.type === 'image' ? 'image' : 'text';
    // An image block's pixels are never re-authored: value/w/h come from local state.
    if (raw.type === 'image' && !original) return acc;
    const id = original ? original.id : createBlockId();
    if (typeof raw.ref === 'string' && raw.ref) refToId.set(raw.ref, id);
    acc.push({
      id,
      type,
      title: typeof raw.title === 'string' ? raw.title.slice(0, 120) : original?.title || '',
      value:
        type === 'image'
          ? original.value
          : stripDuplicateHeading(
              typeof raw.value === 'string' ? raw.value.slice(0, 60000) : '',
              typeof raw.title === 'string' ? raw.title : '',
            ),
      role: type === 'image' ? FIGURE_ROLE : resolveRole(raw.role),
      attachRef: typeof raw.attachTo === 'string' ? raw.attachTo : '',
      attachTo: '',
      w: type === 'image' ? original.w : 0,
      h: type === 'image' ? original.h : 0,
      source: original || null,
    });
    return acc;
  }, []);

  resolved.forEach((item) => {
    // A ref that resolves to a real block wins; an `attachTo` that already names an
    // existing block id (an older server, or a model that used ids) still works.
    const viaRef = item.attachRef ? refToId.get(item.attachRef) : '';
    const viaId = item.attachRef && SAFE_BLOCK_ID.test(item.attachRef) ? item.attachRef : '';
    const target = viaRef || (originalsById.has(viaId) ? viaId : '');
    item.attachTo = target && target !== item.id ? target : '';
    delete item.attachRef;
  });

  return resolved;
};

const dedupe = (items) => {
  const seen = new Set();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
};

const heightResolver = (items) => {
  const textItems = items.filter((item) => item.type !== 'image');
  const cache = new Map();
  return (widthFor) => {
    const requests = textItems.map((item) => ({
      key: `${item.id}:${widthFor(item)}`,
      value: item.value,
      w: widthFor(item),
      fontSize: item.source?.fontSize,
      lineHeight: item.source?.lineHeight,
    }));
    const heights = measureTextBlockHeights(requests);
    requests.forEach((req, index) => cache.set(req.key, heights[index]));
    return (item, w) => {
      if (item.type === 'image') return item.h;
      const measured = cache.get(`${item.id}:${w}`);
      if (Number.isFinite(measured)) return measured;
      // Fallback for environments with no DOM (unit tests): a coarse estimate, only
      // ever used when measurement is impossible.
      const chars = item.value.replace(/<[^>]*>/g, '').length;
      const perLine = Math.max(20, Math.floor(w / 8.2));
      return Math.max(140, Math.min(64 + (Math.ceil(chars / perLine) + 1) * 22, 1400));
    };
  };
};

/**
 * Compose a full page from the model's semantic output.
 * @param {Array} items   `{ id, title, value, role, attachTo }` from the provider
 * @param {Array} originalBlocks the note's current blocks (trusted local state)
 * @returns {{blocks: Array, canvasHeight: number}|null}
 */
export const composeSageLayout = (items, originalBlocks = []) => {
  const originalsById = new Map((originalBlocks || []).map((block) => [block.id, block]));
  const semantic = dedupe(normalizeSemantic(items, originalsById));
  if (!semantic.length) return null;

  const rows = buildRows(semantic);
  // Widths are known once rows exist, so heights can be measured at the real wrap width.
  // (Breakout only shifts x, so it never changes the width text wraps at.)
  const widthByItem = new Map();
  rows.forEach((row) => row.cells.forEach((cell) => widthByItem.set(cell.item.id, cell.slot.w)));
  const resolve = heightResolver(semantic)((item) => widthByItem.get(item.id) || SLOT.main.w);
  const placed = flowRows(rows, resolve);

  const blocks = placed.map(({ item, x, y, w, h }) => ({
    id: item.id,
    type: item.type,
    title: item.title,
    value: item.value,
    role: item.role,
    x,
    y,
    w: item.type === 'image' ? item.w : w,
    h,
  }));

  return finalize(blocks, originalBlocks);
};

// Rows inferred from geometry the user (or a previous run) already established. Anything
// whose tops sit within 24px is one row, so a hand-arranged pair stays a pair even after
// its content changes height.
const groupIntoRows = (blocks) => {
  const rows = [];
  [...blocks]
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .forEach((block) => {
      const row = rows.find((candidate) => Math.abs(candidate.top - block.y) <= 24);
      if (row) {
        row.blocks.push(block);
        row.top = Math.min(row.top, block.y);
      } else {
        rows.push({ top: block.y, blocks: [block] });
      }
    });
  return rows;
};

const measureInPlace = (blocks) => {
  const textItems = blocks.filter((block) => block.type !== 'image');
  const heights = measureTextBlockHeights(
    textItems.map((block) => ({
      value: block.value,
      w: block.w,
      fontSize: block.fontSize,
      lineHeight: block.lineHeight,
    })),
  );
  const heightById = new Map(textItems.map((block, index) => [block.id, heights[index]]));
  return blocks.map((block) => ({
    ...block,
    h: block.type === 'image' ? block.h : heightById.get(block.id) ?? block.h,
  }));
};

const flowInferredRows = (rows) => {
  let y = TOP_Y;
  rows.forEach((row, index) => {
    if (index > 0) y += SPACE.normal;
    let bottom = y;
    row.blocks.forEach((block) => {
      block.y = y;
      bottom = Math.max(bottom, y + block.h);
    });
    y = bottom;
  });
  return rows.flatMap((row) => row.blocks);
};

/**
 * Re-measure and re-flow blocks that already have x/w: content grew or shrank, but the
 * columns stay where they are. Used on its own as a "fit blocks to their content" pass.
 */
export const reflowSageBlocks = (blocks = []) => {
  const list = (Array.isArray(blocks) ? blocks : []).filter(Boolean);
  if (!list.length) return null;
  return finalize(flowInferredRows(groupIntoRows(measureInPlace(list))), blocks);
};

/**
 * Apply a "patch" or "reflow" result: edits to existing blocks by id, plus new blocks
 * anchored after an existing one. The page's arrangement is preserved — only heights are
 * re-measured and rows re-flowed, because the text changed size.
 *
 * @param {Array} currentBlocks the note's live blocks
 * @param {{changed?: Array, added?: Array}} result the server's patch
 * @returns {{blocks: Array, canvasHeight: number, editedCount: number, addedCount: number}|null}
 */
export const applySagePatch = (currentBlocks = [], result = {}) => {
  const list = (Array.isArray(currentBlocks) ? currentBlocks : []).filter(Boolean);
  if (!list.length) return null;
  const edits = new Map(
    (Array.isArray(result?.changed) ? result.changed : [])
      .filter((entry) => entry && typeof entry.id === 'string')
      .map((entry) => [entry.id, entry]),
  );
  const additions = Array.isArray(result?.added) ? result.added : [];

  let editedCount = 0;
  const edited = list.map((block) => {
    const edit = edits.get(block.id);
    // Only text blocks can be rewritten; an image's value is a private Storage URL.
    if (!edit || block.type !== 'text') return { ...block };
    const nextTitle = typeof edit.title === 'string' && edit.title ? edit.title.slice(0, 120) : block.title;
    const value = stripDuplicateHeading(
      typeof edit.value === 'string' ? edit.value.slice(0, 60000) : block.value,
      nextTitle,
    );
    if (value === block.value && !edit.title) return { ...block };
    editedCount += 1;
    return {
      ...block,
      value,
      title: nextTitle,
    };
  });

  const rows = groupIntoRows(edited);
  const rowOf = (blockId) => rows.findIndex((row) => row.blocks.some((block) => block.id === blockId));

  // A new block takes the column of the block it follows, as its own row directly below.
  let addedCount = 0;
  additions.forEach((addition) => {
    if (!addition || typeof addition !== 'object') return;
    if (edited.length + addedCount >= MAX_BLOCKS) return;
    const anchorIndex = addition.afterId ? rowOf(addition.afterId) : -1;
    const anchor = anchorIndex >= 0 ? rows[anchorIndex].blocks.find((b) => b.id === addition.afterId) : null;
    const role = resolveRole(addition.role);
    const slot = SAGE_ROLES[role]?.flow === 'full' ? SLOT.full : anchor ? { x: anchor.x, w: anchor.w } : SLOT.main;
    const block = {
      id: createBlockId(),
      type: 'text',
      title: typeof addition.title === 'string' ? addition.title.slice(0, 120) : '',
      value: stripDuplicateHeading(
        typeof addition.value === 'string' ? addition.value.slice(0, 60000) : '',
        typeof addition.title === 'string' ? addition.title : '',
      ),
      role,
      x: slot.x,
      y: anchor ? anchor.y : TOP_Y,
      w: slot.w,
      h: 240,
    };
    addedCount += 1;
    const row = { top: block.y, blocks: [block] };
    // afterId null means "the very top"; an unknown anchor lands at the end.
    if (addition.afterId && anchorIndex >= 0) rows.splice(anchorIndex + 1, 0, row);
    else if (!addition.afterId) rows.unshift(row);
    else rows.push(row);
  });

  const all = rows.flatMap((row) => row.blocks);
  const measured = measureInPlace(all);
  const byId = new Map(measured.map((block) => [block.id, block]));
  rows.forEach((row) => {
    row.blocks = row.blocks.map((block) => byId.get(block.id) || block);
  });
  const composed = finalize(flowInferredRows(rows), list);
  return composed ? { ...composed, editedCount, addedCount } : null;
};

// ---------------------------------------------------------------------------
// Final safety gate (defense in depth — runs on every mode)
// ---------------------------------------------------------------------------

const PRESERVED_FIELDS = [
  'fontSize',
  'lineHeight',
  'textColor',
  'bgColor',
  'bold',
  'underline',
  'locked',
  'priority',
];

const finalize = (blocks, originalBlocks = []) => {
  const originalsById = new Map((originalBlocks || []).map((block) => [block.id, block]));
  const usedIds = new Set();
  const cleaned = [];

  (Array.isArray(blocks) ? blocks : []).forEach((block) => {
    if (!block || (block.type !== 'text' && block.type !== 'image')) return;
    const original = typeof block.id === 'string' ? originalsById.get(block.id) : null;
    const isImage = block.type === 'image';
    // An image can only exist if it already existed: the provider can neither invent
    // one nor re-type a text block into one (its value is a private Storage URL).
    if (isImage && (!original || original.type !== 'image' || usedIds.has(original.id))) return;

    const canReuseId =
      original && original.type === block.type && SAFE_BLOCK_ID.test(original.id) && !usedIds.has(original.id);
    let id = canReuseId ? original.id : createBlockId();
    while (usedIds.has(id) || !SAFE_BLOCK_ID.test(id)) id = createBlockId();
    usedIds.add(id);

    const value = isImage ? original.value : typeof block.value === 'string' ? block.value.slice(0, 60000) : '';
    // An image keeps its own dimensions exactly; only text is clamped to the band.
    const w = isImage ? original.w : Math.max(160, Math.min(asInt(block.w, SLOT.main.w), BAND_W));
    const h = isImage ? original.h : Math.max(140, Math.min(asInt(block.h, 240), 1400));
    // The band plus the breakout margin is the legal strip. Clamping to the band alone
    // would undo every margin note the engine placed on purpose.
    const minX = RAIL - BREAKOUT;
    const maxX = Math.max(minX, BAND_RIGHT + BREAKOUT - w);
    const x = Math.max(minX, Math.min(asInt(block.x, RAIL), maxX));
    const y = Math.max(TOP_Y, asInt(block.y, TOP_Y));

    cleaned.push({
      // Per-block formatting the student chose is theirs, not Sage's, so it rides along
      // rather than being reset to defaults by normalizeBlocks. Deliberately NOT carried
      // forward: collapsed/restoreHeight (rewritten content should not stay hidden) and
      // zIndex/geometry (this pass owns those).
      ...(original ? PRESERVED_FIELDS.reduce((acc, key) => {
        if (original[key] !== undefined) acc[key] = original[key];
        return acc;
      }, {}) : {}),
      id,
      type: block.type,
      title: typeof block.title === 'string' ? block.title.slice(0, 120) : '',
      value,
      role: SAGE_ROLES[block.role] ? block.role : '',
      x,
      y,
      w,
      h,
    });
  });

  if (!cleaned.length) return null;

  // Overlap guard. With measured heights this should never fire; it stays because a
  // silently overlapping block is data the student cannot read.
  cleaned.sort((a, b) => a.y - b.y || a.x - b.x);
  for (let i = 0; i < cleaned.length; i += 1) {
    const cur = cleaned[i];
    let moved = true;
    while (moved) {
      moved = false;
      for (let j = 0; j < i; j += 1) {
        const prev = cleaned[j];
        const overlapX = cur.x < prev.x + prev.w + MIN_GAP && prev.x < cur.x + cur.w + MIN_GAP;
        const overlapY = cur.y < prev.y + prev.h + MIN_GAP && prev.y < cur.y + cur.h + MIN_GAP;
        if (overlapX && overlapY) {
          cur.y = prev.y + prev.h + MIN_GAP;
          moved = true;
        }
      }
    }
  }

  const maxBottom = cleaned.reduce((max, block) => Math.max(max, block.y + block.h), 0);
  return { blocks: cleaned, canvasHeight: Math.max(MIN_CANVAS_HEIGHT, maxBottom + BOTTOM_PAD) };
};

/**
 * Kept as the named safety pass for any path that receives blocks WITH geometry.
 * `composeSageLayout` and `reflowSageBlocks` already end with it.
 */
export const sanitizeSageLayout = (aiBlocks, originalBlocks) => finalize(aiBlocks, originalBlocks);

/**
 * Grow blocks whose real rendered content turned out taller than the composed height, and
 * push what sits below them in the same column down by exactly that much.
 *
 * The off-screen probe in sageMeasure.js is a faithful replica, but a replica: it can be
 * off by a margin the stylesheet collapses differently, by a webfont that landed a frame
 * late, or by anything ProseMirror does to its own DOM. Rather than chase that fidelity
 * forever, the caller measures the ACTUAL blocks once they are on screen and hands the
 * shortfalls here. Reading the element the student is looking at cannot be wrong.
 *
 * Shifting only blocks whose x-range overlaps is what preserves the two-column flow: a
 * growing reading-column block must not drag the margin rail down with it.
 *
 * @param {Array} blocks composed blocks, with geometry
 * @param {Map<string, number>} overflowById extra pixels each block needs (>0)
 */
export const refitSageBlocks = (blocks, overflowById) => {
  const list = (Array.isArray(blocks) ? blocks : []).map((block) => ({ ...block }));
  if (!list.length || !overflowById?.size) return null;
  const ordered = [...list].sort((a, b) => a.y - b.y || a.x - b.x);
  let changed = false;

  ordered.forEach((block) => {
    const extra = Math.round(overflowById.get(block.id) || 0);
    if (!(extra > 0)) return;
    changed = true;
    const bottomBefore = block.y + block.h;
    block.h += extra;
    ordered.forEach((other) => {
      if (other === block) return;
      if (other.y < bottomBefore) return;
      const sharesColumn = other.x < block.x + block.w && block.x < other.x + other.w;
      if (sharesColumn) other.y += extra;
    });
  });

  if (!changed) return null;
  return finalize(ordered, blocks);
};

export const SAGE_LAYOUT_LIMITS = {
  RAIL,
  BAND_W,
  BAND_RIGHT,
  BREAKOUT,
  GUTTER,
  MIN_GAP,
  TOP_Y,
  SPACE,
};
