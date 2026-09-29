// What a paste brings into a note, cleaned before it lands.
//
// Every other program fills the clipboard with its own idea of a page: Google Docs wraps
// its text in fonts, sizes and colours and ends it with a <br>; Word writes an empty line as
// <o:p>&nbsp;</o:p>; VS Code puts a <br> line above the text; plain text arrives with
// newlines at both ends. ProseMirror keeps all of it, faithfully — so a pasted line landed
// with empty lines above and below it, in Arial 11pt, or light grey on the paper.
// (Reproduced in the room-harness with each of those clipboards.)
//
// NO PASTE BRINGS AN EMPTY LINE, wherever it came from — not at its start, not at its end,
// not in between. The room's paragraphs are already spaced; an empty one is only ever a gap.
// That holds for copies made in a ProseMirror editor too (a note here, classic, ChatGPT's box,
// any TipTap app): a selection dragged over a line takes the empty lines around it along, and
// a copy of several lines from a note that already has gaps carries them inside. The owner
// hit both, one after the other, before this became the rule. An "empty" line is one with no
// words: nothing, spaces, &nbsp;, an invisible zero-width character (Teams, Notion, Outlook
// write those), or only line breaks. Runs of line breaks inside a paragraph collapse to one.
// Tables are left whole — their empty cells are their shape.
//
// A paste from OUTSIDE any such editor also loses the source's look: it keeps its STRUCTURE —
// paragraphs, headings, lists, tables, links, bold / italic / underline / strike, alignment —
// and nothing else: no foreign fonts, sizes or colours. A ProseMirror copy keeps its marks.
//
// Pure except `cleanPastedHtml`, which needs the browser's DOMParser: the rest is loaded by
// tests/room.unit.test.mjs under Node.

import { Fragment, Slice } from '@tiptap/pm/model';

// Formatting worth keeping — what the room itself can express — and only when it says
// something: Google Docs writes font-weight:400 on every span, which would otherwise keep
// an empty style span around each paste. Everything else in a style attribute
// (font-family, font-size, color, line-height, margins…) is the source's look.
const BOLD = /^(bold|bolder|[6-9]\d\d)$/;
const NOT_BOLD = /^(normal|lighter|[1-5]\d\d)$/;
const KEEP_STYLES = {
  'font-style': /^(italic|oblique)/,
  'text-decoration': /underline|line-through/,
  'text-decoration-line': /underline|line-through/,
  'text-align': /^(center|right|justify)$/,
};

// "font-size: 11pt; font-weight: 700" → "font-weight: 700". Read the way ProseMirror reads a
// style attribute: declarations as written, not the browser's expanded longhands. A normal
// weight is kept only `insideBold`, where it un-bolds that stretch.
export const keptStyle = (style = '', { insideBold = false } = {}) =>
  String(style)
    .split(';')
    .map((part) => part.trim())
    .filter((part) => {
      const at = part.indexOf(':');
      if (at <= 0) return false;
      const name = part.slice(0, at).trim().toLowerCase();
      const value = part.slice(at + 1).trim().toLowerCase().replace(/\s*!important$/, '');
      if (name === 'font-weight') return BOLD.test(value) || (insideBold && NOT_BOLD.test(value));
      return Boolean(KEEP_STYLES[name]?.test(value));
    })
    .join('; ');

// Copied from a ProseMirror editor: this app's (a note, classic) or another app's.
export const isFromProseMirror = (html) => /\bdata-pm-slice\b/.test(String(html || ''));

// THE cause of the owner's gaps (their real clipboard, read on 2026-09-29): Chrome on
// Windows hands a paste the whole CF_HTML page around the copy —
//   <html>\r\n<body>\r\n<!--StartFragment--><p data-pm-slice="1 1 []">…</p><!--EndFragment-->\r\n</body>\r\n</html>
// ProseMirror KEEPS whitespace when parsing its own copies, and this schema turns kept
// newlines into line breaks — so those four newlines arrived as two line breaks on either
// side of the paragraph, loose at the top of the paste, and became an empty line above and
// below every line copied inside the app. Only what lies between the markers is the copy.
const FRAGMENT_START = '<!--StartFragment-->';
const FRAGMENT_END = '<!--EndFragment-->';
export const clipboardFragment = (html) => {
  const source = String(html ?? '');
  const start = source.indexOf(FRAGMENT_START);
  const end = source.lastIndexOf(FRAGMENT_END);
  if (start < 0 || end < start) return source;
  return source.slice(start + FRAGMENT_START.length, end);
};

// Plain text: newlines at either end are nothing but empty paragraphs.
export const cleanPastedText = (text) =>
  String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/^\n+|\n+$/g, '');

// The HTML half, before ProseMirror parses it.
export const cleanPastedHtml = (html) => {
  if (!html || isFromProseMirror(html) || typeof DOMParser === 'undefined') return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  // Word's paragraph markers, and everything that is page furniture rather than text — a
  // web page's buttons and form fields (this app's own, in a drag across two blocks) too.
  doc
    .querySelectorAll('meta, style, script, title, link, o\\:p, button, input, select, textarea, svg, [aria-hidden="true"]')
    .forEach((node) => node.remove());
  // <b style="font-weight:normal"> is not bold — Google Docs wraps every copy in one. Unwrap
  // it: with its style gone it would read as bold, and so would the whole paste.
  doc.querySelectorAll('b, strong').forEach((el) => {
    if (NOT_BOLD.test((el.style.fontWeight || '').trim().toLowerCase())) el.replaceWith(...el.childNodes);
  });
  doc.querySelectorAll('[style]').forEach((el) => {
    const kept = keptStyle(el.getAttribute('style'), { insideBold: Boolean(el.parentElement?.closest('b, strong')) });
    if (kept) el.setAttribute('style', kept);
    else el.removeAttribute('style');
  });
  // <font color="…" face="…"> is all look and no structure.
  doc.querySelectorAll('font').forEach((el) => el.replaceWith(...el.childNodes));
  return doc.body.innerHTML;
};

