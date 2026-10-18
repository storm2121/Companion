// What the public home (MarketingExperience.jsx) says and shows: one complete page — the window
// into the room, the desk (its cards switch the note shown under it), Sage, finding things and the
// week, the rest of the desk, and what is coming — and, a level down, a page for each note on the
// desk. Every picture is an actual Companion capture of invented content (public/images/landing),
// with a desktop and a phone crop. `body` is what each capture shows written in the note: the home's
// ⌘K demo (findIndex.js) searches it, the way the app searches a note by any word in it.
//
// Card positions on the desk picture come from the capture harness (deskTargets.json):
// { desktop | phone: { width, height, targets: [{ view, label, x, y, w, h }] } }, x / y / w / h as
// fractions of that capture.

export const IMAGES = '/images/landing';

const TARGET_FILES = import.meta.glob('./deskTargets.json', { eager: true, import: 'default' });
export const DESK_TARGETS = TARGET_FILES['./deskTargets.json'] ?? null;

export const LEDE = {
  line: 'A desk for everything you’re working on.',
  more: 'Notes, a calendar that knows your week, an inbox for loose thoughts, and Sage when a note needs work.',
};

export const DESK = {
  src: 'desk',
  width: DESK_TARGETS?.desktop?.width ?? 1736,
  height: DESK_TARGETS?.desktop?.height ?? 358,
  phone: {
    src: 'desk-mobile',
    width: DESK_TARGETS?.phone?.width ?? 740,
    height: DESK_TARGETS?.phone?.height ?? 944,
  },
  alt: 'A Companion desk with invented Everyday, Working Notes and Systems & Signals groups, each with its latest note.',
};

const CANDLELIGHT = {
  src: 'room-cover',
  width: 1872,
  height: 788,
  phone: { src: 'room-night-mobile', width: 732, height: 780 },
  alt: 'The invented Weekend list in Companion’s Candlelight room.',
};

const RAIN = {
  src: 'rain-cover',
  width: 1872,
  height: 788,
  phone: { src: 'rain-cover-mobile', width: 732, height: 780 },
  alt: 'The invented Weekend list in Companion’s Rain room.',
};

const WORK = {
  src: 'working-note',
  width: 1892,
  height: 1644,
  phone: { src: 'working-note-mobile', width: 696, height: 842 },
  alt: 'The invented Harbor review note: the pilot scope highlighted, a decision callout and a checklist for Friday.',
};

const CLASS = {
  src: 'course-note',
  width: 1892,
  height: 1662,
  phone: { src: 'course-note-mobile', width: 696, height: 606 },
  alt: 'The invented Systems & Signals note on sampling: a formula, an aliasing reminder and a review checklist.',
};

// The notes on the desk, in its order, each with a page of its own (/desk/:view). `shown` is how
// the desk shows it under its card.
export const NOTE_ORDER = ['weekend-list', 'harbor-review', 'sampling-notes'];
export const FIRST_SHOWN = 'harbor-review';

export const NOTES = {
  'weekend-list': {
    title: 'Weekend list',
    group: 'Everyday',
    text: 'A short list for Saturday and Sunday, by day in Rain or by evening in Candlelight.',
    moods: { candlelight: CANDLELIGHT, rain: RAIN },
    shown: { label: 'Everyday.', text: 'A short list for the weekend, here by day in the Rain room.', photo: RAIN },
    tags: ['at-home'],
    body: [
      'Saturday morning',
      'Pick up coffee on the way to the market. The bike shop opens at ten.',
      'Book the bike repair',
      'Back up the photos',
      'Sunday',
      'Walk by the river. Read a few pages. Leave the afternoon open.',
    ],
  },
  'harbor-review': {
    title: 'Harbor review',
    group: 'Working Notes',
    text: 'The pilot scope, the decision, and Friday’s checklist on the same page.',
    photo: WORK,
    shown: { label: 'For work.', text: 'The scope, the decision and Friday’s checklist on one page.', photo: WORK },
    tags: ['decisions', 'next-steps'],
    body: [
      'Tuesday’s review',
      'The delivery pilot is ready. We spent most of the review on staffing, dates, and what we still need from the field team.',
      'Keep the pilot to two sites. The wider rollout can follow once we have reviewed the first deliveries.',
      'Decision: Start with the north site. Add the second site after the first delivery review.',
      'Before Friday',
      'Share the revised timeline',
      'Confirm the delivery windows',
      'Send the field checklist',
      'Still open',
      'Do we need a separate visit before the first delivery, or can the field team send the measurements?',
    ],
  },
  'sampling-notes': {
    title: 'Sampling notes',
    group: 'Systems & Signals',
    text: 'An explanation beside its formula, with sections and a reminder for the idea worth revisiting.',
    photo: CLASS,
    shown: { label: 'For a class.', text: 'An explanation beside its formula, and a reminder for what is worth revisiting.', photo: CLASS },
    tags: ['week-03'],
    body: [
      'From a wave to a sequence',
      'Sampling records the value of a continuous signal at regular intervals. The spacing between those readings determines which changes we can still recover.',
      'Remember: A faster-looking pattern can become a slower one when the sampling rate is too low. That ambiguity is aliasing.',
      'What to check',
      'Find the highest frequency first. Then choose a sampling rate with enough room above twice that value.',
      'Sketch the continuous signal',
      'Compare two sampling intervals',
    ],
  },
};

