import { Dot } from '../primitives';
import SheetTags from '../SheetTags';

// The open notebook in the middle of the desk (prototype Home, RoomDesk): two facing pages.
// Left, "Where you left off" — the latest notes across every course. Right, the latest
// note itself, open: its course and kind, its title, its first lines (read lazily by
// usePageLines; its summary only when the page has no lines), its tags, and "Continue
// writing". By candlelight its pages are the room's smoked glass, by day its paper, like
// every other sheet in the room (desk.css).
//
// On a phone it is one card: the latest note first, then the rest of the list.
// Nothing written yet: one quiet line, and the right page stays blank.

const Row = ({ note, color, stamp, onOpen }) => (
  <li>
    <button type="button" className="room-desk-nb-row" onClick={() => onOpen(note)}>
      <Dot size={8} color={color} />
      <span className="room-desk-nb-row-text">
        <span className="room-desk-nb-row-title" dir="auto">
          {note.title}
        </span>
        <span className="room-desk-nb-row-stamp">{stamp(note)}</span>
      </span>
    </button>
  </li>
);

// Nothing read yet.
const NO_PAGE = { lines: [], read: false };

const Latest = ({ note, color, page, onOpen }) => {
  const text = page.lines.length ? page.lines.join('\n') : page.read ? note.summary : '';
  return (
    <article className="room-desk-nb-latest">
      {(note.className || note.kind) && (
        <p className="room-desk-nb-meta">
          {note.className && (
            <span className="room-desk-nb-course" dir="auto">
              {note.className}
            </span>
          )}
          {/* The kind in the course's own colour, as on the note's sheet in the course. */}
          {note.kind && (
            <span className="room-desk-nb-kind" style={color ? { '--room-course': color } : undefined}>
              {note.kind}
            </span>
          )}
        </p>
      )}
      <h3 className="room-desk-nb-title" dir="auto">
        {note.title}
      </h3>
      {text && (
        <p className={page.lines.length ? 'room-desk-nb-lines' : 'room-desk-nb-summary'} dir="auto">
          {text}
        </p>
      )}
      <SheetTags tags={note.tags} />
      <button type="button" className="room-desk-action" onClick={() => onOpen(note)}>
        Continue writing
      </button>
    </article>
  );
};

const Notebook = ({ notes, colorOf, stamp, onOpen, page = NO_PAGE, single = false, style }) => {
  const latest = notes[0];
  const open = latest && <Latest note={latest} color={colorOf(latest.classId)} page={page} onOpen={onOpen} />;
  const empty = <p className="room-desk-nb-empty">Your first note will show up here.</p>;
  const list = (items) => (
    <ul className="room-desk-nb-list">
      {items.map((note) => (
        <Row key={note.id} note={note} color={colorOf(note.classId)} stamp={stamp} onOpen={onOpen} />
      ))}
    </ul>
  );
  const heading = (
    <h2 id="room-desk-nb-heading" className="room-desk-nb-heading">
      Where you left off
    </h2>
  );

  if (single) {
    return (
      <section className="room-desk-notebook is-single" aria-labelledby="room-desk-nb-heading" style={style}>
        <span className="room-desk-shade" aria-hidden="true" />
        <div className="room-desk-nb-page">
          {heading}
          {latest ? open : empty}
          {notes.length > 1 && list(notes.slice(1))}
          <span className="room-desk-nb-ribbon" aria-hidden="true" />
          <span className="room-desk-nb-curl" aria-hidden="true" />
        </div>
      </section>
    );
  }

  return (
    <section className="room-desk-notebook" aria-labelledby="room-desk-nb-heading" style={style}>
      <span className="room-desk-shade" aria-hidden="true" />
      <div className="room-desk-nb-page room-desk-nb-page--left">
        {heading}
        {latest ? list(notes) : empty}
      </div>
      <div className="room-desk-nb-page room-desk-nb-page--right">
        {open}
        <span className="room-desk-nb-ribbon" aria-hidden="true" />
        <span className="room-desk-nb-curl" aria-hidden="true" />
      </div>
      <span className="room-desk-nb-gutter" aria-hidden="true" />
    </section>
  );
};

export default Notebook;
