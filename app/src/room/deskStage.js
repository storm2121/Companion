// The desk as a picture (prototype Home, DeskStage.jsx, wide screens) — PURE.
//
// Blender renders the room from one seated camera (room-harness/blender); the page lays the
// renders out as a 16:9 stage and puts its own words on the surfaces scene.json names. This
// module decides, from numbers alone (contextweb §5: never measured geometry), how the stage
// fits the window, which pile position each course takes, what leather a book is bound in, how
// its title is lettered on its spine and how much each notebook page holds.

import { contrast, oklchOf } from './deskLayout.js';

// The render's own px (scene.json's 1x): a NATIVE frame of 1800 x 1080 and inside it the DESIGN
// CROP, what a 1440 x 810 window shows (centred across; its offset down the frame is scene.json's).
export const NATIVE = { width: 1800, height: 1080 };
export const CROP = { x: 180, y: 88, width: 1440, height: 810 };
// Old name, kept for the flow of the code that reads the stage's size.
export const STAGE = NATIVE;

// The surround: the room rendered past the frame (3900 x 1320 stage px, the frame its centre),
// so no desktop window shows bars, 32:9 down to 5:4. Its extent in the frame's own px.
export const SURROUND = { x: -1050, y: -120, width: 3900, height: 1320 };
// The least scale and the cap (round seven: 0.7, the planner's pick over 0.6: the owner's 1536 x 750
// window holds the frame's height but 9 px with the notebook three rows deep; 0.6 spent a third of the
// screen on bare table). The words do not shrink with the picture: every word the page draws on the
// stage is at least TYPE_MIN css px at any scale (typeFloor), however small the picture is drawn.
export const S_MIN = 0.7;
export const S_MAX = 2.4;
export const TYPE_MIN = 13;
// The least size a word may have on the stage, in stage px (the page lays words out in stage px and
// the fit scales them): 13 / s (21.7 at 0.6, 14.4 at 0.9, 13 at 1).
export const typeFloor = (scale) => TYPE_MIN / Math.max(1e-6, Number(scale) || 1);

// How the stage fills a window of W x H css px (round six: the most room the window can hold).
// With E the frame's extent (the plain frame, or the surround once it is in):
// scale s = clamp(min(max(W/Ew, H/Eh), W/Cw, H/Ch), S_MIN, S_MAX): max(W/Ew, H/Eh) is the least
// scale at which the extent still covers the window, the min keeps the whole crop inside, S_MIN
// is the floor. The window then shows a REGION of W/s x H/s stage px: across, centred on the crop
// (the frame's own centre); down, inside the frame when it fits there (else inside the extent), as
// low as it can go while the crop's top stays in (the near table is kept before the wall's top); a
// region shorter than the crop keeps the crop's foot and loses its top. Bars (the wall's colour)
// only where the region leaves the extent.
// Returns the frame's box in the window ({ left, top, width, height }, css px), the region (stage
// px), whether it reaches past the plain frame (`surround`: then the surround is wanted), the bars
// (css px), where the crop lands and the type floor at this scale (`floor`, stage px: typeFloor).
export const stageFit = (viewWidth, viewHeight, native = NATIVE, crop = CROP, extent = null) => {
  const vw = Math.max(1, Number(viewWidth) || crop.width);
  const vh = Math.max(1, Number(viewHeight) || crop.height);
  const ext = extent || { x: 0, y: 0, width: native.width, height: native.height };
  const cover = Math.max(vw / ext.width, vh / ext.height);
  const scale = Math.min(Math.max(Math.min(cover, vw / crop.width, vh / crop.height), S_MIN), S_MAX);
  const rw = vw / scale;
  const rh = vh / scale;
  const x = crop.x + crop.width / 2 - rw / 2;
  const foot = ext.y + ext.height;
  let y;
  if (rh < crop.height) y = crop.y + crop.height - rh;
  else if (rh <= native.height) y = Math.min(native.height - rh, crop.y);
  else if (rh <= ext.height) y = Math.min(foot - rh, crop.y);
  else y = foot - rh;
  const bars = {
    left: Math.max(0, ext.x - x) * scale,
    right: Math.max(0, x + rw - (ext.x + ext.width)) * scale,
    top: Math.max(0, ext.y - y) * scale,
    bottom: Math.max(0, y + rh - foot) * scale,
  };
  const left = -x * scale;
  const top = -y * scale;
  return {
    scale,
    left,
    top,
    width: native.width * scale,
    height: native.height * scale,
    region: { x, y, width: rw, height: rh },
    surround: x < -0.5 || y < -0.5 || x + rw > native.width + 0.5 || y + rh > native.height + 0.5,
    bars,
    crop: { left: left + crop.x * scale, top: top + crop.y * scale, width: crop.width * scale, height: crop.height * scale },
    floor: typeFloor(scale),
  };
};

// Every kind of word the page draws on the stage and its own size (stage px, as designed at 1x).
// On the stage each takes max(its size, the floor): stageType. DeskStage hands them to desk.css as
// custom properties (--room-stage-type-<kind>), so the sizes the tests check are the ones drawn.
// The spines' titles and counts are fitted to their labels instead (fitSpineTitle, fitSpineCount,
// with spineFloor), and "and N more" by its spine's height (moreSize).
export const STAGE_TYPE = {
  greeting: 22,
  clock: 14.5,
  sentence: 14.5,
  heading: 16,
  rowTitle: 14.5,
  rowStamp: 14.5,
  meta: 14.5,
  pageTitle: 21,
  lines: 14.5,
  tags: 14.5,
  action: 14.5,
  empty: 14.5,
  cardInput: 16,
  cardFoot: 14.5,
  ghost: 17,
  frameAdd: 20,
};
export const stageType = (kind, scale) => Math.max(STAGE_TYPE[kind] ?? 14.5, typeFloor(scale));
// The spines' floor at a scale: never under 14.5 stage px (the picture's own proportion), never
// under the type floor (13 css px).
export const spineFloor = (scale) => Math.max(SPINE_FLOOR, typeFloor(scale));
// "and N more" on a spine `spineHeight` stage px tall: 0.4 of it, 14.5 to 16, and the floor.
export const moreSize = (spineHeight, scale) => Math.max(Math.min(16, Math.max(14.5, spineHeight * 0.4)), typeFloor(scale));

