import { createContext, useCallback, useEffect, useMemo, useRef } from 'react';
import { clipPolygon, quadBox } from '../../deskProject';
import { LONG_PRESS_MS, STAGE_TYPE, isDrag, stageType } from '../../deskStage';

// What both of the desk's stages share that is not a component (round eight, run 3; moved from DeskStage.jsx
// unchanged): sizes, the hit areas' styles, the press, the lettering's snap, the glides' maths and timing.
// stageParts.jsx has the components.

export const px = (n) => `${Math.round(n * 100) / 100}px`;

// Every word kind's size at this scale (deskStage.js stageType: max(its own, 13 css px)), for
// desk.css: --room-stage-type-<kind>.
export const typeVars = (scale) =>
  Object.fromEntries(Object.keys(STAGE_TYPE).map((kind) => [`--room-stage-type-${kind.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`, px(stageType(kind, scale))]));

// What is worked out from a place alone is worked out once.
export const once = (make) => {
  const kept = new Map();
  return (key) => {
    if (!kept.has(key)) kept.set(key, make(key));
    return kept.get(key);
  };
};
// A style made from a polygon, kept while the polygon, the scale and the origin are the same (run
// desk1, D4: every render of the stage built every book's box and clip string again, twenty-four
// polygons and the dashed places; the polygons themselves are kept from render to render, the hit
// areas by the stage's useMemo and the scene's outlines for good).
const keptStyle = (store, polygon, scale, x, y, make) => {
  const was = store.get(polygon);
  if (was && was.scale === scale && was.x === x && was.y === y) return was.style;
  const style = make();
  store.set(polygon, { scale, x, y, style });
  return style;
};
const HIT_STYLES = new WeakMap();
const CLIP_STYLES = new WeakMap();
// A hit area (a polygon in stage px, deskStage.js pileHits) as a button's box and clip, relative
// to its holder's box origin [x, y].
export const hitStyle = (polygon, origin, scale) =>
  keptStyle(HIT_STYLES, polygon, scale, origin[0], origin[1], () => {
    const box = quadBox(polygon);
    return {
      left: px((box[0] - origin[0]) * scale),
      top: px((box[1] - origin[1]) * scale),
      width: px(box[2] * scale),
      height: px(box[3] * scale),
      clipPath: clipPolygon(polygon, box, scale),
    };
  });
// A whole holder clipped to a polygon (`filling`: the button fills its holder).
export const clipStyle = (polygon, box, scale, filling = false) =>
  keptStyle(CLIP_STYLES, polygon, scale, box[0], box[1], () => ({ ...(filling ? { inset: 0 } : null), clipPath: clipPolygon(polygon, box, scale) }));

// A press on a book or on the candle, from the pointer going down to the click it may end with: it
// becomes a drag 6 css px from where it went down (on touch only after the long press), a long press
// that did not move asks for the menu, and the click either ends with opens nothing.
// The pointer may come up anywhere, off the thing too, where no click follows (run desk1, D1: the
// press then stayed for good, so the next bare hover 6px from the old point took the book with no
// button down, and after a drag that ended off the book the next Enter on it was swallowed as "the
// drag's click"). So the window hears the pointer come up; after that the press only waits, a
// moment, for that click. A move with no button down ends it too.
const CLICK_AFTER_MS = 400;
export const usePress = () => {
  const press = useRef(null);
  const drop = useCallback(() => {
    const state = press.current;
    if (!state) return;
    clearTimeout(state.timer);
    state.unhear();
    press.current = null;
  }, []);
  useEffect(() => drop, [drop]);
  return useMemo(
    () => ({
      down(event) {
        drop();
        if (event.button !== 0) return;
        const touch = event.pointerType === 'touch';
        const state = { x: event.clientX, y: event.clientY, pointer: event.pointerId, touch, ready: !touch, timer: 0, done: false, upAt: null };
        const heard = (e) => {
          if (e.pointerId !== state.pointer) return;
          state.upAt = e.timeStamp;
          state.unhear();
        };
        state.unhear = () => {
          window.removeEventListener('pointerup', heard, true);
          window.removeEventListener('pointercancel', heard, true);
        };
        window.addEventListener('pointerup', heard, true);
        window.addEventListener('pointercancel', heard, true);
        if (touch) {
          state.timer = setTimeout(() => {
            state.ready = true;
          }, LONG_PRESS_MS);
        }
        press.current = state;
      },
      // A move: where the press began ([x, y]) when this move makes it a drag, else null.
      move(event) {
        const state = press.current;
        if (!state || state.done || state.upAt != null || state.pointer !== event.pointerId) return null;
        if (event.buttons === 0) {
          drop();
          return null;
        }
        if (!isDrag(event.clientX - state.x, event.clientY - state.y)) return null;
        clearTimeout(state.timer);
        // A touch that moved before its long press is not a drag (nor a click).
        if (!state.ready) {
          drop();
          return null;
        }
        state.done = true;
        return [state.x, state.y];
      },
      // The pointer up on the thing itself: true for a long press that did not become a drag (its menu).
      up() {
        const state = press.current;
        if (!state) return false;
        clearTimeout(state.timer);
        if (!state.touch || !state.ready || state.done) return false;
        state.done = true;
        return true;
      },
      cancel: drop,
      // Its menu opened (a right-click): the click that may follow opens nothing.
      spend() {
        if (press.current) press.current.done = true;
      },
      // The click: false for the one a drag or a long press ends with.
      click(event) {
        const state = press.current;
        drop();
        return !(state?.done && (state.upAt == null || event.timeStamp - state.upAt < CLICK_AFTER_MS));
      },
    }),
    [drop],
  );
};
export const unionBox = (a, b) => {
  const x = Math.min(a[0], b[0]);
  const y = Math.min(a[1], b[1]);
  return [x, y, Math.max(a[0] + a[2], b[0] + b[2]) - x, Math.max(a[1] + a[3], b[1] + b[3]) - y];
};


// Where the stage's origin is in the page and the device pixel ratio ({ x, y, dpr }, css px), for
// the lettering's origin on whole device pixels; null until measured.
export const StageSnap = createContext(null);

// Where a ghost drawn at `from` lands at `to`: the transform (translate, then scale from its own box's
// corner) taking the one box onto the other, css px. Boxes in stage px [x, y, w, h]; `own` = the ghost's
// own box (its layer's).
export const landing = (fromBox, toBox, own, scale) => {
  const sx = toBox[2] / fromBox[2];
  const sy = toBox[3] / fromBox[3];
  const tx = scale * (toBox[0] - own[0] - sx * (fromBox[0] - own[0]));
  const ty = scale * (toBox[1] - own[1] - sy * (fromBox[1] - own[1]));
  return { tx, ty, sx, sy };
};
export const moveCss = (tx, ty, sx = 1, sy = 1) => `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`;
// The glide: at most 180 ms, easing out (it leaves at about the speed it was let go and settles, no
// overshoot); then the handover, the ghost going over the place's own picture in a few frames.
export const GLIDE_MS = 180;
// A book settling one place down its pile (the one under it left): shorter, it travels a spine's height.
export const SETTLE_GLIDE_MS = 140;
export const SETTLE_MS = 90;
// A night's held candle, see-through (desk.css .room-stage-ghost.is-candle.is-placing says the same).
export const PLACING_OPACITY = 0.55;
export const GLIDE_EASE = 'cubic-bezier(0.22, 0.61, 0.36, 1)';

// Still or reduced motion: things are where they go at once (no glide).
export const quietNow = (still) =>
  Boolean(still) || Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) || document.documentElement.getAttribute('data-motion') === 'still';

