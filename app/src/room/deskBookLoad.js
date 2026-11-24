import { heldName, stateFor, tableUsable } from './deskTable';
import { loadCore, loadState, pictureUrl, stateNow } from './deskTableData';
import { getDeskBook, setDeskBook } from './deskBook';
import { MOOD_RAIN, resolveRoomPrefs } from './roomPrefs';

// The production held book for the deskBook store (CourseBook, the film): the held picture of a course's
// leather in a light state, its surround round it, its pages as one flat quad each. Moved here from TableDesk
// (owner fixes, 2026-11-23) so the book can be registered WITHOUT the desk: a reload at the book's own address
// (/room/course/:id with the desk as Home) lands on the book, not on the course's older page.

// The type setting of the opened book: the book's faces (EB Garamond for title and text, Figtree for the small
// labels). The owner has not chosen yet: 'room' gives the room's own faces (Bricolage, Figtree).
export const BOOK_TYPE = 'book';
// The page's inks on the held paper (r8m4-tones.py at the dimmest text corner: 8.69:1 by night, 10.41:1 by day
// for the ink; 4.67 / 5.59 the soft ink; 5.34 / 6.40 the action's).
const BOOK_INKS = { ink: '#261d16', soft: '#5a4636', action: '#6e2e14' };
const BOOK_PAPER = { night: '#ceb8a6', day: '#dccabc' };

export const heldEntry = (core, state, colour) => {
  const data = stateNow(state);
  const held = data?.held;
  const rec = held?.[heldName(colour)];
  if (!rec) return null;
  const c = core.held.crop;
  const pages = core.held.pages;
  const night = state.startsWith('night');
  return {
    frame: [core.held.frame.width, core.held.frame.height],
    box: [c.x, c.y, c.x + c.width, c.y + c.height],
    extent: core.held.surround,
    src: { x1: pictureUrl(rec, 1), x2: pictureUrl(rec, 2) },
    surround: held['held-surround'] ? { x1: pictureUrl(held['held-surround'], 1), x2: pictureUrl(held['held-surround'], 2), box: held['held-surround'].box } : null,
    ground: night ? '#2a170d' : '#615553',
    paper: night ? BOOK_PAPER.night : BOOK_PAPER.day,
    ...BOOK_INKS,
    leather: heldName(colour).slice(5),
    pages: Object.fromEntries(['left', 'right'].map((side) => [side, { quad: pages[side].text, page: pages[side].page, grid: pages[side].grid, flat: true }])),
  };
};

// `stateOf()`: the light state the desk asks for now. The book is held in that state once its file has been READ, and
// until then in the last one that was (owner fixes 2: a book opened just after the lamp or the candle was pressed asked
// for a state not read yet, had no picture, and showed its words alone on a flat ground: one of the pages that "showed
// and went").
export const registerDeskBook = (core, stateOf) => {
  let last = null;
  const usable = () => {
    const wished = stateOf();
    if (stateNow(wished)) last = wished;
    return last || wished;
  };
  setDeskBook({
    forceDesk: false,
    type: BOOK_TYPE,
    stateNow: usable,
    held: (s, colour) => heldEntry(core, stateNow(s) ? s : usable(), colour),
  });
};

// The book without the desk: the table's core and the light state the saved preferences ask for are read (as DeskHome
// reads them) and the book registered in that state. False when the pictures cannot be read (the course then shows as
// its older page, as with round seven's desk). Asked once per visit.
let asked = null;
export const loadDeskBook = (roomPrefs) => {
  if (getDeskBook()) return Promise.resolve(true);
  if (!asked) {
    const prefs = resolveRoomPrefs(roomPrefs);
    const state = stateFor({ night: prefs.mood !== MOOD_RAIN, candle: roomPrefs?.deskCandle === 'C1' ? 'C1' : 'C0', lamp: roomPrefs?.deskLamp === true });
    asked = loadCore()
      .then((core) =>
        loadState(core, state).then((data) => {
          if (!tableUsable({ core, state: data })) return false;
          if (!getDeskBook()) registerDeskBook(core, () => state);
          return true;
        }),
      )
      .catch(() => false);
  }
  return asked;
};