// The leather a course binds in (round six, the owner's pick: morocco with a label). The course
// colour's hue picks one of six leathers (its lightness does not: leather keeps leather's); a
// colour with next to no hue binds in black. The label is black morocco, as on most old spines;
// a black book's is a deep oxblood (round six: oxblood labels on navy books read as bright red).
export const LEATHERS = ['oxblood', 'chestnut', 'tan', 'bottle', 'navy', 'black'];
export const leatherOf = (color) => {
  const lch = oklchOf(color);
  if (!lch) return 'chestnut';
  const [, chroma, hue] = lch;
  if (chroma < 0.035) return 'black';
  if (hue >= 330 || hue < 30) return 'oxblood';
  if (hue < 65) return 'chestnut';
  if (hue < 110) return 'tan';
  if (hue < 200) return 'bottle';
  return 'navy';
};
export const labelOf = (leather) => (leather === 'black' ? 'oxblood' : 'black');

// The spine's lettering (round seven, run three, the planner's bounded check): EB Garamond Bold 700 in
// its true small caps (font-variant-caps: small-caps, its smcp; Google Fonts, the stage only), Arabic
// in Amiri 700 (EB Garamond has none), the impression and wear by size (DeskStage Gilt). On the
// 30-title set it cuts 5.0% at 1x and 44.6% at the least scale (Cormorant SC, round six: 7.6% and
// 48.9%; Spectral SC 600, run two: 28.8% and 63.9%); its M at the owner's window 0.465 against
// Spectral's 0.443 (room-harness/shots/c-09-face-check.json). Advance widths in thousandths of an
// em for printable ASCII (32-126), EB Garamond 700 small caps, and for the Arabic letters
// U+0621-U+064A as they stand inside a word (medial, between two tatweels), Amiri 700: measured once
// from the fonts with a canvas in the harness (room-harness/advances.html, 2026-10-29; kerning
// ignored, which only errs wide): derived, never measured on the page (contextweb section 5). An
// accented letter counts as its base letter; CJK as a full em; anything else as 0.62em. Round six
// counted every Arabic letter at that 0.62em default, which cut "تاريخ العالم العربي" to one word.
const SPINE_WIDTHS = [
  237, 290, 398, 484, 461, 702, 799, 237, 304, 304, 357, 601, 247, 316, 247, 406, 529, 529, 529,
  529, 529, 529, 529, 529, 529, 529, 282, 247, 541, 629, 541, 395, 781, 720, 626, 709, 766, 575,
  546, 719, 801, 364, 370, 763, 586, 917, 809, 760, 607, 760, 760, 494, 695, 745, 706, 1020, 750,
  654, 596, 356, 406, 356, 514, 590, 237, 504, 438, 496, 536, 403, 382, 503, 561, 255, 259, 534,
  410, 642, 566, 532, 425, 532, 532, 346, 486, 521, 494, 714, 525, 458, 417, 373, 276, 373, 545,
];
// Amiri 700, U+0621..U+064A (inside a word); its space 292.
const ARABIC_WIDTHS = [
  291, 326, 288, 344, 228, 243, 228, 243, 378, 243, 243, 609, 609, 609, 470, 470, 342, 342, 567, 567,
  721, 721, 550, 550, 365, 365, 587, 587, 243, 243, 243, 185, 377, 377, 587, 196, 462, 243, 389, 344, 243, 243,
];
export const SPINE_TRACK = 0.02;
const spineCharEm = (ch) => {
  const code = ch.normalize('NFD').charCodeAt(0);
  if (code >= 32 && code <= 126) return SPINE_WIDTHS[code - 32] / 1000;
  if (code >= 0x0621 && code <= 0x064a) return ARABIC_WIDTHS[code - 0x0621] / 1000;
  // Arabic marks (harakat) take no width of their own.
  if (code >= 0x064b && code <= 0x065f) return 0;
  if ((code >= 0x2e80 && code <= 0x9fff) || (code >= 0xac00 && code <= 0xd7af)) return 1;
  return 0.62;
};
// Arabic is drawn untracked (letter-spacing would break its joins: desk.css), so its letters take
// no tracking here either.
const isArabic = (ch) => {
  const code = ch.charCodeAt(0);
  return code >= 0x0600 && code <= 0x06ff;
};
export const spineMeasure = (text, size, track = SPINE_TRACK) =>
  [...String(text || '')].reduce((sum, ch) => sum + spineCharEm(ch) + (isArabic(ch) ? 0 : track), 0) * size * 1.02;

