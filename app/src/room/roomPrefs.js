// Room atmosphere: the mood the room is in, and the few switches that shape it.
// See dualmode.md §8 step 2. The You page (step 3) writes these; step 2 only reads them.
//
// Everything here resolves to ATTRIBUTES ON <html>, for one concrete reason: the ground
// is painted by index.css's `body` rule via var(--bg). `body` is an ancestor of the room
// tree, so a custom property redefined on a room element inside it would never reach it.
// The attributes must sit above body, exactly like the existing data-theme.

import { useEffect, useMemo, useState } from 'react';
import { rememberMood } from '../designModes';

/* ── Mood ─────────────────────────────────────────────────────────────────────
   'clock' resolves against the hour; 'lamp' and 'rain' pin it. Two states of one
   theme, not two themes.                                                       */

export const MOOD_CLOCK = 'clock';
export const MOOD_LAMP = 'lamp';
export const MOOD_RAIN = 'rain';

export const MOOD_NIGHT = 'night';
export const MOOD_DAY = 'day';

export const MOOD_OPTIONS = [
  { id: MOOD_CLOCK, label: 'Clock' },
  { id: MOOD_LAMP, label: 'Lamp' },
  { id: MOOD_RAIN, label: 'Rain' },
];

const DAY_STARTS = 6;
const DAY_ENDS = 18;

export const isDaytime = (date = new Date()) => {
  const hour = date.getHours();
  return hour >= DAY_STARTS && hour < DAY_ENDS;
};

// 'clock' | 'lamp' | 'rain'  →  'night' | 'day'
export const resolveMood = (preference, date = new Date()) => {
  if (preference === MOOD_LAMP) return MOOD_NIGHT;
  if (preference === MOOD_RAIN) return MOOD_DAY;
  return isDaytime(date) ? MOOD_DAY : MOOD_NIGHT;
};

/* ── Prefs ────────────────────────────────────────────────────────────────────
   `handDrawn: false` means square-ish radii, no tilts, no pencil rules — handled
   entirely by flipping shape tokens in room.css, never by branching in JSX.
   `motion: 'still'` disables everything except the mood cross-fade.            */

export const MOTION_CALM = 'calm';
export const MOTION_STILL = 'still';

export const ROOM_PREFS_DEFAULT = {
  mood: MOOD_CLOCK,
  grain: true,
  handDrawn: true,
  motion: MOTION_CALM,
  radio: false,
};

export const resolveRoomPrefs = (stored) => {
  const raw = stored && typeof stored === 'object' ? stored : {};
  const moodOk = MOOD_OPTIONS.some((option) => option.id === raw.mood);
  return {
    mood: moodOk ? raw.mood : ROOM_PREFS_DEFAULT.mood,
    grain: typeof raw.grain === 'boolean' ? raw.grain : ROOM_PREFS_DEFAULT.grain,
    handDrawn: typeof raw.handDrawn === 'boolean' ? raw.handDrawn : ROOM_PREFS_DEFAULT.handDrawn,
    motion: raw.motion === MOTION_STILL ? MOTION_STILL : MOTION_CALM,
    radio: typeof raw.radio === 'boolean' ? raw.radio : ROOM_PREFS_DEFAULT.radio,
  };
};

/* ── Applying it ──────────────────────────────────────────────────────────── */

const ROOM_ATTRS = ['data-mood', 'data-grain', 'data-hand-drawn', 'data-motion'];

const setRoomAttributes = (mood, prefs) => {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.setAttribute('data-mood', mood);
  root.setAttribute('data-grain', prefs.grain ? 'on' : 'off');
  root.setAttribute('data-hand-drawn', prefs.handDrawn ? 'on' : 'off');
  root.setAttribute('data-motion', prefs.motion);
};

export const clearRoomAttributes = () => {
  if (typeof document === 'undefined') return;
  ROOM_ATTRS.forEach((attr) => document.documentElement.removeAttribute(attr));
};

// A clock that ticks on the minute boundary and again whenever the window regains focus —
// a laptop that slept through 18:00 would otherwise keep the lamp on, and Home's clock
// line would show the minute the page was opened, forever.
export const useMinuteClock = () => {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer = null;
    const schedule = () => {
      const current = new Date();
      const wait = 60_000 - (current.getSeconds() * 1000 + current.getMilliseconds()) + 40;
      timer = setTimeout(() => {
        setNow(new Date());
        schedule();
      }, wait);
    };
    schedule();
    const onFocus = () => setNow(new Date());
    window.addEventListener('focus', onFocus);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, []);
  return now;
};

// The mood is DERIVED from the preference and the clock, never synced into state by an
// effect — a setState in an effect body is a cascading render, and this needs none.
export const useRoomAtmosphere = (stored) => {
  // Memoised because resolveRoomPrefs returns a fresh object every call, which would
  // otherwise re-fire the attribute effect on every render.
  const prefs = useMemo(() => resolveRoomPrefs(stored), [stored]);
  const now = useMinuteClock();
  const mood = resolveMood(prefs.mood, now);

  useEffect(() => {
    setRoomAttributes(mood, prefs);
    // So the next reload's first paint is this mood's ground (public/boot.js).
    rememberMood(mood);
  }, [mood, prefs]);

  return { mood, prefs };
};

/* ── Shape helpers ────────────────────────────────────────────────────────────
   Paper tilts cycle through ±0.3°…±1.2° and never repeat an angle back to back.
   Deterministic by index so a grid looks hand-laid but never reshuffles on render. */

const TILTS = [-0.6, 0.4, -1.0, 0.8, -0.3, 1.2, -0.8, 0.5, -1.2, 0.3];

export const tiltFor = (index = 0) => TILTS[Math.abs(index) % TILTS.length];

// The same, keyed on a stable id rather than a position — so a photo keeps its own tilt
// wherever it is moved to on the board, instead of changing angle every time it swaps
// places with a neighbour.
export const tiltForKey = (key = '') => {
  let hash = 0;
  for (const ch of String(key)) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return TILTS[Math.abs(hash) % TILTS.length];
};

// Load stagger: every block fades in, 70ms apart, in reading order.
export const staggerStyle = (index = 0) => ({ animationDelay: `${(index * 0.07).toFixed(2)}s` });
