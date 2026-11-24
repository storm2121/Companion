import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/authState';
import RoomShell from './RoomShell';
import CourseSheet from './components/CourseSheet';
import TableStage from './components/desk/TableStage';
import { useReducedMotion, useViewport } from './components/desk/useDeskBreakpoint';
import { usePageLines } from './components/desk/usePageLines';
import { cleanBreaks } from './calendarDays';
import { deskClock, deskStatus, noteStamp, noteTime, timeOfDayWord, useRoomDesk } from './roomData';
import { MOOD_CANDLELIGHT, MOOD_RAIN, MOTION_STILL, resolveRoomPrefs, useMinuteClock } from './roomPrefs';
import { keepPlaces } from './deskStage';
import {
  NEAR,
  PLACES,
  PLACE_NAMES,
  arrangeTable,
  cannotMoveBook,
  capacityOf,
  closerOrBack,
  mergePatch,
  movedLine,
  placeBeside,
  slotOf,
  stateFor,
  tableMoveTo,
  tableShift,
  tableWish,
} from './deskTable';
import { loadState } from './deskTableData';
import { usePageActions } from './roomCommands';
import { offerUndo, sayInRoom, useRoomUndo } from './roomUndo';
import { announceMoves, getFilm, homePathOf, openCourseOnDesk, setNoteKeep } from './deskFilm';
import { registerDeskBook } from './deskBookLoad';
import { noteCourseFor } from './deskSearch';
import { startNote } from './startNote';

// The desk's Home on the production table (round eight, run 3): RoomDesk's work for the new stage
// (TableStage.jsx), behind the You page's Home switch, on wide windows, when the pictures are there
// (DeskHome.jsx decides; anything missing and round seven's RoomDesk stands, as before).
//
// The table holds 18 books (deskTable.js): any course's book can go to any place with room, on top, and any
// can be taken (the books above it settle down a level). Saved per person in roomPrefs.deskTable (courseId ->
// slot) and roomPrefs.deskTableFrom (where a book brought closer came from); round seven's deskPlaces is left
// alone for the old stage. The candle (roomPrefs.deskCandle, C0 or C1, as round seven), its light (the mood:
// Candlelight is night, Rain is day), the lamp (roomPrefs.deskLamp), the small notebook (a new note, the room's
// Home way). The course opens as the held book (CourseBook, registered here with the production pictures).

// (The held book's own entry, its type setting and inks: deskBookLoad.js, shared with a book opened without the desk.)

const RECENT = 5;
// A move's save and undo line wait for its glide (180 ms, then the 90 ms hand-over).
const MOVE_SAVE_AFTER_MS = 300;

