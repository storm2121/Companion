// Shared countdown labels for calendar events ({date:'YYYY-MM-DD', time?:'HH:MM'}).
// Day-level for far events; once under 24h away (and a time is set), it counts hours
// and minutes.

export const eventDaysFromToday = (dateStr) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [y, m, d] = (dateStr || '').split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  dt.setHours(0, 0, 0, 0);
  return Math.round((dt - today) / 86400000);
};

const eventDateTime = (ev) => {
  const [y, m, d] = (ev?.date || '').split('-').map(Number);
  if (!y) return null;
  const [hh, mm] = (ev?.time || '').split(':').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, Number.isFinite(hh) ? hh : 23, Number.isFinite(mm) ? mm : 59);
};

// "Today / Tomorrow / in N days / N days ago" — but within 24h of a timed event:
// "in 5h" / "in 3h 20m" / "in 45m" / "now".
export const eventCountdownLabel = (ev) => {
  const days = eventDaysFromToday(ev?.date);
  const dt = eventDateTime(ev);
  if (dt && days >= 0) {
    const diffMin = Math.round((dt - new Date()) / 60000);
    if (diffMin <= 0 && days === 0) return ev?.time ? 'now' : 'Today';
    if (diffMin > 0 && diffMin < 1440 && ev?.time) {
      const h = Math.floor(diffMin / 60);
      const m = diffMin % 60;
      if (h === 0) return `in ${m}m`;
      if (m === 0) return `in ${h}h`;
      return `in ${h}h ${m}m`;
    }
  }
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
};

// "14:30" → "2:30 PM" for display next to titles.
export const formatEventTime = (time) => {
  if (!time) return '';
  const [h, m] = time.split(':').map(Number);
  if (!Number.isFinite(h)) return '';
  const ap = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${String(m || 0).padStart(2, '0')} ${ap}`;
};
