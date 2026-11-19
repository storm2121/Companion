// The desk (Home prototype, "the desk in the room") — PURE. Where everything lies on the
// desk, how it is seen from the chair, which way its shadows fall and what ink a title takes.
//
// No DOM, no measuring (contextweb §5: measured geometry never goes into state). Two desks:
//   - phones and tablets (below 1100px): the stacked flow of rounds one and two, laid out by
//     desk.css; deskLayout() only says where the candle is, for the books' night shadows;
//   - wide screens (from 1100px): the stage, Blender's render of the room from the chair
//     (DeskStage.jsx; its geometry is scene.json's, its rules deskStage.js).

/* ── Breakpoints ──────────────────────────────────────────────────────────────────
   ≤ 760 the phone reflow; 761–1099 the same flow, wider; from 1100 the stage.
   desk.css uses the very same numbers.                                              */

export const DESK_PHONE_MAX = 760;
export const DESK_COMPACT_MIN = 1100;
export const DESK_WIDE_MIN = 1340;
export const DESK_HUGE_MIN = 1800;

export const BP_PHONE = 'phone';
export const BP_TABLET = 'tablet';
export const BP_COMPACT = 'compact';
export const BP_WIDE = 'wide';
export const BP_HUGE = 'huge';

// For matchMedia: the first query that matches names the breakpoint (none = huge).
export const DESK_MEDIA = [
  [BP_PHONE, `(max-width: ${DESK_PHONE_MAX}px)`],
  [BP_TABLET, `(max-width: ${DESK_COMPACT_MIN - 1}px)`],
  [BP_COMPACT, `(max-width: ${DESK_WIDE_MIN - 1}px)`],
  [BP_WIDE, `(max-width: ${DESK_HUGE_MIN - 1}px)`],
];

export const breakpointFor = (width) => {
  const w = Number(width) || 0;
  if (w <= DESK_PHONE_MAX) return BP_PHONE;
  if (w < DESK_COMPACT_MIN) return BP_TABLET;
  if (w < DESK_WIDE_MIN) return BP_COMPACT;
  if (w < DESK_HUGE_MIN) return BP_WIDE;
  return BP_HUGE;
};

export const isFlow = (breakpoint) => breakpoint === BP_PHONE || breakpoint === BP_TABLET;

/* ── Rows and tilts ───────────────────────────────────────────────────────────── */

export const BOOKS_PER_ROW = 3;

// Rows for `count` books AND the "+ New course" slot that always follows them.
export const rowsFor = (count, perRow = BOOKS_PER_ROW) =>
  Math.max(1, Math.ceil((Math.max(0, Math.floor(Number(count) || 0)) + 1) / Math.max(1, perRow)));

// Books lie a little askew, never more than 1.2°, and never at the same angle as the one
// before — including where the cycle starts again. Thirteen entries, so a row of three
// never lines up with the row above it.
const BOOK_TILTS = [-0.7, 0.5, -1.1, 0.2, 0.9, -0.4, 1.2, -0.9, 0.6, -0.2, 1.0, -1.2, 0.3];

export const bookTilt = (index = 0) =>
  BOOK_TILTS[Math.abs(Math.floor(Number(index) || 0)) % BOOK_TILTS.length];

/* ── The flow desks (phone, tablet) ──────────────────────────────────────────────────
   Below 1100px the desk stays the stacked flow of rounds one and two — the same materials,
   the real candle and the notebook's page, laid out by desk.css in the page's own flow. The
   stage (DeskStage.jsx) is for wide screens only, where it earns its cost. These reference
   grids only say roughly where each book lies relative to the candle (in the desk's top-right
   corner there), so its night shadow falls the right way.                                  */

const round = (n) => Math.round(n * 10) / 10;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

const FLOWS = {
  [BP_PHONE]: { stage: 460, cols: 2, width: 150, gap: 20, top: 560 },
  [BP_TABLET]: { stage: 900, cols: 4, width: 140, gap: 24, top: 420 },
};

// Everything on a flow desk for `count` courses (a wide breakpoint is laid out as the tablet:
// the wide screens use sceneLayout).
export const deskLayout = ({ count = 0, breakpoint = BP_TABLET } = {}) => {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  const f = FLOWS[breakpoint] || FLOWS[BP_TABLET];
  const height = round((f.width * 4) / 3);
  return {
    breakpoint,
    flow: true,
    rows: rowsFor(n, f.cols),
    candle: { x: f.stage - 36, y: 18 },
    books: Array.from({ length: n }, (_, i) => ({
      index: i,
      deskX: (i % f.cols) * (f.width + f.gap),
      deskY: f.top + Math.floor(i / f.cols) * (height + f.gap),
      width: f.width,
      height,
    })),
    light: null,
    height: 0,
  };
};

