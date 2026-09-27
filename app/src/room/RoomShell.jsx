import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/authState';
import TopLine from './components/TopLine';
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

const RoomShell = ({ children, back, onBack, trailing, ...topLine }) => {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const initial = (profile?.displayName || profile?.email || 'M').slice(0, 1).toUpperCase();
  const inboxCount = useMemo(() => inboxLines(profile?.inbox).length, [profile?.inbox]);

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
      {children}
    </>
  );
};

export default RoomShell;
