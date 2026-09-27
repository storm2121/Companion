// ⌘K search over the room's own world: its courses and its page notes. Classic's notes
// are not searched — the room never reads them (dualmode.md §2).
//
// Titles match at once, from what is already in memory. A note's body matches only once
// it has been read: the caller reads bodies lazily and hands them in as `texts`, a Map of
// noteId -> indexedText(...).
//
// DOM-free and Firebase-free: tests/room.unit.test.mjs loads it under Node.

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
// Title matches come before body matches — a title is the stronger signal.
export const searchDesk = ({ query, courses = [], notes = [], texts, limit = 24 }) => {
  const q = fold(String(query || '').trim());
  if (!q) return { courses: [], notes: [] };

  const courseHits = courses.filter((course) => fold(course.name).includes(q)).slice(0, 5);
  const byTitle = [];
  const byBody = [];
  notes.forEach((note) => {
    if (fold(note.title).includes(q)) {
      byTitle.push({ note, where: 'title' });
      return;
    }
    const body = texts?.get?.(note.id);
    if (!body) return;
    const at = body.folded.indexOf(q);
    if (at >= 0) byBody.push({ note, where: 'body', snippet: snippetParts(body.text, at, q.length) });
  });

  return { courses: courseHits, notes: [...byTitle, ...byBody].slice(0, limit) };
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
