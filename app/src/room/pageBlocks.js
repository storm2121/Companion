// The room's note model: a LINEAR DOCUMENT, not a canvas.
//
// Blocks live in the same Firestore shape classic uses — `{ blocks: MAP, order: [ids] }`
// on `…/notes/{id}/content/main` — so `saveNoteContentDelta`, `getNote` and the delete
// cascades all work unchanged (dualmode.md §3.3). What differs is which fields matter:
// a page block carries `type` and `section`, and never x/y/w/h.
//
// This works without touching shared code because `sanitizeBlocks` is a pass-through and
// `saveNoteContentDelta` writes `changedBlocks` values verbatim. If anyone ever adds a
// field whitelist to either, page notes break silently (dualmode.md §6.3).
//
// DOM-free and Firebase-free on purpose: tests/room.unit.test.mjs loads it under Node.

export const BLOCK_TEXT = 'text';
export const BLOCK_TWO_COLUMN = 'twoColumn';
export const BLOCK_IMAGE = 'image';
export const BLOCK_CODE = 'code';
export const BLOCK_MATH = 'math';
export const BLOCK_CALLOUT = 'callout';
export const BLOCK_CHECKLIST = 'checklist';

// The complete list the `+` menu offers. That is the design's whole vocabulary — it is
// not a starting point to extend.
export const BLOCK_TYPES = [
  { id: BLOCK_TEXT, label: 'Text' },
  { id: BLOCK_TWO_COLUMN, label: 'Two columns' },
  { id: BLOCK_IMAGE, label: 'Image' },
  { id: BLOCK_CODE, label: 'Code' },
  { id: BLOCK_MATH, label: 'Math' },
  { id: BLOCK_CALLOUT, label: 'Callout' },
  { id: BLOCK_CHECKLIST, label: 'Checklist' },
];

// What a COLUMN may contain: everything except another two-column. Columns do not
// nest, which keeps the model one level deep and the layout predictable.
export const COLUMN_BLOCK_TYPES = BLOCK_TYPES.filter((type) => type.id !== BLOCK_TWO_COLUMN);

export const newBlockId = () =>
  globalThis.crypto?.randomUUID?.() || `blk-${Date.now()}-${Math.random().toString(16).slice(2)}`;

export const createBlock = (type = BLOCK_TEXT) => {
  const block = { id: newBlockId(), type, value: '', section: false };
  if (type === BLOCK_TWO_COLUMN) {
    block.colA = [{ id: newBlockId(), type: BLOCK_TEXT, value: '' }];
    block.colB = [{ id: newBlockId(), type: BLOCK_TEXT, value: '' }];
  }
  if (type === BLOCK_CALLOUT) block.label = 'Prof said';
  if (type === BLOCK_CODE) block.lang = 'python';
  if (type === BLOCK_CHECKLIST) {
    block.value = '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p></p></li></ul>';
  }
  return block;
};

/* ── The board ────────────────────────────────────────────────────────────────
   A photo on the right-hand board is just a block with `rail: true`, plus where it
   hangs (`y`), how wide it is (`w`) and its shape (`ar`). Layout lives in railLayout.js.

   Deliberately NOT a `pins` subcollection: that would need a firestore.rules entry and a
   deploy, while this rides `saveNoteContentDelta`, the delta diff and the delete
   cascades with no new code at all.

   Photos are no longer tied to a section. They used to carry `pinnedTo`/`keep`/`dy`/`h`;
   those fields are simply not persisted any more, so a photo sheds them the next time it
   is saved.                                                                           */

export const createPin = (type, fields = {}) => ({
  ...createBlock(type),
  ...fields,
  rail: true,
  section: false,
});

export const pageBlocksOf = (blocks = []) => blocks.filter((block) => !block?.rail);
export const railBlocksOf = (blocks = []) => blocks.filter((block) => block?.rail);

// A brand-new page. The first block always opens a section, so §1 exists from the start.
export const startingBlocks = () => {
  const first = createBlock(BLOCK_TEXT);
  first.section = true;
  return [first];
};

/* ── Sections ─────────────────────────────────────────────────────────────────
   §n is derived from position, never stored — renumbering is then impossible to get
   wrong, and deleting a block cannot leave a gap in the sequence.                */

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

