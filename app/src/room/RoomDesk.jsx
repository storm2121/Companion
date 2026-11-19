import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/authState';
import RoomShell from './RoomShell';
import CaptureScrap from './components/CaptureScrap';
import CourseSheet from './components/CourseSheet';
import Desk from './components/desk/Desk';
import DeskStage from './components/desk/DeskStage';
import Book from './components/desk/Book';
import Notebook from './components/desk/Notebook';
import Candle from './components/desk/Candle';
import PhotoFrame from './components/desk/PhotoFrame';
import { useDeskBreakpoint, useReducedMotion, useViewport } from './components/desk/useDeskBreakpoint';
import { usePageLines } from './components/desk/usePageLines';
import { cleanBreaks } from './calendarDays';
import { deskClock, deskStatus, noteStamp, noteTime, timeOfDayWord, useRoomDesk } from './roomData';
import { MOOD_CANDLELIGHT, MOOD_RAIN, MOTION_STILL, resolveRoomPrefs, useMinuteClock } from './roomPrefs';
import {
  BP_PHONE,
  DAY_SHADOW,
  bookTilt,
  castShadow,
  coverBoard,
  coverInk,
  coverTone,
  deskLayout,
  isFlow,
  textDirection,
  titleSize,
} from './deskLayout';
import {
  arrangePiles,
  bringCloser,
  candleOf,
  candlePlaces,
  isNearPlace,
  moveInPile,
  moveTo,
  moveToOtherPile,
  nightKeyOf,
  putBack,
  spineLook,
} from './deskStage';
import { usePageActions } from './roomCommands';
import { offerUndo } from './roomUndo';
import { rememberPick } from './deskFlight';
import { useDeskReturn } from './deskFlightRun';
import scene from './assets/desk/scene.json';
import './desk.css';

// PROTOTYPE — "the desk in the room", a Home to replace RoomHome's card grid. Not routed
// in App.jsx; the room-harness shows it at /room with ?proto=desk.
//
// The room stays the room: Candlelight's picture (or Rain's grey day) is the wall, and in
// front of it a wooden desk with real things on it — the candle (the mood switch), the open
// notebook (where you left off), the courses as books, the quick-capture scrap and the
// Home's picture in a frame. Same data and shell as RoomHome; every position comes from the
// pure deskLayout.js, never from the DOM.
//   - Wide screens (from 1100px): the stage (DeskStage) — the room as Blender rendered it from
//     the chair (room-harness/blender): the courses as books in two piles, the notebook on its
//     stand, the scrap, the Home's picture on the wall; the page puts its words on the quads
//     the render wrote (scene.json). No camera motion of any kind.
//   - Phones and tablets: the stacked flow desk of rounds one and two (Desk).
//
// EMPTY MEANS ABSENT holds throughout: no notes, no count; nothing written, no open page; no
// courses, no books — the notebook's one line, the candle, the card, a first book's ghost. The
// frame on the wall always hangs (on the stage it is part of the rendered room: the set is made
// with it in place, so only its own picture may cover where it is).

// How long a picked book takes to finish lifting before its course opens.
const PICK_MS = 180;
// Notes on the notebook's left page.
const RECENT = 5;
const px = (n) => `${n}px`;

// An object's two shadows as custom properties (desk.css .room-desk-shade): the flow desk.
const shadeVars = (night, day = DAY_SHADOW) => ({
  '--sn-x': px(night.dx),
  '--sn-y': px(night.dy),
  '--sn-blur': px(night.blur),
  '--sn-a': night.alpha,
  '--sd-x': px(day.dx),
  '--sd-y': px(day.dy),
  '--sd-blur': px(day.blur),
  '--sd-a': day.alpha,
});

// On the flow desks the candle is small and in a corner: a short shadow straight down.
const FLOW_NIGHT = { dx: 0, dy: 8, blur: 16, alpha: 0.42 };

