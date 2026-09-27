import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/authState';
import { createCourse, deleteClass, updateCourse } from '../../services/library';
import { cleanSchedule, WEEK_ORDER, WEEKDAY_SHORT } from '../calendarDays';
import { markGone, offerUndo, sayInRoom, unmarkGone } from '../roomUndo';
import { Overlay } from './Overlay';
import { Chip, Pill } from './primitives';

// A course, on a sheet of paper: its name and colour, and the three details the design
// calls optional — when it meets, the room, the professor (README: "Course fields (time,
// room, professor) are all optional"). Used to add a course from the desk and to edit one
// from its page.
//
// Courses are SHARED with classic. The details are new optional fields that classic never
// reads (dualmode.md §6.1); the calendar derives each week's classes from `schedule`.

// The design's six course colours. A course carried over from classic keeps the colour it
// was given there, which is offered first when you edit it.
const ROOM_COURSE_COLORS = ['#6b5bd2', '#2e8b6a', '#c24a6e', '#2f7bb8', '#c9711f', '#b08a12'];

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// What deleting takes with it, said plainly. The room cannot see a course's classic
// notes, so it has to name them — they go too.
const deleteCopy = (course) => {
  const here = Number(course?.noteCount) || 0;
  const classic = Math.max(0, (Number(course?.allNotes) || 0) - here);
  if (!here && !classic) return 'It has no notes.';
  if (!classic) return `Its ${plural(here, 'note')} go with it.`;
  if (!here) return `Its ${plural(classic, 'note')} in the classic design go with it.`;
  return `Every note in it goes too — ${here} here and ${classic} in the classic design.`;
};

