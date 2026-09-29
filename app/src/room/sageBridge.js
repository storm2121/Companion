// The room's half of Sage (step 7).
//
// The callable — `sageImprove`, shared with classic — understands two kinds of block:
// "text" with HTML in `value`, and "image". A room page has seven. So the room translates,
// both ways, and the server is not touched (no deploy):
//
//   OUT  every page block becomes a text block: a callout carries its label as the title,
//        code goes as <pre><code>, math as a paragraph, a checklist as its list HTML, and a
//        two-column block goes as its children, one by one. Board photos never go — they
//        hang where you put them and Sage has no say in that.
//   BACK each answer lands on the block it came from, in that block's own shape (code stays
//        code, a checklist stays a checklist, a column child stays in its column); a NEW
//        block takes its type from the role Sage gave it; and a rebuilt page opens a
//        section at every real heading.
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
  createBlock,
  decodeEntities,
  pageBlocksOf,
  railBlocksOf,
  stripHtml,
} from './pageBlocks.js';

// The callable refuses more than this many blocks in one call (MAX_BLOCKS server-side).
export const SAGE_MAX_BLOCKS = 160;

const escapeHtml = (text) =>
  String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

// Text out of HTML with its line breaks KEPT — for code and math, where a newline matters.
export const htmlToLines = (html) =>
  decodeEntities(
    String(html || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(?:p|div|li|h[1-6]|pre)>/gi, '\n')
      .replace(/<[^>]*>/g, ''),
  )
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/* ── Out ──────────────────────────────────────────────────────────────────── */

const outOne = (block) => {
  const base = { id: block.id, type: 'text', title: '', value: block.value || '' };
  if (block.type === BLOCK_IMAGE) return { id: block.id, type: 'image', title: '', value: '' };
  if (block.type === BLOCK_CODE) {
    return { ...base, title: block.lang ? `Code (${block.lang})` : 'Code', value: `<pre><code>${escapeHtml(block.value)}</code></pre>` };
  }
  if (block.type === BLOCK_MATH) return { ...base, title: 'Formula', value: `<p>${escapeHtml(block.value)}</p>` };
  if (block.type === BLOCK_CALLOUT) return { ...base, title: block.label || '' };
  return base;
};

export const toSageBlocks = (blocks = []) =>
  pageBlocksOf(blocks).flatMap((block) =>
    block.type === BLOCK_TWO_COLUMN ? [...(block.colA || []), ...(block.colB || [])].map(outOne) : [outOne(block)],
  );

// Enough words for Sage to work with (classic's rule: more than 20 characters of text).
export const hasSageText = (outgoing = []) =>
  outgoing.reduce((total, block) => total + (block.type === 'text' ? stripHtml(block.value, Infinity).length : 0), 0) > 20;

/* ── Back: one block ──────────────────────────────────────────────────────── */

// A list Sage returned for a checklist, turned back into a checklist. Each item keeps the
// tick it had in the same position; an item Sage added starts unticked.
export const asTaskList = (html, originalHtml = '') => {
  const source = String(html || '');
  if (/data-type="taskList"/.test(source)) return source;
  const ticks = [...String(originalHtml).matchAll(/data-checked="(true|false)"/g)].map((m) => m[1] === 'true');
  let items = [...source.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => m[1]);
  if (!items.length) {
    items = [...source.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => m[1]).filter((inner) => stripHtml(inner));
  }
  if (!items.length) return originalHtml || source;
  const body = items
    .map((inner, i) => {
      const content = /^\s*<p[\s>]/i.test(inner) ? inner : `<p>${inner}</p>`;
      return `<li data-type="taskItem" data-checked="${ticks[i] ? 'true' : 'false'}">${content}</li>`;
    })
    .join('');
  return `<ul data-type="taskList">${body}</ul>`;
};

// A block title, as the room shows one: a heading at the top of the block's own text —
// unless the text already opens with a heading.
const titled = (title, html, level = 3) => {
  const heading = String(title || '').trim();
  const body = html || '';
  if (!heading || /^\s*<h[1-6][\s>]/i.test(body)) return body;
  return `<h${level}>${escapeHtml(heading)}</h${level}>${body}`;
};

