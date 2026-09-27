// The board beside the page: photos hung on the right, free to move up and down.
//
// Layout is a PURE FUNCTION of stored data — each photo's `y`, width `w` and aspect ratio
// `ar`. Nothing is measured from the DOM, and that is the real fix for the freeze.
//
// The old rail anchored every photo to a live § position, so it had to measure the page
// (getBoundingClientRect on every scroll frame, a ResizeObserver on the paper, heights
// read back from rendered cards). Photos change size as they load and resize, which kept
// feeding that measurement loop. Now a photo's height is derived —
//
//     height = (w − 2·PIN_PAD) / ar + 2·PIN_PAD
//
// — and the CSS renders the frame at exactly that size, so the numbers here and the pixels
// on screen cannot drift apart. There is nothing left to measure.
//
// Firebase-free and DOM-free on purpose: tests/room.unit.test.mjs loads it under Node.

export const PIN_GAP = 22; // breathing room between two photos
export const PIN_PAD = 8; // paper border round the photo — MUST equal .room-hang-card padding
export const DEFAULT_PIN_WIDTH = 300;
export const MIN_PIN_WIDTH = 140;
export const MAX_PIN_WIDTH = 364; // the rail column in room.css (.room-note grid)
export const DEFAULT_RATIO = 4 / 3; // until a photo's real shape is known
export const BOARD_TAIL = 120; // empty space kept under the last photo, as a drop target
export const NUDGE = 18; // one arrow-key step

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export const pinWidth = (pin) =>
  clamp(Math.round(Number(pin?.w) || DEFAULT_PIN_WIDTH), MIN_PIN_WIDTH, MAX_PIN_WIDTH);

export const pinRatio = (pin) => (Number(pin?.ar) > 0 ? Number(pin.ar) : DEFAULT_RATIO);

export const pinHeight = (pin, width = pinWidth(pin)) =>
  Math.round((width - 2 * PIN_PAD) / pinRatio(pin) + 2 * PIN_PAD);

// A width for a resize gesture, locked to the photo's shape. Whichever axis the pointer
// moved further along drives it, so a diagonal pull feels natural and the photo can never
// be squashed or stretched.
export const resizeWidth = (fromWidth, ratio, dx, dy) => {
  const byY = dy * (ratio > 0 ? ratio : DEFAULT_RATIO);
  const delta = Math.abs(dx) >= Math.abs(byY) ? dx : byY;
  return clamp(Math.round(fromWidth + delta), MIN_PIN_WIDTH, MAX_PIN_WIDTH);
};

const merged = (pin, overrides) => (overrides[pin.id] ? { ...pin, ...overrides[pin.id] } : pin);

// Where every photo actually sits. A photo stays where it was hung (`y`) unless that would
// overlap the photo above it, in which case it is pushed down just far enough. Nothing is
// ever pushed UP — a board keeps the gaps you leave on it.
//
// ORDER IS DECIDED BY CENTRES. Two photos swap places the moment one's middle passes the
// other's middle — the way a hand sliding paper past paper feels. Ordering by top edge
// instead made a dragged photo "stick" behind its neighbour until it had been dragged
// almost the neighbour's full height. For photos that do not overlap, centre order and
// top order are the same thing, so a settled board never reshuffles.
//
// `overrides` lets a drag or a resize preview a change ({ [id]: { y?, w?, ar? } }) without
// touching stored pins. Photos with no `y` yet (older notes) are stacked from the top in
// the order they were added.
export const resolveRail = (pins = [], overrides = {}) => {
  let legacyFloor = 0;
  const items = pins.map((pin, order) => {
    const next = merged(pin, overrides);
    const w = pinWidth(next);
    const h = pinHeight(next, w);
    const y = Number(next.y);
    let want;
    if (Number.isFinite(y)) {
      want = Math.max(0, Math.round(y));
    } else {
      want = legacyFloor;
      legacyFloor += h + PIN_GAP;
    }
    return { id: pin.id, order, w, h, want, centre: want + h / 2, moving: Boolean(overrides[pin.id]) };
  });
  // On a tie, the photo being moved wins: what you are placing goes where you put it.
  // Without this, two same-size photos with the top one at y=0 could never swap — the
  // dragged one is clamped at 0, so its centre can only ever TIE the other's.
  items.sort(
    (a, b) =>
      a.centre - b.centre || Number(b.moving) - Number(a.moving) || a.want - b.want || a.order - b.order,
  );

  const slots = {};
  let floor = 0;
  let bottom = 0;
  items.forEach((item, rank) => {
    const top = Math.max(item.want, floor);
    slots[item.id] = { top, w: item.w, h: item.h, rank };
    bottom = top + item.h;
    floor = bottom + PIN_GAP;
  });

  return {
    slots,
    // Where the next photo would go if appended.
    end: items.length ? floor : 0,
    // How tall the board has to be to hold everything, plus room to drop more.
    height: items.length ? bottom + BOARD_TAIL : 0,
  };
};

// The resolved positions written back, so what is stored is what is shown. Returns ONLY
// the pins that changed — an overridden pin always, plus any the change pushed.
//
// It returns PATCHES ({ id, y, w, …overrides }), never whole pins, and the caller merges
// them. Whole pins are copies of a render-time snapshot, so two commits landing before a
// re-render (several old photos learning their shape as they load) would each write back a
// stale copy of the other — silently undoing the first one's change. A patch only ever
// carries the fields this call actually decided.
export const settleRail = (pins = [], overrides = {}) => {
  const { slots } = resolveRail(pins, overrides);
  return pins.flatMap((pin) => {
    const slot = slots[pin.id];
    const touched = Boolean(overrides[pin.id]);
    if (!touched && pin.y === slot.top && pin.w === slot.w) return [];
    return [{ ...(overrides[pin.id] || {}), id: pin.id, y: slot.top, w: slot.w }];
  });
};

// Keyboard moves. A plain step up or down; when the step would run into a neighbour, the
// two swap places instead, so arrow keys can reorder the board as well as nudge it.
//
// A swap is written as the two FINAL positions, packed exactly as resolveRail would pack
// them. It cannot just move one photo a pixel past the other: with centre ordering, a tall
// photo "one pixel above" a short one still has its centre below it and would not swap.
export const nudgeOverrides = (pins, id, direction) => {
  const { slots } = resolveRail(pins);
  const self = slots[id];
  if (!self) return {};
  const ordered = pins
    .map((pin) => ({ id: pin.id, ...slots[pin.id] }))
    .sort((a, b) => a.rank - b.rank);
  const index = ordered.findIndex((item) => item.id === id);

  if (direction < 0) {
    const above = ordered[index - 1];
    const wanted = Math.max(0, self.top - NUDGE);
    if (!above || wanted >= above.top + above.h + PIN_GAP) return { [id]: { y: wanted } };
    return { [id]: { y: above.top }, [above.id]: { y: above.top + self.h + PIN_GAP } };
  }

  const below = ordered[index + 1];
  const wanted = self.top + NUDGE;
  if (!below || wanted + self.h + PIN_GAP <= below.top) return { [id]: { y: wanted } };
  return { [below.id]: { y: self.top }, [id]: { y: self.top + below.h + PIN_GAP } };
};
