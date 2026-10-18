import { indexedText, matchActions, searchDesk } from '../room/deskSearch.js';

// The ⌘K demo on the home (FindDemo.jsx) runs on the app's own search, room/deskSearch.js: the
// same folding (case and accents), the same order — a title first, then a tag, then any word in a
// note — and the same action matching ("sw ca" finds "Switch to Candlelight"). It searches the
// desk the home shows: its three notes and Sage's call note, as the captures show them written.
//
// Pure and DOM-free: FindDemo.jsx builds the index once, at load, from sceneData.js and
// sageDemoData.js; tests/public-window.unit.test.mjs builds one from fixtures.
//
//   buildFindIndex({ notes: [{ id, title, group, tags, body: string[], path }], groups: string[] })
//   findRows(index, query, { mood, limit })  ->  rows, best first:
//     { key, kind: 'note' | 'group' | 'mood' | 'inert', label, hint, path?, mood?, says?, snippet? }

// A note's lines are held apart by a mark no one types, so a match's snippet can stop at the end
// of its own line (the room's snippetParts folds every kind of white space into one).
const LINE = ' ¶ ';

export const buildFindIndex = ({ notes = [], groups = [] }) => ({
  notes: notes.map(({ id, title, group, tags = [], path }) => ({ id, title, group, tags, path })),
  courses: groups.map((name) => ({ id: name, name })),
  texts: new Map(notes.map((note) => [note.id, indexedText((note.body ?? []).join(LINE))])),
});

// The words around a match, within the line it was found in: cut at a line's edge, a snippet
// needs no "…" there.
const withinLine = (snippet) => {
  if (!snippet) return null;
  const mark = LINE.trim();
  const before = snippet.before.split(mark);
  const after = snippet.after.split(mark);
  return {
    before: before.length > 1 ? before[before.length - 1].trimStart() : snippet.before,
    match: snippet.match,
    after: after.length > 1 ? after[0].trimEnd() : snippet.after,
  };
};

// What ⌘K does besides finding: change the room, add an event, start a note. Only the room
// changes here; the others say what they would do on a desk of your own.
const ACTIONS = [
  {
    id: 'rain',
    label: 'Switch to Rain',
    keywords: ['day', 'light', 'grey', 'gray', 'theme', 'mood', 'room'],
    hint: 'Room',
    kind: 'mood',
    mood: 'rain',
    idle: true,
  },
  {
    id: 'candlelight',
    label: 'Switch to Candlelight',
    keywords: ['night', 'dark', 'candle', 'cozy', 'evening', 'theme', 'mood', 'room'],
    hint: 'Room',
    kind: 'mood',
    mood: 'candlelight',
    idle: true,
  },
  {
    id: 'event',
    label: 'Add an event',
    keywords: ['calendar', 'new', 'event', 'exam', 'quiz', 'deadline', 'reminder', 'due', 'schedule'],
    hint: 'Calendar',
    kind: 'inert',
    says: 'On your own desk, this adds an event to your calendar.',
  },
];

export const CREATE_GROUP = 'Working Notes';

const noteRow = (hit) => ({
  key: `n-${hit.note.id}`,
  kind: 'note',
  label: hit.note.title,
  hint: hit.where === 'tag' ? `#${hit.tag}` : hit.note.group,
  path: hit.note.path,
  view: hit.note.id,
  snippet: withinLine(hit.snippet),
});

const actionRow = (action) => ({
  key: `a-${action.id}`,
  kind: action.kind,
  label: action.label,
  hint: action.hint,
  mood: action.mood,
  says: action.says,
});

const groupRow = (course) => ({ key: `g-${course.id}`, kind: 'group', label: course.name, hint: 'Group', path: '/desk' });

export const findRows = (index, query, { mood = 'rain', limit = 5 } = {}) => {
  const trimmed = String(query ?? '').trim();
  // Switching to the room already on show is not offered.
  const actions = ACTIONS.filter((action) => action.mood !== mood);

  if (!trimmed) {
    const recent = index.notes.map((note) => noteRow({ note, where: 'title' }));
    return [...recent, ...actions.filter((action) => action.idle).map(actionRow)].slice(0, limit);
  }

  const results = searchDesk({ query: trimmed, courses: index.courses, notes: index.notes, texts: index.texts });
  if (trimmed.startsWith('#')) return results.notes.map(noteRow).slice(0, limit);

  const matched = matchActions(trimmed, actions, 3);
  // What was typed can always become a note — unless it plainly named an action.
  const offerCreate = trimmed.length >= 2 && !matched.some((hit) => hit.strong);
  const rows = [
    ...matched.filter((hit) => hit.strong).map((hit) => actionRow(hit.action)),
    ...results.courses.map(groupRow),
    ...results.notes.map(noteRow),
    ...matched.filter((hit) => !hit.strong).map((hit) => actionRow(hit.action)),
  ];
  const create = offerCreate
    ? [
        {
          key: 'a-create',
          kind: 'inert',
          label: `New note “${trimmed}”`,
          hint: CREATE_GROUP,
          says: `On your own desk, this starts a note called “${trimmed}” in ${CREATE_GROUP}.`,
        },
      ]
    : [];
  // The new note stays on the list however many other things answer.
  return [...rows.slice(0, Math.max(0, limit - create.length)), ...create];
};