/* ── Shadows on the flow desks ────────────────────────────────────────────────────
   By candlelight a book's shadow falls AWAY from the flame: longer, softer and fainter the
   further away it lies. By day the light is the window's, high and to the left: a short,
   soft shadow down and to the right, the same for everything.                       */

export const DAY_SHADOW = { dx: 3, dy: 6, blur: 12, alpha: 0.3 };

// `slot` and `candle` share one coordinate system: { x, y, width, height } and { x, y }.
export const castShadow = (slot, candle, { night = true } = {}) => {
  if (!night || !slot || !candle) return { ...DAY_SHADOW };
  const cx = (slot.x ?? 0) + (slot.width ?? 0) / 2;
  const cy = (slot.y ?? 0) + (slot.height ?? 0) / 2;
  const vx = cx - candle.x;
  const vy = cy - candle.y;
  const d = Math.hypot(vx, vy) || 1;
  const length = clamp(8 + d * 0.014, 8, 28);
  return {
    dx: round((vx / d) * length),
    dy: round((vy / d) * length),
    blur: round(clamp(8 + d * 0.012, 8, 26)),
    alpha: Math.round(clamp(0.62 - d / 4000, 0.3, 0.6) * 100) / 100,
  };
};

/* ── Cloth and ink ────────────────────────────────────────────────────────────────
   A course's colour becomes its book's cloth: deeper and quieter than the dot on a sheet
   (book cloth is dyed, not printed), then the cloth texture multiplies over it in
   desk.css. The title takes whichever ink reads best on the cloth AS DRAWN — through the
   texture's lightest and darkest threads, by day and under the night's dimming — and the
   cloth is deepened further until that ink holds at least 4.5:1.                   */

export const INK_LIGHT = '#f4ecdd';
export const INK_DARK = '#1d1611';

// The cloth tile's mean and spread (cloth.webp, see assets/desk/README.md), and the
// night's dimming: a flat warm shade laid over every cover at this alpha (desk.css).
export const CLOTH_MEAN = 0.875;
export const CLOTH_SPREAD = 0.09;
export const NIGHT_SHADE = [24 / 255, 14 / 255, 6 / 255];
export const NIGHT_SHADE_ALPHA = 0.3;
export const MIN_CONTRAST = 4.5;

const FALLBACK = [0.45, 0.4, 0.36];

const toLinear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toGamma = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

const oklabToSrgb = (L, a, b) => {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return lin.map((v) => clamp(toGamma(clamp(v, 0, 1)), 0, 1));
};

const srgbToOklab = ([r, g, b]) => {
  const [R, G, B] = [r, g, b].map(toLinear);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
};

// '#rgb', '#rrggbb', 'rgb(…)' or 'oklch(…)' (classic's palette) → sRGB 0–1, or null.
export const parseColor = (value) => {
  const text = String(value || '').trim().toLowerCase();
  let match = text.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (match) {
    const hex = match[1].length === 3 ? [...match[1]].map((ch) => ch + ch).join('') : match[1];
    return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  }
  match = text.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/);
  if (match) return match.slice(1, 4).map((v) => clamp(Number(v) / 255, 0, 1));
  match = text.match(/^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)/);
  if (match) {
    const L = Number(match[1]) / (match[2] ? 100 : 1);
    const C = Number(match[3]);
    const h = (Number(match[4]) * Math.PI) / 180;
    return oklabToSrgb(L, C * Math.cos(h), C * Math.sin(h));
  }
  return null;
};

// A colour's OKLCH: [L 0-1, chroma, hue in degrees 0-360], or null.
export const oklchOf = (value) => {
  const rgb = parseColor(value);
  if (!rgb) return null;
  const [L, a, b] = srgbToOklab(rgb);
  return [L, Math.hypot(a, b), ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360];
};

export const luminance = ([r, g, b]) =>
  0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);

export const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const toHex = (rgb) =>
  `#${rgb.map((v) => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0')).join('')}`;
const scale = (rgb, k) => rgb.map((v) => clamp(v * k, 0, 1));
const nightOf = (rgb) =>
  rgb.map((v, i) => v * (1 - NIGHT_SHADE_ALPHA) + NIGHT_SHADE[i] * NIGHT_SHADE_ALPHA);