/* ── The parsed half ────────────────────────────────────────────────────────── */

const isBreak = (node) => node.type.name === 'hardBreak';

// Characters that draw nothing: zero-width space, non-joiner and joiner, word joiner, BOM.
const INVISIBLE = /[\u200b-\u200d\u2060\ufeff]/g;

// A line with no words in it: a paragraph or heading that is empty, spaces, &nbsp;, invisible
// characters or nothing but line breaks. (An empty code block is a visible box: content.)
const isBlankLine = (node) => {
  if (!node.isTextblock || node.type.spec.code) return false;
  let blank = true;
  node.forEach((child) => {
    if (child.isText ? /\S/.test(child.text.replace(INVISIBLE, '')) : !isBreak(child)) blank = false;
  });
  return blank;
};

// A line's breaks: none at its edges, and never two in a row — a run of them IS an empty line.
const tidyBreaks = (node) => {
  if (node.type.spec.code || !node.childCount) return node;
  const children = [];
  node.forEach((child) => children.push(child));
  const kept = [];
  children.forEach((child) => {
    if (isBreak(child) && (!kept.length || isBreak(kept[kept.length - 1]))) return;
    kept.push(child);
  });
  while (kept.length && isBreak(kept[kept.length - 1])) kept.pop();
  return kept.length === children.length ? node : node.copy(Fragment.fromArray(kept));
};

// One node of a paste, with every empty line in it gone — down through lists, list items and
// quotes. A container left with nothing in it goes too; one that cannot do without what was
// taken (a list item must open with a paragraph) is left exactly as it was.
const tidyNode = (node) => {
  if (node.isTextblock) return tidyBreaks(node);
  if (node.isLeaf || node.type.spec.tableRole) return node;
  const kept = [];
  node.forEach((child) => {
    if (isBlankLine(child)) return;
    const tidied = tidyNode(child);
    if (tidied) kept.push(tidied);
  });
  if (!kept.length) return null;
  const content = Fragment.fromArray(kept);
  if (content.eq(node.content)) return node;
  return node.type.validContent(content) ? node.copy(content) : node;
};

// Filler at the top of a paste: a line break, or text that is only whitespace.
const isFiller = (node) => isBreak(node) || (node.isText && !/\S/.test(node.text.replace(INVISIBLE, '')));

// The parsed paste with no empty line anywhere in it. Opened again the way ProseMirror opens
// any paste from outside — as far as it goes, stopping at an isolating node (a table) — so a
// single pasted line joins the line it lands on instead of splitting it.
//
// A paste can arrive with LOOSE line breaks at its top level, beside its paragraphs — what a
// clipboard wrapper's newlines become (see clipboardFragment). Such filler only counts BETWEEN
// two pieces of text (a line break inside a copied line, a space between two marked words);
// at an edge or next to a block it is only a gap, and a run of breaks is kept as one.
export const tidyPastedSlice = (slice) => {
  const nodes = [];
  slice.content.forEach((node) => nodes.push(node));
  const kept = [];
  nodes.forEach((node, i) => {
    if (isBlankLine(node)) return;
    if (isFiller(node)) {
      let before = i - 1;
      while (before >= 0 && isFiller(nodes[before])) before -= 1;
      let after = i + 1;
      while (after < nodes.length && isFiller(nodes[after])) after += 1;
      const between = before >= 0 && after < nodes.length && nodes[before].isInline && nodes[after].isInline;
      if (!between) return;
      if (isBreak(node) && kept.length && isBreak(kept[kept.length - 1])) return;
      kept.push(node);
      return;
    }
    const tidied = tidyNode(node);
    if (tidied) kept.push(tidied);
  });
  const content = Fragment.fromArray(kept);
  if (content.eq(slice.content)) return slice;
  if (!kept.length) return Slice.empty;
  return Slice.maxOpen(content, false);
};

// The editor props for one editor. ProseMirror runs `transformPasted` last for EVERY paste
// and also for a drag inside the editor; only the first two hooks see where a paste came
// from, so they note it for the third — and a drag (neither ran) is moved, not pasted, and
// left alone.
export const pasteProps = () => {
  let source = null;
  return {
    transformPastedHTML: (html) => {
      const fragment = clipboardFragment(html);
      source = isFromProseMirror(fragment) ? 'editor' : 'outside';
      return source === 'editor' ? fragment : cleanPastedHtml(fragment);
    },
    transformPastedText: (text, plain, view) => {
      source = 'outside';
      // Into a code block, text is code: its newlines are its own.
      return view?.state?.selection?.$from?.parent?.type?.spec?.code ? text : cleanPastedText(text);
    },
    transformPasted: (slice) => {
      const from = source;
      source = null;
      return from ? tidyPastedSlice(slice) : slice;
    },
  };
};
