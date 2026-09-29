import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import RoomShell from './RoomShell';
import Paper from './components/Paper';
import SheetTags from './components/SheetTags';
import { Dot, Pill } from './components/primitives';
import { countWord } from './calendarDays';
import { cleanTag, hasTag } from './noteTags';
import { noteStamp, noteTime, useRoomDesk, useTagsInUse } from './roomData';
import { tiltFor } from './roomPrefs';

// All notes — the link beside "Where you left off" on Home (6a). The design names it and
// never draws it, so it is the Course page's grid across every course: newest first, each
// sheet stamped with the course it lives in. No sort control and no filter row — the design
// deletes those everywhere; ⌘K is how you look for one note.
//
// The one exception is a TAG. `?tag=midterm` (from a tag on a note, or ⌘K's "#") narrows
// the grid to the notes carrying it; and once any note has a tag, the tags in use sit as
// one quiet line under the count, so they can be browsed as well as searched.

const plural = (n, word) => (n === 1 ? word : `${word}s`);

const RoomNotes = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { courses, notes } = useRoomDesk();
  const tagsInUse = useTagsInUse();
  const tag = cleanTag(params.get('tag'));

  const colorOf = useMemo(() => new Map(courses.map((course) => [course.id, course.color])), [courses]);
  const shown = useMemo(
    () => [...(tag ? notes.filter((note) => hasTag(note, tag)) : notes)].sort((a, b) => noteTime(b) - noteTime(a)),
    [notes, tag],
  );
  const courseCount = new Set(shown.map((note) => note.classId)).size;
  const across = `across ${countWord(courseCount).toLowerCase()} ${plural(courseCount, 'course')}`;

  let summary;
  if (tag) {
    summary = shown.length
      ? `${countWord(shown.length)} ${plural(shown.length, 'note')} tagged #${tag}, ${across}.`
      : `No note is tagged #${tag} any more.`;
  } else {
    summary = notes.length
      ? `${countWord(notes.length)} ${plural(notes.length, 'note')} ${across}.`
      : 'Nothing written in this design yet. Open a course to start a note.';
  }

  const openTag = (name) => navigate(name ? `/room/notes?tag=${encodeURIComponent(name)}` : '/room/notes');

  return (
    <RoomShell back="Desk" onBack={() => navigate('/room')}>
      <div className="room-course-head room-rise">
        <div>
          <h1 className="room-course-title">{tag ? `#${tag}` : 'All notes'}</h1>
          <p className="room-course-sub">{summary}</p>
          {tagsInUse.length > 0 && (
            <p className="room-tag-line" aria-label="Tags">
              {tagsInUse.slice(0, 16).map(({ tag: name, count }) => (
                <button
                  key={name}
                  type="button"
                  className={`room-tag-link${name === tag ? ' is-on' : ''}`}
                  onClick={() => openTag(name === tag ? '' : name)}
                  aria-pressed={name === tag}
                >
                  #{name}
                  <span className="room-tag-count">{count}</span>
                </button>
              ))}
            </p>
          )}
        </div>
        {tag && <Pill onClick={() => openTag('')}>All notes</Pill>}
      </div>

      <div className="room-note-grid">
        {shown.map((note, i) => (
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
            <SheetTags tags={note.tags} />
          </Paper>
        ))}
      </div>
    </RoomShell>
  );
};

export default RoomNotes;
