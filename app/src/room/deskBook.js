// The course as the opened book (round eight, run 3) — PURE (no DOM, no React).
//
// On the desk's stage a course is no longer a page of its own: it is the held book, a rendered picture of
// the book open on its rest (Blender, its own camera), and the course's words are laid on its two pages.
// Until the production pictures exist (track P2: prod1/scene2.json) this is reached ONLY when the harness
// registers the proposal pictures (`?book=1`, room-harness/main.jsx): the app itself registers nothing,
// so its course page is today's.
//
// The registered book: { forceDesk, held(light, leather) } where held() gives one picture's entry
//   { frame: [W, H], box: [x0, y0, x1, y1] (what must show whole), src: { x1, x2 }, ground (the window's
//     bars, where the picture does not reach), paper, ink, leather,
//     pages: { left: { quad, page, grid }, right: { ... } } }
// in the picture's 1x px: `quad` the text area's corners (TL, TR, BR, BL), `grid` rows x cols of where the
// text area's points lie on the picture (the page's cup), `page` the paper's own corners.

// This file is the small part every course page loads (is there a book?); the pages' geometry and words
// are deskBookPages.js, loaded with the book itself.

import { breakpointFor, isFlow } from './deskLayout.js';

/* ── The registered book ────────────────────────────────────────────────── */

let book = null;
const listeners = new Set();
export const setDeskBook = (value) => {
  book = value || null;
  listeners.forEach((fn) => fn());
};
export const getDeskBook = () => book;
export const subscribeDeskBook = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

// Owner fixes 3 (2026-11-23): the desk's other time of day (night <-> day) is no longer read in idle time after
// every load (79 pictures and their list, 1.4 MB, for a switch most visits never make). The candle asks for it as the pointer
// or the keyboard comes to it; and the desk leaves here a way to read those files into the browser's cache, which the
// You page calls when the pointer or the keyboard comes to its Mood control (a change there shows the desk in the
// other look the next time it is opened).
let lookWarmer = null;
export const setLookWarmer = (fn) => {
  lookWarmer = typeof fn === 'function' ? fn : null;
};
export const warmOtherLook = () => {
  try {
    lookWarmer?.();
  } catch {
    // A hint only.
  }
};

// The course shown as the book: a book registered, the desk as Home (or the harness's forcing it), and a
// window wide enough for the stage (phones and tablets keep today's page).
export const bookShows = ({ width, homeIsDesk = false }, registered = book) =>
  Boolean(registered) && (homeIsDesk || Boolean(registered.forceDesk)) && !isFlow(breakpointFor(width));

// The room's light as the held pictures know it: 'night' (any candle place) or 'day'.
export const bookLight = (roomKey) => (String(roomKey || '').startsWith('night') ? 'night' : 'day');
