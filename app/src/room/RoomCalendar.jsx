import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/authState';
import { deleteCalendarEvent, setCalendarEvent } from '../services/library';
import RoomShell from './RoomShell';
import Paper from './components/Paper';
import { Chip, Dot, Pill } from './components/primitives';
import { Overlay } from './components/Overlay';
import {
  addDays,
  calendarSummary,
  cleanTime,
  dayEntries,
  isYmd,
  journalRows,
  MONTH_NAMES,
  monthDays,
  monthGrid,
  monthSummary,
  parseYmd,
  quietLine,
  stripLabel,
  ymd,
} from './calendarDays';
import { useRoomCourses } from './roomData';
import { tiltFor, useMinuteClock } from './roomPrefs';
import { offerUndo } from './roomUndo';

// Calendar — design 6d. "A journal, not a grid."
//
// Days are paper strips read downward: today first, with the pencil outline; empty days
// collapse into one quiet line. Classes are SYNTHESISED from each course's optional
// schedule (calendarDays.js) — never stored as events — and show a time only if the course
// has one. What you add yourself are amber tags, stored in the same `events` map classic's
// calendar uses, so they show in both designs.
//
// The dot-month on the left is for jumping; "Month view" is the wall calendar, ported from
// classic's six-week grid into paper (dualmode.md §4.2), not a new interaction.

const WEEK_HEAD = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MAX_IN_CELL = 3;

const prefersStill = () =>
  document.documentElement.dataset.motion === 'still' ||
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/* ── Add / edit ───────────────────────────────────────────────────────────── */

const EventForm = ({ draft, courses, uid, onClose }) => {
  const existing = draft.event;
  const [title, setTitle] = useState(existing?.title || '');
  const [date, setDate] = useState(existing?.date || draft.date);
  const [time, setTime] = useState(existing?.time || '');
  const [courseId, setCourseId] = useState(existing?.courseId || '');

  // Not awaited: the write lands in the local cache at once, so the journal redraws
  // immediately, online or not.
  const save = (event) => {
    event.preventDefault();
    const clean = title.trim();
    if (!clean || !isYmd(date) || !uid) return;
    setCalendarEvent(uid, {
      ...(existing || {}),
      date,
      time: cleanTime(time),
      title: clean.slice(0, 120),
      courseId,
    }).catch((err) => console.error('Could not save that', err));
    onClose();
  };

  // Deleting never asks — it goes, and the line offers it back.
  const remove = () => {
    if (!uid || !existing) return;
    deleteCalendarEvent(uid, existing.id).catch((err) => console.error('Could not remove that', err));
    onClose();
    offerUndo({
      message: `${existing.title || 'That'} removed`,
      undo: () =>
        setCalendarEvent(uid, existing).catch((err) => console.error('Could not put that back', err)),
    });
  };

  return (
    <form onSubmit={save}>
      <input
        className="room-field"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="What is it? Quiz 2, office hours, a deadline…"
        aria-label="What is it"
        maxLength={120}
        autoFocus
      />
      <div className="room-form-pair">
        <label className="room-form-field">
          <span className="room-form-label">Day</span>
          <input
            type="date"
            className="room-field"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            required
          />
        </label>
        <label className="room-form-field">
          <span className="room-form-label">Time, if it has one</span>
          <input
            type="time"
            className="room-field"
            value={time}
            onChange={(event) => setTime(event.target.value)}
          />
        </label>
      </div>

      {courses.length > 0 && (
        <>
          <p className="room-form-label">For a course</p>
          <div className="room-days" role="group" aria-label="Course">
            <Chip selected={!courseId} onClick={() => setCourseId('')}>
              None
            </Chip>
            {courses.map((course) => (
              <Chip key={course.id} selected={courseId === course.id} onClick={() => setCourseId(course.id)}>
                {course.name}
              </Chip>
            ))}
          </div>
        </>
      )}

      <div className="room-seg" style={{ marginTop: 22 }}>
        <Pill variant="primary" type="submit" disabled={!title.trim() || !isYmd(date)}>
          {existing ? 'Save' : 'Add it'}
        </Pill>
        <Pill onClick={onClose}>Cancel</Pill>
      </div>

      {existing && (
        <div className="room-sheet-foot">
          <div>
            <div className="room-setting-name">Remove it</div>
            <p className="room-setting-copy">From both designs. You can undo it for a few seconds.</p>
          </div>
          <button type="button" className="room-you-action" onClick={remove}>
            Remove
          </button>
        </div>
      )}
    </form>
  );
};

/* ── The page ─────────────────────────────────────────────────────────────── */