// An existing block, rewritten, in its own shape. `withTitle` is for a rebuilt page, where
// every block comes back with a title; a quick edit's optional title has nowhere to go on
// a text block and is dropped.
const reshape = (original, entry, withTitle = false) => {
  if (typeof entry?.value !== 'string' || original.type === BLOCK_IMAGE) return original;
  const value = entry.value;
  if (original.type === BLOCK_CODE || original.type === BLOCK_MATH) return { ...original, value: htmlToLines(value) };
  if (original.type === BLOCK_CALLOUT) {
    return { ...original, label: String(entry.title || '').trim() || original.label, value };
  }
  if (original.type === BLOCK_CHECKLIST) return { ...original, value: asTaskList(value, original.value) };
  return { ...original, value: withTitle ? titled(entry.title, value, entry.role === 'lead' ? 2 : 3) : value };
};

// A block the page did not have: its type comes from the role Sage gave it
// (dualmode.md §5 — caveat → callout, formula → math, example → code or callout,
// summary → callout, the rest → text).
export const blockForRole = (role, title, value) => {
  const html = String(value || '');
  const label = String(title || '').trim();
  if (role === 'caveat') return { ...createBlock(BLOCK_CALLOUT), label: label || 'Watch out', value: html };
  if (role === 'summary') return { ...createBlock(BLOCK_CALLOUT), label: label || 'In short', value: html };
  if (role === 'example') {
    if (/<pre[\s>]/i.test(html)) return { ...createBlock(BLOCK_CODE), lang: '', value: htmlToLines(html) };
    return { ...createBlock(BLOCK_CALLOUT), label: label || 'Example', value: html };
  }
  if (role === 'formula') {
    const plain = htmlToLines(html);
    // A "formula" that is really prose or a list stays text.
    if (plain && plain.length <= 240 && !/<(?:ul|ol|table)[\s>]/i.test(html)) {
      return { ...createBlock(BLOCK_MATH), value: plain };
    }
  }
  return { ...createBlock(BLOCK_TEXT), value: titled(label, html, role === 'lead' ? 2 : 3) };
};

/* ── Back: the whole answer ───────────────────────────────────────────────── */

// Every block the room sent, by id: page blocks, and column children with the two-column
// block that holds them.
const indexPage = (page) => {
  const byId = new Map();
  page.forEach((block) => {
    if (block.type === BLOCK_TWO_COLUMN) {
      [...(block.colA || []), ...(block.colB || [])].forEach((child) => byId.set(child.id, { block: child, parent: block.id }));
    } else {
      byId.set(block.id, { block, parent: '' });
    }
  });
  return byId;
};

// The page always opens a section.
const opensSection = (page) => page.map((block, i) => (i === 0 && !block.section ? { ...block, section: true } : block));

// "patch" and "reflow": edits land in place — inside a column if that is where the block
// lives — and new blocks go after the block Sage names (after its two-column block, for a
// column child), in the order Sage listed them. Works on a run of page blocks: the whole
// page, or one section of it. `top` is where a block with no anchor goes: the very top of
// the page, but just under a section's opening block, which stays the section's title.
const editPage = (page, result, { reshapeOne, buildNew, anchorOf, top = '' }) => {
  const byId = indexPage(page);
  const edits = new Map();
  (Array.isArray(result.changed) ? result.changed : []).forEach((entry) => {
    const hit = byId.get(entry?.id);
    if (!hit || hit.block.type === BLOCK_IMAGE || edits.has(entry.id)) return;
    edits.set(entry.id, reshapeOne(hit.block, entry));
  });

  let next = page.map((block) => {
    if (block.type !== BLOCK_TWO_COLUMN) return edits.get(block.id) || block;
    const swap = (list) => (list || []).map((child) => edits.get(child.id) || child);
    const touched = [...(block.colA || []), ...(block.colB || [])].some((child) => edits.has(child.id));
    return touched ? { ...block, colA: swap(block.colA), colB: swap(block.colB) } : block;
  });

  let added = 0;
  const lastAfter = new Map();
  (Array.isArray(result.added) ? result.added : []).forEach((entry) => {
    if (!String(entry?.value || '').trim()) return;
    const fresh = buildNew(entry);
    const hit = byId.get(anchorOf(entry));
    const anchor = hit ? hit.parent || anchorOf(entry) : top;
    const after = lastAfter.get(anchor) ?? anchor;
    const at = after ? next.findIndex((block) => block.id === after) + 1 : 0;
    next = [...next.slice(0, at), fresh, ...next.slice(at)];
    lastAfter.set(anchor, fresh.id);
    added += 1;
  });

  return { mode: result.mode, blocks: opensSection(next), changed: edits.size, added };
};

