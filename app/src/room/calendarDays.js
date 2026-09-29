// The calendar's arithmetic, and the course schedule it is built from.
//
// Dates are LOCAL 'YYYY-MM-DD' keys — the shape classic's `events` map already uses — so
// something added in either design shows in both.
//
// A course's weekly meetings are never stored as dated events. They are SYNTHESISED here
// from the course's optional `schedule`, `{ days: [0-6], time: 'HH:MM' | '' }` with 0 as
// Sunday (as Date#getDay counts). Changing a course's times therefore moves every class at
// once, and deleting the course takes its classes with it.
//
// DOM-free and Firebase-free on purpose: tests/room.unit.test.mjs loads it under Node.

const pad = (n) => String(n).padStart(2, '0');

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

// The order a student reads a week in: Monday first, Sunday last.
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

/* ── Day keys ─────────────────────────────────────────────────────────────── */

export const ymd = (date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

export const isYmd = (key) => /^\d{4}-\d{2}-\d{2}$/.test(String(key || ''));

export const parseYmd = (key) => {
  const [y, m, d] = String(key || '').split('-').map(Number);
  return new Date(y || 1970, (m || 1) - 1, d || 1);
};

export const addDays = (key, n) => {
  const date = parseYmd(key);
  return ymd(new Date(date.getFullYear(), date.getMonth(), date.getDate() + n));
};

const monthOf = (key) => String(key).slice(0, 7);
const isWeekend = (key) => {
  const day = parseYmd(key).getDay();
  return day === 0 || day === 6;
};

// "Friday 18"
export const dayLabel = (key) => {
  const date = parseYmd(key);
  return `${WEEKDAY_NAMES[date.getDay()]} ${date.getDate()}`;
};

// 'HH:MM' on a 24-hour clock, or '' — anything else is dropped rather than guessed at.
export const cleanTime = (value) => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!match) return '';
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return '';
  return `${pad(hours)}:${pad(minutes)}`;
};

const minutesOf = (time) => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};

/* ── A course's week ──────────────────────────────────────────────────────── */

// Null when the course meets on no day — that is "no schedule", which the UI shows as
// nothing at all. `from` / `until` are the term's first and last day, both optional: without
// them a class simply repeats every week. An `until` before `from` is dropped, not guessed at.
export const cleanSchedule = (value) => {
  if (!value || typeof value !== 'object' || !Array.isArray(value.days)) return null;
  const given = value.days.map(Number);
  const days = WEEK_ORDER.filter((day) => given.includes(day));
  if (!days.length) return null;
  const schedule = { days, time: cleanTime(value.time) };
  if (isYmd(value.from)) schedule.from = value.from;
  if (isYmd(value.until) && !(schedule.from && value.until < schedule.from)) schedule.until = value.until;
  return schedule;
};

// Whether a course's classes run on a given day at all (inside its term, if it has one).
export const meetsOn = (schedule, key) =>
  Boolean(schedule) &&
  schedule.days.includes(parseYmd(key).getDay()) &&
  !(schedule.from && key < schedule.from) &&
  !(schedule.until && key > schedule.until);

const joinAnd = (words) =>
  words.length <= 1 ? words.join('') : `${words.slice(0, -1).join(', ')} & ${words[words.length - 1]}`;

// "Tue & Thu 10:00" · "Mon, Wed & Fri" · "Fri 11:00" · "Weekdays 09:00"
export const scheduleLine = (value) => {
  const schedule = cleanSchedule(value);
  if (!schedule) return '';
  const weekdays = schedule.days.length === 5 && schedule.days.every((day) => day >= 1 && day <= 5);
  const days = weekdays ? 'Weekdays' : joinAnd(schedule.days.map((day) => WEEKDAY_SHORT[day]));
  return schedule.time ? `${days} ${schedule.time}` : days;
};

const text = (value) => (typeof value === 'string' ? value.trim() : '');

// The line under a course's name — "Tue & Thu 10:00 · Room 204" — each part only if set.
// The design shows the professor on the course page, not on the desk.
export const courseMeta = (course, { professor = false } = {}) =>
  [scheduleLine(course?.schedule), text(course?.room), professor ? text(course?.professor) : '']
    .filter(Boolean)
    .join(' · ');

/* ── Breaks ─────────────────────────────────────────────────────────────────
   Stretches with no classes — a fall break, the holidays: `roomPrefs.breaks`, a short
   list of { id, name, from, until }. A break silences every course's classes on its days;
   the things you added yourself still show. A reversed range is put the right way round
   and a one-day break may leave `until` out.                                       */

export const cleanBreaks = (value) =>
  (Array.isArray(value) ? value : [])
    .filter((entry) => entry && isYmd(entry.from))
    .map((entry) => {
      const until = isYmd(entry.until) ? entry.until : entry.from;
      const [from, to] = entry.from <= until ? [entry.from, until] : [until, entry.from];
      return {
        id: String(entry.id || `${from}_${to}`),
        name: String(entry.name || '').trim().slice(0, 60),
        from,
        until: to,
      };
    })
    .sort((a, b) => a.from.localeCompare(b.from));

