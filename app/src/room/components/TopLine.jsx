import { MOD_KEY } from '../platform';

// The only chrome in the design. No sidebar, ever.
//
// On Home it opens with the wordmark; everywhere else it opens with "← Desk".
// `here` marks the page you are on (calendar / inbox), so its link reads as the current
// place rather than a door to it. The Inbox count shows only when something is waiting —
// empty means absent.

const TopLine = ({
  back,
  onBack,
  onSearch,
  onCalendar,
  onInbox,
  onAvatar,
  initial = 'M',
  inboxCount = 0,
  here,
  trailing,
}) => (
  // `--tools`: a page that brings its own controls (the editor's Sage, ···, save status).
  // On a phone those win the room, and the page links step aside (room.css).
  <div className={`room-topline${trailing ? ' room-topline--tools' : ''}`}>
    {back ? (
      <button type="button" className="room-back" onClick={onBack}>
        ← {back}
      </button>
    ) : (
      <div className="room-wordmark">
        companion<span>.</span>
      </div>
    )}

    <div className="room-topline-nav">
      {trailing}
      <button
        type="button"
        className="room-topline-link room-topline-link--page"
        onClick={onSearch}
        title={`Search your notes and courses (${MOD_KEY}+K)`}
      >
        Search<span className="room-kbd room-kbd--key">{MOD_KEY === '⌘' ? '⌘K' : 'Ctrl K'}</span>
      </button>
      <button
        type="button"
        className="room-topline-link room-topline-link--page"
        onClick={onCalendar}
        aria-current={here === 'calendar' ? 'page' : undefined}
      >
        Calendar
      </button>
      <button
        type="button"
        className="room-topline-link room-topline-link--page"
        onClick={onInbox}
        aria-current={here === 'inbox' ? 'page' : undefined}
      >
        Inbox
        {inboxCount > 0 && <span className="room-kbd">{inboxCount}</span>}
      </button>
      <button type="button" className="room-avatar" onClick={onAvatar} aria-label="You">
        {initial}
      </button>
    </div>
  </div>
);

export default TopLine;
