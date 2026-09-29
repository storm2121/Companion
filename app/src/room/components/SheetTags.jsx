import { cleanTags } from '../noteTags';

// A note's tags on its sheet in a grid: "#midterm #week-3 +2". Text, not buttons — the
// whole sheet is the button that opens the note; tags are browsed from All notes and ⌘K.
// Empty means absent: no tags, no line.

const SHOWN = 3;

const SheetTags = ({ tags }) => {
  const list = cleanTags(tags);
  if (!list.length) return null;
  const more = list.length - SHOWN;
  return (
    <p className="room-sheet-tags">
      {list.slice(0, SHOWN).map((tag) => (
        <span key={tag}>#{tag}</span>
      ))}
      {more > 0 && <span className="room-sheet-tags-more">+{more}</span>}
    </p>
  );
};

export default SheetTags;
