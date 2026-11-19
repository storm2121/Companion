// The notebook's open page on the desk (prototype Home, RoomDesk): the first lines of the
// latest note, as plain text. PURE — tests/desk.unit.test.mjs loads it under Node.
//
// Read with the HTML reader markdownExport.js already has (the editors write well-formed
// HTML), one line per paragraph, heading or list item, so the page starts the way the note
// does. Prose only: a photo, a formula or a block of code would read as noise in four lines
// of text, and a template's empty headings-to-be (an empty callout) say nothing.

import { readHtml } from './markdownExport.js';
import { BLOCK_CALLOUT, BLOCK_CHECKLIST, BLOCK_TEXT, BLOCK_TWO_COLUMN, pageBlocksOf } from './pageBlocks.js';

// The page shows four lines (desk.css clamps them); a line is never longer than this.
export const PAGE_LINES = 4;
export const PAGE_LINE_CHARS = 240;

// The elements that end a line.
const BREAK = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'ul', 'ol', 'blockquote', 'pre', 'div',
  'table', 'tr', 'dt', 'dd', 'figcaption',
]);

const linesOfHtml = (html) => {
  const lines = [];
  let line = '';
  const flush = () => {
    const text = line.replace(/\s+/g, ' ').trim();
    if (text) lines.push(text);
    line = '';
  };
  const walk = (node) => {
    if (node.text !== undefined) {
      line += node.text;
      return;
    }
    if (node.tag === 'br') {
      flush();
      return;
    }
    const block = BREAK.has(node.tag);
    if (block) flush();
    (node.children || []).forEach(walk);
    if (block) flush();
  };
  walk(readHtml(html));
  flush();
  return lines;
};

const linesOf = (block) => {
  if (!block) return [];
  if (block.type === BLOCK_TWO_COLUMN) return [...(block.colA || []), ...(block.colB || [])].flatMap(linesOf);
  if (block.type === BLOCK_CALLOUT) {
    const [first, ...rest] = linesOfHtml(block.value);
    if (!first) return [];
    const label = String(block.label || '').trim();
    return [label ? `${label}: ${first}` : first, ...rest];
  }
  if (block.type === BLOCK_TEXT || block.type === BLOCK_CHECKLIST) return linesOfHtml(block.value);
  return [];
};

// The first `max` lines of a note's page (its blocks as getNote returns them), or [].
export const pageLines = (blocks, max = PAGE_LINES) => {
  const out = [];
  for (const block of pageBlocksOf(Array.isArray(blocks) ? blocks : [])) {
    for (const line of linesOf(block)) {
      out.push(line.length > PAGE_LINE_CHARS ? `${line.slice(0, PAGE_LINE_CHARS - 1).trimEnd()}…` : line);
      if (out.length >= max) return out;
    }
  }
  return out;
};