// "layout": Sage rebuilt the page (or the section). It comes back whole, in reading order:
// continued blocks keep their shape, new ones take the type they are given, a run of
// paired blocks becomes two columns, and sections open where the answer says. Board
// photos are never part of it, and a photo on the page that Sage left out is kept at the
// end — it may drop words, never photos.
const rebuildPage = (page, entries, sent, { continued, buildNew, isPair, opens }) => {
  const byId = indexPage(page);
  const used = new Set();
  const out = [];
  let added = 0;
  let run = [];
  const flush = () => {
    if (run.length >= 2) {
      out.push({
        ...createBlock(BLOCK_TWO_COLUMN),
        colA: run.filter((_, i) => i % 2 === 0),
        colB: run.filter((_, i) => i % 2 === 1),
      });
    } else {
      out.push(...run);
    }
    run = [];
  };

  entries.forEach((entry) => {
    const hit = entry?.id && !used.has(entry.id) ? byId.get(entry.id) : null;
    let block;
    if (hit) {
      used.add(entry.id);
      block = continued(hit.block, entry);
    } else {
      if (!String(entry?.value || '').trim()) return;
      block = buildNew(entry);
      added += 1;
    }
    if (isPair(entry, block)) {
      run.push({ ...block, section: false });
      return;
    }
    flush();
    out.push({ ...block, section: opens(entry, block) });
  });
  flush();
  // Nothing usable came back (every entry empty): refuse it rather than wipe the page.
  if (!out.length) return null;

  byId.forEach(({ block }, id) => {
    if (block.type === BLOCK_IMAGE && !used.has(id)) out.push(block);
  });
  // Blocks written WHILE Sage was working were never sent, so its rebuild cannot know them:
  // they are kept, at the end, rather than lost. (`sent` = the ids that went out.)
  if (sent) {
    page.forEach((block) => {
      if (block.type === BLOCK_IMAGE || used.has(block.id) || sent.has(block.id)) return;
      if (block.type === BLOCK_TWO_COLUMN && [...(block.colA || []), ...(block.colB || [])].some((c) => sent.has(c.id))) return;
      out.push(block);
    });
  }

  return { mode: 'layout', blocks: opensSection(out), changed: used.size, added };
};

const opensWithHeading = (block) => block.type === BLOCK_TEXT && /^\s*<h2[\s>]/i.test(block.value || '');

// Classic's contract: roles, titles, `afterId`.
const CLASSIC = {
  reshapeOne: (original, entry) => reshape(original, entry),
  buildNew: (entry) => blockForRole(entry.role, entry.title, entry.value),
  anchorOf: (entry) => entry.afterId,
  continued: (original, entry) => reshape(original, entry, true),
  isPair: (entry, block) => entry.role === 'terms' && block.type === BLOCK_TEXT,
  opens: (entry, block) => opensWithHeading(block),
};

/* ── Back: the page path's answer (functions/lib/pageSage.js) ─────────────────
   Room types both ways: code and math come back as plain text, a callout with its
   label, a checklist as a list whose ticks are kept by position.                  */

// Plain text for code and math — unless the model wrapped it in HTML anyway.
const plainValue = (value) => {
  const raw = String(value || '');
  return /^\s*<(?:pre|p|code|div)[\s>]/i.test(raw) ? htmlToLines(raw) : raw.replace(/\r\n?/g, '\n').trim();
};

const reshapePage = (original, entry) => {
  if (typeof entry?.value !== 'string' || original.type === BLOCK_IMAGE) return original;
  const value = entry.value;
  if (original.type === BLOCK_CODE || original.type === BLOCK_MATH) return { ...original, value: plainValue(value) };
  if (original.type === BLOCK_CALLOUT) {
    return { ...original, label: String(entry.label || '').trim() || original.label, value };
  }
  if (original.type === BLOCK_CHECKLIST) return { ...original, value: asTaskList(value, original.value) };
  return { ...original, value };
};

// A block the page did not have. The page path names the room type itself.
export const blockForPageEntry = (entry) => {
  const value = String(entry?.value || '');
  if (entry?.type === 'callout') {
    return { ...createBlock(BLOCK_CALLOUT), label: String(entry.label || '').trim() || 'Note', value };
  }
  if (entry?.type === 'code') return { ...createBlock(BLOCK_CODE), lang: entry.lang || '', value: plainValue(value) };
  if (entry?.type === 'math') return { ...createBlock(BLOCK_MATH), value: plainValue(value) };
  if (entry?.type === 'checklist') return { ...createBlock(BLOCK_CHECKLIST), value: asTaskList(value) };
  return { ...createBlock(BLOCK_TEXT), value };
};