// A spine's title, generous and logical (ROUND6-BRIEF 2b), on its label (`width` x `height`, 1x
// px) of a spine `spineHeight` px tall: (1) one line at the base size if it fits; (2) else, on a
// spine at least 40px tall, two lines broken at a word, balanced, down to the floor; (3) else one
// line shrunk to the floor; (4) else the same with the words of SPINE_ABBREVIATIONS shortened;
// (4b) else the same without its function words (of, the, a, an, to, for, in, on; "and" as "&"):
// "Hist. Arab World", not a cut "Hist. of the Arab"; (5) else cut at the last word that fits, or
// one word sooner where a phrase ends there (a function word stood) and two words or more are
// kept ("Comparative Politics", not "Comparative Politics Middle"); no ellipsis (a gilt ellipsis
// looks wrong), a dangling "&" dropped; a lone word too long for the floor at its last letter that
// fits, with an abbreviation's stop. Never more than SPINE_CAP
// characters (a longer title is abbreviated, spared, then cut). The floor is the scale's (spineFloor:
// 14.5 stage px, more where the scale is under 0.9, so a word is never under 13 css px), and the base
// never under it. A label too low for one line at the floor holds no title (rule 'none'). The full
// title stays the book's accessible name.
// Returns { lines, size, rule }.
export const SPINE_CAP = 32;
export const SPINE_BASE = 17;
export const SPINE_FLOOR = 14.5;
export const SPINE_LINE = 0.94;
export const SPINE_ABBREVIATIONS = {
  History: 'Hist.',
  Introduction: 'Intro.',
  Mathematics: 'Math.',
  Philosophy: 'Phil.',
  Structures: 'Struct.',
  Algorithms: 'Algo.',
  Engineering: 'Eng.',
  Literature: 'Lit.',
  Economics: 'Econ.',
  Chemistry: 'Chem.',
  Biology: 'Bio.',
  Physics: 'Phys.',
  Linguistics: 'Ling.',
  Psychology: 'Psych.',
  Statistics: 'Stat.',
  Organic: 'Org.',
  Computer: 'Comp.',
  Science: 'Sci.',
  Foundations: 'Found.',
  Fundamentals: 'Fund.',
  Principles: 'Princ.',
  Advanced: 'Adv.',
  Laboratory: 'Lab.',
};
const LOOSE_ENDS = new Set(['the', 'a', 'an', 'and', '&']);
const DANGLING = new Set(['a', 'an', 'and', 'at', 'by', 'for', 'from', 'in', 'into', 'of', 'on', 'or', 'the', 'to', 'with', '&', '-', '–', ':']);
const ABBREVIATED = new Map(Object.entries(SPINE_ABBREVIATIONS).map(([word, short]) => [word.toLowerCase(), short]));

// The words a short title can do without, and "and" as "&" (step 4b); at least one word is kept.
// `breaks`: where a phrase ends in what is kept (a function word stood there, or "&" begins).
const FUNCTION_WORDS = new Set(['of', 'the', 'a', 'an', 'to', 'for', 'in', 'on']);
const spareWords = (text) => {
  const all = String(text || '').split(' ').filter(Boolean);
  const words = [];
  const breaks = new Set();
  all.forEach((word) => {
    const low = word.toLowerCase();
    if (FUNCTION_WORDS.has(low)) {
      if (words.length) breaks.add(words.length);
      return;
    }
    if (low === 'and' || word === '&') {
      if (words.length) breaks.add(words.length);
      words.push('&');
      return;
    }
    words.push(word);
  });
  return words.length ? { words, breaks } : { words: all, breaks: new Set() };
};
export const spareTitle = (text) => spareWords(text).words.join(' ');

// Every word of the table shortened (a trailing stop or comma kept, never doubled).
export const abbreviateTitle = (text) =>
  String(text || '')
    .split(' ')
    .map((word) => {
      const bare = word.replace(/[.,;:]+$/, '');
      const short = ABBREVIATED.get(bare.toLowerCase());
      if (!short) return word;
      return short + word.slice(bare.length).replace(/^\./, '');
    })
    .join(' ');

export const fitSpineTitle = (title, { width, height = Infinity, spineHeight = 0, base: baseSize = SPINE_BASE, floor = SPINE_FLOOR, lineHeight = SPINE_LINE, measure = spineMeasure } = {}) => {
  const base = Math.max(baseSize, floor);
  const text = String(title || '').trim().replace(/\s+/g, ' ');
  if (!text) return { lines: [], size: base, rule: 'empty' };
  if (height / lineHeight < floor - 1e-6) return { lines: [], size: floor, rule: 'none' };
  const sizeFor = (lines) => {
    const widest = Math.max(...lines.map((line) => measure(line, 100)));
    const byWidth = widest > 0 ? (100 * width) / widest : base;
    return Math.min(base, byWidth, height / (lines.length * lineHeight));
  };
  const fits = (size) => size >= floor - 1e-6;
  // Rules (1)-(3) for one wording, or null.
  const fit = (candidate) => {
    if ([...candidate].length > SPINE_CAP) return null;
    const one = sizeFor([candidate]);
    if (one >= base - 1e-6) return { lines: [candidate], size: base, rule: 'one' };
    if (spineHeight >= 40) {
      const words = candidate.split(' ');
      // A first line never ends on an article or "and" ("History of / the Arab World", not
      // "History of the / Arab World"), unless no other break holds.
      const loose = (k) => LOOSE_ENDS.has(words[k - 1].toLowerCase());
      const breaksAt = [...Array(words.length).keys()].slice(1);
      const tight = breaksAt.filter((k) => !loose(k));
      let best = null;
      for (const k of tight.length ? tight : breaksAt) {
        const lines = [words.slice(0, k).join(' '), words.slice(k).join(' ')];
        const size = sizeFor(lines);
        const balance = Math.abs(measure(lines[0], 100) - measure(lines[1], 100));
        if (fits(size) && (!best || size > best.size + 1e-6 || (Math.abs(size - best.size) <= 1e-6 && balance < best.balance))) best = { lines, size, balance };
      }
      // Two lines only when they hold a larger size than one line would.
      if (best && best.size > one + 1e-6) return { lines: best.lines, size: best.size, rule: 'two' };
    }
    return fits(one) ? { lines: [candidate], size: one, rule: 'shrink' } : null;
  };
  const whole = fit(text);
  if (whole) return whole;
  const short = abbreviateTitle(text);
  if (short !== text) {
    const fitted = fit(short);
    if (fitted) return { ...fitted, rule: `abbrev+${fitted.rule}` };
  }
  const { words, breaks } = spareWords(short);
  const spare = words.join(' ');
  if (spare !== short) {
    const fitted = fit(spare);
    if (fitted) return { ...fitted, rule: `spare+${fitted.rule}` };
  }
  const cutAt = (k) => {
    let end = k;
    while (end > 1 && DANGLING.has(words[end - 1].toLowerCase())) end -= 1;
    return fit(words.slice(0, end).join(' '));
  };
  for (let k = words.length - 1; k >= 1; k -= 1) {
    const fitted = cutAt(k);
    if (!fitted) continue;
    // A phrase's end one word sooner reads better than a phrase cut in its middle.
    const sooner = !breaks.has(k) && breaks.has(k - 1) && k - 1 >= 2 ? cutAt(k - 1) : null;
    const best = sooner || fitted;
    return { ...best, rule: `cut+${best.rule}` };
  }
  // A first word too long even alone: its letters that fit at the floor, and a stop.
  const letters = [...words[0]];
  let n = Math.min(letters.length, SPINE_CAP - 1);
  while (n > 1 && measure(`${letters.slice(0, n).join('')}.`, floor) > width) n -= 1;
  return { lines: [`${letters.slice(0, n).join('')}.`], size: floor, rule: 'cut-word' };
};

