// What the room's screens read. Courses are SHARED with classic (same `classes`
// collection); notes are not — the room only ever sees notes whose format is 'page'.
//
// Everything here follows the design's fifth non-negotiable: EMPTY MEANS ABSENT.
// A course with no room notes has no count and no "last note" — those fields come back
// undefined, and the components render nothing rather than a zero or a dash.
//
// ONE SOURCE FOR THE WHOLE VISIT. RoomLayout (the parent route) owns the listeners and
// hands the data down by context, so moving between Home, a course, a note and You opens
// nothing new and reads nothing twice. It used to be a hook per page: every visit to Home
// or a course re-read every note in every course from the server. Now the room keeps one
// live listener on courses and one per course on PAGE notes only, and the persistent
// cache means both keep working — from cache — when the connection drops.

import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { countCourseNotes, listenToAllClasses, listenToPageNotes, markRoomCourse } from '../services/library';
import { readyToMarkRoom, showInRoom } from './courseDesigns';
import { classStatus } from './calendarDays';
import { tagCounts } from './noteTags';
import { useRoomUndo } from './roomUndo';

export const noteTime = (note) => {
  const updated = note?.updatedAt?.toMillis?.();
  if (Number.isFinite(updated)) return updated;
  const created = note?.createdAt?.toMillis?.();
  return Number.isFinite(created) ? created : 0;
};

/* ── Formatting ───────────────────────────────────────────────────────────── */

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

const pad = (n) => String(n).padStart(2, '0');

// "FRI 18 SEP · 21:40"
export const deskClock = (date = new Date()) =>
  `${DAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]} · ${pad(date.getHours())}:${pad(date.getMinutes())}`;

// "Morning" / "Afternoon" / "Evening" — the greeting's first word.
export const timeOfDayWord = (date = new Date()) => {
  const hour = date.getHours();
  // Still up after midnight is still the evening; the morning starts at five.
  if (hour < 5) return 'Evening';
  if (hour < 12) return 'Morning';
  if (hour < 17) return 'Afternoon';
  return 'Evening';
};

// "TODAY 16:12" · "YESTERDAY" · "12 SEP"
export const noteStamp = (note, now = new Date()) => stampFor(noteTime(note), now);

// The same stamp for any moment given in milliseconds — an inbox line's `createdAt`.
export const stampFor = (ms, now = new Date()) => {
  if (!ms) return '';
  const then = new Date(ms);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (ms >= startOfToday) return `TODAY ${pad(then.getHours())}:${pad(then.getMinutes())}`;
  if (ms >= startOfToday - 86_400_000) return 'YESTERDAY';
  return `${then.getDate()} ${MONTHS[then.getMonth()]}`;
};

/* ── The desk ─────────────────────────────────────────────────────────────────── */

// Two contexts, not one: the note editor only needs courses, and a single context would
// re-render it every time its OWN save touched the note's `updatedAt`.
export const RoomCoursesContext = createContext({ courses: [], loading: true });
export const RoomNotesContext = createContext([]);

// Owned by RoomLayout. Everything below the room reads from what this returns.
export const useRoomDataSource = (uid) => {
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notesByCourse, setNotesByCourse] = useState({});
  // Courses whose room notes the SERVER has confirmed — the only ones safe to judge by them.
  const [serverSeen, setServerSeen] = useState(() => new Set());
  const checked = useRef(new Set());

  useEffect(() => {
    if (!uid) return undefined;
    return listenToAllClasses(
      uid,
      (snapshot) => {
        setCourses(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) })));
        setLoading(false);
      },
      (err) => {
        console.error('Room course listener failed', err);
        setLoading(false);
      },
    );
  }, [uid]);

  // Keyed on the SET of course ids, so a rename, a colour change or a note count ticking
  // up does not tear down and re-open every note listener.
  const courseIds = useMemo(() => JSON.stringify(courses.map((course) => course.id)), [courses]);

  useEffect(() => {
    const ids = JSON.parse(courseIds);
    if (!uid || !ids.length) return undefined;
    const stops = ids.map((classId) =>
      listenToPageNotes(
        uid,
        classId,
        (snapshot) => {
          const list = snapshot.docs.map((docSnap) => ({
            id: docSnap.id,
            ...(docSnap.data() || {}),
            classId,
          }));
          setNotesByCourse((prev) => ({ ...prev, [classId]: list }));
          if (!snapshot.metadata?.fromCache) {
            setServerSeen((prev) => (prev.has(classId) ? prev : new Set(prev).add(classId)));
          }
        },
        (err) => console.error('Room note listener failed', err),
      ),
    );
    return () => stops.forEach((stop) => stop());
  }, [uid, courseIds]);

  // Each design keeps its own courses (room/courseDesigns.js): the room lists what it made,
  // and an older course only while it holds room notes.
  const roomCourses = useMemo(
    () => courses.filter((course) => showInRoom(course, (notesByCourse[course.id] || []).length)),
    [courses, notesByCourse],
  );

  // An older course whose notes are ALL room notes becomes the room's, so classic stops
  // listing it. Checked once per course per visit: the course's own note count must not be
  // above the room notes seen, and then the server's count of all its notes must equal them.
  useEffect(() => {
    if (!uid) return;
    courses.forEach((course) => {
      const pageCount = (notesByCourse[course.id] || []).length;
      if (checked.current.has(course.id)) return;
      if (!readyToMarkRoom({ course, pageCount, serverSeen: serverSeen.has(course.id) })) return;
      checked.current.add(course.id);
      countCourseNotes(uid, course.id)
        .then((total) => (total === pageCount ? markRoomCourse(uid, course.id) : undefined))
        .catch((err) => {
          checked.current.delete(course.id);
          console.warn('Could not check which design a course belongs to', err);
        });
    });
  }, [uid, courses, notesByCourse, serverSeen]);

  // Names are joined here rather than when listening, so renaming a course updates every
  // note's course name without re-subscribing anything. Notes of a deleted course drop out.
  const notes = useMemo(() => {
    const names = new Map(roomCourses.map((course) => [course.id, course.name || '']));
    return Object.entries(notesByCourse)
      .filter(([classId]) => names.has(classId))
      .flatMap(([classId, list]) => list.map((note) => ({ ...note, className: names.get(classId) })));
  }, [roomCourses, notesByCourse]);

  const coursesValue = useMemo(() => ({ courses: roomCourses, loading }), [roomCourses, loading]);
  return { coursesValue, notes };
};

