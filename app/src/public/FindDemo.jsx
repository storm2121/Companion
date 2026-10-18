import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import { buildFindIndex, findRows } from './findIndex';
import { NOTE_ORDER, NOTES, pathOf } from './sceneData';
import { SAGE_NOTE } from './sageDemoData';
import { useReducedMotion } from './useReducedMotion';
import { MOOD_NAMES, readMood, setMoodChoice, subscribeMood } from './windowMood';

// ⌘K, working, on the home's "Find anything" tile. A real field: what is typed is searched as
// the app searches (findIndex.js, on the room's own deskSearch.js) across the desk the home
// shows — its three notes, as their captures show them written, and Sage's call note. ↑ ↓ move,
// ↵ acts: a note opens on its own page with the home's own transition (out of the row that was
// chosen), "Switch to …" changes the room in the window above, and the rest say what they would
// do on a desk of your own. ⌘K or Ctrl+K anywhere on the home comes here; Escape lets go. Focus
// is never held.

const INDEX = buildFindIndex({
  notes: [
    ...NOTE_ORDER.map((view) => {
      const note = NOTES[view];
      return {
        id: view,
        title: note.title,
        group: note.group,
        tags: note.tags,
        path: pathOf(view),
        body: [...note.body, note.text, note.shown.text],
      };
    }),
    {
      id: 'call-with-mira',
      title: SAGE_NOTE.title,
      group: SAGE_NOTE.group,
      tags: SAGE_NOTE.tags,
      path: '/sage',
      body: SAGE_NOTE.before.flatMap((block) => (block.type === 'check' ? block.items.map((item) => item.text) : [block.text])),
    },
  ],
  groups: [...new Set(NOTE_ORDER.map((view) => NOTES[view].group))],
});

const FIRST_QUERY = 'aliasing';
// What was typed survives a visit to a note's page, so coming back folds the note into the row
// it was opened from.
let remembered = FIRST_QUERY;

const APPLE = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '');
const SHORTCUT = APPLE ? '⌘K' : 'Ctrl K';

const Snippet = ({ snippet }) => (
  <span className="mx-find-snip">
    {snippet.before}
    <mark>{snippet.match}</mark>
    {snippet.after}
  </span>
);

const FindDemo = ({ titleId }) => {
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const { mood } = useSyncExternalStore(subscribeMood, readMood, readMood);
  const uid = useId();
  const listId = `${uid}-list`;
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const [query, setQuery] = useState(remembered);
  const [active, setActive] = useState(0);
  const [status, setStatus] = useState('');
  const rows = useMemo(() => findRows(INDEX, query, { mood }), [query, mood]);
  const current = Math.min(active, Math.max(rows.length - 1, 0));
  const activeRow = rows[current];

  const type = (value) => {
    remembered = value;
    setQuery(value);
    setActive(0);
    setStatus('');
  };

  const act = (row) => {
    if (!row) return;
    if (row.kind === 'note') {
      if (row.path === '/sage') navigate('/sage');
      else navigate(row.path, { state: { opener: 'find' } });
      return;
    }
    if (row.kind === 'group') {
      navigate('/desk');
      return;
    }
    if (row.kind === 'mood') {
      setMoodChoice(row.mood);
      setStatus(`The room is in ${MOOD_NAMES[row.mood]} now.`);
      return;
    }
    setStatus(row.says ?? '');
  };

  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive(Math.min(Math.max(current + step, 0), Math.max(rows.length - 1, 0)));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      act(activeRow);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setStatus('');
      inputRef.current?.blur();
    }
  };

  // The row picked by keys stays in view inside the list.
  useEffect(() => {
    const list = listRef.current;
    const row = list?.children[current];
    if (!list || !row) return;
    const top = row.offsetTop;
    const bottom = top + row.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
  }, [current]);

  // ⌘K / Ctrl+K anywhere on the home brings the field into view, ready to type over.
  useEffect(() => {
    const onKey = (event) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'k') return;
      const input = inputRef.current;
      if (!input) return;
      event.preventDefault();
      input.focus({ preventScroll: true });
      input.select();
      input.closest('.mx-tile')?.scrollIntoView({ block: 'center', behavior: reduce ? 'instant' : 'smooth' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [reduce]);

  return (
    <div className="mx-find">
      <div className="mx-find-field">
        <kbd className="mx-key">{SHORTCUT}</kbd>
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-labelledby={titleId}
          aria-expanded={rows.length > 0}
          aria-controls={listId}
          aria-activedescendant={activeRow ? `${uid}-${activeRow.key}` : undefined}
          aria-autocomplete="list"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="go"
          placeholder="Search notes, or type a command"
          value={query}
          onChange={(event) => type(event.target.value)}
          onKeyDown={onKeyDown}
          onFocus={(event) => event.target.select()}
        />
      </div>
      <ul className="mx-find-list" id={listId} role="listbox" aria-label="Results" ref={listRef}>
        {rows.map((row, index) => (
          <li
            key={row.key}
            id={`${uid}-${row.key}`}
            role="option"
            aria-selected={index === current}
            className={index === current ? 'is-on' : undefined}
            data-target={row.kind === 'note' && row.path !== '/sage' ? row.view : undefined}
            data-source="find"
            onPointerMove={() => index !== current && setActive(index)}
            // Choosing with the pointer keeps the caret where it was.
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => act(row)}
          >
            <span className="mx-find-row">
              <span className="mx-find-label">{row.label}</span>
              <span className="mx-find-hint">{row.hint}</span>
            </span>
            {row.snippet && <Snippet snippet={row.snippet} />}
          </li>
        ))}
        {!rows.length && <li className="mx-find-none" role="presentation">Nothing on this desk says that.</li>}
      </ul>
      <p className="mx-find-keys" aria-hidden="true">
        <span>
          <kbd className="mx-key">↑</kbd>
          <kbd className="mx-key">↓</kbd> move
        </span>
        <span>
          <kbd className="mx-key">↵</kbd> open
        </span>
        <span>
          <kbd className="mx-key">esc</kbd> close
        </span>
      </p>
      <p className="mx-find-status" role="status">
        {status}
      </p>
    </div>
  );
};

export default FindDemo;
