import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/authState';
import { getNote } from '../services/library';
import { pageText } from './pageBlocks';
import {
  closeRoomSearch,
  indexedText,
  isSearchOpen,
  searchDesk,
  subscribeSearch,
  toggleRoomSearch,
} from './deskSearch';
import { noteStamp, noteTime, useRoomDesk } from './roomData';
import { Dot } from './components/primitives';
import { Overlay } from './components/Overlay';

// ⌘K — the design's only search (6a's top line: "Search ⌘K"). Undesigned beyond that, so it
// is built from parts the room already has: an overlay sheet, a field, plain rows.
//
// Titles match instantly from the notes already in memory. Bodies are read only once a
// real query is typed, newest note first, a few at a time, through the cache-first
// `getNote` — and each is kept for the rest of the visit, stamped with when the note last
// changed, so an unchanged note is never read twice.

// noteId -> { text, folded, stamp }. Module-level, so reopening search starts warm.
const bodies = new Map();
const stampOf = (note) => note?.contentUpdatedAt?.toMillis?.() || noteTime(note);

const BATCH = 6;
const RECENT = 5;

const SearchSheet = () => {
  const navigate = useNavigate();
  const { firebaseUser } = useAuth();
  const { courses, notes } = useRoomDesk();
  const [query, setQuery] = useState('');
  const [texts, setTexts] = useState(() => new Map(bodies));
  const [failed, setFailed] = useState(() => new Set());
  const [active, setActive] = useState(0);

  const uid = firebaseUser?.uid;
  const newest = useMemo(() => [...notes].sort((a, b) => noteTime(b) - noteTime(a)), [notes]);
  const colorOf = useMemo(() => new Map(courses.map((course) => [course.id, course.color])), [courses]);

  const trimmed = query.trim();
  const wantBodies = trimmed.length >= 2;
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
        getNote(uid, note.classId, note.id)
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

  // One flat list, so ↑ ↓ and Enter walk it in the order it reads.
  const rows = useMemo(() => {
    if (!trimmed) {
      return newest.slice(0, RECENT).map((note) => ({ kind: 'note', note, key: note.id }));
    }
    return [
      ...results.courses.map((course) => ({ kind: 'course', course, key: `c-${course.id}` })),
      ...results.notes.map((hit) => ({ kind: 'note', note: hit.note, snippet: hit.snippet, key: hit.note.id })),
    ];
  }, [trimmed, newest, results]);

  const current = Math.min(active, Math.max(rows.length - 1, 0));

  const go = (row) => {
    if (!row) return;
    closeRoomSearch();
    if (row.kind === 'course') {
      navigate(`/room/course/${row.course.id}`);
      return;
    }
    // Arriving with the query arms the note's own find, so the match is on screen.
    navigate(`/room/note/${row.note.classId}/${row.note.id}`, trimmed ? { state: { find: trimmed } } : undefined);
  };

  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!rows.length) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((current + step + rows.length) % rows.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      go(rows[current]);
    }
  };

  const status = (() => {
    if (!trimmed) return newest.length ? 'Recent' : '';
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
        placeholder="Search your notes and courses"
        aria-label="Search"
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
                className={`room-search-row${i === current ? ' is-active' : ''}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(row)}
              >
                {row.kind === 'course' ? (
                  <>
                    <Dot size={10} color={row.course.color} />
                    <span className="room-search-title">{row.course.name}</span>
                    <span className="room-stamp">Course</span>
                  </>
                ) : (
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
                    </span>
                    <span className="room-stamp">{row.note.className} · {noteStamp(row.note)}</span>
                  </>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="room-stamp room-search-foot">↑ ↓ to move · ↵ to open · Esc to close</p>
    </Overlay>
  );
};

// Always mounted by RoomLayout: owns ⌘K / Ctrl+K for every room page.
const RoomSearch = () => {
  const shown = useSyncExternalStore(subscribeSearch, isSearchOpen, isSearchOpen);

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

  return shown ? <SearchSheet /> : null;
};

export default RoomSearch;