// The worst contrast an ink meets on a cover of base colour `tone`: the cloth's lightest
// threads by day for a light ink, its darkest under the night's shade for a dark one.
const worstContrast = (tone, ink) => {
  const drawn = scale(tone, CLOTH_MEAN);
  if (ink === INK_LIGHT) return contrast(parseColor(INK_LIGHT), scale(drawn, 1 + CLOTH_SPREAD));
  return contrast(parseColor(INK_DARK), nightOf(scale(drawn, 1 - CLOTH_SPREAD)));
};

const bestInk = (tone) => {
  const light = worstContrast(tone, INK_LIGHT);
  const dark = worstContrast(tone, INK_DARK);
  return light >= dark ? { ink: INK_LIGHT, worst: light } : { ink: INK_DARK, worst: dark };
};

const coverRgb = (color) => {
  const [L, a, b] = srgbToOklab(parseColor(color) || FALLBACK);
  const C = Math.hypot(a, b);
  const h = Math.atan2(b, a);
  const chroma = Math.min(C * 0.62, 0.1);
  let lightness = clamp(L * 0.86, 0.3, 0.66);
  let tone = oklabToSrgb(lightness, chroma * Math.cos(h), chroma * Math.sin(h));
  // Deepen until the title holds. 40 steps of 0.012 reach the floor from anywhere.
  for (let step = 0; step < 40 && bestInk(tone).worst < MIN_CONTRAST; step += 1) {
    lightness = Math.max(0.2, lightness - 0.012);
    tone = oklabToSrgb(lightness, chroma * Math.cos(h), chroma * Math.sin(h));
  }
  return tone;
};

// The cloth's base colour for a course (before the texture multiplies over it).
export const coverTone = (color) => toHex(coverRgb(color));

// A course's colour as a dye for cloth, in sRGB 0-1 (the stage's slabs, deskStage.spineInk): the
// covers' restraint — chroma at most 0.62x and never above 0.1 (OKLab) — at the colour's own
// lightness, since the render's grey cloth then darkens and shades it.
export const clothDye = (color) => {
  const [L, a, b] = srgbToOklab(parseColor(color) || FALLBACK);
  const C = Math.hypot(a, b);
  const h = Math.atan2(b, a);
  const chroma = Math.min(C * 0.62, 0.1);
  return oklabToSrgb(L, chroma * Math.cos(h), chroma * Math.sin(h));
};

// The book's back board, seen under its page block: the same cloth, in shadow.
export const coverBoard = (color) => toHex(scale(coverRgb(color), 0.55));

// The title's ink for a course's book, chosen on the cover as drawn.
export const coverInk = (color) => bestInk(coverRgb(color)).ink;

// The contrast the title is guaranteed on that cover (for the tests and the curious).
export const coverContrast = (color) => bestInk(coverRgb(color)).worst;

/* ── Titles ───────────────────────────────────────────────────────────────────────
   A cover holds ~90px of text across. A long name steps down in size, and so does one
   whose longest word would not fit the cover at full size — a title is never broken
   inside a word. Word widths are COUNTED from rough letter widths of Bricolage 600 (em),
   with a margin, never measured. desk.css clamps to five lines as a last resort.    */

export const TITLE_MIN = 12.5;

const letterEm = (ch) => {
  if (/[mwMW@%]/.test(ch)) return 0.88;
  if (/[il.,;:!|'’`]/.test(ch)) return 0.28;
  if (/[ftrIj()[\]]/.test(ch)) return 0.38;
  if (/[A-Z]/.test(ch)) return 0.68;
  if (/[0-9]/.test(ch)) return 0.6;
  return 0.58;
};

export const wordEm = (word) => [...String(word || '')].reduce((sum, ch) => sum + letterEm(ch), 0);

export const titleSize = (name, textWidth = 90, base = 18.5) => {
  const text = String(name || '').trim();
  const widest = text.split(/\s+/).reduce((max, word) => Math.max(max, wordEm(word)), 0);
  const length = [...text].length;
  let size = base;
  if (length > 16) size = base - 1.5;
  if (length > 28) size = base - 3;
  if (length > 40) size = base - 4.5;
  // 6% to spare: browsers round, and a cover's text box is never quite its nominal width.
  const fits = Math.floor(((textWidth * 0.94) / Math.max(1, widest)) * 2) / 2;
  return Math.max(TITLE_MIN, Math.min(size, fits));
};

// A title in Arabic or Hebrew reads right to left — and its book is bound on the right.
// The first strong character decides, as dir="auto" does.
export const textDirection = (text) => {
  for (const ch of String(text || '')) {
    if (/[֐-ࣿיִ-﷿ﹰ-ﻼ]/.test(ch)) return 'rtl';
    if (/[A-Za-zÀ-ɏͰ-ϿЀ-ӿ]/.test(ch)) return 'ltr';
  }
  return 'ltr';
};