const PAGE = {
  reshapeOne: reshapePage,
  buildNew: blockForPageEntry,
  anchorOf: (entry) => entry.after,
  continued: reshapePage,
  isPair: (entry, block) => entry.pair === true && block.type === BLOCK_TEXT,
  opens: (entry, block) => entry.section === true || opensWithHeading(block),
};

// A room block as the page path reads it: its own type; code and math as plain text.
const pageOutOne = (block) => {
  const id = block.id;
  if (block.type === BLOCK_IMAGE) return { id, type: 'image' };
  if (block.type === BLOCK_CODE) return { id, type: 'code', lang: block.lang || '', value: block.value || '' };
  if (block.type === BLOCK_MATH) return { id, type: 'math', value: block.value || '' };
  if (block.type === BLOCK_CALLOUT) return { id, type: 'callout', label: block.label || '', value: block.value || '' };
  if (block.type === BLOCK_CHECKLIST) return { id, type: 'checklist', value: block.value || '' };
  return { id, type: 'text', value: block.value || '' };
};

export const toPageBlocks = (blocks = []) =>
  pageBlocksOf(blocks).flatMap((block) =>
    block.type === BLOCK_TWO_COLUMN ? [...(block.colA || []), ...(block.colB || [])].map(pageOutOne) : [pageOutOne(block)],
  );

/* ── One section at a time ───────────────────────────────────────────────────── */

// Where a section runs among the page's blocks: [start, end), from the block that opens it
// to the next one that opens a section. No section asked for: the whole page. One that is
// no longer there: null.
export const sectionBounds = (page, sectionId) => {
  if (!sectionId) return [0, page.length];
  const start = page.findIndex((block) => block.id === sectionId);
  if (start < 0) return null;
  let end = start + 1;
  while (end < page.length && !page[end].section) end += 1;
  return [start, end];
};

// The page blocks one run works on: the whole page, or one section of it.
export const sageScope = (blocks, sectionId = '') => {
  const page = pageBlocksOf(blocks);
  const bounds = sectionBounds(page, sectionId);
  return bounds ? page.slice(bounds[0], bounds[1]) : [];
};

// { mode, blocks, changed, added, note, tags } — or null when the answer cannot be used.
// `blocks` should be the page as it is NOW (edits made during the run survive a quick edit
// by id); `sent` — a Set of the ids that went out — lets a rebuild keep what was written
// meanwhile; `sectionId` confines the answer to that section, the rest of the page and the
// board untouched. Either contract is read: the page path's, or classic's (from a server
// deployed before the page path existed).
export const applySageResult = (blocks, result, { sent, sectionId = '' } = {}) => {
  if (!result || typeof result !== 'object') return null;
  const page = pageBlocksOf(blocks);
  const bounds = sectionBounds(page, sectionId);
  if (!bounds) return null;
  const [start, end] = bounds;
  const scope = page.slice(start, end);
  const rules = result.format === 'page' ? PAGE : CLASSIC;

  let applied = null;
  if (result.mode === 'layout') {
    const entries = Array.isArray(result.blocks) ? result.blocks : [];
    if (entries.length) applied = rebuildPage(scope, entries, sent, rules);
  } else if (result.mode === 'patch' || result.mode === 'reflow') {
    applied = editPage(scope, result, { ...rules, top: sectionId ? scope[0]?.id || '' : '' });
  }
  if (!applied) return null;

  return {
    ...applied,
    blocks: [...page.slice(0, start), ...applied.blocks, ...page.slice(end), ...railBlocksOf(blocks)],
    note: typeof result.note === 'string' ? result.note.trim() : '',
    tags: Array.isArray(result.tags) ? result.tags.filter((tag) => typeof tag === 'string') : [],
  };
};

// One line in the design's voice about what just happened.
export const sageSummary = (applied) => {
  if (!applied) return '';
  const blocksWord = (n) => `${n} ${n === 1 ? 'block' : 'blocks'}`;
  if (applied.mode === 'layout') return `Sage rebuilt the page — ${blocksWord(applied.changed + applied.added)}.`;
  if (applied.changed && applied.added) return `Sage changed ${blocksWord(applied.changed)} and added ${applied.added}.`;
  if (applied.added) return `Sage added ${blocksWord(applied.added)}.`;
  return `Sage changed ${blocksWord(applied.changed)}.`;
};