// A course waiting out its delete's undo window (or already sent to the server) is left
// out everywhere at once — the desk, the calendar, search, the move menu.
const useVisibleCourses = () => {
  const value = useContext(RoomCoursesContext);
  const { hidden } = useRoomUndo();
  return useMemo(
    () => (hidden.size ? { ...value, courses: value.courses.filter((course) => !hidden.has(course.id)) } : value),
    [value, hidden],
  );
};

// Just the courses — for pages that never show note lists (the editor, You).
export const useRoomCourses = () => useVisibleCourses();

// Courses decorated with their room notes, plus the three most recent notes.
export const useRoomDesk = () => {
  const { courses, loading } = useVisibleCourses();
  const allNotes = useContext(RoomNotesContext);
  const { hidden } = useRoomUndo();

  // Notes waiting out a delete's undo window stay out of every list, and so do the notes
  // of a course that is.
  const notes = useMemo(() => {
    if (!hidden.size) return allNotes;
    const live = new Set(courses.map((course) => course.id));
    return allNotes.filter((note) => !hidden.has(note.id) && live.has(note.classId));
  }, [allNotes, hidden, courses]);

  // Decorate each course with only what it actually has.
  const desk = useMemo(() => {
    const byCourse = new Map();
    notes.forEach((note) => {
      const list = byCourse.get(note.classId) || [];
      list.push(note);
      byCourse.set(note.classId, list);
    });

    return courses.map((course) => {
      const own = (byCourse.get(course.id) || []).sort((a, b) => noteTime(b) - noteTime(a));
      return {
        ...course,
        // undefined, not 0 — the sheet renders nothing at all when there is nothing.
        noteCount: own.length || undefined,
        // The course doc's own count covers BOTH designs; deleting says what goes with it.
        allNotes: Number(course.noteCount) || 0,
        lastNote: own[0],
        schedule: course.schedule || undefined,
        room: course.room || undefined,
      };
    });
  }, [courses, notes]);

  const recent = useMemo(
    () => [...notes].sort((a, b) => noteTime(b) - noteTime(a)).slice(0, 3),
    [notes],
  );

  return { courses: desk, notes, recent, loading };
};

// Every tag in use across the room's notes, most used first: [{ tag, count }]. Read from
// the notes context directly, so only what shows tags re-renders when a note changes —
// never the editor, which must not re-render on its own saves.
export const useTagsInUse = () => {
  const notes = useContext(RoomNotesContext);
  return useMemo(() => tagCounts(notes), [notes]);
};

// A course's notes as the design orders them: pinned first, then newest first.
export const sortCourseNotes = (notes = []) =>
  [...notes].sort(
    (a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || noteTime(b) - noteTime(a),
  );

// The one-sentence status under the greeting. It never invents a schedule: once a course
// says when it meets, the line is about the day ("Two classes today — …"); until then it
// reports only what the notes say.
//
// Takes `recent` — newest first — not the raw note list, which is in fetch order. Reading
// `notes[0]` named whichever course happened to come back first.
export const deskStatus = ({ courses, recent, now = new Date(), breaks = [] }) => {
  if (!courses.length) return 'Nothing on the desk yet. Add a course to start.';
  const today = classStatus({ courses, now, breaks });
  if (today) return today;
  if (!recent.length) {
    return 'Nothing written here yet. Open a course and start a note.';
  }
  return recent[0]?.className
    ? `You were last in ${recent[0].className}.`
    : 'Pick up where you left off.';
};