export const breakOn = (breaks, key) =>
  (breaks || []).find((entry) => key >= entry.from && key <= entry.until) || null;

/* ── One day ──────────────────────────────────────────────────────────────── */

const byTime = (a, b) => (a.time || '99:99').localeCompare(b.time || '99:99');

// Everything on one day: the classes that meet that weekday and what you added.
// Timed entries come first, in time order; then untimed classes; then untimed things.
// `breaks` should already be cleaned (cleanBreaks) — this runs for every day on screen.
export const dayEntries = (key, { courses = [], events = [], breaks = [] } = {}) => {
  const byId = new Map(courses.map((course) => [course.id, course]));
  const onBreak = Boolean(breakOn(breaks, key));

  const classes = courses.flatMap((course) => {
    const schedule = cleanSchedule(course.schedule);
    if (onBreak || !meetsOn(schedule, key)) return [];
    return [
      {
        kind: 'class',
        id: `${course.id}@${key}`,
        courseId: course.id,
        title: course.name || '',
        color: course.color || '',
        time: schedule.time,
      },
    ];
  });

  const added = events
    .filter((event) => event?.date === key)
    .map((event) => {
      const course = event.courseId ? byId.get(event.courseId) : null;
      return {
        kind: 'event',
        id: event.id,
        title: event.title || '',
        time: cleanTime(event.time),
        courseId: course?.id || '',
        courseName: course?.name || '',
        event,
      };
    });

  const rank = (entry) => (entry.time ? 0 : entry.kind === 'class' ? 1 : 2);
  return [...classes, ...added].sort(
    (a, b) => rank(a) - rank(b) || byTime(a, b) || a.title.localeCompare(b.title),
  );
};

/* ── The journal ──────────────────────────────────────────────────────────────
   A journal, not a grid: days are strips read downward. A day with something on it is a
   strip; empty days collapse, and consecutive empty days merge into one quiet line.
   `keep` days (today, a day you jumped to) are always strips, so there is somewhere to
   press +. A new month opens with a divider, and a quiet run never crosses one.      */

const JOURNAL_MAX_DAYS = 400;

// `breakOf(key)` names the break a day falls in, if any: a quiet run never mixes break
// days with ordinary empty days, so each can say what it is.
export const journalRows = (from, to, entriesOf, keep = [], breakOf = () => null) => {
  const rows = [];
  if (!isYmd(from) || !isYmd(to) || from > to) return rows;
  let quiet = [];
  let quietBreak = null;
  let month = monthOf(from);
  const flush = () => {
    if (quiet.length) {
      rows.push({ type: 'quiet', keys: quiet, breakName: quietBreak ? quietBreak.name || '' : null });
    }
    quiet = [];
    quietBreak = null;
  };
  let key = from;
  for (let n = 0; key <= to && n < JOURNAL_MAX_DAYS; n += 1, key = addDays(key, 1)) {
    if (monthOf(key) !== month) {
      flush();
      month = monthOf(key);
      rows.push({ type: 'month', key });
    }
    const entries = entriesOf(key);
    if (entries.length || keep.includes(key)) {
      flush();
      rows.push({ type: 'day', key, entries });
    } else {
      const off = breakOf(key);
      if (quiet.length && (off?.id || null) !== (quietBreak?.id || null)) flush();
      if (!quiet.length) quietBreak = off;
      quiet.push(key);
    }
  }
  flush();
  return rows;
};

// "Saturday 19 · Sunday 20 — weekend, nothing planned."
// "Tuesday 22 to Thursday 24 — nothing planned."
// "Monday 12 to Friday 16 — Fall break, no classes."   (breakName: '' for an unnamed break)
export const quietLine = (keys = [], breakName = null) => {
  if (!keys.length) return '';
  const span =
    keys.length <= 2
      ? keys.map(dayLabel).join(' · ')
      : `${dayLabel(keys[0])} to ${dayLabel(keys[keys.length - 1])}`;
  if (breakName !== null) return `${span} — ${breakName || 'a break'}, no classes.`;
  return `${span} — ${keys.every(isWeekend) ? 'weekend, nothing planned' : 'nothing planned'}.`;
};

/* ── The month ────────────────────────────────────────────────────────────── */

// The dot-month: blanks before the 1st (weeks start on Sunday, as the design draws it),
// then one key per day.
export const monthDays = (year, month) => {
  const first = new Date(year, month, 1);
  const count = new Date(year, month + 1, 0).getDate();
  return {
    blanks: first.getDay(),
    keys: Array.from({ length: count }, (_, i) => ymd(new Date(year, month, i + 1))),
  };
};

// The month view's wall grid: always six full weeks, Sunday first — classic's shape.
export const monthGrid = (year, month) => {
  const offset = new Date(year, month, 1).getDay();
  return Array.from({ length: 42 }, (_, i) => ymd(new Date(year, month, 1 - offset + i)));
};

/* ── Sentences ────────────────────────────────────────────────────────────── */

const COUNT_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
// "Two", "Ten", then digits — for sentences in the design's voice.
export const countWord = (n) => COUNT_WORDS[n] || String(n);

