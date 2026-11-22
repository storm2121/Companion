import { useContext, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/authState';
import TopLine from './components/TopLine';
import { DataTrouble } from './components/primitives';
import { RoomCoursesContext } from './roomData';
import { openRoomSearch } from './deskSearch';
import { inboxLines } from './inboxLines';

// The top of every room page: the one thin line of chrome, then the page.
//
// Deliberately thin. The ground, the weather and the <html> attributes belong to
// RoomLayout, the parent route, so they persist while you move between pages instead of
// being torn down and rebuilt on every navigation.
//
// Every page gets the same working top line — Search opens the ⌘K sheet, Calendar and
// Inbox are pages, the avatar is You — and a page can still override any of it.
//
// When a course or note listener was refused, every page says so in one line under the top
// line. A page that says it in a sentence of its own (Home, a course, All notes) passes
// `ownTrouble` so it is not said twice.

const RoomShell = ({ children, back, onBack, trailing, ownTrouble = false, ...topLine }) => {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const initial = (profile?.displayName || profile?.email || 'M').slice(0, 1).toUpperCase();
  const inboxCount = useMemo(() => inboxLines(profile?.inbox).length, [profile?.inbox]);
  const { trouble, retry } = useContext(RoomCoursesContext);

  return (
    <>
      <TopLine
        back={back}
        onBack={onBack}
        initial={initial}
        trailing={trailing}
        inboxCount={inboxCount}
        onSearch={openRoomSearch}
        onCalendar={() => navigate('/room/calendar')}
        onInbox={() => navigate('/room/inbox')}
        onAvatar={() => navigate('/room/you')}
        {...topLine}
      />
      {trouble && !ownTrouble && <DataTrouble trouble={trouble} onRetry={retry} className="room-status room-trouble" />}
      {children}
    </>
  );
};

export default RoomShell;
