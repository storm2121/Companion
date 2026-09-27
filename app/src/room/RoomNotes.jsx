import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import RoomShell from './RoomShell';
import Paper from './components/Paper';
import { Dot } from './components/primitives';
import { countWord } from './calendarDays';
import { noteStamp, noteTime, useRoomDesk } from './roomData';
import { tiltFor } from './roomPrefs';

// All notes — the link beside "Where you left off" on Home (6a). The design names it and
// never draws it, so it is the Course page's grid across every course: newest first, each
// sheet stamped with the course it lives in. No sort control, no filter row — the design
// deletes those everywhere; ⌘K is how you look for one note.

const plural = (n, word) => (n === 1 ? word : `${word}s`);

const RoomNotes = () => {
  const navigate = useNavigate();
  const { courses, notes } = useRoomDesk();

  const colorOf = useMemo(() => new Map(courses.map((course) => [course.id, course.color])), [courses]);
  const newest = useMemo(() => [...notes].sort((a, b) => noteTime(b) - noteTime(a)), [notes]);
  const courseCount = new Set(notes.map((note) => note.classId)).size;

  const summary = notes.length
    ? `${countWord(notes.length)} ${plural(notes.length, 'note')} across ${countWord(courseCount).toLowerCase()} ${plural(courseCount, 'course')}.`
    : 'Nothing written in this design yet. Open a course to start a note.';

  return (
    <RoomShell back="Desk" onBack={() => navigate('/room')}>
      <div className="room-course-head room-rise">
        <div>
          <h1 className="room-course-title">All notes</h1>
          <p className="room-course-sub">{summary}</p>
        </div>
      </div>

      <div className="room-note-grid">
        {newest.map((note, i) => (
          <Paper
            key={note.id}
            tilt={tiltFor(i + 1)}
            stagger={Math.min(i + 2, 14)}
            interactive
            onClick={() => navigate(`/room/note/${note.classId}/${note.id}`)}
          >
            <div className="room-course-top">
              <span className="room-stamp room-notes-course">
                <Dot size={8} color={colorOf.get(note.classId)} />
                {note.className}
              </span>
              <span className="room-stamp">{noteStamp(note)}</span>
            </div>
            <h3 className="room-course-name" style={{ fontSize: 22 }}>
              {note.title}
            </h3>
            {note.kind && <p className="room-course-meta">{note.kind}</p>}
          </Paper>
        ))}
      </div>
    </RoomShell>
  );
};

export default RoomNotes;
