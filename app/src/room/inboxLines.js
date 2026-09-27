// The Inbox: lines jotted on the desk, waiting to be filed. They live as a map on the
// profile doc (`inbox.{id}`, like `events`), which is why no rules change or deploy was
// needed. Room-only — classic has no inbox and gains none (dualmode.md §4.2).
//
// DOM-free and Firebase-free: tests/room.unit.test.mjs loads it under Node.

// Newest first. Anything malformed or blank is simply not a line.
export const inboxLines = (inbox) =>
  Object.values(inbox || {})
    .filter((entry) => entry && typeof entry.id === 'string' && typeof entry.text === 'string' && entry.text.trim())
    .sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));

// A filed line's note title: its first line, at most `max` characters, cut at a word.
export const titleFromLine = (text, max = 60) => {
  const line = String(text || '').split('\n')[0].replace(/\s+/g, ' ').trim();
  if (!line) return 'Untitled';
  if (line.length <= max) return line;
  const cut = line.slice(0, max);
  const space = cut.lastIndexOf(' ');
  const kept = space > max / 2 ? cut.slice(0, space) : cut;
  return `${kept.replace(/[\s,;:.—-]+$/, '')}…`;
};
