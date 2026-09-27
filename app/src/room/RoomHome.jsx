import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/authState';
import RoomShell from './RoomShell';
import Paper from './components/Paper';
import CaptureScrap from './components/CaptureScrap';
import CourseSheet from './components/CourseSheet';
import SceneSlot from './components/SceneSlot';
import { Dot, PencilRule } from './components/primitives';
import { courseMeta } from './calendarDays';
import { deskClock, deskStatus, noteStamp, timeOfDayWord, useRoomDesk } from './roomData';
import { tiltFor, useMinuteClock } from './roomPrefs';

// Home — design 6a/6f. Land, see what is next, open a course, jot one line.
//
// Every optional field obeys non-negotiable #5, EMPTY MEANS ABSENT: a course with no
// schedule renders no schedule line, one with no room notes renders no count and no
// "LAST" row, and "Where you left off" does not exist until there is something to
// return to. Never a placeholder dash.

const RoomHome = () => {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { courses, recent } = useRoomDesk();
  const [newCourseOpen, setNewCourseOpen] = useState(false);

  // Ticks on the minute, so the clock line and the greeting word stay true.
  const now = useMinuteClock();
  const firstName = (profile?.displayName || '').trim().split(' ')[0] || 'there';
  const colorOf = (classId) => courses.find((c) => c.id === classId)?.color;

  return (
    <RoomShell>
      <div className="room-home">
        {/* ── Left: where you are, and one line you can throw somewhere ── */}
        <div className="room-home-left">
          <span className="room-clock room-rise">{deskClock(now)}</span>
          <h1 className="room-greeting room-rise" style={{ animationDelay: '0.07s' }}>
            {timeOfDayWord(now)}, {firstName}.
          </h1>
          <p className="room-status room-rise" style={{ animationDelay: '0.14s' }}>
            {deskStatus({ courses, recent, now })}
          </p>

          <SceneSlot stagger={3} />

          <CaptureScrap stagger={4} />
        </div>

        {/* ── Right: the desk itself ── */}
        <div className="room-home-right">
          <div className="room-section-head room-rise" style={{ animationDelay: '0.07s' }}>
            <h2 className="room-section-title">Your desk</h2>
            <button
              type="button"
              className="room-section-action"
              onClick={() => setNewCourseOpen(true)}
            >
              + New course
            </button>
          </div>
          <div className="room-desk-rule room-rise" style={{ animationDelay: '0.07s' }}>
            <PencilRule opacity={0.5} />
          </div>

          <div className="room-course-grid">
            {courses.map((course, i) => {
              const meta = courseMeta(course);
              return (
                <Paper
                  key={course.id}
                  tilt={tiltFor(i)}
                  stagger={i + 2}
                  interactive
                  onClick={() => navigate(`/room/course/${course.id}`)}
                >
                  <div className="room-course-top">
                    <Dot size={10} color={course.color} />
                    {course.noteCount && (
                      <span className="room-stamp">
                        {course.noteCount} {course.noteCount === 1 ? 'note' : 'notes'}
                      </span>
                    )}
                  </div>
                  <h3 className="room-course-name">{course.name}</h3>
                  {meta && <p className="room-course-meta">{meta}</p>}
                  {course.lastNote && (
                    <div className="room-course-last">
                      <span className="room-stamp">Last</span>
                      <span>{course.lastNote.title}</span>
                    </div>
                  )}
                </Paper>
              );
            })}
          </div>

          {/* Absent entirely until there is something to come back to. */}
          {recent.length > 0 && (
            <div className="room-recent">
              <div className="room-section-head">
                <h2 className="room-section-title">Where you left off</h2>
                <button type="button" className="room-section-action" onClick={() => navigate('/room/notes')}>
                  All notes
                </button>
              </div>
              <div className="room-recent-grid">
                {recent.map((note, i) => (
                  <Paper
                    key={note.id}
                    className="room-recent-chip"
                    tilt={tiltFor(i + 6)}
                    interactive
                    onClick={() => navigate(`/room/note/${note.classId}/${note.id}`)}
                  >
                    <Dot size={9} color={colorOf(note.classId)} />
                    <div style={{ minWidth: 0 }}>
                      <div className="room-recent-title">{note.title}</div>
                      <div className="room-stamp">{noteStamp(note, now)}</div>
                    </div>
                  </Paper>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <CourseSheet open={newCourseOpen} onClose={() => setNewCourseOpen(false)} />
    </RoomShell>
  );
};

export default RoomHome;
