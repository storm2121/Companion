import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/authState';
import { createPageNote, deleteInboxEntry, restoreInboxEntry } from '../services/library';
import RoomShell from './RoomShell';
import Paper from './components/Paper';
import CaptureScrap from './components/CaptureScrap';
import { MenuCard } from './components/Overlay';
import { textBlock } from './pageBlocks';
import { countWord } from './calendarDays';
import { inboxLines, titleFromLine } from './inboxLines';
import { stampFor, useRoomCourses } from './roomData';
import { tiltFor, useMinuteClock } from './roomPrefs';
import { offerUndo } from './roomUndo';

// Inbox — reached from the top line. The design names it (quick capture's `→ INBOX`) and
// lists "empty inbox" among the states to build, but never draws the screen, so it is
// assembled from the room's own parts: the page head of Calendar/You on the left, one paper
// strip per line on the right.
//
// A line leaves the Inbox one of two ways. FILED: it becomes the first paragraph of a new
// note in the course you pick (titled from the line). DONE: it is simply let go, with undo.
// Both are local-first writes, so both work offline.

const RoomInbox = () => {
  const navigate = useNavigate();
  const { firebaseUser, profile } = useAuth();
  const { courses } = useRoomCourses();
  const now = useMinuteClock();
  const [menuFor, setMenuFor] = useState('');

  const lines = useMemo(() => inboxLines(profile?.inbox), [profile?.inbox]);
  const uid = firebaseUser?.uid;

  const summary = lines.length
    ? `${countWord(lines.length)} ${lines.length === 1 ? 'line' : 'lines'} waiting.`
    : 'Nothing waiting.';

  const fileInto = (line, course) => {
    if (!uid) return;
    const { id, saved } = createPageNote(uid, course.id, {
      title: titleFromLine(line.text),
      blocks: [textBlock(line.text, { section: true })],
    });
    saved.catch((err) => console.error('The server refused that note', err));
    deleteInboxEntry(uid, line.id).catch((err) => console.error('Could not clear that line', err));
    offerUndo({
      message: `Filed in ${course.name}`,
      action: { label: 'Open', run: () => navigate(`/room/note/${course.id}/${id}`) },
    });
  };

  const done = (line) => {
    if (!uid) return;
    deleteInboxEntry(uid, line.id).catch((err) => console.error('Could not clear that line', err));
    offerUndo({
      message: 'Line cleared',
      undo: () =>
        restoreInboxEntry(uid, line).catch((err) => console.error('Could not put that line back', err)),
    });
  };

  return (
    <RoomShell back="Desk" onBack={() => navigate('/room')} here="inbox">
      <div className="room-split">
        <div className="room-split-side room-rise" style={{ animationDelay: '0.07s' }}>
          <h1 className="room-page-name">Inbox</h1>
          <p className="room-page-summary">{summary}</p>
          <CaptureScrap tilt={-0.6} hint="Add a line" className="room-scrap--inbox" />
          <p className="room-page-note">
            Lines you jot on the desk wait here. File one into a course and it becomes the start
            of a new note there.
          </p>
        </div>

        <div className="room-inbox-list">
          {!lines.length && (
            <p className="room-quiet room-rise" style={{ animationDelay: '0.14s' }}>
              Anything you jot down lands here, until you file it.
            </p>
          )}

          {lines.map((line, i) => (
            <Paper
              key={line.id}
              // Raised while its menu is open: every tilted strip is its own stacking
              // context, so the next strip down would otherwise paint over the menu.
              className={`room-inbox-line${menuFor === line.id ? ' is-open' : ''}`}
              tilt={tiltFor(i + 3) * 0.6}
              stagger={i + 2}
            >
              <p className="room-inbox-text">{line.text}</p>
              <div className="room-inbox-foot">
                <span className="room-stamp">{stampFor(Number(line.createdAt) || 0, now)}</span>
                <span className="room-inbox-actions">
                  {courses.length > 0 && (
                    <span style={{ position: 'relative' }}>
                      <button
                        type="button"
                        className="room-you-action"
                        data-menu-trigger=""
                        aria-expanded={menuFor === line.id}
                        onClick={() => setMenuFor((open) => (open === line.id ? '' : line.id))}
                      >
                        File into…
                      </button>
                      {menuFor === line.id && (
                        <MenuCard
                          onClose={() => setMenuFor('')}
                          style={{ position: 'absolute', top: 28, right: 0 }}
                          items={courses.map((course) => ({
                            id: course.id,
                            label: course.name,
                            onSelect: () => fileInto(line, course),
                          }))}
                        />
                      )}
                    </span>
                  )}
                  <button type="button" className="room-you-action" onClick={() => done(line)}>
                    Done
                  </button>
                </span>
              </div>
            </Paper>
          ))}
        </div>
      </div>
    </RoomShell>
  );
};

export default RoomInbox;
