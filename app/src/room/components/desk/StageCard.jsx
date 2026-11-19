import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../../context/authState';
import { addInboxEntry } from '../../../services/library';
import { cardHint } from '../../deskStage';

// The stage's capture card (prototype Home, DeskStage): the room's quick capture (CaptureScrap's
// behaviour: Enter files the line in the Inbox at once, the field clears, "Filed" for a moment) on
// the rendered index card. Its words keep 13 css px however small the room is drawn (round seven),
// so on a small scale the card says less instead of cutting a word: the longest hint that fits the
// card's line at its size (deskStage.js cardHint). The field's name stays "Jot something down".

const StageCard = ({ className = '', width, size }) => {
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
    <div className={['room-scrap', className].filter(Boolean).join(' ')}>
      <form onSubmit={file}>
        <input
          className="room-scrap-input"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={cardHint(width, size)}
          aria-label="Jot something down"
          maxLength={2000}
        />
        <div className="room-scrap-foot">
          <span>{filed ? 'Filed' : '→ Inbox'}</span>
          <span>↵</span>
        </div>
      </form>
    </div>
  );
};

export default StageCard;