// "+ New course": the ghost of the next book, a dashed spine at the next free place on the shorter
// pile (the left on a tie; on an empty desk, L0). None once "and N more" holds the last place or
// both piles are full.
export const ghostPlace = (places, more = null) => {
  if (more) return null;
  const count = { L: 0, R: 0 };
  // Only the piles: a book brought closer (a near place) is on neither.
  (places || []).forEach((place) => {
    if (place[0] in count) count[place[0]] += 1;
  });
  const side = count.L <= count.R ? 'L' : 'R';
  const other = side === 'L' ? 'R' : 'L';
  if (count[side] < PILE_DEPTH) return `${side}${count[side]}`;
  return count[other] < PILE_DEPTH ? `${other}${count[other]}` : null;
};

// The gilt's tooling by its size on the screen (round seven, the planner's word after the lettering
// study): from TOOLED_PX device px a letter's size, round six's full tooled look (the mood's SVG
// impression, the wear as rendered: 2x screens, big windows, the near book's cover); under it (the
// stage at its least scale on an ordinary screen), where round six's lettering went soft (the
// impression's inner edges and the worn gold at 13 css px, not the rendering path), the press one
// device pixel below and the wear eased (DeskStage Gilt).
export const TOOLED_PX = 18;
export const giltSmall = (size, scale, dpr = 1) => size * scale * (Number(dpr) || 1) < TOOLED_PX;

// The 2x pictures when they will be drawn at 1.25 device px a stage px or more, else 1x (and 1x
// when the browser asks to save data).
export const pictureDensity = (scale, dpr = 1, saveData = false) => (!saveData && scale * (Number(dpr) || 1) >= 1.25 ? 2 : 1);

// Two piles of up to twelve. Courses alternate, left then right, so both piles grow together.
// Past twenty-four courses, twenty-three books and "and N more" (opening All notes) as the last
// place. "+ New course" is the ghost of the next book (ghostPlace).
export const PILE_DEPTH = 12;
export const PLACES = Array.from({ length: PILE_DEPTH * 2 }, (_, k) => `${k % 2 ? 'R' : 'L'}${k >> 1}`);

export const pilePlaces = (count) => {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  const capacity = PLACES.length;
  const books = n <= capacity ? n : capacity - 1;
  const more = n - books;
  return {
    books: PLACES.slice(0, books),
    more: more > 0 ? { place: PLACES[books], count: more } : null,
  };
};

// The NEAR places (round seven): a book brought closer lies flat on the near table, cover up, in
// front of the piles (scene.json nearPlaces; one, the planner's gate B). Only the student puts a book
// there (the menu, a drag, Ctrl K, Alt + Enter); a near place holds one book.
export const NEAR_PLACES = ['N0'];
const NEAR_SET = new Set(NEAR_PLACES);
export const isNearPlace = (place) => NEAR_SET.has(place);

// The arrangement a student chose (roomPrefs.deskPlaces: courseId -> 'L0'..'R11' or a near place).
// A book saved on a near place keeps it (the first in course order; one book a place). Courses with
// a saved pile place keep it; the rest fill the free pile places in course order as above (never a
// near place); then each pile SETTLES — books stack from the bottom, so a gap left by a course that
// went closes, the books above it dropping down in their order. A place saved twice goes to the
// first course in course order; a place that is neither is ignored. Past twenty-four courses on the
// piles, twenty-three books and "and N more" (the courses shown nowhere) on the next free pile place.
// Returns:
//   books: [{ id, place }] in course order (on the piles and the near places),
//   more:  { place, count } | null,
//   map:   courseId -> place for every book, after settling,
//   changed: whether a saved place moved (then `map` is written back, once).
const PLACE_SET = new Set(PLACES);
const sideOf = (place) => place[0];
const levelOf = (place) => Number(place.slice(1));

export const arrangePiles = (courseIds, saved) => {
  const ids = (Array.isArray(courseIds) ? courseIds : []).filter((id) => id != null);
  const stored = saved && typeof saved === 'object' ? saved : {};
  const near = new Map();
  ids.forEach((id) => {
    const place = stored[id];
    if (typeof place === 'string' && NEAR_SET.has(place) && ![...near.values()].includes(place)) near.set(id, place);
  });
  const onPiles = ids.filter((id) => !near.has(id));
  const maxBooks = onPiles.length <= PLACES.length ? onPiles.length : PLACES.length - 1;
  const taken = new Map();
  const want = new Map();
  onPiles.forEach((id) => {
    const place = stored[id];
    if (typeof place === 'string' && PLACE_SET.has(place) && !taken.has(place) && taken.size < maxBooks) {
      taken.set(place, id);
      want.set(id, place);
    }
  });
  const free = PLACES.filter((place) => !taken.has(place));
  onPiles.forEach((id) => {
    if (want.has(id) || want.size >= maxBooks) return;
    const place = free.shift();
    want.set(id, place);
  });
  // Settle each pile: its books in order of level, re-levelled 0, 1, 2, ...
  const map = {};
  ['L', 'R'].forEach((side) => {
    const pile = [...want.entries()].filter(([, place]) => sideOf(place) === side).sort((a, b) => levelOf(a[1]) - levelOf(b[1]));
    pile.forEach(([id], level) => {
      map[id] = `${side}${level}`;
    });
  });
  near.forEach((place, id) => {
    map[id] = place;
  });
  const books = ids.filter((id) => map[id]).map((id) => ({ id, place: map[id] }));
  const count = ids.length - books.length;
  let more = null;
  if (count > 0) {
    const used = new Set(Object.values(map));
    more = { place: PLACES.find((place) => !used.has(place)), count };
  }
  // Only what was saved is rewritten: a student who never moved a book never writes a map.
  const changed = ids.some((id) => Object.prototype.hasOwnProperty.call(stored, id) && stored[id] !== map[id]);
  return { books, more, map, changed };
};

