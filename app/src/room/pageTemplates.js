// Page templates for new room notes (dualmode.md §4.2).
//
// Classic's templates are spatial — "two-over-one", "triple-stack" — and cannot exist on a
// page. The room's are STRUCTURES: an ordered set of blocks whose sections open with a
// heading, which the outline reads as the section's title. They are offered as a chip row
// on a blank note and disappear the moment it has any content.
//
// Custom templates are "save this note's structure": headings, block types, sections and
// labels are kept; everything written under them is left behind. They live on the profile
// doc (`roomTemplates`), NOT in `noteTemplates` — classic's template picker lists that
// collection, and a page-shaped template there would create a broken canvas note.
//
// DOM-free and Firebase-free: tests/room.unit.test.mjs loads it under Node.

import {
  BLOCK_CALLOUT,
  BLOCK_CHECKLIST,
  BLOCK_CODE,
  BLOCK_IMAGE,
  BLOCK_MATH,
  BLOCK_TEXT,
  BLOCK_TWO_COLUMN,
  newBlockId,
  stripHtml,
} from './pageBlocks.js'; // explicit extension: Node's test runner loads this file too

const EMPTY_TASKS =
  '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p></p></li></ul>';
const h2 = (text) => `<h2>${text}</h2><p></p>`;
const h3 = (text) => `<h3>${text}</h3><p></p>`;

// `kind` becomes the stamp on the note's sheet in the course grid (LECTURE, READING…).
export const PAGE_TEMPLATES = [
  {
    id: 'lecture',
    label: 'Lecture',
    kind: 'Lecture',
    blocks: [
      { type: BLOCK_TEXT, section: true, value: h2('Key ideas') },
      { type: BLOCK_CALLOUT, label: 'Prof said', value: '<p></p>' },
      {
        type: BLOCK_TWO_COLUMN,
        section: true,
        colA: [{ type: BLOCK_TEXT, value: h3('Definitions') }],
        colB: [{ type: BLOCK_TEXT, value: h3('Examples') }],
      },
      { type: BLOCK_CHECKLIST, section: true, value: `<h2>To review</h2>${EMPTY_TASKS}` },
    ],
  },
  {
    id: 'reading',
    label: 'Reading',
    kind: 'Reading',
    blocks: [
      { type: BLOCK_TEXT, section: true, value: h2('Source') },
      { type: BLOCK_TEXT, section: true, value: h2('Summary') },
      { type: BLOCK_CALLOUT, label: 'Quote', value: '<p></p>' },
      { type: BLOCK_CHECKLIST, section: true, value: `<h2>Questions</h2>${EMPTY_TASKS}` },
    ],
  },
  {
    id: 'review',
    label: 'Review',
    kind: 'Review',
    blocks: [
      { type: BLOCK_CHECKLIST, section: true, value: `<h2>Topics</h2>${EMPTY_TASKS}` },
      { type: BLOCK_TEXT, section: true, value: h2('Formulas') },
      { type: BLOCK_MATH, value: '' },
      { type: BLOCK_CALLOUT, label: 'Weak spot', value: '<p></p>' },
      { type: BLOCK_TEXT, section: true, value: h2('Practice') },
    ],
  },
];

// A note counts as blank — and so shows the template row — while it is exactly one empty
// text block with nothing on the board. The row goes the moment anything is written.
export const isBlankPage = (pageBlocks = [], photoCount = 0) =>
  photoCount === 0 &&
  pageBlocks.length === 1 &&
  (pageBlocks[0]?.type || BLOCK_TEXT) === BLOCK_TEXT &&
  !stripHtml(pageBlocks[0]?.value);

const copyOptional = (from, to) => {
  if (from.label !== undefined) to.label = from.label;
  if (from.lang !== undefined) to.lang = from.lang;
  return to;
};

// Fresh blocks from a structure: new ids everywhere, and the first block always opens §1.
export const instantiate = (structure = []) =>
  structure.map((block, index) => {
    const type = block.type || BLOCK_TEXT;
    const out = copyOptional(block, {
      id: newBlockId(),
      type,
      value: block.value || '',
      section: index === 0 ? true : Boolean(block.section),
    });
    if (type === BLOCK_TWO_COLUMN) {
      const child = (item) =>
        copyOptional(item, { id: newBlockId(), type: item.type || BLOCK_TEXT, value: item.value || '' });
      out.colA = (block.colA || []).map(child);
      out.colB = (block.colB || []).map(child);
    }
    return out;
  });

// TipTap writes well-formed HTML, so headings can be lifted out without a parser.
const HEADINGS = /<h[1-3][^>]*>[\s\S]*?<\/h[1-3]>/gi;
const keepHeadings = (html) => (String(html || '').match(HEADINGS) || []).join('');

// "Save this note's structure": what shape the note has, none of what it says.
const skeleton = (block) => {
  const type = block.type || BLOCK_TEXT;
  const out = copyOptional(block, { type });
  if (block.section) out.section = true;
  if (type === BLOCK_TWO_COLUMN) {
    out.value = '';
    out.colA = (block.colA || []).map(skeleton);
    out.colB = (block.colB || []).map(skeleton);
  } else if (type === BLOCK_CHECKLIST) {
    out.value = keepHeadings(block.value) + EMPTY_TASKS;
  } else if (type === BLOCK_CODE || type === BLOCK_MATH || type === BLOCK_IMAGE) {
    out.value = '';
  } else {
    out.value = `${keepHeadings(block.value)}<p></p>`;
  }
  return out;
};

export const structureOf = (pageBlocks = []) => pageBlocks.map(skeleton);

// Saved templates from the profile, oldest first so the row does not reshuffle.
export const savedTemplates = (map) =>
  Object.values(map && typeof map === 'object' ? map : {})
    .filter((template) => template?.id && Array.isArray(template.blocks))
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