const RoomCalendar = () => {
  const navigate = useNavigate();
  const { firebaseUser, profile } = useAuth();
  const { courses } = useRoomCourses();
  const now = useMinuteClock();
  const todayKey = ymd(now);

  const [view, setView] = useState(() => ({ year: now.getFullYear(), month: now.getMonth() }));
  const [mode, setMode] = useState('journal');
  // A day picked in the dot-month or the month view: always drawn as a strip, and scrolled to.
  const [jump, setJump] = useState({ key: '', seq: 0 });
  const [draft, setDraft] = useState(null);

  const events = useMemo(
    () => Object.values(profile?.events || {}).filter((event) => event && isYmd(event.date)),
    [profile?.events],
  );
  const entriesOf = useCallback((key) => dayEntries(key, { courses, events }), [courses, events]);

  const { year, month } = view;
  const isThisMonth = year === now.getFullYear() && month === now.getMonth();
  const monthStart = ymd(new Date(year, month, 1));
  const monthEnd = ymd(new Date(year, month + 1, 0));

  // In the month you are in, the journal opens at today and runs at least two weeks —
  // past the month's end if it has to, behind a divider. Jumping back to an earlier day
  // opens it from there. Any other month reads from its 1st to its last day.
  const jumpedBack = isThisMonth && jump.key && jump.key < todayKey && jump.key >= monthStart;
  const from = isThisMonth ? (jumpedBack ? jump.key : todayKey) : monthStart;
  const twoWeeks = addDays(todayKey, 13);
  const to = isThisMonth && twoWeeks > monthEnd ? twoWeeks : monthEnd;

  const rows = useMemo(
    () => journalRows(from, to, entriesOf, [todayKey, jump.key].filter(Boolean)),
    [from, to, entriesOf, todayKey, jump.key],
  );

  const summary = isThisMonth
    ? calendarSummary({ todayKey, entriesOf })
    : monthSummary({ year, month, events });

  const dots = useMemo(() => monthDays(year, month), [year, month]);
  const grid = useMemo(() => monthGrid(year, month), [year, month]);

  // After a jump renders, bring its strip into view. No state is set here — only scrolling.
  useEffect(() => {
    if (!jump.key || mode !== 'journal') return;
    const node = document.querySelector(`[data-day="${jump.key}"]`);
    node?.scrollIntoView({ block: 'center', behavior: prefersStill() ? 'auto' : 'smooth' });
  }, [jump, mode]);

  const jumpTo = (key) => {
    const date = parseYmd(key);
    setView({ year: date.getFullYear(), month: date.getMonth() });
    setMode('journal');
    setJump((prev) => ({ key, seq: prev.seq + 1 }));
  };

  const shiftMonth = (delta) => {
    const next = new Date(year, month + delta, 1);
    setView({ year: next.getFullYear(), month: next.getMonth() });
    setJump((prev) => ({ key: '', seq: prev.seq + 1 }));
  };

  const goToday = () => {
    setView({ year: now.getFullYear(), month: now.getMonth() });
    setJump((prev) => ({ key: '', seq: prev.seq + 1 }));
    window.scrollTo({ top: 0, behavior: prefersStill() ? 'auto' : 'smooth' });
  };

  const addOn = (key) => setDraft({ date: key });
  const openCourse = (courseId) => navigate(`/room/course/${courseId}`);

  const renderEntry = (entry) =>
    entry.kind === 'class' ? (
      <button key={entry.id} type="button" className="room-entry" onClick={() => openCourse(entry.courseId)}>
        <Dot size={10} color={entry.color} />
        {entry.title}
        {entry.time && <span className="room-entry-time">{entry.time}</span>}
      </button>
    ) : (
      <button
        key={entry.id}
        type="button"
        className="room-entry"
        onClick={() => setDraft({ date: entry.event.date, event: entry.event })}
      >
        <span className="room-tag">
          {entry.title}
          {entry.courseName && <span className="room-tag-course"> · {entry.courseName}</span>}
        </span>
        {entry.time && <span className="room-entry-time">{entry.time}</span>}
      </button>
    );

  return (
    <RoomShell back="Desk" onBack={() => navigate('/room')} here="calendar">
      <div className="room-split room-cal">
        {/* ── Left: the month, for jumping around ── */}
        <div className="room-split-side room-cal-side room-rise" style={{ animationDelay: '0.07s' }}>
          <div className="room-cal-title">
            <h1 className="room-page-name">{MONTH_NAMES[month]}</h1>
            {/* The design's title is the month alone; another year says which, quietly. */}
            {year !== now.getFullYear() && <span className="room-stamp">{year}</span>}
            <span className="room-cal-steps">
              <button type="button" className="room-cal-step" onClick={() => shiftMonth(-1)} aria-label="Previous month">
                ←
              </button>
              <button type="button" className="room-cal-step" onClick={() => shiftMonth(1)} aria-label="Next month">
                →
              </button>
            </span>
          </div>
          <p className="room-page-summary">
            {summary}
            {!isThisMonth && (
              <>
                {' '}
                <button type="button" className="room-inline-action" onClick={goToday}>
                  Back to today
                </button>
              </>
            )}
          </p>

          <div className="room-dotmonth" role="group" aria-label={`${MONTH_NAMES[month]} ${year}`}>
            {WEEK_HEAD.map((letter, i) => (
              <span key={`h${i}`} className="room-dotmonth-head" aria-hidden="true">
                {letter}
              </span>
            ))}
            {Array.from({ length: dots.blanks }, (_, i) => (
              <span key={`b${i}`} aria-hidden="true" />
            ))}
            {dots.keys.map((key) => (
              <button
                key={key}
                type="button"
                className={[
                  'room-dotmonth-day',
                  key === todayKey && 'is-today',
                  key < todayKey && 'is-past',
                  key === jump.key && 'is-picked',
                ]
                  .filter(Boolean)
                  .join(' ')}
                aria-current={key === todayKey ? 'date' : undefined}
                onClick={() => jumpTo(key)}
              >
                {parseYmd(key).getDate()}
              </button>
            ))}
          </div>

          <div className="room-seg" style={{ marginTop: 34, gap: 10 }}>
            <Pill variant="primary" onClick={() => addOn(jump.key || (isThisMonth ? todayKey : monthStart))}>
              + Add something
            </Pill>
            <Pill onClick={() => setMode((current) => (current === 'month' ? 'journal' : 'month'))}>
              {mode === 'month' ? 'Journal' : 'Month view'}
            </Pill>
          </div>
          <p className="room-page-note">Classes come from your courses. Times show only if you set them.</p>
        </div>

        {/* ── Right: the journal, or the wall calendar ── */}
        {mode === 'journal' ? (
          <div className="room-journal">
            {rows.map((row, i) => {
              if (row.type === 'month') {
                return (
                  <h2 key={`m-${row.key}`} className="room-section-title room-journal-month">
                    {MONTH_NAMES[parseYmd(row.key).getMonth()]}
                  </h2>
                );
              }
              if (row.type === 'quiet') {
                return (
                  <p key={`q-${row.keys[0]}`} className="room-quiet">
                    {quietLine(row.keys)}
                  </p>
                );
              }
              const today = row.key === todayKey;
              const date = parseYmd(row.key);
              return (
                <Paper
                  key={row.key}
                  className={`room-day${today ? ' is-today' : ''}`}
                  tilt={tiltFor(i) * 0.7}
                  stagger={Math.min(i + 2, 12)}
                  data-day={row.key}
                >
                  <div className="room-day-head">
                    <span className="room-day-num">{date.getDate()}</span>
                    <span className={`room-day-name${today ? ' is-today' : ''}`}>{stripLabel(row.key, todayKey)}</span>
                  </div>
                  <div className="room-day-entries">{row.entries.map(renderEntry)}</div>
                  <button
                    type="button"
                    className="room-day-add"
                    onClick={() => addOn(row.key)}
                    aria-label={`Add something on ${stripLabel(row.key, todayKey)} ${date.getDate()}`}
                  >
                    +
                  </button>
                </Paper>
              );
            })}
          </div>
        ) : (
          <Paper className="room-month" tilt={0.3} stagger={2}>
            <div className="room-month-grid">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((name) => (
                <span key={name} className="room-month-head">
                  {name}
                </span>
              ))}
              {grid.map((key) => {
                const entries = entriesOf(key);
                const inMonth = key >= monthStart && key <= monthEnd;
                return (
                  <button
                    key={key}
                    type="button"
                    className={['room-month-cell', !inMonth && 'is-out', key === todayKey && 'is-today']
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => jumpTo(key)}
                  >
                    <span className="room-month-num">{parseYmd(key).getDate()}</span>
                    {entries.slice(0, MAX_IN_CELL).map((entry) => (
                      <span key={entry.id} className={`room-month-entry${entry.kind === 'event' ? ' is-tag' : ''}`}>
                        {entry.kind === 'class' && <Dot size={7} color={entry.color} />}
                        <span className="room-month-entry-name">{entry.title}</span>
                      </span>
                    ))}
                    {entries.length > MAX_IN_CELL && (
                      <span className="room-month-more">+{entries.length - MAX_IN_CELL} more</span>
                    )}
                  </button>
                );
              })}
            </div>
          </Paper>
        )}
      </div>

      <Overlay open={Boolean(draft)} onClose={() => setDraft(null)} title={draft?.event ? 'Change it' : 'Add something'}>
        {draft && (
          <EventForm draft={draft} courses={courses} uid={firebaseUser?.uid} onClose={() => setDraft(null)} />
        )}
      </Overlay>
    </RoomShell>
  );
};

export default RoomCalendar;