// Moves (each one map to write): a book to the top of the other pile, or one place up or down its
// own pile (swapping with the book there). The pile it leaves settles. Null when it cannot move.
// (A near book's "other pile" is the one it did not come from: putBack's.)
export const moveToOtherPile = (arrangement, id, from = {}) => {
  const place = arrangement.map[id];
  if (!place) return null;
  if (NEAR_SET.has(place)) {
    const home = homePile(arrangement, id, from);
    return putBack(arrangement, id, { ...from, [id]: home === 'L' ? 'R' : 'L' })?.map ?? null;
  }
  const other = sideOf(place) === 'L' ? 'R' : 'L';
  const height = Object.values(arrangement.map).filter((p) => sideOf(p) === other).length;
  if (height >= PILE_DEPTH) return null;
  const next = { ...arrangement.map, [id]: `${other}${height}` };
  // The pile it left settles.
  const side = sideOf(place);
  const left = Object.entries(next)
    .filter(([key, p]) => key !== id && sideOf(p) === side)
    .sort((a, b) => levelOf(a[1]) - levelOf(b[1]));
  left.forEach(([key], level) => {
    next[key] = `${side}${level}`;
  });
  return next;
};

export const moveInPile = (arrangement, id, step) => {
  const place = arrangement.map[id];
  if (!place || !step || NEAR_SET.has(place)) return null;
  const target = `${sideOf(place)}${levelOf(place) + Math.sign(step)}`;
  const neighbour = Object.keys(arrangement.map).find((key) => arrangement.map[key] === target);
  if (!neighbour) return null;
  return { ...arrangement.map, [id]: target, [neighbour]: place };
};

// A pile's height and its books in order (bottom first), in a map.
const pileOf = (map, side) =>
  Object.entries(map)
    .filter(([, p]) => sideOf(p) === side && /^[LR]\d+$/.test(p))
    .sort((a, b) => levelOf(a[1]) - levelOf(b[1]));
// The pile `side` with `id` taken off it (if it was on it), re-levelled from the bottom.
const settlePile = (map, side) => {
  pileOf(map, side).forEach(([key], level) => {
    map[key] = `${side}${level}`;
  });
  return map;
};

// The pile a near book goes back to (`from`: roomPrefs.deskNearFrom, courseId -> 'L' | 'R', where it
// lay before it was brought closer); unknown or full, the shorter pile (the left on a tie) with room.
export const homePile = (arrangement, id, from = {}) => {
  const map = arrangement.map;
  const height = (side) => pileOf(map, side).filter(([key]) => key !== id).length;
  const wanted = from?.[id];
  if ((wanted === 'L' || wanted === 'R') && height(wanted) < PILE_DEPTH) return wanted;
  if (height('L') <= height('R')) return height('L') < PILE_DEPTH ? 'L' : height('R') < PILE_DEPTH ? 'R' : null;
  return height('R') < PILE_DEPTH ? 'R' : height('L') < PILE_DEPTH ? 'L' : null;
};

// A near book back on its pile (homePile), on top. Returns { map, from } (from: its memory cleared)
// or null.
export const putBack = (arrangement, id, from = {}) => {
  const place = arrangement.map[id];
  if (!place || !NEAR_SET.has(place)) return null;
  const side = homePile(arrangement, id, from);
  if (!side) return null;
  const map = { ...arrangement.map };
  map[id] = `${side}${pileOf(map, side).length}`;
  const rest = { ...(from || {}) };
  delete rest[id];
  return { map, from: rest };
};

// A book brought closer: to the first free near place; where every near place is taken, the book on
// the first goes back to its pile's next free slot (homePile) first. The pile the book leaves settles;
// where it lay is remembered (`from`) so "Put back" returns it there. Returns { map, from } or null
// (already near; no room to put the other back).
export const bringCloser = (arrangement, id, from = {}) => {
  const place = arrangement.map[id];
  if (!place || NEAR_SET.has(place)) return null;
  let map = { ...arrangement.map };
  let memory = { ...(from || {}) };
  let target = NEAR_PLACES.find((p) => !Object.values(map).includes(p));
  if (!target) {
    target = NEAR_PLACES[0];
    const sitting = Object.keys(map).find((key) => map[key] === target);
    // Its pile is measured without the book coming off the other one.
    const back = putBack({ map: { ...map, [id]: '_' } }, sitting, memory);
    if (!back) return null;
    map = { ...back.map, [id]: place };
    memory = back.from;
  }
  map[id] = target;
  settlePile(map, sideOf(place));
  memory[id] = sideOf(place);
  return { map, from: memory };
};

// Where a dragged book may go (round seven): the next free slot on each pile (on its own pile, its
// top: only where it is not the top already), every near place (a taken one sends its book back:
// bringCloser), and its own place (dropping there changes nothing). Each { place, kind }.
export const dragTargets = (arrangement, id) => {
  const place = arrangement.map[id];
  if (!place) return [];
  const out = [{ place, kind: 'own' }];
  ['L', 'R'].forEach((side) => {
    const pile = pileOf(arrangement.map, side);
    const mine = pile.some(([key]) => key === id);
    // A full pile has no next slot (its own pile's top: the book is on it already, or there is no
    // place above it to draw the target at).
    if (pile.length >= PILE_DEPTH || (mine && pile[pile.length - 1][0] === id)) return;
    out.push({ place: `${side}${pile.length}`, kind: 'pile' });
  });
  if (!NEAR_SET.has(place)) NEAR_PLACES.forEach((p) => out.push({ place: p, kind: 'near' }));
  return out;
};