const CourseForm = ({ course, onClose }) => {
  const navigate = useNavigate();
  const { firebaseUser } = useAuth();
  const editing = Boolean(course);
  const [initial] = useState(() => cleanSchedule(course?.schedule));

  const [name, setName] = useState(course?.name || '');
  const [color, setColor] = useState(course?.color || ROOM_COURSE_COLORS[0]);
  const [days, setDays] = useState(() => initial?.days || []);
  const [time, setTime] = useState(() => initial?.time || '');
  const [from, setFrom] = useState(() => initial?.from || '');
  const [until, setUntil] = useState(() => initial?.until || '');
  const [room, setRoom] = useState(course?.room || '');
  const [professor, setProfessor] = useState(course?.professor || '');

  const colors =
    course?.color && !ROOM_COURSE_COLORS.includes(course.color)
      ? [course.color, ...ROOM_COURSE_COLORS]
      : ROOM_COURSE_COLORS;

  const toggleDay = (day) =>
    setDays((prev) => (prev.includes(day) ? prev.filter((item) => item !== day) : [...prev, day]));

  // Neither write is awaited: both land in the local cache at once and the desk redraws
  // from its live listener, online or not.
  const save = (event) => {
    event.preventDefault();
    const cleanName = name.trim();
    if (!cleanName || !firebaseUser) return;
    const details = {
      // Null when no day is picked — that removes the schedule rather than storing an empty one.
      schedule: cleanSchedule({ days, time, from, until }),
      room: room.trim().slice(0, 60),
      professor: professor.trim().slice(0, 80),
    };
    if (editing) {
      updateCourse(firebaseUser.uid, course.id, { name: cleanName, color, ...details }).catch((err) => {
        console.error('Could not save that course', err);
        sayInRoom('That course could not be saved');
      });
    } else {
      createCourse(firebaseUser.uid, { name: cleanName, color, ...details }).saved.catch((err) => {
        console.error('Could not add that course', err);
        sayInRoom('That course could not be added');
      });
    }
    onClose();
  };

  // Undo instead of a confirm (dualmode.md §4.2). The cascade is server-side and cannot
  // be taken back, so it is not SENT until the undo window has passed — until then the
  // course is only hidden. It needs a connection, so offline it says so and does nothing.
  const remove = () => {
    if (!firebaseUser) return;
    if (!navigator.onLine) {
      sayInRoom('Deleting a course needs a connection');
      return;
    }
    const uid = firebaseUser.uid;
    const { id, name: courseName } = course;
    onClose();
    navigate('/room');
    offerUndo({
      message: `${courseName} deleted`,
      hides: [id],
      undo: () => {},
      commit: () => {
        markGone([id]);
        deleteClass(uid, id).catch((err) => {
          console.error('Could not delete that course', err);
          unmarkGone([id]);
          sayInRoom(`${courseName} could not be deleted`);
        });
      },
    });
  };

  return (
    <form onSubmit={save}>
      <input
        className="room-field"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="What is it called?"
        aria-label="Course name"
        maxLength={80}
        autoFocus
      />
      <div className="room-swatches">
        {colors.map((swatch) => (
          <button
            key={swatch}
            type="button"
            className="room-swatch"
            style={{ background: swatch }}
            aria-pressed={swatch === color}
            aria-label={`Colour ${swatch}`}
            onClick={() => setColor(swatch)}
          />
        ))}
      </div>

      <p className="room-form-label">Meets</p>
      <div className="room-days" role="group" aria-label="Days it meets">
        {WEEK_ORDER.map((day) => (
          <Chip key={day} selected={days.includes(day)} onClick={() => toggleDay(day)}>
            {WEEKDAY_SHORT[day]}
          </Chip>
        ))}
        <input
          type="time"
          className="room-field room-time-field"
          value={time}
          onChange={(event) => setTime(event.target.value)}
          aria-label="Start time"
          disabled={!days.length}
          title={days.length ? 'When it starts. Leave it empty if it varies.' : 'Pick a day first'}
        />
      </div>

      <div className="room-form-pair">
        <label className="room-form-field">
          <span className="room-form-label">Term starts</span>
          <input
            type="date"
            className="room-field"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            disabled={!days.length}
          />
        </label>
        <label className="room-form-field">
          <span className="room-form-label">Term ends</span>
          <input
            type="date"
            className="room-field"
            value={until}
            min={from || undefined}
            onChange={(event) => setUntil(event.target.value)}
            disabled={!days.length}
          />
        </label>
      </div>

      <div className="room-form-pair">
        <label className="room-form-field">
          <span className="room-form-label">Room</span>
          <input
            className="room-field"
            value={room}
            onChange={(event) => setRoom(event.target.value)}
            placeholder="Room 204"
            maxLength={60}
          />
        </label>
        <label className="room-form-field">
          <span className="room-form-label">Professor</span>
          <input
            className="room-field"
            value={professor}
            onChange={(event) => setProfessor(event.target.value)}
            placeholder="Who teaches it"
            maxLength={80}
          />
        </label>
      </div>

      <p className="room-setting-copy" style={{ marginTop: 16 }}>
        All optional, and nothing shows until you fill it in. The days put its classes on your
        calendar — only between the term dates, if you set them.
      </p>

      <div className="room-seg" style={{ marginTop: 20 }}>
        <Pill variant="primary" type="submit" disabled={!name.trim()}>
          {editing ? 'Save' : 'Add it'}
        </Pill>
        <Pill onClick={onClose}>Cancel</Pill>
      </div>

      {editing && (
        <div className="room-sheet-foot">
          <div>
            <div className="room-setting-name">Delete this course</div>
            <p className="room-setting-copy">
              {deleteCopy(course)} You can undo it for a few seconds.
            </p>
          </div>
          <button type="button" className="room-you-action" onClick={remove}>
            Delete
          </button>
        </div>
      )}
    </form>
  );
};

// The overlay unmounts its contents when closed, so every opening starts a fresh form from
// the course as it is now.
const CourseSheet = ({ open, course, onClose }) => (
  <Overlay open={open} onClose={onClose} title={course ? 'About this course' : 'A new course'}>
    <CourseForm course={course} onClose={onClose} />
  </Overlay>
);

export default CourseSheet;