const when = (key, fromKey) => {
  const date = parseYmd(key);
  const ahead = Math.round((date - parseYmd(fromKey)) / 86_400_000);
  if (ahead === 1) return 'tomorrow';
  return ahead <= 6 ? WEEKDAY_NAMES[date.getDay()] : dayLabel(key);
};

// The one sentence under the month's name, for the month you are in.
// "Two classes today, then a free weekend."
export const calendarSummary = ({ todayKey, entriesOf, horizon = 14 }) => {
  const today = entriesOf(todayKey);
  const onlyClasses = today.every((entry) => entry.kind === 'class');
  const one = today.length === 1;
  const noun = onlyClasses ? (one ? 'class' : 'classes') : one ? 'thing' : 'things';
  const head = `${countWord(today.length)} ${noun} today`;

  const gap = [];
  for (let i = 1; i <= horizon; i += 1) {
    const key = addDays(todayKey, i);
    const entries = entriesOf(key);
    if (entries.length) {
      const next = entries[0].title;
      if (!today.length) {
        return i === 1 ? `Nothing today. ${next} tomorrow.` : `Nothing today. ${next} on ${when(key, todayKey)}.`;
      }
      if (i === 1) return `${head}, then ${next} tomorrow.`;
      if (gap.every(isWeekend)) {
        // On a Saturday the only free day ahead is Sunday — it is not "a free weekend".
        const free = gap.length === 1 ? `a free ${WEEKDAY_NAMES[parseYmd(gap[0]).getDay()]}` : 'a free weekend';
        return `${head}, then ${free}.`;
      }
      return `${head}, then nothing until ${when(key, todayKey)}.`;
    }
    gap.push(key);
  }
  return today.length ? `${head}, and nothing else for two weeks.` : 'Nothing in the next two weeks.';
};

// The same sentence for any other month: only what you added counts — classes recur.
export const monthSummary = ({ year, month, events = [] }) => {
  const prefix = `${year}-${pad(month + 1)}-`;
  const n = events.filter((event) => String(event?.date || '').startsWith(prefix)).length;
  const name = MONTH_NAMES[month];
  if (!n) return `Nothing added for ${name} yet.`;
  return `${countWord(n)} ${n === 1 ? 'thing' : 'things'} added for ${name}.`;
};

/* ── Home's status line ───────────────────────────────────────────────────────
   Once courses carry times, Home can say what the day holds — the design's
   "Two classes today — Statistics, then Data Structures. The rest of the day is yours."
   Returns '' when no course has a schedule; the caller falls back to what it knows. */

// A class still "counts" until it is over. There is no end time, so assume the common
// 75 minutes rather than dropping a class the moment it starts. A class with no time
// counts until the end of the teaching day — at 21:40 it is over, whatever time it was.
const CLASS_MINUTES = 75;
const TEACHING_DAY_ENDS = 18 * 60;

const partOfDay = (time) => {
  const minutes = minutesOf(time);
  if (minutes < 12 * 60) return 'morning';
  if (minutes < 17 * 60) return 'afternoon';
  return 'evening';
};

const joinThen = (names) =>
  names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')}, then ${names[names.length - 1]}`;

export const classStatus = ({ courses = [], now = new Date(), breaks = [] }) => {
  const scheduled = courses.filter((course) => cleanSchedule(course.schedule));
  if (!scheduled.length) return '';

  const todayKey = ymd(now);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const today = dayEntries(todayKey, { courses: scheduled, breaks });
  const left = today.filter((entry) =>
    entry.time ? minutesOf(entry.time) + CLASS_MINUTES > nowMinutes : nowMinutes < TEACHING_DAY_ENDS,
  );

  if (left.length === 1) {
    const only = left[0];
    return `${only.title} ${only.time ? `at ${only.time}` : 'today'}. The rest of the day is yours.`;
  }
  if (left.length > 1) {
    return `${countWord(left.length)} classes today — ${joinThen(left.map((entry) => entry.title))}. The rest of the day is yours.`;
  }

  const off = breakOn(breaks, todayKey);
  const opener = today.length
    ? `${WEEKDAY_NAMES[now.getDay()]}'s done.`
    : off
      ? `${off.name || 'A break'} — no classes today.`
      : 'Nothing on today.';
  for (let i = 1; i <= 7; i += 1) {
    const key = addDays(todayKey, i);
    const entries = dayEntries(key, { courses: scheduled, breaks });
    if (entries.length) {
      const first = entries[0];
      const day = i === 1 ? 'tomorrow' : WEEKDAY_NAMES[parseYmd(key).getDay()];
      const part = first.time ? ` ${partOfDay(first.time)}` : '';
      const quiet = i > 1 ? ' Nothing before then.' : '';
      return `${opener} ${first.title} is next, ${day}${part}.${quiet}`;
    }
  }
  return '';
};

// Used by the journal's strips: "Today" for today, the weekday otherwise.
export const stripLabel = (key, todayKey) => (key === todayKey ? 'Today' : WEEKDAY_NAMES[parseYmd(key).getDay()]);
