import { useEffect } from 'react';

// The room's LATEST preference writer, for anything that writes later than the click that
// asked for it (run room2, finding R7).
//
// `updateRoomPrefs` (AuthContext, classic's and frozen) writes the WHOLE roomPrefs object,
// built from the profile of the render it was made in. A closure that runs seconds later —
// an Undo — holding an old one writes every other preference back to what it was then:
// remove a break, change the mood, press Undo, and the old mood came back with the break.
//
// RoomLayout, which is mounted for as long as the room is, keeps the newest writer here, so
// an Undo still finds it after the page that offered it has gone. This closes the Undo case.
// Two changes made before the first one's snapshot returns can still cross: that needs a
// field-path write in AuthContext itself.

let latest = null;

// Returns the function that takes this writer back out (only if it is still the latest).
export const setRoomPrefsWriter = (writer) => {
  latest = writer || null;
  return () => {
    if (latest === writer) latest = null;
  };
};

export const useRoomPrefsWriter = (updateRoomPrefs) => {
  useEffect(() => setRoomPrefsWriter(updateRoomPrefs), [updateRoomPrefs]);
};

// Always a promise, like the writer itself; rejected when the room is not open.
export const writeRoomPrefs = (patch) => {
  const writer = latest;
  if (!writer) return Promise.reject(new Error('The room is not open.'));
  return Promise.resolve().then(() => writer(patch));
};
