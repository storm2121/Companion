// The room the home's window looks into (HeroWindow.jsx): Rain by day and Candlelight at night,
// following the visitor's clock the way the app does (the room's own rule, room/roomPrefs.js
// isDaytime: day from 06:00 to 18:00 — repeated here because that module cannot load under Node),
// unless the visitor picks one. The choice is this visit's alone: it is never written anywhere,
// and never touches a signed-in desk's own preferences.
//
// The pure part (moodAt, clockText, statusText) is tested in tests/public-window.unit.test.mjs.
// The store below it is what the window, the site's top line, a note's page and the ⌘K demo share.

export const MOOD_AUTO = 'auto';
export const MOOD_RAIN = 'rain';
export const MOOD_CANDLELIGHT = 'candlelight';

export const MOOD_CHOICES = [
  { id: MOOD_AUTO, label: 'Auto' },
  { id: MOOD_RAIN, label: 'Rain' },
  { id: MOOD_CANDLELIGHT, label: 'Candlelight' },
];

export const MOOD_NAMES = { [MOOD_RAIN]: 'Rain', [MOOD_CANDLELIGHT]: 'Candlelight' };

const DAY_STARTS = 6;
const DAY_ENDS = 18;
export const isDaytime = (date = new Date()) => date.getHours() >= DAY_STARTS && date.getHours() < DAY_ENDS;

const isMood = (value) => value === MOOD_RAIN || value === MOOD_CANDLELIGHT;
export const isChoice = (value) => value === MOOD_AUTO || isMood(value);

// 'auto' | 'rain' | 'candlelight'  ->  'rain' | 'candlelight'
export const moodAt = (choice, date = new Date()) => {
  if (isMood(choice)) return choice;
  return isDaytime(date) ? MOOD_RAIN : MOOD_CANDLELIGHT;
};

const pad = (n) => String(n).padStart(2, '0');

// The app's own clock: 24-hour, as the desk's top line writes it.
export const clockText = (date = new Date()) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;

// "Rain · 14:32": what the top line says about the room.
export const statusText = (mood, date = new Date()) => `${MOOD_NAMES[mood] ?? MOOD_NAMES[MOOD_RAIN]} · ${clockText(date)}`;

// ── The visit's store ────────────────────────────────────────────────────────────────────────
// Outside React, so the top line (PublicLayout) and the pages under it (MarketingExperience)
// read one value without threading it through the router. The clock ticks on the minute only
// while something is listening, and is read again whenever the tab comes back.

let choice = MOOD_AUTO;
let snapshot = null;
const listeners = new Set();
let timer = 0;

const build = (date = new Date()) => ({ choice, mood: moodAt(choice, date), clock: clockText(date) });

const publish = () => {
  const next = build();
  if (snapshot && next.choice === snapshot.choice && next.mood === snapshot.mood && next.clock === snapshot.clock) return;
  snapshot = next;
  listeners.forEach((listener) => listener());
};

const tick = () => {
  publish();
  const now = new Date();
  timer = window.setTimeout(tick, 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds()) + 20);
};

const onVisible = () => {
  if (document.visibilityState === 'visible') publish();
};

export const readMood = () => {
  if (!snapshot) snapshot = build();
  return snapshot;
};

export const subscribeMood = (listener) => {
  listeners.add(listener);
  if (listeners.size === 1) {
    tick();
    document.addEventListener('visibilitychange', onVisible);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size) return;
    window.clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisible);
  };
};

export const setMoodChoice = (next) => {
  if (!isChoice(next) || next === choice) return;
  choice = next;
  publish();
};
