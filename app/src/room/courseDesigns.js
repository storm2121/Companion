// Which design a course belongs to (owner, 2026-09-29: "make the old courses only visible in
// the old version and vice versa").
//
// A course the room makes carries `design: 'room'` and only the room lists it. Every course
// from before — none of them carries the field — is classic's, and only classic lists it,
// with one exception kept so nothing written in the room disappears: an older course that
// already holds room notes still shows in the room. Once every note in such a course is a
// room note, it is marked as the room's and classic stops listing it (roomData.js).
//
// DOM-free: tests/room.unit.test.mjs loads it under Node.

export const COURSE_DESIGN_ROOM = 'room';

export const isRoomCourse = (course) => course?.design === COURSE_DESIGN_ROOM;

// Whether the room lists a course, given how many room notes it holds.
export const showInRoom = (course, pageCount = 0) => isRoomCourse(course) || pageCount > 0;

// Whether an older course is worth checking to become the room's: not marked yet, some
// room notes, their list confirmed by the SERVER (a cache can be stale either way), and the
// course's own count of all its notes — both designs — no higher than the room notes seen.
// The caller then counts the course's notes on the server before marking it: only if every
// one of them is a room note does classic lose nothing.
export const readyToMarkRoom = ({ course, pageCount = 0, serverSeen = false }) =>
  Boolean(course) &&
  !isRoomCourse(course) &&
  serverSeen &&
  pageCount > 0 &&
  (Number(course.noteCount) || 0) <= pageCount;
