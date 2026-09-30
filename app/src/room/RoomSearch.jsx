import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/authState';
import { addInboxEntry, createPageNote, getNoteAsOf } from '../services/library';
import { pageText, startingBlocks } from './pageBlocks';
import {
  closeRoomSearch,
  courseFromPath,
  indexedText,
  isSearchOpen,
  matchActions,
  searchDesk,
  subscribeSearch,
  toggleRoomSearch,
} from './deskSearch';
import { cleanTag } from './noteTags';
import { noteStamp, noteTime, useRoomDesk } from './roomData';
import { pageActions } from './roomCommands';
import { MOOD_CANDLELIGHT, MOOD_RAIN, resolveRoomPrefs } from './roomPrefs';
import { sayInRoom } from './roomUndo';
import CourseSheet from './components/CourseSheet';
import { Dot } from './components/primitives';
import { Overlay } from './components/Overlay';

// ⌘K — the design's only search (6a's top line: "Search ⌘K"), and the room's command line.
// Undesigned beyond that, so it is built from parts the room already has: an overlay sheet,
// a field, plain rows.
//
// It FINDS: courses and notes by title at once, from what is already in memory; notes by a
// tag ("#midterm", or just the word); bodies once a real query is typed — read newest note
// first, a few at a time, through `getNoteAsOf` (this device's copy unless the note changed
// since, then the server's) and kept for the rest of the visit, stamped with when the note
// last changed, so an unchanged note is never read twice.
//
// It DOES: goes to a page, starts a note, adds a course or something on the calendar,
// switches the mood — plus whatever the open page offers (roomCommands.js): a note's Sage,
// tags, PDF, "Insert a formula"… And anything typed that nothing answers can become a new
// note with that title, or a line in the inbox.

// noteId -> { text, folded, stamp }. Module-level, so reopening search starts warm.
const bodies = new Map();
const stampOf = (note) => note?.contentUpdatedAt?.toMillis?.() || noteTime(note);

const BATCH = 6;
const RECENT = 5;
const ACTIONS_SHOWN = 5;
// With nothing typed, the open page's first few actions sit under the recent notes.
const IDLE_ACTIONS = 3;

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// The room-wide actions. A page action with the same id replaces its room-wide twin — on a
// course page "New note in …" becomes "New note here", on the calendar "Add something"
// opens its own form rather than navigating to itself.
const roomActions = ({ go, courses, course, newNote, addCourse, mood, setMood }) =>
  [
    course && {
      id: 'new-note',
      label: `New note in ${course.name}`,
      keywords: ['create', 'add', 'write', 'page', 'start'],
      run: () => newNote(course.id),
    },
    {
      id: 'go-calendar',
      label: 'Open the calendar',
      keywords: ['schedule', 'week', 'month', 'events', 'exams', 'deadlines', 'breaks'],
      run: () => go('/room/calendar'),
    },
    {
      id: 'add-event',
      label: 'Add something to the calendar',
      keywords: ['new', 'event', 'exam', 'quiz', 'deadline', 'reminder', 'due'],
      run: () => go('/room/calendar', { state: { add: true } }),
    },
    {
      id: 'go-inbox',
      label: 'Open the inbox',
      keywords: ['scraps', 'capture', 'thoughts', 'later'],
      run: () => go('/room/inbox'),
    },
    {
      id: 'go-notes',
      label: 'See all notes',
      keywords: ['every', 'list', 'tags', 'browse'],
      run: () => go('/room/notes'),
    },
    { id: 'go-desk', label: 'Go to the desk', keywords: ['home', 'courses'], run: () => go('/room') },
    {
      id: 'go-you',
      label: 'Open You',
      keywords: ['settings', 'preferences', 'profile', 'account', 'export', 'markdown', 'sage', 'instructions'],
      run: () => go('/room/you'),
    },
    { id: 'add-course', label: 'Add a course', keywords: ['new', 'create', 'class', 'subject'], run: addCourse },
    mood !== MOOD_CANDLELIGHT && {
      id: 'mood-candlelight',
      label: 'Switch to the candlelight mood',
      keywords: ['night', 'dark', 'candle', 'cozy', 'city', 'window', 'theme', 'mood'],
      run: () => setMood(MOOD_CANDLELIGHT),
    },
    mood !== MOOD_RAIN && {
      id: 'mood-rain',
      label: 'Switch to the rain mood',
      keywords: ['day', 'light', 'grey', 'theme', 'mood'],
      run: () => setMood(MOOD_RAIN),
    },
    // "new note stat" → New note in Statistics.
    ...courses
      .filter((item) => item.id !== course?.id)
      .map((item) => ({
        id: `new-note-${item.id}`,
        label: `New note in ${item.name}`,
        keywords: ['create', 'add', 'write', 'page'],
        run: () => newNote(item.id),
      })),
  ].filter(Boolean);

