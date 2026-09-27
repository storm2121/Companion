// Find in a room note — "2 OF 7", ← →, matches marked in the design's marker yellow.
//
// Two halves. The top half is pure (Node-testable in tests/room.unit.test.mjs); the bottom
// half walks the page's DOM and paints with the CSS Custom Highlight API, which marks text
// WITHOUT touching the editor's document — so finding can never dirty a note or trigger a save.
//
// Better than classic's find in one respect: text is joined per block before matching, so a
// word that is partly bold or partly a link ("hel<b>lo</b>") is still found. Classic
// matches inside single text nodes and misses those.

/* ── Pure ─────────────────────────────────────────────────────────────────── */

// Every case-insensitive occurrence of `query` in `text`, as [start, end) offsets.
// Non-overlapping, left to right — "aaa" in "aaaaaa" is two matches, not four.
export const findInText = (text = '', query = '') => {
  const q = query.toLowerCase();
  if (!q) return [];
  const lower = String(text).toLowerCase();
  const out = [];
  let at = lower.indexOf(q);
  while (at !== -1) {
    out.push([at, at + q.length]);
    at = lower.indexOf(q, at + q.length);
  }
  return out;
};

// Which segment an offset into the joined text falls in, and where inside it. `segments`
// are [{ start, length }] in order. An offset exactly at a boundary belongs to the segment
// that ENDS there when `preferEnd` is set (a range's end), and to the one that STARTS there
// otherwise (a range's start) — so a match never begins at the very end of a node.
export const locateOffset = (segments, offset, preferEnd = false) => {
  for (let i = 0; i < segments.length; i += 1) {
    const { start, length } = segments[i];
    const end = start + length;
    if (offset < end || (preferEnd && offset === end) || i === segments.length - 1) {
      return { index: i, offset: Math.min(Math.max(offset - start, 0), length) };
    }
  }
  return null;
};

// "2 of 7", or a plain "No match" — never "0 of 0".
export const findLabel = (index, count) => (count ? `${index + 1} of ${count}` : 'No match');

// Wraps around at both ends, as ← → should.
export const stepIndex = (index, count, delta) => (count ? (index + delta + count) % count : 0);

/* ── DOM ──────────────────────────────────────────────────────────────────── */

const HIGHLIGHT_ALL = 'room-find';
const HIGHLIGHT_CURRENT = 'room-find-current';

const canHighlight = () =>
  typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight !== 'undefined';

// Matches in the order they appear on the page. Prose becomes Ranges. Code and math live in
// <textarea>s, whose text no Range can reach: those matches point at the field, which is
// scrolled to and outlined when it is the current match.
export const collectMatches = (root, query) => {
  if (!root || !query) return [];
  const matches = [];
  root.querySelectorAll('.room-prose, .room-code-area').forEach((el) => {
    if (el.tagName === 'TEXTAREA') {
      findInText(el.value, query).forEach(([start, end]) => matches.push({ field: el, start, end }));
      return;
    }
    const nodes = [];
    const segments = [];
    let text = '';
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      nodes.push(node);
      segments.push({ start: text.length, length: node.nodeValue.length });
      text += node.nodeValue;
      node = walker.nextNode();
    }
    findInText(text, query).forEach(([start, end]) => {
      const from = locateOffset(segments, start);
      const to = locateOffset(segments, end, true);
      if (!from || !to) return;
      const range = document.createRange();
      range.setStart(nodes[from.index], from.offset);
      range.setEnd(nodes[to.index], to.offset);
      matches.push({ range });
    });
  });
  return matches;
};

export const paintMatches = (matches, current) => {
  document.querySelectorAll('.room-code-area.is-found').forEach((el) => el.classList.remove('is-found'));
  if (canHighlight()) {
    const ranges = matches.filter((m) => m.range).map((m) => m.range);
    CSS.highlights.set(HIGHLIGHT_ALL, new Highlight(...ranges));
    const here = matches[current];
    if (here?.range) CSS.highlights.set(HIGHLIGHT_CURRENT, new Highlight(here.range));
    else CSS.highlights.delete(HIGHLIGHT_CURRENT);
  }
  matches[current]?.field?.classList.add('is-found');
};

export const clearMatches = () => {
  if (canHighlight()) {
    CSS.highlights.delete(HIGHLIGHT_ALL);
    CSS.highlights.delete(HIGHLIGHT_CURRENT);
  }
  document.querySelectorAll('.room-code-area.is-found').forEach((el) => el.classList.remove('is-found'));
};

export const revealMatch = (match, still) => {
  const el = match?.field || match?.range?.startContainer?.parentElement;
  el?.scrollIntoView({ block: 'center', behavior: still ? 'auto' : 'smooth' });
};
