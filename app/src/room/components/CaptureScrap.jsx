import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../context/authState';
import { addInboxEntry } from '../../services/library';
import Paper from './Paper';

// Quick capture — a scrap of paper with one line on it (design 6a). Enter files the line
// in the Inbox and clears the field. On Home and at the top of the Inbox itself.
//
// Filing does not wait for the server: the write lands in the local cache at once and
// Firestore sends it when it can. Awaiting the server made it hang, offline, on a "Filed"
// that never came.

const CaptureScrap = ({ tilt = 0.8, stagger, hint = '→ Inbox', className = '' }) => {
  const { firebaseUser } = useAuth();
  const [text, setText] = useState('');
  const [filed, setFiled] = useState(false);
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  const file = (event) => {
    event.preventDefault();
    const line = text.trim();
    if (!line || !firebaseUser) return;
    setText('');
    setFiled(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setFiled(false), 2400);
    addInboxEntry(firebaseUser.uid, line).catch((err) => {
      console.error('Could not file that line', err);
      setText(line);
      setFiled(false);
    });
  };

  return (
    <Paper className={['room-scrap', className].filter(Boolean).join(' ')} tilt={tilt} stagger={stagger}>
      <form onSubmit={file}>
        <input
          className="room-scrap-input"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Jot something down"
          aria-label="Jot something down"
          maxLength={2000}
        />
        <div className="room-scrap-foot">
          <span>{filed ? 'Filed' : hint}</span>
          <span>↵</span>
        </div>
      </form>
    </Paper>
  );
};

export default CaptureScrap;