const decodeEntity = (match, body) => {
  if (body[0] === '#') {
    const code =
      body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : match;
  }
  return NAMED_ENTITIES[body.toLowerCase()] ?? match;
};

// `&amp;` → `&`, `&#39;` → `'` … for text that has already lost its tags.
export const decodeEntities = (text) => String(text || '').replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, decodeEntity);

// Plain text out of block HTML, for outline titles. Deliberately NOT a DOM parse: the
// outline recomputes on every keystroke, and an innerHTML parse per section per keystroke
// was real work — it also fetched any image a block referenced, just to read its text.
// Only the start is read (`limit`), because a title only ever needs the first line.
export const stripHtml = (html, limit = 800) => {
  if (!html) return '';
  return String(html)
    .slice(0, limit)
    .replace(/<(?:br|\/p|\/li|\/h[1-6]|\/div|\/pre)\b[^>]*>/gi, ' ')
    .replace(/<[^>]*>?/g, '') // also drops a tag cut in half by the slice
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, decodeEntity)
    .replace(/\s+/g, ' ')
    .trim();
};

// The first line a block shows — its heading, or its first paragraph — never the heading
// run together with the paragraph under it ("Trees that stay short A degenerate tree…").
const LINE_END = /<\/(?:p|h[1-6]|li|div|pre|blockquote)>|<br\s*\/?>/i;
export const firstLineOf = (html) =>
  String(html || '')
    .slice(0, 800)
    .split(LINE_END)
    .map((part) => stripHtml(part))
    .find(Boolean) || '';

// Returns [{ id, index, title }] for every block that opens a section.
export const sectionsOf = (blocks = []) => {
  let n = 0;
  return blocks
    .filter((block) => block?.section && !block?.rail)
    .map((block) => {
      n += 1;
      // A two-column block keeps its text in its columns, so the outline reads from the
      // first child that actually has some.
      const fromColumns = [...(block.colA || []), ...(block.colB || [])]
        .map((child) => firstLineOf(child.value))
        .find(Boolean);
      const text = firstLineOf(block.value) || fromColumns || '';
      const title = text.split(/[.;:—]/)[0].slice(0, 44).trim();
      return { id: block.id, index: n, title: title || `Section ${n}` };
    });
};

/* ── Plain text ───────────────────────────────────────────────────────────────
   The whole page as text, for ⌘K search. Code and math are plain already; a callout's
   label is part of what it says; a photo contributes only its alt text.            */

const blockText = (block) => {
  if (!block) return '';
  if (block.type === BLOCK_CODE || block.type === BLOCK_MATH) return String(block.value || '');
  if (block.type === BLOCK_IMAGE) return String(block.alt || '');
  if (block.type === BLOCK_TWO_COLUMN) {
    return [...(block.colA || []), ...(block.colB || [])].map(blockText).filter(Boolean).join('\n');
  }
  const body = stripHtml(block.value, Infinity);
  return block.type === BLOCK_CALLOUT && block.label ? `${block.label} ${body}` : body;
};

export const pageText = (blocks = []) =>
  pageBlocksOf(blocks).map(blockText).filter(Boolean).join('\n').trim();

