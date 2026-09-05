// Real block heights, measured instead of estimated.
//
// Sage used to make the model predict every block's height with
// `charsPerLine = floor(w / 8.2); h = 64 + lines * 24`. Actual line height in a text
// block is `fontSize 14 x lineHeight 1.4 = 19.6px`, so that formula over-estimated plain
// prose by ~20% (a band of dead air at the bottom of every block) while badly
// under-estimating headings, list padding, tables and `<pre>` code — which don't wrap —
// leaving their content cut off at the block edge behind a thin inner scrollbar.
//
// Only the browser knows how tall rendered HTML is: it has the fonts, the TipTap
// stylesheet and the real wrap width. So we render each block off-screen into the SAME
// classes the live editor uses (`note-textarea tiptap-editor`, see RichTextBlock's
// editorProps) and read the result back.

// .note-block-shell is `grid-template-rows: 28px minmax(0, 1fr)` with a 1px border and
// global border-box sizing, so the content row gets `h - 28 - 2`.
const BLOCK_CHROME = 30;
// The content element wraps inside the shell border, so it is 2px narrower than the block.
const BORDER_X = 2;
const MIN_TEXT_HEIGHT = 140;
const MAX_TEXT_HEIGHT = 1400;
const DEFAULT_FONT_SIZE = 14;
const DEFAULT_LINE_HEIGHT = 1.4;

let host = null;

// One reused off-screen host: creating and dropping a container per block would thrash
// layout on a 40-block note. `visibility: hidden` (not `display: none`) is required —
// a display-none subtree has no layout at all, so scrollHeight would read 0.
const getHost = () => {
  if (host && host.isConnected) return host;
  host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = [
    'position:absolute',
    'left:-99999px',
    'top:0',
    'visibility:hidden',
    'pointer-events:none',
    'contain:layout style',
  ].join(';');
  document.body.appendChild(host);
  return host;
};

// NOT scrollHeight. scrollHeight omits the trailing margin of the last child, and the
// editor stylesheet puts a margin on every paragraph (0.35em) and list (0.2em) — across
// eight or ten children that quietly lost 40-60px, which is exactly enough to cut the
// last bullet off the bottom of a block. The probe carries the editor's own padding, so
// child margins cannot collapse out through its edges: its own box height is the honest
// number.
const readProbeHeight = (probe) => Math.ceil(probe.getBoundingClientRect().height);

export const releaseMeasureHost = () => {
  if (host?.isConnected) host.remove();
  host = null;
};

/**
 * Natural height for one text block's HTML at a given width, including block chrome.
 * Returns null when the DOM is unavailable (SSR, tests) so callers can fall back.
 */
export const measureTextBlockHeight = (value, width, options = {}) => {
  if (typeof document === 'undefined') return null;
  const fontSize = Number.isFinite(options.fontSize) ? options.fontSize : DEFAULT_FONT_SIZE;
  const lineHeight = Number.isFinite(options.lineHeight) ? options.lineHeight : DEFAULT_LINE_HEIGHT;
  const probe = document.createElement('div');
  probe.className = 'note-textarea tiptap-editor';
  // The live editor fills its block (`height: 100%; overflow-y: auto`). For measurement
  // both must be released or scrollHeight reports the box, not the content.
  probe.style.cssText = [
    `width:${Math.max(80, Math.round(width) - BORDER_X)}px`,
    'height:auto',
    'max-height:none',
    'overflow:visible',
    `font-size:${fontSize}px`,
    `line-height:${lineHeight}`,
  ].join(';');
  probe.innerHTML = typeof value === 'string' ? value : '';
  const parent = getHost();
  parent.appendChild(probe);
  const content = readProbeHeight(probe);
  probe.remove();
  const total = content + BLOCK_CHROME;
  return Math.max(MIN_TEXT_HEIGHT, Math.min(total, MAX_TEXT_HEIGHT));
};

/**
 * Batch version: measures a list of `{ value, w, fontSize, lineHeight }` in one pass and
 * returns the heights in the same order. Kept as its own entry point so a whole layout
 * costs one style/layout flush rather than one per block.
 */
export const measureTextBlockHeights = (items = []) => {
  if (typeof document === 'undefined') return items.map(() => null);
  const parent = getHost();
  const probes = items.map((item) => {
    const probe = document.createElement('div');
    probe.className = 'note-textarea tiptap-editor';
    probe.style.cssText = [
      `width:${Math.max(80, Math.round(item?.w || 340) - BORDER_X)}px`,
      'height:auto',
      'max-height:none',
      'overflow:visible',
      `font-size:${Number.isFinite(item?.fontSize) ? item.fontSize : DEFAULT_FONT_SIZE}px`,
      `line-height:${Number.isFinite(item?.lineHeight) ? item.lineHeight : DEFAULT_LINE_HEIGHT}`,
    ].join(';');
    probe.innerHTML = typeof item?.value === 'string' ? item.value : '';
    parent.appendChild(probe);
    return probe;
  });
  // Read every height only after all writes, so the browser does one reflow.
  const heights = probes.map((probe) =>
    Math.max(MIN_TEXT_HEIGHT, Math.min(readProbeHeight(probe) + BLOCK_CHROME, MAX_TEXT_HEIGHT)),
  );
  probes.forEach((probe) => probe.remove());
  return heights;
};

export const MEASURE_LIMITS = { BLOCK_CHROME, MIN_TEXT_HEIGHT, MAX_TEXT_HEIGHT };
