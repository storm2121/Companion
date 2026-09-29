// ⌘K search over the room's own world: its courses and its page notes. Classic's notes
// are not searched — the room never reads them (dualmode.md §2).
//
// Titles match at once, from what is already in memory. A note's body matches only once
// it has been read: the caller reads bodies lazily and hands them in as `texts`, a Map of
// noteId -> indexedText(...).
//
// DOM-free and Firebase-free: tests/room.unit.test.mjs loads it under Node.

import { cleanTag, cleanTags, tagCounts } from './noteTags.js';

// Case- and accent-insensitive, and ONE output character per input character, so an index
// found in the folded text is the same index in the original (a whole-string NFD would
// shift every index after an accent).
export const fold = (value) => {
  const source = String(value || '');
  // Fast path: plain ASCII lower-cases without changing length.
  if (!/[^\t\n\r -~]/.test(source)) return source.toLowerCase();
  let out = '';
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    const base = ch.normalize('NFD')[0] || ch;
    out += base.toLowerCase()[0] || base;
  }
  return out;
};

// A note body as the search holds it: the text once, and its folded twin for matching.
export const indexedText = (text) => {
  const plain = String(text || '');
  return { text: plain, folded: fold(plain) };
};

// The words around a body match, split so the match itself can be marked.
export const snippetParts = (text, at, length, radius = 48) => {
  const start = Math.max(0, at - radius);
  const end = Math.min(text.length, at + length + radius);
  const squash = (part) => part.replace(/\s+/g, ' ');
  return {
    before: `${start > 0 ? '…' : ''}${squash(text.slice(start, at)).trimStart()}`,
    match: text.slice(at, at + length),
    after: `${squash(text.slice(at + length, end)).trimEnd()}${end < text.length ? '…' : ''}`,
  };
};

// `notes` should arrive newest first; the order within each group is kept.
// Title matches come before tag matches, and both before body matches — a title is the
// strongest signal, a word somewhere in the text the weakest.
//
// A query that starts with "#" asks for TAGS: the tags in use that start with what follows
// (most used first) and the notes carrying one of them. Nothing else answers it.
export const searchDesk = ({ query, courses = [], notes = [], texts, limit = 24 }) => {
  const raw = String(query || '').trim();
  if (raw.startsWith('#')) return searchTags(raw, notes, limit);
  const q = fold(raw);
  if (!q) return { courses: [], notes: [], tags: [] };

  const courseHits = courses.filter((course) => fold(course.name).includes(q)).slice(0, 5);
  const byTitle = [];
  const byTag = [];
  const byBody = [];
  notes.forEach((note) => {
    if (fold(note.title).includes(q)) {
      byTitle.push({ note, where: 'title' });
      return;
    }
    const tag = cleanTags(note.tags).find((item) => fold(item).includes(q));
    if (tag) {
      byTag.push({ note, where: 'tag', tag });
      return;
    }
    const body = texts?.get?.(note.id);
    if (!body) return;
    const at = body.folded.indexOf(q);
    if (at >= 0) byBody.push({ note, where: 'body', snippet: snippetParts(body.text, at, q.length) });
  });

  return { courses: courseHits, notes: [...byTitle, ...byTag, ...byBody].slice(0, limit), tags: [] };
};

const searchTags = (raw, notes, limit) => {
  const wanted = fold(cleanTag(raw));
  const tags = tagCounts(notes).filter(({ tag }) => fold(tag).startsWith(wanted));
  if (!wanted) return { courses: [], notes: [], tags: tags.slice(0, 8) };
  const hits = [];
  notes.forEach((note) => {
    const tag = cleanTags(note.tags).find((item) => fold(item).startsWith(wanted));
    if (tag) hits.push({ note, where: 'tag', tag });
  });
  return { courses: [], notes: hits.slice(0, limit), tags: tags.slice(0, 4) };
};

/* ── Actions ──────────────────────────────────────────────────────────────────
   ⌘K also DOES things: go to a page, start a note, file a thought, switch the mood,
   and whatever the open page offers (a note's "Find in this note"). An action is
   { id, label, keywords?, run }; it matches when every word typed starts a word of its
   label or keywords — "new no" finds "New note", "cal" finds "Calendar".
   Returns [{ action, strong }], best first. `strong` means the LABEL answered the query;
   a match found only in the keywords is weak, and the palette lists it after the notes. */

const wordsOf = (text) => fold(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

export const matchActions = (query, actions = [], limit = 5) => {
  const typed = wordsOf(query);
  if (!typed.length) return [];
  const phrase = typed.join(' ');
  return actions
    .map((action, order) => {
      const label = wordsOf(action.label);
      const vocab = [...label, ...wordsOf((action.keywords || []).join(' '))];
      if (!typed.every((word) => vocab.some((known) => known.startsWith(word)))) return null;
      // The label itself reading as typed beats a label word that starts with it, which
      // beats a match found only in the keywords.
      let score = 2;
      if (label.join(' ').startsWith(phrase)) score = 0;
      else if (typed.every((word) => label.some((known) => known.startsWith(word)))) score = 1;
      return { action, score, order };
    })
    .filter(Boolean)
    .sort((a, b) => a.score - b.score || a.order - b.order)
    .slice(0, limit)
    .map(({ action, score }) => ({ action, strong: score < 2 }));
};

// The course a room path is about — a course page or one of its notes — or ''.
export const courseFromPath = (pathname = '') => {
  const found = /^\/room\/(?:course|note)\/([^/?#]+)/.exec(String(pathname));
  if (!found) return '';
  try {
    return decodeURIComponent(found[1]);
  } catch {
    return found[1];
  }
};

/* ── Whether the sheet is open ────────────────────────────────────────────────
   Outside React, so the top line's Search button (in every page) and ⌘K (owned by
   RoomLayout's RoomSearch) open the same sheet without a context threaded through. */

let searchOpen = false;
const searchListeners = new Set();
const setSearchOpen = (next) => {
  searchOpen = next;
  searchListeners.forEach((listener) => listener());
};

export const openRoomSearch = () => setSearchOpen(true);
export const closeRoomSearch = () => setSearchOpen(false);
export const toggleRoomSearch = () => setSearchOpen(!searchOpen);
export const isSearchOpen = () => searchOpen;
export const subscribeSearch = (listener) => {
  searchListeners.add(listener);
  return () => searchListeners.delete(listener);
};
