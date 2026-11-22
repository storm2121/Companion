import { useEffect, useState } from 'react';
import { getNoteAsOf } from '../../../services/library';
import { pageLines } from '../../deskPage';
import { noteTime } from '../../roomData';

// The notebook's open page (RoomDesk): the latest note's first lines, read LAZILY — once
// the desk has drawn and the browser is idle — and through the cheapest path there is:
// `getNoteAsOf` with the note's contentUpdatedAt (contextweb §3), which is this device's own
// copy unless the note changed elsewhere. One note, never more.
//
// A successful read is kept for the session under the note's id and stamp, so coming back to
// the desk reads nothing again until the note changes. A failed one (offline, and no copy on
// this device) is not kept: the page simply has no lines, and the next visit tries again.
//
// Returns { lines, read }: `read` once this note's answer is in, whatever it was.

let kept = { key: '', lines: [] };
// Reads are numbered: only the latest one asked for is kept (run desk1, D11: an older note's read
// answering last overwrote the newer note's lines, and the page stayed blank until the next visit).
let asked = 0;

const stampOf = (note) => note?.contentUpdatedAt?.toMillis?.() || noteTime(note);

export const usePageLines = (uid, note) => {
  const classId = note?.classId;
  const id = note?.id;
  const stamp = note ? stampOf(note) : 0;
  // Under the account too, so the lines kept for one are never another's.
  const key = uid && classId && id ? `${uid}/${classId}/${id}/${stamp}` : '';
  const [answered, setAnswered] = useState('');

  useEffect(() => {
    if (!key || kept.key === key) return undefined;
    let live = true;
    const read = () => {
      asked += 1;
      const mine = asked;
      getNoteAsOf(uid, classId, id, stamp)
        .then(
          (full) => {
            if (mine === asked) kept = { key, lines: pageLines(full?.blocks) };
          },
          () => undefined,
        )
        .then(() => {
          if (live) setAnswered(key);
        });
    };
    const idle = globalThis.requestIdleCallback;
    const handle = idle ? idle(read, { timeout: 800 }) : setTimeout(read, 200);
    return () => {
      live = false;
      if (idle) globalThis.cancelIdleCallback?.(handle);
      else clearTimeout(handle);
    };
  }, [uid, classId, id, stamp, key]);

  if (!key) return { lines: [], read: false };
  if (kept.key === key) return { lines: kept.lines, read: true };
  return { lines: [], read: answered === key };
};
