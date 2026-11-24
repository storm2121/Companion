import { lazy, Suspense, useEffect, useState } from 'react';
import { useAuth } from '../context/authState';
import RoomShell from './RoomShell';
import { useDeskBreakpoint } from './components/desk/useDeskBreakpoint';
import { isFlow } from './deskLayout';
import { stateFor, tableUsable } from './deskTable';
import { loadCore, loadState } from './deskTableData';
import { MOOD_RAIN, resolveRoomPrefs } from './roomPrefs';

// The desk as Home (RoomHomeDoor opens this when roomPrefs.home is 'desk'): which desk (round eight, run 3).
//   - Phones and tablets: round seven's RoomDesk (its flow desk), exactly as before.
//   - Wide windows: the production table (TableDesk), once its core and the light state's own file are read
//     (public/assets/desk-p1, deskTableData.js); if either cannot be fetched, round seven's RoomDesk and its
//     stage, as before (its chunk and its pictures are loaded only then).
// While the core is on its way (52 kB, a moment), the room's top line stands with nothing under it, as the
// door's own wait does: never one desk and then the other.

const RoomDesk = lazy(() => import('./RoomDesk'));
const TableDesk = lazy(() => import('./TableDesk'));

// For the visit: the table's data once read (or the failure), so a return to Home decides at once.
let known = null;

const DeskHome = ({ bare = false }) => {
  const breakpoint = useDeskBreakpoint();
  const flow = isFlow(breakpoint);
  const { profile } = useAuth();
  const prefs = resolveRoomPrefs(profile?.roomPrefs);
  const first = stateFor({ night: prefs.mood !== MOOD_RAIN, candle: profile?.roomPrefs?.deskCandle === 'C1' ? 'C1' : 'C0', lamp: profile?.roomPrefs?.deskLamp === true });
  const [table, setTable] = useState(known);
  useEffect(() => {
    if (flow || table) return undefined;
    let alive = true;
    loadCore()
      .then((core) => loadState(core, first).then((state) => ({ core, state })))
      .then(
        ({ core, state }) => (tableUsable({ core, state }) ? { core } : { failed: true }),
        (err) => {
          console.error('The desk\'s pictures could not be read; the desk is round seven\'s', err);
          return { failed: true };
        },
      )
      .then((result) => {
        known = result;
        if (alive) setTable(result);
      });
    return () => {
      alive = false;
    };
  }, [flow, table, first]);

  if (flow || table?.failed) {
    return (
      <Suspense fallback={<RoomShell />}>
        <RoomDesk />
      </Suspense>
    );
  }
  if (!table) return <RoomShell />;
  return (
    <Suspense fallback={<RoomShell />}>
      <TableDesk core={table.core} bare={bare} />
    </Suspense>
  );
};

export default DeskHome;
