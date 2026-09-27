import { useSyncExternalStore } from 'react';

// One undo line for the whole room (dualmode.md §4.2: deletes never ask, they offer undo).
//
// It lives OUTSIDE React, in this module, so it survives moving between pages: deleting a
// course takes you back to the desk, and its undo has to come along. RoomLayout renders
// the line and settles whatever is still waiting when the room is left.
//
// Two kinds of action use it:
//  - REVERSIBLE writes (an inbox line, a calendar item) happen at once; `undo` writes the
//    thing back. Nothing is hidden and nothing waits.
//  - IRREVERSIBLE server cascades (deleting notes or a course) must not happen until the
//    window has passed, so "undo" can mean "it never happened". Their ids go in `hides`
//    while waiting; `commit` runs when the window closes. A committed id should be passed
//    to `markGone`, which keeps it hidden until the live data drops it — un-hiding it the
//    moment the request left made it flicker back for the second the server took.
//
// Only one action waits at a time: offering a new one settles the previous one first.

export const UNDO_MS = 6000;

let state = { entry: null, gone: new Set(), hidden: new Set() };
const listeners = new Set();

const publish = (next) => {
  const merged = { ...state, ...next };
  merged.hidden = new Set([...(merged.entry?.hides || []), ...merged.gone]);
  state = merged;
  listeners.forEach((listener) => listener());
};

const settle = (entry) => {
  if (!entry) return;
  clearTimeout(entry.timer);
  if (state.entry === entry) publish({ entry: null });
  entry.commit?.();
};

// { message, undo?, commit?, hides?: [ids], action?: { label, run }, ms? }
// `action` is a second word on the line that is not an undo — "Filed in Paradigm · Open".
export const offerUndo = ({ message, undo, commit, hides, action, ms = UNDO_MS }) => {
  if (state.entry) settle(state.entry);
  const entry = { message, undo, commit, action, hides: hides || [] };
  entry.timer = setTimeout(() => settle(entry), ms);
  publish({ entry });
};

// A line with nothing to undo — "Deleting needs a connection".
export const sayInRoom = (message) => offerUndo({ message });

export const undoNow = () => {
  const { entry } = state;
  if (!entry) return;
  clearTimeout(entry.timer);
  publish({ entry: null });
  entry.undo?.();
};

// Leaving the room, or the tab, inside the window still means "do it".
export const settleNow = () => settle(state.entry);

export const markGone = (ids = []) => publish({ gone: new Set([...state.gone, ...ids]) });

export const unmarkGone = (ids = []) => {
  const gone = new Set(state.gone);
  ids.forEach((id) => gone.delete(id));
  publish({ gone });
};

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const snapshot = () => state;

// { entry, hidden } — `hidden` is every id a list should leave out right now.
export const useRoomUndo = () => useSyncExternalStore(subscribe, snapshot, snapshot);
