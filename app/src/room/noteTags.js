// Note tags — a note's own labels ("midterm", "week-3", "ask-prof"). They live on the note's
// meta doc as `tags: string[]`, a field every note is already created with; the room is the
// first design to fill it in. A tag is written the way it is shown: lower-case, one word,
// hyphens for spaces, so "#Week 3" and "week-3" are the same tag everywhere — the note, its
// sheet, ⌘K's "#" search and All notes' `?tag=` filter.
//
// DOM-free and Firebase-free: tests/room.unit.test.mjs loads it under Node.

export const TAG_MAX = 24;
export const TAGS_PER_NOTE = 12;

// "#Week 3!" → "week-3". Letters and digits in any script (with their accents and marks),
// `_` and single hyphens; everything else becomes a hyphen and is trimmed off the ends.
export const cleanTag = (raw) =>
  String(raw ?? '')
    .normalize('NFC')
    .trim()
    .replace(/^#+/, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}_-]+/gu, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, TAG_MAX)
    .replace(/[-_]+$/, '');

// A note's tags as stored: cleaned, no repeats, at most TAGS_PER_NOTE, in the order given.
export const cleanTags = (list) => {
  const out = [];
  (Array.isArray(list) ? list : []).forEach((raw) => {
    const tag = cleanTag(raw);
    if (tag && !out.includes(tag) && out.length < TAGS_PER_NOTE) out.push(tag);
  });
  return out;
};

// Several typed or pasted at once — "exam, week 3 #proofs" — split on commas and hashes.
// Spaces stay inside a tag ("week 3" → "week-3"): a comma, a hash or Enter ends one.
export const splitTags = (text) =>
  String(text ?? '')
    .split(/[,#\n]+/)
    .map(cleanTag)
    .filter(Boolean);

// The tags with `typed` added (already there: unchanged) or `tag` taken away.
export const withTags = (tags, typed) => cleanTags([...cleanTags(tags), ...splitTags(typed)]);
export const withoutTag = (tags, tag) => cleanTags(tags).filter((item) => item !== cleanTag(tag));

export const hasTag = (note, tag) => {
  const wanted = cleanTag(tag);
  return Boolean(wanted) && cleanTags(note?.tags).includes(wanted);
};

// Every tag in use across `notes`, most used first, ties alphabetical: [{ tag, count }].
export const tagCounts = (notes = []) => {
  const counts = new Map();
  notes.forEach((note) => {
    cleanTags(note?.tags).forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1));
  });
  return [...counts]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
};

// While a tag is being typed: tags already in use that START with what is typed, then ones
// that merely contain it — never one the note already has, never the exact text itself.
// `known` is tagCounts(...) order, so the most used come first within each group.
export const suggestTags = (typed, known = [], taken = [], limit = 5) => {
  const q = cleanTag(typed);
  const pool = known.filter((tag) => !taken.includes(tag) && tag !== q);
  if (!q) return pool.slice(0, limit);
  const starts = pool.filter((tag) => tag.startsWith(q));
  const inside = pool.filter((tag) => !tag.startsWith(q) && tag.includes(q));
  return [...starts, ...inside].slice(0, limit);
};