const TableDesk = ({ core, bare = false }) => {
  const navigate = useNavigate();
  const { firebaseUser, profile, updateRoomPrefs } = useAuth();
  const { courses, notes, recent, loading, trouble } = useRoomDesk();
  const [newCourseOpen, setNewCourseOpen] = useState(false);
  const now = useMinuteClock();
  const viewport = useViewport();
  const reduced = useReducedMotion();
  const roomPrefs = profile?.roomPrefs;
  const prefs = resolveRoomPrefs(roomPrefs);
  const still = prefs.motion === MOTION_STILL || reduced;
  const firstName = (profile?.displayName || '').trim().split(' ')[0] || 'there';
  const breaks = useMemo(() => cleanBreaks(roomPrefs?.breaks), [roomPrefs?.breaks]);

  // The candle's light (the mood) and the lamp answer their press at once: the wish holds until the saved
  // value catches up (or is refused).
  const savedLit = prefs.mood !== MOOD_RAIN;
  const [litWish, setLitWish] = useState(null);
  if (litWish && litWish.to === savedLit) setLitWish(null);
  const lit = litWish && litWish.from === savedLit ? litWish.to : savedLit;
  const savedLamp = roomPrefs?.deskLamp === true;
  const [lampWish, setLampWish] = useState(null);
  if (lampWish && lampWish.to === savedLamp) setLampWish(null);
  const lamp = lampWish && lampWish.from === savedLamp ? lampWish.to : savedLamp;
  const candle = roomPrefs?.deskCandle === 'C1' && core.candles.C1 ? 'C1' : 'C0';
  const state = stateFor({ night: lit, candle, lamp });

  // The latest preference writer (an undo pressed later must not write an old profile back).
  const writePrefs = useRef(updateRoomPrefs);
  useEffect(() => {
    writePrefs.current = updateRoomPrefs;
  });
  const [said, setSaid] = useState({ text: '', n: 0 });
  const say = useCallback((text) => text && setSaid((was) => ({ text, n: was.n + 1 })), []);
  // One write of the table and its undo line; a book move is announced to the stage first (its books start
  // travelling in this frame), the save and the line after the glide (round eight, run 2).
  // (Fix run: a book's move is kept as the table's local wish meanwhile, so quick moves add up; a failed save or an
  // undo lets the wish go.)
  const dropWish = useRef(() => {});
  const writeMove = useCallback((patch, before, message, what, moves = null) => {
    const save = () =>
      Promise.resolve(writePrefs.current?.(patch)).catch((err) => {
        console.error(`Could not move ${what}`, err);
        if (moves) dropWish.current();
        sayInRoom('That move could not be saved');
      });
    const offer = () =>
      offerUndo({
        message,
        undo: () => {
          if (moves) dropWish.current();
          return Promise.resolve(writePrefs.current?.(before)).catch((err) => console.error(`Could not put ${what} back`, err));
        },
      });
    if (moves) {
      announceMoves(moves.from, moves.to, moves.primary);
      setTimeout(() => {
        save();
        offer();
      }, MOVE_SAVE_AFTER_MS);
    } else {
      save();
      offer();
    }
  }, []);

  // The arrangement: the saved slots, settled (deskTable.js arrangeTable); written back once where settling
  // moved a saved slot, never while a delete waits out its undo (its course's slot is kept meanwhile).
  const saved = roomPrefs?.deskTable;
  const savedFrom = roomPrefs?.deskTableFrom;
  const ids = useMemo(() => courses.map((c) => c.id), [courses]);
  // The local wish (deskTable.js tableWish): { map, from } of the last move, until the saved table says the same.
  const [wish, setWish] = useState(null);
  const wished = useMemo(() => tableWish(ids, saved, wish, core), [ids, saved, wish, core]);
  if (wish && wished.done) setWish(null);
  useEffect(() => {
    dropWish.current = () => setWish(null);
  });
  useEffect(() => {
    if (!wish) return undefined;
    const timer = setTimeout(() => setWish(null), 5000);
    return () => clearTimeout(timer);
  }, [wish]);
  const arrangement = wished.arrangement;
  const fromNow = wish?.from || savedFrom;
  const from = useMemo(() => (fromNow && typeof fromNow === 'object' ? fromNow : {}), [fromNow]);
  const { entry: undoEntry } = useRoomUndo();
  const waiting = undoEntry?.hides;
  const holding = Boolean(waiting?.some((id) => typeof saved?.[id] === 'string'));
  const slotsToWrite = useCallback((map) => keepPlaces(map, saved, waiting), [saved, waiting]);
  const settled = useRef('');
  useEffect(() => {
    if (loading || trouble || holding || !arrangement.changed || bare) return;
    const key = JSON.stringify(arrangement.map);
    if (settled.current === key) return;
    settled.current = key;
    Promise.resolve(updateRoomPrefs?.({ deskTable: arrangement.map })).catch((err) => console.error('Could not settle the table', err));
  }, [arrangement, loading, trouble, holding, updateRoomPrefs, bare]);

  const nameOf = useCallback((id) => courses.find((c) => c.id === id)?.name || 'That book', [courses]);
  // A book onto the top of a place (a drop, the menu, Ctrl K, Alt + arrows): one write, an undo line, the
  // books travelling first.
  const moveBook = useCallback(
    (id, place) => {
      const map = tableMoveTo(arrangement, id, place, core);
      if (!map) {
        say(cannotMoveBook(arrangement, id, place, nameOf(id)));
        return;
      }
      const wasAt = slotOf(arrangement.map[id])?.place;
      // (Leaving the near stack, its "from" is written as null: under the deep merge a key left out stays.)
      const nextFrom = place === NEAR && wasAt !== NEAR ? { ...from, [id]: wasAt } : wasAt === NEAR && place !== NEAR ? { ...from, [id]: null } : from;
      setWish({ map, from: nextFrom });
      writeMove(
        { deskTable: slotsToWrite(map), deskTableFrom: nextFrom },
        { deskTable: slotsToWrite(arrangement.map), deskTableFrom: mergePatch(nextFrom, from) },
        movedLine(nameOf(id), map[id]),
        'the book',
        { from: arrangement.map, to: map, primary: id },
      );
    },
    [arrangement, core, from, nameOf, say, slotsToWrite, writeMove],
  );
  // Alt + Up / Down within the stack; Alt + Left / Right to the next place across with room; Alt + Enter
  // closer (the near stack) or back.
  const keyMove = useCallback(
    (id, how) => {
      if (how === 'up' || how === 'down') {
        const map = tableShift(arrangement, id, how === 'up' ? 1 : -1);
        if (!map) {
          say(cannotMoveBook(arrangement, id, how, nameOf(id)));
          return;
        }
        setWish({ map, from });
        writeMove({ deskTable: slotsToWrite(map) }, { deskTable: slotsToWrite(arrangement.map) }, movedLine(nameOf(id), map[id]), 'the book', { from: arrangement.map, to: map, primary: id });
        return;
      }
      const place = how === 'closer' ? closerOrBack(arrangement, id, from, core) : placeBeside(arrangement, id, how === 'left' ? -1 : 1, core);
      if (!place) {
        say(cannotMoveBook(arrangement, id, how, nameOf(id)));
        return;
      }
      moveBook(id, place);
    },
    [arrangement, core, from, moveBook, nameOf, say, slotsToWrite, writeMove],
  );

  // The candle's place (round seven's C0 and C1): by night the whole light state moves with it.
  const moveCandle = useCallback(
    (place) => {
      if (!core.candles[place] || place === candle) return;
      writeMove({ deskCandle: place }, { deskCandle: candle }, `The candle is ${core.candles[place].name} now.`, 'the candle');
    },
    [candle, core, writeMove],
  );
  const toggleCandle = () => {
    const next = !lit;
    setLitWish({ from: savedLit, to: next });
    Promise.resolve(updateRoomPrefs?.({ mood: next ? MOOD_CANDLELIGHT : MOOD_RAIN })).catch((err) => {
      setLitWish(null);
      console.error('Could not change the light', err);
    });
  };
  const toggleLamp = useCallback(() => {
    const next = !lamp;
    setLampWish({ from: savedLamp, to: next });
    say(next ? 'The lamp is on.' : 'The lamp is off.');
    Promise.resolve(writePrefs.current?.({ deskLamp: next })).catch((err) => {
      setLampWish(null);
      console.error('Could not switch the lamp', err);
      sayInRoom('The lamp could not be switched');
    });
  }, [lamp, savedLamp, say]);

  // The small notebook: a new note the way the room starts one from Home with no course chosen (Ctrl K's
  // "New note in …": the course written in last, else the first), in the normal editor; no course yet: the
  // course sheet.
  const newNote = useCallback(() => {
    const course = noteCourseFor(courses, notes, '', noteTime);
    if (!course) {
      setNewCourseOpen(true);
      return;
    }
    // (Fix run 2: the desk is kept under every note it opens, so the way back is one frame.)
    setNoteKeep({ phase: 'note' });
    const id = startNote(firebaseUser?.uid, course.id, navigate);
    // (Owner fixes, B: this note's own way out leads back here, to the desk: RoomShell reads `pocket`.)
    setNoteKeep(id ? { phase: 'note', pocket: `/room/note/${course.id}/${id}`, home: homePathOf(window.location.pathname) } : null);
  }, [courses, notes, firebaseUser, navigate]);

  // A book picked: its film (the stage plays it); still and reduced motion open the course at once.
  const pick = useCallback(
    (id) => {
      if (openCourseOnDesk(id)) return;
      navigate(`/room/course/${id}`);
    },
    [navigate],
  );

  // What a book's menu and Ctrl K offer: closer / back, every other place with room, up and down its stack.
  const movesOf = useCallback(
    (id) => {
      const slot = slotOf(arrangement.map[id]);
      if (!slot) return [];
      const stack = arrangement.stacks[slot.place];
      const out = [];
      const near = slot.place === NEAR;
      const closer = closerOrBack(arrangement, id, from, core);
      if (closer) out.push({ key: 'closer', how: 'closer', label: near ? 'Put back' : 'Bring closer', place: closer });
      PLACES.forEach((p) => {
        if (p === slot.place || (closer && p === closer && !near) || arrangement.stacks[p].length >= capacityOf(core, p)) return;
        out.push({ key: `to-${p}`, place: p, label: `Move to ${PLACE_NAMES[p]}` });
      });
      if (slot.level + 1 < stack.length) out.push({ key: 'up', how: 'up', label: 'Move up' });
      if (slot.level > 0) out.push({ key: 'down', how: 'down', label: 'Move down' });
      return out;
    },
    [arrangement, core, from],
  );
  const menuItemsOf = useCallback(
    (id) => movesOf(id).map((m) => ({ key: m.key, label: m.label, run: () => (m.how === 'up' || m.how === 'down' ? keyMove(id, m.how) : moveBook(id, m.place)) })),
    [movesOf, keyMove, moveBook],
  );
  usePageActions(() =>
    getFilm()
      ? []
      : [
          { id: 'desk-lamp', label: lamp ? 'Turn the lamp off' : 'Turn the lamp on', keywords: ['lamp', 'light', 'switch', 'reading'], run: toggleLamp },
          ...['C0', 'C1']
            .filter((p) => core.candles[p] && p !== candle)
            .map((p) => ({ id: `desk-candle-${p}`, label: `Move the candle ${core.candles[p].name}`, keywords: ['candle', 'light', 'move'], run: () => moveCandle(p) })),
          ...arrangement.books.flatMap(({ id }) => {
            const course = courses.find((c) => c.id === id);
            if (!course) return [];
            return movesOf(id).map((m) => ({
              id: `desk-${m.key}-${id}`,
              label: m.how === 'closer' ? `${m.label === 'Put back' ? 'Put' : 'Bring'} ${course.name} ${m.label === 'Put back' ? 'back' : 'closer'}` : m.how ? `Move ${course.name} ${m.how}` : `Move ${course.name} to ${PLACE_NAMES[m.place]}`,
              keywords: ['book', 'stack', 'arrange', 'move', course.name],
              run: () => (m.how === 'up' || m.how === 'down' ? keyMove(id, m.how) : moveBook(id, m.place)),
            }));
          }),
        ],
  );

  // The held book for the course page (CourseBook) and the film: registered while this desk is the Home.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });
  useEffect(() => {
    registerDeskBook(core, () => stateRef.current);
  }, [core]);
  // The state's file is fetched as soon as it is wished for (the stage decodes its pictures).
  useEffect(() => {
    loadState(core, state).catch(() => null);
  }, [core, state]);

  const latest = useMemo(() => [...notes].sort((a, b) => noteTime(b) - noteTime(a)).slice(0, RECENT), [notes]);
  const page = usePageLines(firebaseUser?.uid, latest[0]);
  const colorOf = useCallback((classId) => courses.find((c) => c.id === classId)?.color, [courses]);
  const stamp = useCallback((note) => noteStamp(note, now), [now]);
  const openNote = useCallback(
    (note) => {
      setNoteKeep({ phase: 'note' });
      navigate(`/room/note/${note.classId}/${note.id}`);
    },
    [navigate],
  );
  // Where a new course would lie ("+ New course", the next free slot by fill order).
  const ghostSlot = useMemo(() => (arrangement.more ? null : arrangeTable([...ids, '\u0000new'], arrangement.map, core).map['\u0000new'] || null), [arrangement, ids, core]);

  return (
    <RoomShell>
      <div className="room-desk-page is-stage is-table">
        <TableStage
          core={core}
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
          lit={lit}
          still={still}
          onToggleCandle={toggleCandle}
          onNewCourse={() => setNewCourseOpen(true)}
          arrangement={arrangement}
          onMove={moveBook}
          onKeyMove={keyMove}
          menuItemsOf={menuItemsOf}
          candle={candle}
          onMoveCandle={moveCandle}
          lamp={lamp}
          onToggleLamp={toggleLamp}
          onNewNote={newNote}
          viewport={viewport}
          bare={bare}
          ghostSlot={ghostSlot}
        />
      </div>
      {arrangement.more && !bare && (
        <button type="button" className="room-table-more" onClick={() => navigate('/room/notes')}>
          {arrangement.more.count === 1 ? 'One more course is in All notes' : `${arrangement.more.count} more courses are in All notes`}
        </button>
      )}
      <p className="room-desk-said" role="status">
        {said.text}
        {said.n % 2 ? ' ' : ''}
      </p>
      <CourseSheet open={newCourseOpen} onClose={() => setNewCourseOpen(false)} />
    </RoomShell>
  );
};

export default TableDesk;