// The move a drop on `target` (a dragTargets place) makes: { map, from } or null (its own place).
export const moveTo = (arrangement, id, target, from = {}) => {
  const place = arrangement.map[id];
  if (!place || !target || target === place) return null;
  if (NEAR_SET.has(target)) return bringCloser(arrangement, id, from);
  const side = sideOf(target);
  if (NEAR_SET.has(place)) return putBack(arrangement, id, { ...from, [id]: side });
  if (side !== sideOf(place)) {
    const map = moveToOtherPile(arrangement, id, from);
    return map ? { map, from: { ...(from || {}) } } : null;
  }
  // The top of its own pile.
  const map = { ...arrangement.map };
  map[id] = `${side}${PILE_DEPTH}`;
  return { map: settlePile(map, side), from: { ...(from || {}) } };
};

// A pointer that moves this far (css px) from where it went down is a drag; less is a click (the
// flight). On touch a drag starts only after a long press.
export const DRAG_PX = 6;
export const LONG_PRESS_MS = 350;
export const isDrag = (dx, dy) => Math.hypot(dx, dy) >= DRAG_PX;

// Whether a polygon ([[x, y], ...]) holds a point [x, y] (even-odd).
export const pointInPolygon = (poly, [x, y]) => {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
};

// The target under the pointer (stage px): the one whose polygon holds it; else the nearest
// centre within `reach` (stage px); else null. `targets`: [{ place, polygon }].
export const pickTarget = (targets, [x, y], reach = 60) => {
  const inside = (poly) => {
    let hit = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
      const [xi, yi] = poly[i];
      const [xj, yj] = poly[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
  };
  const held = targets.find((t) => inside(t.polygon));
  if (held) return held.place;
  let best = null;
  let bestD = reach;
  targets.forEach((t) => {
    const cx = t.polygon.reduce((s, p) => s + p[0], 0) / t.polygon.length;
    const cy = t.polygon.reduce((s, p) => s + p[1], 0) / t.polygon.length;
    const d = Math.hypot(cx - x, cy - y);
    if (d < bestD) {
      bestD = d;
      best = t.place;
    }
  });
  return best;
};

// The candle's places (round seven, run three; scene.json `candles`): today's C0 by the notebook and
// C1 beside the card. A place is offered only where its night set is in scene.json (images[night key]);
// the saved one (roomPrefs.deskCandle) where it is, else C0. Each place's night is its own mood key
// (C0 'night', C1 'nightC1': the room lit from there), its day the day's set with its own candle.
export const candlePlaces = (scene) =>
  Object.entries(scene?.candles || {})
    .filter(([, c]) => c && scene.images?.[c.night])
    .map(([place]) => place);
export const candleOf = (scene, saved) => (typeof saved === 'string' && candlePlaces(scene).includes(saved) ? saved : 'C0');
export const nightKeyOf = (scene, place) => (scene?.candles?.[place] && scene.images?.[scene.candles[place].night] ? scene.candles[place].night : 'night');
export const isNightKey = (mood) => typeof mood === 'string' && mood.startsWith('night');
// Where a dragged candle may stand: a dashed ring on the table round each place's dish (its box at
// 1x: [x0, y0, x1, y1], the candle and its dish; the dish's ellipse is about half as tall as wide).
export const candleRing = (box, steps = 28) => {
  const [x0, , x1, y1] = box;
  const rx = (x1 - x0) / 2 + 4;
  const ry = rx * 0.5;
  const cx = (x0 + x1) / 2;
  const cy = y1 - ry + 4;
  return Array.from({ length: steps }, (_, k) => {
    const t = (2 * Math.PI * k) / steps;
    return [Math.round((cx + rx * Math.cos(t)) * 10) / 10, Math.round((cy + ry * Math.sin(t)) * 10) / 10];
  });
};

export const MIN_CONTRAST = 4.5;

const toHex = (rgb) => `#${rgb.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('')}`;

// A book's look on the stage in a mood (scene: scene.json): the leather its course binds in and its
// label's (leatherOf / labelOf), their dyes as the page multiplies them into the neutral render
// (scene.json leatherDyes / labelDyes: display-sRGB multipliers measured in the study), the leather
// as drawn (its neutral tone at the spine times its dye: the flight's cloth), the gilt's typical
// colour (the place's gilt strip, the flight's ink) and the contrast of the gilt on the dyed label,
// for the title and for the count (each on its own label).
// Returns { leather, label, tint, labelTint, cover, gilt, contrast: { title, count } }.
export const spineLook = (scene, mood, place, colour) => {
  const leather = leatherOf(colour);
  const label = labelOf(leather);
  const tint = scene.leatherDyes?.[mood]?.[leather] || [1, 1, 1];
  const labelTint = scene.labelDyes?.[mood]?.[label] || [1, 1, 1];
  const tone = scene.spineTone?.[mood]?.[place] || [0.4, 0.4, 0.4];
  const gilts = scene.giltTone?.[mood]?.[place] || {};
  const under = scene.labelTone?.[mood]?.[place] || {};
  const onLabel = (kind) => {
    if (!gilts[kind] || !under[kind]) return null;
    return Math.round(contrast(gilts[kind], under[kind].map((v, i) => v * labelTint[i])) * 100) / 100;
  };
  return {
    leather,
    label,
    tint: toHex(tint),
    labelTint: toHex(labelTint),
    cover: toHex(tone.map((v, i) => v * tint[i])),
    gilt: toHex(gilts.title || [0.79, 0.64, 0.36]),
    contrast: { title: onLabel('title'), count: onLabel('count') },
  };
};

// The count on its label, as large as fits up to 17px (a title's size; never under the floor), one
// line of untracked lining figures in COUNT_FACE (round seven: EB Garamond 800 against Spectral SC's
// own lining figures at 600 and 700, by the lettering study's M; see COUNT_FACES), every figure the
// same advance (tabular, measured once in the harness: room-harness/advances.html). Where it will not
// fit at the floor (a small scale's floor on a low or narrow label), the count is dropped (text '')
// and the title keeps its place: the count stays in the book's accessible name. (Round six fell back
// to Cormorant SC's narrower figures; with Cormorant gone the floor decides.) Returns { text, size,
// face }.
export const COUNT_BASE = 17;
// The candidates' figure advances in em (tabular lining figures).
export const COUNT_FACES = { garamond: 0.54, spectral600: 0.536, spectral700: 0.561 };
// Spectral SC 700's lining figures: the crispest of the three by the lettering study's M (round seven,
// room-harness/typeafter.py counts: mean 0.410 against Spectral SC 600's 0.442 and EB Garamond 800's
// 0.462, at 1536 x 750 / 1.25 and at 2x, night and day), one family with the titles.
export const COUNT_FACE = 'spectral700';
export const COUNT_FIGURE_EM = COUNT_FACES[COUNT_FACE];
export const countMeasure = (text, size, face = COUNT_FACE) =>
  [...String(text || '')].reduce((sum, ch) => sum + (/[0-9]/.test(ch) ? COUNT_FACES[face] ?? COUNT_FIGURE_EM : spineCharEm(ch)), 0) * size * 1.02;
export const fitSpineCount = (count, { width, height = Infinity, floor = SPINE_FLOOR } = {}) => {
  const base = Math.max(COUNT_BASE, floor);
  const text = String(count ?? '').trim();
  if (!text) return { text: '', size: base, face: COUNT_FACE };
  const widest = countMeasure(text, 100);
  const size = Math.floor(Math.min(base, widest > 0 ? (100 * width) / widest : base, height / SPINE_LINE) * 100) / 100;
  // A hundredth of a px under the floor is the rounding above, not a smaller word.
  if (size >= floor - 0.011) return { text, size: Math.max(size, floor), face: COUNT_FACE };
  return { text: '', size: floor, face: COUNT_FACE, dropped: true };
};

// How much each notebook page holds at a scale (round seven: the words keep 13 css px however small
// the picture is drawn, so a smaller scale holds fewer of them). The pages are laid out at the left
// page's own size at 1x (PAGE_BOX, stage px) as desk.css does, every size max(its own, the floor):
//   left:  the top margin (the date in it), the greeting, the day's sentence (`sentence` lines), the
//          rule, "Where you left off", then `rows` notes (a title line and a stamp line each);
//   right: the meta line, the title (two lines at most), the first lines (`clamp` lines), the tags'
//          line (`tags`), "Continue writing".
// Whole lines only: the counts are the most whose lines all fit (pageHeights), so nothing is ever
// cut through a line. The day first: the sentence keeps two lines before the rows grow; a fourth
// row is worth more than a third line of it. `lines` is how many of the note's own lines are taken
// (deskPage.js gives at most four), `clamp` how many lines they may fill.
// Returns { rows, sentence, lines, clamp, tags }.
export const PAGE_BOX = { width: 274, height: 375 };
export const PAGE_LAYOUT = {
  padTop: 30,
  padBottom: 20,
  // The date sits in the top margin, this far down; the greeting starts under it.
  clockTop: 10,
  greetingLine: 1.1,
  sentenceGap: 8,
  sentenceLine: 1.42,
  rule: 28,
  headingLine: 1.15,
  headingGap: 12,
  rowTitleLine: 1.22,
  rowStampLine: 1.3,
  rowGap: 11,
  metaLine: 1.3,
  metaGap: 8,
  titleLine: 1.12,
  titleLines: 2,
  titleGap: 10,
  textLine: 1.45,
  textGap: 12,
  tagsLine: 1.3,
  tagsGap: 12,
  actionLine: 1.3,
};
export const MAX_ROWS = 4;
const PAGE_TEXT_LINES = 4;

export const pageHeights = ({ rows, sentence, clamp, tags }, scale = 1) => {
  const L = PAGE_LAYOUT;
  const size = (kind) => stageType(kind, scale);
  const top = Math.max(L.padTop, L.clockTop + size('clock') * L.rowStampLine + 2);
  const left =
    top +
    size('greeting') * L.greetingLine +
    (sentence ? L.sentenceGap + sentence * size('sentence') * L.sentenceLine : 0) +
    L.rule +
    size('heading') * L.headingLine +
    L.headingGap +
    (rows ? rows * (size('rowTitle') * L.rowTitleLine + size('rowStamp') * L.rowStampLine) + (rows - 1) * L.rowGap : 0) +
    L.padBottom;
  const right =
    L.padTop +
    size('meta') * L.metaLine +
    L.metaGap +
    size('pageTitle') * L.titleLine * L.titleLines +
    L.titleGap +
    (clamp ? clamp * size('lines') * L.textLine + L.textGap : 0) +
    (tags ? size('tags') * L.tagsLine + L.tagsGap : 0) +
    size('action') * L.actionLine +
    L.padBottom;
  return { left, right };
};

export const pageCapacity = (scale = 1, box = PAGE_BOX) => {
  const fits = (cap, side) => pageHeights(cap, scale)[side] <= box.height + 1e-6;
  let sentence = 2;
  let rows = 0;
  while (rows < MAX_ROWS && fits({ rows: rows + 1, sentence }, 'left')) rows += 1;
  if (!rows && fits({ rows: 1, sentence: 1 }, 'left')) {
    sentence = 1;
    rows = 1;
  }
  if (rows === MAX_ROWS && fits({ rows, sentence: 3 }, 'left')) sentence = 3;
  let clamp = 0;
  while (clamp < 12 && fits({ clamp: clamp + 1, tags: true }, 'right')) clamp += 1;
  // The tags' line only when the note's lines keep three lines beside it.
  const tags = clamp >= 3;
  if (!tags) while (clamp < 12 && fits({ clamp: clamp + 1, tags: false }, 'right')) clamp += 1;
  return { rows, sentence, lines: Math.min(PAGE_TEXT_LINES, clamp), clamp, tags };
};

// The books' hit areas on a pile (round seven): at least `need` stage px tall each (24 css px at
// the scale: 24 / s), so a book is easy to point at however small the picture is drawn. A book's
// own silhouette (its spine, and the top face of the pile's top book) is where it is hit; where
// that is too low, its area runs on invisibly toward the table, over the leather of the book below
// but never over that book's title label, and only as far as the book below can spare (a pile's
// labels never lose their own book). `places`: the pile's places bottom to top, as drawn (its
// books, then the dashed place on top if there is one: "+ New course" or "and N more"). Between two
// books the boundary stays where the upper book's spine ends unless one of them needs it moved; the
// bottom book runs on onto the table, the top one up into the room above the pile (nothing is
// there to cover). Computed at two points across the pile (its spines' mean ends) and drawn as
// straight lines through them, so each area is a polygon with straight edges.
// Returns { [place]: polygon (stage px) }.
const lineAt = (a, b, x) => (Math.abs(b[0] - a[0]) < 1e-9 ? (a[1] + b[1]) / 2 : a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0]));

