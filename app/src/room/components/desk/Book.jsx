import { useRef } from 'react';

// One course, as a closed book lying cover-up on the flow desk (prototype Home, RoomDesk, phones
// and tablets; the wide screens' books are the stage's slabs, DeskStage.jsx).
//
// Everything that varies per book arrives as custom properties from the pure layout
// (deskLayout.js): its cloth, its ink, its title's size, where it lies, its tilt and the shadow
// it casts by candlelight and by day. The CSS draws the rest — cloth, spine fold, page block
// (desk.css).
//
// The count follows the room's rule, EMPTY MEANS ABSENT: no notes, no count at all.
// A title in Arabic or Hebrew is set right to left, on a book bound on the right.

const Book = ({ course, look, rtl = false, picked = false, onPick }) => {
  const ref = useRef(null);
  const count = course.noteCount;

  // The rect is read in the click handler, never in render: the course page may fly the
  // book in from where it lay (deskFlight.js).
  const pick = () => onPick?.(course.id, ref.current?.getBoundingClientRect());

  return (
    <button
      ref={ref}
      type="button"
      className={`room-desk-book${rtl ? ' is-rtl' : ''}${picked ? ' is-picked' : ''}`}
      data-course-id={course.id}
      style={look}
      onClick={pick}
    >
      <span className="room-desk-shade" aria-hidden="true" />
      {/* Its thickness: the board edges and the page block, on the faces turned from the light. */}
      <span className="room-desk-book-edge" aria-hidden="true" />
      <span className="room-desk-book-cover">
        <span className="room-desk-book-title" dir="auto">
          {course.name}
        </span>
        {count ? (
          <span className="room-desk-book-count">
            {count} {count === 1 ? 'note' : 'notes'}
          </span>
        ) : null}
      </span>
    </button>
  );
};

export default Book;
