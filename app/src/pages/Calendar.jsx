import { useMemo, useRef, useState } from 'react';
import { FaArrowLeft, FaChevronLeft, FaChevronRight, FaPlus, FaTrash } from 'react-icons/fa';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { setCalendarEvent, deleteCalendarEvent } from '../services/library';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const EVENT_COLORS = [
  'oklch(0.74 0.105 70)', // honey
  'oklch(0.62 0.09 15)', // rose
  'oklch(0.68 0.07 145)', // sage
  'oklch(0.66 0.07 240)', // dusk blue
  'oklch(0.62 0.075 320)', // plum
];

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s) => {
  const [y, m, d] = (s || '').split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};
const daysFromToday = (s) => {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  const d = parseYmd(s);
  d.setHours(0, 0, 0, 0);
  return Math.round((d - t) / 86400000);
};
const relativeLabel = (n) => {
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
};

const Calendar = () => {
  const { firebaseUser, profile } = useAuth();
  const navigate = useNavigate();
  const today = new Date();
  const todayKey = ymd(today);

  const [view, setView] = useState({ year: today.getFullYear(), month: today.getMonth() });
  const [selected, setSelected] = useState(todayKey);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftColor, setDraftColor] = useState(EVENT_COLORS[0]);
  const [slide, setSlide] = useState('');
  const titleRef = useRef(null);

  const events = useMemo(() => Object.values(profile?.events || {}), [profile?.events]);
  const eventsByDay = useMemo(() => {
    const map = new Map();
    events.forEach((ev) => {
      if (!ev?.date) return;
      if (!map.has(ev.date)) map.set(ev.date, []);
      map.get(ev.date).push(ev);
    });
    return map;
  }, [events]);

  const upcoming = useMemo(
    () =>
      events
        .filter((ev) => ev?.date && daysFromToday(ev.date) >= 0)
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(0, 7),
    [events],
  );

  const cells = useMemo(() => {
    const first = new Date(view.year, view.month, 1);
    const start = new Date(view.year, view.month, 1 - first.getDay());
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [view]);

  const changeMonth = (delta) => {
    setSlide(delta > 0 ? 'next' : 'prev');
    setView((prev) => {
      const d = new Date(prev.year, prev.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
    setTimeout(() => setSlide(''), 260);
  };

  const goToday = () => {
    setView({ year: today.getFullYear(), month: today.getMonth() });
    setSelected(todayKey);
  };

  const selectedEvents = eventsByDay.get(selected) || [];
  const selectedDelta = daysFromToday(selected);

  const handleAddEvent = async () => {
    const title = draftTitle.trim();
    if (!title || !firebaseUser) return;
    setDraftTitle('');
    try {
      await setCalendarEvent(firebaseUser.uid, { date: selected, title, color: draftColor });
      titleRef.current?.focus();
    } catch (err) {
      console.error('Failed to add event', err);
    }
  };

  const handleDeleteEvent = async (id) => {
    if (!firebaseUser) return;
    try {
      await deleteCalendarEvent(firebaseUser.uid, id);
    } catch (err) {
      console.error('Failed to delete event', err);
    }
  };

  const selectedDateObj = parseYmd(selected);

  return (
    <div className="app-shell calendar-shell">
      <header className="app-bar topbar">
        <div className="app-bar-inner settings-bar">
          <button className="ghost-btn note-back" onClick={() => navigate('/dashboard')} title="Back">
            <FaArrowLeft />
            <span className="note-back-label">Back</span>
          </button>
          <div className="brand">
            <h1>Calendar</h1>
          </div>
          <span />
        </div>
      </header>

      <div className="calendar-page">
        <section className="calendar-main">
          <div className="calendar-toolbar">
            <h2>
              {MONTHS[view.month]} <span>{view.year}</span>
            </h2>
            <div className="calendar-nav">
              <button type="button" className="cal-nav-btn" onClick={() => changeMonth(-1)} title="Previous month">
                <FaChevronLeft />
              </button>
              <button type="button" className="btn btn-soft btn-sm" onClick={goToday}>
                Today
              </button>
              <button type="button" className="cal-nav-btn" onClick={() => changeMonth(1)} title="Next month">
                <FaChevronRight />
              </button>
            </div>
          </div>

          <div className="calendar-weekdays">
            {WEEKDAYS.map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>

          <div className={`calendar-grid ${slide ? `slide-${slide}` : ''}`}>
            {cells.map((d) => {
              const key = ymd(d);
              const inMonth = d.getMonth() === view.month;
              const isToday = key === todayKey;
              const isSelected = key === selected;
              const dayEvents = eventsByDay.get(key) || [];
              return (
                <button
                  key={key}
                  type="button"
                  className={`cal-day ${inMonth ? '' : 'muted'} ${isToday ? 'today' : ''} ${
                    isSelected ? 'selected' : ''
                  } ${dayEvents.length ? 'has-events' : ''}`}
                  onClick={() => setSelected(key)}
                >
                  <span className="cal-day-num">{d.getDate()}</span>
                  {dayEvents.length > 0 && (
                    <span className="cal-day-dots">
                      {dayEvents.slice(0, 3).map((ev) => (
                        <i key={ev.id} style={{ background: ev.color || 'var(--accent)' }} />
                      ))}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </section>

        <aside className="calendar-side">
          {/* Selected day */}
          <div className="cal-card">
            <div className="cal-day-head">
              <div>
                <strong>
                  {WEEKDAYS[selectedDateObj.getDay()]}, {MONTHS[selectedDateObj.getMonth()]}{' '}
                  {selectedDateObj.getDate()}
                </strong>
                <span className={`cal-countdown ${selectedDelta === 0 ? 'now' : ''}`}>
                  {relativeLabel(selectedDelta)}
                </span>
              </div>
            </div>

            <div className="cal-event-add">
              <input
                ref={titleRef}
                value={draftTitle}
                placeholder="Add something on this day…"
                onChange={(e) => setDraftTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddEvent()}
              />
              <div className="cal-color-row">
                {EVENT_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={`cal-swatch ${draftColor === color ? 'active' : ''}`}
                    style={{ background: color }}
                    onClick={() => setDraftColor(color)}
                    aria-label="Event color"
                  />
                ))}
                <button
                  type="button"
                  className="cal-add-btn"
                  onClick={handleAddEvent}
                  disabled={!draftTitle.trim()}
                  title="Add event"
                >
                  <FaPlus />
                </button>
              </div>
            </div>

            <div className="cal-event-list">
              {selectedEvents.length === 0 ? (
                <p className="cal-empty">Nothing planned. Add a deadline, exam, or reminder.</p>
              ) : (
                selectedEvents.map((ev) => (
                  <div key={ev.id} className="cal-event">
                    <span className="cal-event-dot" style={{ background: ev.color || 'var(--accent)' }} />
                    <span className="cal-event-title">{ev.title}</span>
                    <button
                      type="button"
                      className="cal-event-del"
                      onClick={() => handleDeleteEvent(ev.id)}
                      title="Delete"
                    >
                      <FaTrash />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Upcoming */}
          <div className="cal-card">
            <h3 className="cal-card-title">Upcoming</h3>
            {upcoming.length === 0 ? (
              <p className="cal-empty">No upcoming events yet.</p>
            ) : (
              <div className="cal-upcoming">
                {upcoming.map((ev) => {
                  const delta = daysFromToday(ev.date);
                  return (
                    <button
                      key={ev.id}
                      type="button"
                      className="cal-upcoming-item"
                      onClick={() => {
                        const d = parseYmd(ev.date);
                        setView({ year: d.getFullYear(), month: d.getMonth() });
                        setSelected(ev.date);
                      }}
                    >
                      <span className="cal-event-dot" style={{ background: ev.color || 'var(--accent)' }} />
                      <span className="cal-upcoming-title">{ev.title}</span>
                      <span className={`cal-upcoming-when ${delta <= 3 ? 'soon' : ''}`}>
                        {relativeLabel(delta)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
};

export default Calendar;