// A book's cloth and ink, for either desk.
const clothOf = (course, i) => ({
  '--cover': coverTone(course.color),
  '--cover-board': coverBoard(course.color),
  '--ink': coverInk(course.color),
  // Each book is cut from a different part of the cloth.
  '--cloth-at': `${(i * 89) % 256}px ${(i * 53) % 256}px`,
});

// A book on the flow desk: desk.css places it; the layout says where its shadow falls.
const flowLook = (course, i, layout) => {
  const slot = layout.books[i];
  const night = castShadow(slot && { x: slot.deskX, y: slot.deskY, width: slot.width, height: slot.height }, layout.candle);
  return {
    ...clothOf(course, i),
    '--tilt': `${bookTilt(i)}deg`,
    // The flow desks' books are ~148px wide; a cover keeps ~30px for its spine and margins.
    '--title-size': px(titleSize(course.name, 118)),
    ...shadeVars(night),
  };
};

const RoomDesk = () => {
  const navigate = useNavigate();
  const { firebaseUser, profile, updateRoomPrefs } = useAuth();
  const { courses, notes, recent } = useRoomDesk();
  const [newCourseOpen, setNewCourseOpen] = useState(false);
  const [pickedId, setPickedId] = useState(null);
  const pickTimer = useRef(null);

  // Ticks on the minute, so the clock line and the greeting word stay true.
  const now = useMinuteClock();
  const breakpoint = useDeskBreakpoint();
  const viewport = useViewport();
  const flow = isFlow(breakpoint);
  const firstName = (profile?.displayName || '').trim().split(' ')[0] || 'there';
  const breaks = useMemo(() => cleanBreaks(profile?.roomPrefs?.breaks), [profile?.roomPrefs?.breaks]);
  const prefs = resolveRoomPrefs(profile?.roomPrefs);
  // The candle answers its click at once: the wished state holds until the saved one catches up.
  const savedLit = prefs.mood !== MOOD_RAIN;
  const [litWish, setLitWish] = useState(null);
  const lit = litWish && litWish.from === savedLit ? litWish.to : savedLit;
  const reduced = useReducedMotion();
  const still = prefs.motion === MOTION_STILL || reduced;

  const layout = useMemo(() => deskLayout({ count: courses.length, breakpoint }), [courses.length, breakpoint]);
  const looks = useMemo(() => (flow ? courses.map((course, i) => flowLook(course, i, layout)) : []), [courses, layout, flow]);

  // The notebook's left page: the latest notes across every course, newest first.
  const latest = useMemo(
    () => [...notes].sort((a, b) => noteTime(b) - noteTime(a)).slice(0, RECENT),
    [notes],
  );
  // The right page: the latest note's first lines, read once, lazily (usePageLines).
  const page = usePageLines(firebaseUser?.uid, latest[0]);
  const colorOf = useCallback((classId) => courses.find((c) => c.id === classId)?.color, [courses]);
  const stamp = useCallback((note) => noteStamp(note, now), [now]);
  const openNote = useCallback((note) => navigate(`/room/note/${note.classId}/${note.id}`), [navigate]);

  useEffect(() => () => clearTimeout(pickTimer.current), []);

  // Where each course's book lies on the stage's piles: the student's own arrangement
  // (roomPrefs.deskPlaces) where there is one, settled so a pile never has a gap; written back
  // once when settling changed a saved place.
  const savedPlaces = profile?.roomPrefs?.deskPlaces;
  const arrangement = useMemo(() => arrangePiles(courses.map((course) => course.id), savedPlaces), [courses, savedPlaces]);
  const settled = useRef('');
  useEffect(() => {
    if (flow || !arrangement.changed) return;
    const key = JSON.stringify(arrangement.map);
    if (settled.current === key) return;
    settled.current = key;
    Promise.resolve(updateRoomPrefs?.({ deskPlaces: arrangement.map })).catch((err) => console.error('Could not settle the piles', err));
  }, [arrangement, flow, updateRoomPrefs]);

  // Where the candle stands (round seven, run three: roomPrefs.deskCandle, C0 by the notebook or C1
  // beside the card; scene.json candles): by night the room is lit from there.
  const candle = candleOf(scene, profile?.roomPrefs?.deskCandle);
  const nightKey = nightKeyOf(scene, candle);
  const moveCandle = useCallback(
    (place) => {
      if (!candlePlaces(scene).includes(place) || place === candle) return;
      const before = candle;
      Promise.resolve(updateRoomPrefs?.({ deskCandle: place }))
        .then(() =>
          offerUndo({
            message: `The candle is ${scene.candles[place].name} now.`,
            undo: () => updateRoomPrefs?.({ deskCandle: before })?.catch?.((err) => console.error('Could not move the candle back', err)),
          }),
        )
        .catch((err) => console.error('Could not move the candle', err));
    },
    [candle, updateRoomPrefs],
  );

  // Where each book brought closer lay before (roomPrefs.deskNearFrom: courseId -> 'L' | 'R'), so
  // "Put back" returns it to its own pile (deskStage.js putBack).
  const nearFrom = profile?.roomPrefs?.deskNearFrom;

  // Moving a book: to the other pile's top, or one place up or down its own. One write each,
  // and the undo line can put it back.
  const moveBook = useCallback(
    (courseId, how) => {
      const course = courses.find((item) => item.id === courseId);
      const from = arrangement.map[courseId];
      if (!course || !from) return;
      const side = from[0];
      let map = null;
      if (isNearPlace(from)) {
        // A book brought closer: Alt + Left / Right to that pile, "across" to the one it did not come from.
        if (how === 'across') map = moveToOtherPile(arrangement, courseId, nearFrom || {});
        else if (how === 'left' || how === 'right') map = putBack(arrangement, courseId, { ...(nearFrom || {}), [courseId]: how === 'left' ? 'L' : 'R' })?.map;
      } else if (how === 'left' || how === 'right' || how === 'across') {
        const wanted = how === 'across' ? (side === 'L' ? 'R' : 'L') : how === 'left' ? 'L' : 'R';
        if (wanted !== side) map = moveToOtherPile(arrangement, courseId);
      } else {
        map = moveInPile(arrangement, courseId, how === 'up' ? 1 : -1);
      }
      if (!map) return;
      const before = arrangement.map;
      const where = map[courseId][0] === 'L' ? 'the left pile' : 'the right pile';
      Promise.resolve(updateRoomPrefs?.({ deskPlaces: map }))
        .then(() =>
          offerUndo({
            message: `${course.name} is on ${where} now.`,
            undo: () => updateRoomPrefs?.({ deskPlaces: before })?.catch?.((err) => console.error('Could not put the book back', err)),
          }),
        )
        .catch((err) => console.error('Could not move the book', err));
    },
    [arrangement, courses, updateRoomPrefs, nearFrom],
  );

  // Bringing a book closer (onto the near place, in front of the piles), putting it back, or a drop
  // where a drag ended (deskStage.js bringCloser / putBack / moveTo): one write of the places and of
  // where a near book came from; the undo line says what moved and can put it back.
  const arrangeBook = useCallback(
    (courseId, how) => {
      const course = courses.find((item) => item.id === courseId);
      if (!course || !arrangement.map[courseId]) return;
      const memory = nearFrom && typeof nearFrom === 'object' ? nearFrom : {};
      let next = null;
      if (how === 'closer') next = bringCloser(arrangement, courseId, memory);
      else if (how === 'back') next = putBack(arrangement, courseId, memory);
      else if (how && how.to) next = moveTo(arrangement, courseId, how.to, memory);
      if (!next) return;
      const pileName = (place) => (place[0] === 'L' ? 'the left pile' : 'the right pile');
      const now = next.map[courseId];
      // The book a "Bring closer" sent back to its pile, if the near place was taken.
      const sentBack = Object.keys(arrangement.map).find((id) => id !== courseId && isNearPlace(arrangement.map[id]) && !isNearPlace(next.map[id]));
      const other = sentBack ? courses.find((item) => item.id === sentBack) : null;
      const message = isNearPlace(now)
        ? `${course.name} is closer now.${other ? ` ${other.name} is back on ${pileName(next.map[sentBack])}.` : ''}`
        : isNearPlace(arrangement.map[courseId])
          ? `${course.name} is back on ${pileName(now)}.`
          : `${course.name} is on ${pileName(now)} now.`;
      const before = { deskPlaces: arrangement.map, deskNearFrom: memory };
      Promise.resolve(updateRoomPrefs?.({ deskPlaces: next.map, deskNearFrom: next.from }))
        .then(() =>
          offerUndo({
            message,
            undo: () => updateRoomPrefs?.(before)?.catch?.((err) => console.error('Could not put the book back', err)),
          }),
        )
        .catch((err) => console.error('Could not move the book', err));
    },
    [arrangement, courses, updateRoomPrefs, nearFrom],
  );

  // What ⌘K offers on the desk: moving the candle to its other place, moving any book on the piles,
  // bringing one closer, putting it back.
  usePageActions(() =>
    flow
      ? []
      : [
          ...candlePlaces(scene)
            .filter((place) => place !== candle)
            .map((place) => ({
              id: `desk-candle-${place}`,
              label: `Move the candle ${scene.candles[place].name}`,
              keywords: ['candle', 'light', 'move', 'lamp'],
              run: () => moveCandle(place),
            })),
          ...arrangement.books.flatMap(({ id, place }) => {
            const course = courses.find((item) => item.id === id);
            if (!course) return [];
            if (isNearPlace(place)) {
              const keywords = ['book', 'pile', 'arrange', 'back', 'away', course.name];
              return [{ id: `desk-back-${id}`, label: `Put ${course.name} back`, keywords, run: () => arrangeBook(id, 'back') }];
            }
            const closer = { id: `desk-closer-${id}`, label: `Bring ${course.name} closer`, keywords: ['book', 'closer', 'near', 'pull', course.name], run: () => arrangeBook(id, 'closer') };
            const other = place[0] === 'L' ? 'the right pile' : 'the left pile';
            const level = Number(place.slice(1));
            const height = arrangement.books.filter((book) => book.place[0] === place[0]).length;
            const keywords = ['book', 'pile', 'arrange', 'stack', course.name];
            return [
              closer,
              { id: `desk-move-${id}-across`, label: `Move ${course.name} to ${other}`, keywords, run: () => moveBook(id, 'across') },
              ...(level + 1 < height ? [{ id: `desk-move-${id}-up`, label: `Move ${course.name} up`, keywords, run: () => moveBook(id, 'up') }] : []),
              ...(level > 0 ? [{ id: `desk-move-${id}-down`, label: `Move ${course.name} down`, keywords, run: () => moveBook(id, 'down') }] : []),
            ];
          }),
        ],
  );

  // A book's cloth, for its flight to its course page and home again (deskFlightRun.js): on the
  // stage, its leather as drawn there and its title in the gilt's colour; on the flow desk, its
  // cover's.
  const lookOf = useCallback(
    (courseId) => {
      const i = courses.findIndex((course) => course.id === courseId);
      if (i < 0) return null;
      const course = courses[i];
      const place = flow ? null : arrangement.map[courseId];
      if (place) {
        const look = spineLook(scene, lit ? nightKey : 'day', place, course.color);
        return { cover: look.cover, clothAt: '0 0', ink: look.gilt, title: course.name };
      }
      return {
        cover: coverTone(course.color),
        clothAt: `${(i * 89) % 256}px ${(i * 53) % 256}px`,
        ink: coverInk(course.color),
        title: course.name,
      };
    },
    [courses, flow, lit, arrangement, nightKey],
  );
  useDeskReturn(lookOf);

  // The same switch as the You page's mood: lit is Candlelight, out is Rain.
  const toggleCandle = () => {
    const next = !lit;
    setLitWish({ from: savedLit, to: next });
    Promise.resolve(updateRoomPrefs?.({ mood: next ? MOOD_CANDLELIGHT : MOOD_RAIN })).catch((err) => {
      setLitWish(null);
      console.error('Could not change the light', err);
    });
  };

  // Click or Enter: the book finishes its lift, then its course opens. Where it lay is
  // kept for the course page (deskFlight.js). Still and reduced motion open at once.
  const pick = (courseId, rect) => {
    if (pickedId) return;
    rememberPick(rect, courseId, Date.now(), lookOf(courseId));
    const quiet =
      document.documentElement.getAttribute('data-motion') === 'still' ||
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (quiet) {
      navigate(`/room/course/${courseId}`);
      return;
    }
    setPickedId(courseId);
    pickTimer.current = setTimeout(() => navigate(`/room/course/${courseId}`), PICK_MS);
  };

  const notebook = (style) => (
    <Notebook
      notes={latest}
      colorOf={colorOf}
      stamp={stamp}
      onOpen={openNote}
      page={page}
      single={breakpoint === BP_PHONE}
      style={style}
    />
  );
  const newCourse = (style) => (
    <button
      type="button"
      className={`room-desk-new${courses.length ? '' : ' is-first'}`}
      style={style}
      onClick={() => setNewCourseOpen(true)}
    >
      <span className="room-desk-new-plus" aria-hidden="true">
        +
      </span>
      New course
    </button>
  );

  // The flow desk (phones, tablets): the page's own flow places everything; the shadows fall.
  const flowDesk = () => {
    const shade = shadeVars(FLOW_NIGHT);
    return (
      <Desk night={lit} still={still}>
        <Candle lit={lit} onToggle={toggleCandle} style={shade} />
        {notebook(shade)}
        <div className="room-desk-books">
          {courses.map((course, i) => (
            <Book
              key={course.id}
              course={course}
              look={looks[i]}
              rtl={textDirection(course.name) === 'rtl'}
              picked={pickedId === course.id}
              onPick={pick}
            />
          ))}
          {newCourse()}
        </div>
        <div className="room-desk-scrap-slot" style={shade}>
          <span className="room-desk-shade" aria-hidden="true" />
          <CaptureScrap className="room-desk-scrap" />
        </div>
        <PhotoFrame style={shade} />
      </Desk>
    );
  };

  // The stage: Blender's room, the page's words (DeskStage.jsx). The plaque's words move onto the
  // notebook's left page there: the wall stays a wall.
  const stageDesk = () => (
    <DeskStage
      courses={courses}
      notes={latest}
      page={page}
      greeting={`${timeOfDayWord(now)}, ${firstName}.`}
      status={deskStatus({ courses, recent, now, breaks })}
      clock={deskClock(now)}
      colorOf={colorOf}
      stamp={stamp}
      onOpenNote={openNote}
      onPick={pick}
      pickedId={pickedId}
      lit={lit}
      still={still}
      onToggleCandle={toggleCandle}
      onNewCourse={() => setNewCourseOpen(true)}
      onMore={() => navigate('/room/notes')}
      arrangement={arrangement}
      onMove={moveBook}
      onArrange={arrangeBook}
      candle={candle}
      nightKey={nightKey}
      onMoveCandle={moveCandle}
      viewport={viewport}
    />
  );

  return (
    <RoomShell>
      <div className={`room-desk-page${flow ? ' is-flow' : ' is-stage'}`}>
        {/* The wall: where you are in the day. Exactly Home's plaque (on the stage, the notebook's
            left page holds it instead). */}
        {flow && (
          <div className="room-desk-wall">
            <div className="room-desk-plaque">
              <span className="room-clock room-rise">{deskClock(now)}</span>
              <h1 className="room-greeting room-rise" style={{ animationDelay: '0.07s' }}>
                {timeOfDayWord(now)}, {firstName}.
              </h1>
              <p className="room-status room-rise" style={{ animationDelay: '0.14s' }}>
                {deskStatus({ courses, recent, now, breaks })}
              </p>
            </div>
          </div>
        )}

        {flow ? flowDesk() : stageDesk()}
      </div>

      <CourseSheet open={newCourseOpen} onClose={() => setNewCourseOpen(false)} />
    </RoomShell>
  );
};

export default RoomDesk;