const SearchSheet = ({ onAddCourse }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { firebaseUser, profile, updateRoomPrefs } = useAuth();
  const { courses, notes } = useRoomDesk();
  const [query, setQuery] = useState('');
  const [texts, setTexts] = useState(() => new Map(bodies));
  const [failed, setFailed] = useState(() => new Set());
  const [active, setActive] = useState(0);

  const uid = firebaseUser?.uid;
  const newest = useMemo(() => [...notes].sort((a, b) => noteTime(b) - noteTime(a)), [notes]);
  const colorOf = useMemo(() => new Map(courses.map((course) => [course.id, course.color])), [courses]);

  // The course "New note" means: the one on screen, else the one written in last.
  const hereId = courseFromPath(location.pathname);
  const course =
    courses.find((item) => item.id === hereId) ||
    courses.find((item) => item.id === newest[0]?.classId) ||
    courses[0] ||
    null;

  const trimmed = query.trim();
  const tagMode = trimmed.startsWith('#');
  const wantBodies = !tagMode && trimmed.length >= 2;
  const unread = newest.filter((note) => !failed.has(note.id) && texts.get(note.id)?.stamp !== stampOf(note));

  // The next few bodies to read, as ONE STRING, so the effect depends on which notes they
  // are rather than on a new array every render. Each finished batch updates `texts`, which
  // moves this on to the next batch — the reading carries on until nothing is left, and
  // typing (which does not change the batch) never restarts it.
  const nextBatch = wantBodies
    ? unread
        .slice(0, BATCH)
        .map((note) => `${note.classId}/${note.id}/${stampOf(note)}`)
        .join(',')
    : '';

  useEffect(() => {
    if (!nextBatch || !uid) return undefined;
    let cancelled = false;
    const batch = nextBatch.split(',').map((item) => {
      const [classId, id, stamp] = item.split('/');
      return { classId, id, stamp: Number(stamp) };
    });
    Promise.all(
      batch.map((note) =>
        getNoteAsOf(uid, note.classId, note.id, note.stamp)
          .then((full) => ({ note, text: pageText(full?.blocks || []) }))
          .catch(() => ({ note, text: null })),
      ),
    ).then((results) => {
      if (cancelled) return;
      const missed = [];
      results.forEach(({ note, text }) => {
        // Not on this device and no connection: say so rather than report "no match".
        if (text === null) missed.push(note.id);
        else bodies.set(note.id, { ...indexedText(text), stamp: note.stamp });
      });
      setTexts(new Map(bodies));
      if (missed.length) setFailed((prev) => new Set([...prev, ...missed]));
    });
    return () => {
      cancelled = true;
    };
  }, [nextBatch, uid]);

  const results = useMemo(
    () => searchDesk({ query: trimmed, courses, notes: newest, texts }),
    [trimmed, courses, newest, texts],
  );

  /* ── What the actions do ─────────────────────────────────────────────────── */

  const go = (path, options) => navigate(path, options);

  // Like the course page's "New note": made on this device, opened at once, online or not.
  const newNote = (courseId, title = '') => {
    if (!uid || !courseId) return;
    const { id, saved } = createPageNote(uid, courseId, {
      title: title.trim().slice(0, 120) || 'Untitled',
      blocks: startingBlocks(),
    });
    saved.catch((err) => console.error('The server refused that note', err));
    navigate(`/room/note/${courseId}/${id}`);
  };

  const fileInInbox = (text) => {
    if (!uid) return;
    addInboxEntry(uid, text).catch((err) => console.error('Could not file that', err));
    sayInRoom('In the inbox');
  };

  const setMood = (mood) =>
    updateRoomPrefs?.({ mood })?.catch?.((err) => console.error('Could not change the mood', err));

  // Read fresh on every render: a page's actions follow its state ("Pin" / "Unpin").
  const offered = pageActions();
  const offeredIds = new Set(offered.map((action) => action.id));
  const actions = [
    ...offered.filter((action) => !action.forTag),
    ...roomActions({
      go,
      courses,
      course,
      newNote,
      addCourse: onAddCourse,
      mood: resolveRoomPrefs(profile?.roomPrefs).mood,
      setMood,
    }).filter((action) => !offeredIds.has(action.id)),
  ];

  // One flat list, so ↑ ↓ and Enter walk it in the order it reads.
  const actionRow = (action, suffix = '') => ({
    kind: 'action',
    key: `a-${action.id}${suffix}`,
    label: action.label,
    hint: action.hint,
    run: action.run,
  });
  const noteRow = (hit) => ({ kind: 'note', key: hit.note.id, note: hit.note, snippet: hit.snippet, tag: hit.tag });

  let rows;
  if (!trimmed) {
    rows = [
      ...newest.slice(0, RECENT).map((note) => ({ kind: 'note', note, key: note.id })),
      ...offered
        .filter((action) => !action.forTag)
        .slice(0, IDLE_ACTIONS)
        .map((action) => actionRow(action)),
    ];
  } else if (tagMode) {
    // "#exam": the tags that start so, then the note on screen taking one — the tag in use
    // that was probably meant, and exactly what was typed — then the notes carrying them.
    const typed = cleanTag(trimmed);
    const meant = results.tags[0]?.tag;
    const offers = [...new Set([meant, typed].filter(Boolean))];
    rows = [
      ...results.tags.map(({ tag: name, count }) => ({ kind: 'tag', key: `t-${name}`, tag: name, count })),
      ...(typed
        ? offered
            .filter((action) => action.forTag)
            .flatMap((action) =>
              offers
                .filter((tag) => !action.has?.(tag))
                .map((tag) => ({ ...actionRow(action, tag), label: `${action.label} #${tag}`, run: () => action.run(tag) })),
            )
        : []),
      ...results.notes.map(noteRow),
    ];
  } else {
    const matched = matchActions(trimmed, actions, ACTIONS_SHOWN);
    // What was typed can become a note or an inbox line — unless it plainly named an action.
    const offerCreate = trimmed.length >= 2 && !matched.some((hit) => hit.strong);
    rows = [
      ...matched.filter((hit) => hit.strong).map((hit) => actionRow(hit.action)),
      ...results.courses.map((item) => ({ kind: 'course', course: item, key: `c-${item.id}` })),
      ...results.notes.map(noteRow),
      ...matched.filter((hit) => !hit.strong).map((hit) => actionRow(hit.action)),
      // Nothing has to answer for these two to be useful: type a title, press ↓ ↵.
      ...(course && offerCreate
        ? [
            {
              kind: 'action',
              key: 'a-create',
              label: `New note “${trimmed}”`,
              hint: course.name,
              run: () => newNote(course.id, trimmed),
            },
          ]
        : []),
      ...(offerCreate
        ? [{ kind: 'action', key: 'a-inbox', label: `Put “${trimmed}” in the inbox`, hint: 'Inbox', run: () => fileInInbox(trimmed) }]
        : []),
    ];
  }

  const current = Math.min(active, Math.max(rows.length - 1, 0));

  const choose = (row) => {
    if (!row) return;
    closeRoomSearch();
    if (row.kind === 'action') {
      row.run?.();
      return;
    }
    if (row.kind === 'tag') {
      navigate(`/room/notes?tag=${encodeURIComponent(row.tag)}`);
      return;
    }
    if (row.kind === 'course') {
      navigate(`/room/course/${row.course.id}`);
      return;
    }
    // Arriving with the query arms the note's own find, so the match is on screen. Not for a
    // note found by its tag: the tag is not in its text.
    const find = trimmed && !tagMode && !row.tag ? { state: { find: trimmed } } : undefined;
    navigate(`/room/note/${row.note.classId}/${row.note.id}`, find);
  };

  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!rows.length) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((current + step + rows.length) % rows.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(rows[current]);
    }
  };

  const status = (() => {
    if (!trimmed) return newest.length ? 'Recent' : '';
    if (tagMode) return results.tags.length || !cleanTag(trimmed) ? '' : 'No note has that tag yet';
    if (wantBodies && unread.length) return `Reading ${unread.length} ${unread.length === 1 ? 'note' : 'notes'}…`;
    if (failed.size) return `${failed.size} ${failed.size === 1 ? 'note is' : 'notes are'} not on this device yet`;
    return '';
  })();

  return (
    <Overlay open onClose={closeRoomSearch} label="Search">
      <input
        className="room-search-input"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
        placeholder="Search, or say what to do"
        aria-label="Search or run an action"
        autoFocus
      />

      {status && <p className="room-stamp room-search-status">{status}</p>}

      {trimmed && !rows.length && !(wantBodies && unread.length) && (
        <p className="room-setting-copy room-search-none">Nothing here matches “{trimmed}”.</p>
      )}

      {rows.length > 0 && (
        <ul className="room-search-list" role="listbox" aria-label="Results">
          {rows.map((row, i) => (
            <li key={row.key} role="option" aria-selected={i === current}>
              <button
                type="button"
                className={`room-search-row${i === current ? ' is-active' : ''}${row.kind === 'action' ? ' is-action' : ''}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(row)}
              >
                {row.kind === 'action' && (
                  <>
                    <span className="room-search-glyph" aria-hidden="true">
                      ›
                    </span>
                    <span className="room-search-title">{row.label}</span>
                    {row.hint && <span className="room-stamp">{row.hint}</span>}
                  </>
                )}
                {row.kind === 'tag' && (
                  <>
                    <span className="room-search-glyph" aria-hidden="true">
                      #
                    </span>
                    <span className="room-search-title">{row.tag}</span>
                    <span className="room-stamp">{plural(row.count, 'note')}</span>
                  </>
                )}
                {row.kind === 'course' && (
                  <>
                    <Dot size={10} color={row.course.color} />
                    <span className="room-search-title">{row.course.name}</span>
                    <span className="room-stamp">Course</span>
                  </>
                )}
                {row.kind === 'note' && (
                  <>
                    <Dot size={9} color={colorOf.get(row.note.classId)} />
                    <span className="room-search-text">
                      <span className="room-search-title">{row.note.title || 'Untitled'}</span>
                      {row.snippet && (
                        <span className="room-search-snippet">
                          {row.snippet.before}
                          <mark>{row.snippet.match}</mark>
                          {row.snippet.after}
                        </span>
                      )}
                      {!row.snippet && row.tag && <span className="room-search-snippet">#{row.tag}</span>}
                    </span>
                    <span className="room-stamp">
                      {row.note.className} · {noteStamp(row.note)}
                    </span>
                  </>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="room-stamp room-search-foot">↑ ↓ to move · ↵ to open · # for tags · Esc to close</p>
    </Overlay>
  );
};

// Always mounted by RoomLayout: owns ⌘K / Ctrl+K for every room page — and the course sheet
// that "Add a course" opens, which has to outlive the search sheet that asked for it.
const RoomSearch = () => {
  const shown = useSyncExternalStore(subscribeSearch, isSearchOpen, isSearchOpen);
  const [addingCourse, setAddingCourse] = useState(false);

  useEffect(() => {
    const onKey = (event) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && (event.key === 'k' || event.key === 'K')) {
        event.preventDefault();
        toggleRoomSearch();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Leaving the room with search open must not leave it open for the next visit.
  useEffect(() => () => closeRoomSearch(), []);

  return (
    <>
      {shown && <SearchSheet onAddCourse={() => setAddingCourse(true)} />}
      <CourseSheet open={addingCourse} onClose={() => setAddingCourse(false)} />
    </>
  );
};

export default RoomSearch;