// What Companion does, in the order the page shows it. Find anything and the calendar have their
// own tiles under Sage (Find anything is a working ⌘K); the rest lie on "More on the desk", each
// with its small drawn scene.
export const FEATURES = [
  {
    id: 'calendar',
    title: 'A calendar that knows your week',
    text: 'Give a group its days and times, and they fill your calendar on their own. Deadlines go right next to them.',
  },
  {
    id: 'inbox',
    title: 'An inbox for loose thoughts',
    text: 'Write it down the moment it comes. File it where it belongs later.',
  },
  {
    id: 'find',
    title: 'Find anything',
    text: '⌘K finds a note by any word in it. It also starts a note, adds an event or changes the room.',
  },
  {
    id: 'structure',
    title: 'Notes with some shape',
    text: 'Sections, formulas, callouts, checklists and photos, right on the page.',
  },
  {
    id: 'export',
    title: 'Take it with you',
    text: 'Any note as a PDF. The whole desk as Markdown, one folder per group.',
  },
  {
    id: 'room',
    title: 'A room you like being in',
    text: 'Rain by day, candlelight at night. It follows the clock, or the one you pick.',
  },
];

// What is coming: named, not explained. The drawing shows three people's copies of one note
// being written at once.
export const HUB = {
  label: 'Coming',
  title: 'A hub for your class',
  text: 'Your notes, in step with everyone in the course.',
  items: ['Sync notes with your class', 'Share a page', 'Upload what you have', 'Export it all'],
  close: 'That’s all we’ll say for now.',
  people: ['You', 'Sara', 'Omar'],
};

// The window into the room, under the cover's words (HeroWindow.jsx): the line along its sill, and
// the one hint it gives.
export const WINDOW = {
  note: 'Everyday · Weekend list',
  saved: 'Saved · just now',
  hint: { pointer: 'Drag across the glass to wipe it.', touch: 'Swipe across the glass to wipe it.' },
  fine: 'An actual Companion view. All names and note content are invented.',
};

// The last words on the page.
export const CLOSE = {
  title: 'Ready when you are.',
  open: 'Already have a desk? Open it',
};

export const pathOf = (view) => `/desk/${view}`;

// Which page an address shows — the home (with the section /desk or /sage lands on) or one note —
// and that page's own address (`path`), which an unknown note redirects to.
export const sceneOf = (pathname) => {
  const path = pathname.replace(/\/+$/, '') || '/';
  const match = path.match(/^\/desk\/([^/]+)$/);
  if (match) {
    if (Object.hasOwn(NOTES, match[1])) return { key: `note:${match[1]}`, view: match[1], section: null, path };
    if (match[1] === 'call-with-mira') return { key: 'home', view: null, section: 'sage', path: '/sage' };
    return { key: 'home', view: null, section: 'inside', path: '/desk' };
  }
  const section = path === '/sage' ? 'sage' : path === '/desk' ? 'inside' : null;
  return { key: 'home', view: null, section, path };
};
