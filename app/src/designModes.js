// Dual-design seam. See `dualmode.md` at the repo root for the full rationale.
//
// Two designs coexist: 'classic' (the canvas app that has always been here) and
// 'room' (the "lofi study room" redesign). They share courses, the profile and the
// whole backend; they do NOT share notes.
//
// Two separate concepts live in this file, and keeping them separate is the point:
//
//   designMode  — the user's PREFERENCE, stored on the profile doc. It decides which
//                 design the switch sends you to. It does NOT repaint anything.
//   data-design — the attribute on <html>, set by a room route while it is mounted and
//                 cleared when it unmounts. Only this drives styling.
//
// Driving the attribute from the route (not from the preference) is deliberate: a user
// whose preference is 'room' can still open a classic URL, and classic must render
// exactly as it always did. Tying the attribute to the preference would repaint classic.

export const DESIGN_CLASSIC = 'classic';
export const DESIGN_ROOM = 'room';

// What a NEW account starts in: the room (owner, 2026-09-28). This constant only seeds a
// profile at creation (AuthContext). It is deliberately NOT the fallback for a missing
// preference: profiles from before the seam carry no `designMode`, and those people have
// always used classic — `resolveDesignMode` keeps them there.
export const DESIGN_DEFAULT_MODE = DESIGN_ROOM;

export const DESIGN_OPTIONS = [
  {
    id: DESIGN_CLASSIC,
    label: 'Classic',
    blurb: 'The canvas desk you already use. Blocks you place anywhere.',
  },
  {
    id: DESIGN_ROOM,
    label: 'Room',
    blurb: 'Keeps your courses and starts with its own notes.',
  },
];

// A missing or unknown preference means classic — see DESIGN_DEFAULT_MODE above.
export const resolveDesignMode = (mode) => (mode === DESIGN_ROOM ? DESIGN_ROOM : DESIGN_CLASSIC);

/* ── Which design renders at a URL ─────────────────────────────────────────────
   Decided HERE, at the root of the route tree — never by redirecting. `/dashboard` in
   room mode IS the room's home, at that address; nothing navigates, nothing flashes.

     /room/…                          always the room
     /dashboard  /settings  /calendar  follow the preference — both designs have a home,
     /class/:id                       a settings page, a calendar and a course page
     everything else                  classic: a canvas note or the template builder,
                                      which only classic can show                       */

const FOLLOWS_PREFERENCE = [
  /^\/dashboard\/?$/,
  /^\/settings\/?$/,
  /^\/calendar\/?$/,
  /^\/class\/[^/]+\/?$/,
];

export const designFor = (pathname = '', mode) => {
  if (pathname === '/room' || pathname.startsWith('/room/')) return DESIGN_ROOM;
  if (resolveDesignMode(mode) === DESIGN_ROOM && FOLLOWS_PREFERENCE.some((re) => re.test(pathname))) {
    return DESIGN_ROOM;
  }
  return DESIGN_CLASSIC;
};

/* ── The first paint ───────────────────────────────────────────────────────────
   public/boot.js reads what is remembered here BEFORE the app's code arrives and marks
   <html data-boot="room">, so a reload in the room paints the room's ground from the first
   frame instead of flashing classic's. Both are `companion:` keys, so "clear this device"
   removes them. The marks come off the moment the real page takes over (`clearBoot`). */

export const DESIGN_BOOT_KEY = 'companion:design';
export const MOOD_BOOT_KEY = 'companion:mood';

export const rememberDesign = (mode) => {
  try {
    localStorage.setItem(DESIGN_BOOT_KEY, resolveDesignMode(mode));
  } catch {
    // Storage blocked: the next reload simply paints classic first, as before.
  }
};

export const rememberMood = (mood) => {
  try {
    localStorage.setItem(MOOD_BOOT_KEY, mood === 'day' ? 'day' : 'night');
  } catch {
    // As above.
  }
};

export const clearBoot = () => {
  if (typeof document === 'undefined') return;
  document.documentElement.removeAttribute('data-boot');
  document.documentElement.removeAttribute('data-boot-mood');
};

// Sets <html data-design>. Room routes call this on mount and reset it on unmount.
export const applyDesignMode = (mode) => {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-design', resolveDesignMode(mode));
};

/* ── Note format ───────────────────────────────────────────────────────────────
   A note belongs to exactly one design, recorded in its `format` field. Notes that
   predate the seam have no `format` at all, so ABSENT MUST MEAN 'canvas'.

   This is also why the lists filter in JS and never in a Firestore query:
   `where('format','==','canvas')` does not match documents that lack the field, so
   querying on it would silently hide every note written before today.          */

export const NOTE_FORMAT_CANVAS = 'canvas';
export const NOTE_FORMAT_PAGE = 'page';

export const noteFormatFor = (mode) =>
  resolveDesignMode(mode) === DESIGN_ROOM ? NOTE_FORMAT_PAGE : NOTE_FORMAT_CANVAS;

export const noteFormatOf = (note) =>
  note?.format === NOTE_FORMAT_PAGE ? NOTE_FORMAT_PAGE : NOTE_FORMAT_CANVAS;

// Predicates for the note lists. `isCanvasNote` is what classic filters on.
export const isCanvasNote = (note) => noteFormatOf(note) === NOTE_FORMAT_CANVAS;
export const isPageNote = (note) => noteFormatOf(note) === NOTE_FORMAT_PAGE;