// Every photo a note holds — on the board, on the page, or inside a column — for a course's
// Files. Only real addresses: a photo still uploading has no `value` yet.
export const photosOf = (blocks = []) =>
  blocks
    .flatMap((block) => (block?.type === BLOCK_TWO_COLUMN ? [...(block.colA || []), ...(block.colB || [])] : [block]))
    .filter((block) => block?.type === BLOCK_IMAGE && /^https?:\/\//.test(String(block.value || '')))
    .map((block) => ({ id: block.id, url: block.value, alt: String(block.alt || ''), ar: Number(block.ar) || 0 }));

// One plain paragraph holding `text` — how a line filed from the Inbox becomes a note.
export const textBlock = (text, fields = {}) => ({
  ...createBlock(BLOCK_TEXT),
  value: `<p>${escapeHtml(text)}</p>`,
  ...fields,
});

/* ── Persistence ──────────────────────────────────────────────────────────── */

// Everything a page block or a board photo actually uses. Anything else a block carries
// (x/y/w/h from a canvas note, the retired pin fields) is left out of every save.
const FIELDS = [
  'id',
  'type',
  'value',
  'label',
  'lang',
  'section',
  'alt',
  'rail',
  'y',
  'w',
  'ar',
  'colA',
  'colB',
];

export const toStored = (block) => {
  const out = {};
  FIELDS.forEach((key) => {
    if (block[key] !== undefined) out[key] = block[key];
  });
  out.type = out.type || BLOCK_TEXT;
  out.section = Boolean(out.section);
  return out;
};

export const fromStored = (block, index = 0) => {
  const out = {
    ...block,
    id: block.id || newBlockId(),
    type: block.type || BLOCK_TEXT,
    value: typeof block.value === 'string' ? block.value : '',
    // A note that somehow arrives with no section at all still gets a §1.
    section: !block.rail && (Boolean(block.section) || index === 0),
  };
  if (out.type === BLOCK_TWO_COLUMN && !Array.isArray(out.colA)) {
    // Two-column blocks used to hold two HTML strings. Lift them into single-child column
    // lists, and clear `value`: left behind, it would keep feeding the outline the
    // column's OLD text long after the column itself had been edited.
    out.colA = [{ id: newBlockId(), type: BLOCK_TEXT, value: out.value || '' }];
    out.colB = Array.isArray(out.colB)
      ? out.colB
      : [{ id: newBlockId(), type: BLOCK_TEXT, value: block.valueB || '' }];
    out.value = '';
  }
  delete out.valueB;
  return out;
};

// Per-block diff against the last saved snapshot: one field path per changed block
// rather than rewriting the whole document on every keystroke.
export const diffBlocks = (blocks, lastSaved) => {
  const changedBlocks = {};
  const seen = new Set();
  blocks.forEach((block) => {
    const stored = toStored(block);
    seen.add(block.id);
    if (JSON.stringify(stored) !== JSON.stringify(lastSaved?.[block.id])) {
      changedBlocks[block.id] = stored;
    }
  });
  const removedBlockIds = Object.keys(lastSaved || {}).filter((id) => !seen.has(id));
  const order = blocks.map((block) => block.id);
  const changed = Object.keys(changedBlocks).length > 0 || removedBlockIds.length > 0;
  return { changedBlocks, removedBlockIds, order, changed };
};

export const snapshotOf = (blocks) =>
  blocks.reduce((acc, block) => {
    acc[block.id] = toStored(block);
    return acc;
  }, {});

/* ── PDF ──────────────────────────────────────────────────────────────────────
   `utils/exportPdf.js` is shared with classic and understands only text and image
   blocks. Rather than add page-only branches to a file classic depends on, the page is
   flattened here first: a two-column block becomes its two columns in reading order,
   and code/math become <pre>.

   Its `readingOrder` sorts by y then x. Page blocks have neither, so every key is 0 and
   Array#sort (stable since ES2019) leaves the order alone. Board photos DO carry a `y`,
   which is why they are flattened into plain image blocks without one below.        */

const escapeHtml = (text) =>
  String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const flatten = (block) => {
  if (block.type === BLOCK_CODE || block.type === BLOCK_MATH) {
    return { type: 'text', value: `<pre>${escapeHtml(block.value)}</pre>` };
  }
  if (block.type === BLOCK_IMAGE) return { type: 'image', value: block.value || '' };
  return { type: 'text', value: block.value || '' };
};

// Board photos are part of the note, so they print too — after the page, top to bottom.
export const toPdfBlocks = (blocks = []) => {
  const photos = railBlocksOf(blocks)
    .map((pin, order) => ({ pin, order }))
    .sort((a, b) => (Number(a.pin.y) || 0) - (Number(b.pin.y) || 0) || a.order - b.order)
    .map(({ pin }) => pin);
  return [...pageBlocksOf(blocks), ...photos].flatMap((block) =>
    block.type === BLOCK_TWO_COLUMN
      ? [...(block.colA || []), ...(block.colB || [])].map(flatten)
      : [flatten(block)],
  );
};