export const pileHits = (quads, places, need) => {
  const list = (places || []).filter((place) => quads.spines?.[place]);
  if (!list.length) return {};
  const spine = (p) => quads.spines[p];
  const label = (p) => quads.spineLabels?.[p] || spine(p);
  const xs = [
    list.reduce((sum, p) => sum + Math.min(spine(p)[0][0], spine(p)[3][0]), 0) / list.length,
    list.reduce((sum, p) => sum + Math.max(spine(p)[1][0], spine(p)[2][0]), 0) / list.length,
  ];
  const top = list.length - 1;
  // The boundaries' y at each of the two points: b[k] between place k (below) and k + 1 (above).
  const bounds = xs.map((x) => {
    const natural = (k) => lineAt(spine(list[k + 1])[3], spine(list[k + 1])[2], x);
    const lo = (k) => lineAt(label(list[k + 1])[3], label(list[k + 1])[2], x);
    const hi = (k) => lineAt(label(list[k])[0], label(list[k])[1], x);
    // The least y each boundary may take so that every place above it still gets `need`.
    const least = [];
    // The top place runs up as far as it needs (nothing above it), so it asks nothing of the others.
    let above = -Infinity;
    for (let k = top - 1; k >= 0; k -= 1) {
      least[k] = Math.max(lo(k), above + need);
      above = least[k];
    }
    const b = [];
    let below = Infinity;
    for (let k = 0; k < top; k += 1) {
      const most = Math.min(hi(k), below - need);
      b[k] = Math.min(Math.max(natural(k), least[k]), Math.max(most, least[k]));
      below = b[k];
    }
    const foot = lineAt(spine(list[0])[3], spine(list[0])[2], x);
    return { b, bottom: top > 0 ? Math.max(foot, b[0] + need) : foot };
  });
  const at = (k, j) => (k < 0 ? bounds[j].bottom : bounds[j].b[k]);
  const yAt = (k, x) => {
    const [x0, x1] = xs;
    const [y0, y1] = [at(k, 0), at(k, 1)];
    return Math.abs(x1 - x0) < 1e-9 ? y0 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  };
  const out = {};
  list.forEach((place, k) => {
    const q = spine(place);
    const left = Math.min(q[0][0], q[3][0]);
    const right = Math.max(q[1][0], q[2][0]);
    const lower = [
      [right, yAt(k - 1, right)],
      [left, yAt(k - 1, left)],
    ];
    if (k === top) {
      // Its top face's far edge where the camera sees the face (a pile's high places lie above the
      // eye: their tops are seen from below, and the spine's top edge is the top), raised where the
      // place would be under `need` tall.
      const t = quads.tops?.[place];
      const seen = t && t[0][1] < q[0][1] && t[1][1] < q[1][1];
      const upTo = (x, own) => Math.min(own, yAt(k - 1, x) - need);
      out[place] = seen
        ? [[t[0][0], upTo(t[0][0], t[0][1])], [t[1][0], upTo(t[1][0], t[1][1])], q[1], ...lower, q[0]]
        : [[left, upTo(left, lineAt(q[0], q[1], left))], [right, upTo(right, lineAt(q[0], q[1], right))], ...lower];
    } else {
      out[place] = [[left, yAt(k, left)], [right, yAt(k, right)], ...lower];
    }
  });
  return out;
};

// The capture card's hint, as long as its line holds at its size (stage px): the card says less on a
// small scale instead of cutting a word. Widths in em from Figtree 400's advances (Google Fonts,
// measured once with a canvas in the harness, 2026-10-28; 2% to spare).
export const CARD_HINTS = [
  ['Jot something down', 9.22],
  ['Jot it down', 5.07],
  ['Jot down', 4.21],
];
export const cardHint = (width, size) => (CARD_HINTS.find(([, em]) => em * size * 1.02 <= width) || CARD_HINTS[CARD_HINTS.length - 1])[0];

// Where a hit polygon is tallest across a label's middle: its height there (stage px).
export const heightAt = (polygon, x) => {
  const ys = [];
  polygon.forEach((a, i) => {
    const b = polygon[(i + 1) % polygon.length];
    if ((a[0] - x) * (b[0] - x) <= 0 && Math.abs(b[0] - a[0]) > 1e-9) ys.push(a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0]));
  });
  return ys.length >= 2 ? Math.max(...ys) - Math.min(...ys) : 0;
};
