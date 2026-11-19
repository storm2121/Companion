// The book you just picked up on the desk, and the way back to it — PURE module store and
// maths, no DOM (deskFlightRun.js flies the cloth; tests/desk.unit.test.mjs runs this).
//
// The desk (RoomDesk, a prototype Home) writes where the picked book lay on screen — its
// projected rect, read once in the click handler — which course it is, and how its cloth looks,
// the moment before it opens that course. The course page takes it ONCE and flies the cloth
// from the book to its title. Leaving the course page writes the title's place the same way;
// the desk takes that once and flies the cloth home to the book. A pick or a return is good for
// a moment only; anything older, or for another course, is dropped rather than flown from a
// stale place.

const FRESH_MS = 2000;

let pick = null;
let back = null;

const rectOf = (rect) => {
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return { left: n(rect?.left), top: n(rect?.top), width: n(rect?.width), height: n(rect?.height) };
};

const fresh = (entry, courseId, now) => {
  if (!entry) return null;
  if (courseId != null && entry.courseId !== String(courseId)) return null;
  if (now - entry.at > FRESH_MS) return null;
  return entry;
};

// `look`: the cloth to fly — { cover, clothAt, ink, title } (deskLayout's colours).
export const rememberPick = (rect, courseId, now = Date.now(), look = null) => {
  pick = rect && courseId ? { rect: rectOf(rect), courseId: String(courseId), at: now, look } : null;
};

// Returns { rect, courseId, at, look } once, then forgets it. With a `courseId`, only a pick
// of that course counts.
export const takePick = (courseId, now = Date.now()) => {
  const taken = pick;
  pick = null;
  return fresh(taken, courseId, now);
};

// Leaving a course page: where its title was on the screen.
export const rememberReturn = (rect, courseId, now = Date.now()) => {
  back = rect && courseId ? { rect: rectOf(rect), courseId: String(courseId), at: now } : null;
};

export const takeReturn = (now = Date.now()) => {
  const taken = back;
  back = null;
  return fresh(taken, null, now);
};

/* ── The flight's maths ─────────────────────────────────────────────────────────
   The cloth is a sheet that moves (a transform) and changes size (a clip from its own top-left
   corner) — never scaled, so nothing on it is ever stretched. Boxes are { x, y, w, h } in the
   window's px. */

// The room's critically damped spring (boardMotion.smoothDamp): this smooth time settles in
// about 0.42 s, with no bounce.
export const FLIGHT_SMOOTH = 0.13;

export const boxOfRect = (rect) => ({ x: rect.left, y: rect.top, w: rect.width, h: rect.height });

// The sheet's own size: the larger of the two boxes, so the clip only ever cuts it.
export const flightSize = (from, to) => ({ w: Math.max(from.w, to.w), h: Math.max(from.h, to.h) });

// The box a fraction `t` of the way (the harness freezes a flight there; 0 = the book).
export const flightBox = (from, to, t) => {
  const k = Math.max(0, Math.min(1, Number(t) || 0));
  return {
    x: from.x + (to.x - from.x) * k,
    y: from.y + (to.y - from.y) * k,
    w: from.w + (to.w - from.w) * k,
    h: from.h + (to.h - from.h) * k,
  };
};

// How far along a box is, 0..1, by the largest of its four distances.
export const flightProgress = (from, to, box) => {
  const keys = ['x', 'y', 'w', 'h'];
  const total = Math.max(...keys.map((key) => Math.abs(to[key] - from[key])), 1e-6);
  const left = Math.max(...keys.map((key) => Math.abs(to[key] - box[key])));
  return Math.max(0, Math.min(1, 1 - left / total));
};

// The transform and the clip that draw a box on a sheet of `size`.
export const flightStyle = (box, size, radius = 6) => ({
  transform: `translate3d(${box.x.toFixed(2)}px, ${box.y.toFixed(2)}px, 0)`,
  clipPath: `inset(0px ${Math.max(0, size.w - box.w).toFixed(2)}px ${Math.max(0, size.h - box.h).toFixed(2)}px 0px round ${radius}px)`,
});
