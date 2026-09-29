import { useState } from 'react';
import { useAuth } from '../../context/authState';
import { SAGE_VOICES } from '../sageChoices';
import { Overlay } from './Overlay';
import { Chip, Pill } from './primitives';

// Sage's standing instructions (design 6e: "Sage's instructions live on the You page"):
// how it talks to you, what your notes are about, and anything else it should always keep
// in mind. What to do — and what else — is picked in the note's Sage panel, which also
// remembers the extras you used last. Stored on `roomPrefs.sage`, so they follow you.

const Form = ({ onClose }) => {
  const { profile, updateRoomPrefs } = useAuth();
  const saved = profile?.roomPrefs?.sage || {};
  const [voice, setVoice] = useState(() =>
    SAGE_VOICES.some((item) => item.id === saved.voice) ? saved.voice : 'buddy',
  );
  const [topic, setTopic] = useState(typeof saved.topic === 'string' ? saved.topic : '');
  const [comment, setComment] = useState(typeof saved.comment === 'string' ? saved.comment : '');

  // Not awaited: the preference lands in the local cache at once. The extras are kept.
  const save = (event) => {
    event.preventDefault();
    updateRoomPrefs({
      sage: { ...saved, voice, topic: topic.trim().slice(0, 120), comment: comment.trim().slice(0, 500) },
    }).catch((err) => console.error('Could not save Sage’s instructions', err));
    onClose();
  };

  return (
    <form onSubmit={save}>
      <p className="room-setting-copy" style={{ fontSize: 15 }}>
        Every Sage run in the room uses these. After each run Sage leaves you a line about
        what it did — this is how it says it.
      </p>

      <p className="room-form-label">How Sage talks</p>
      <div className="room-days">
        {SAGE_VOICES.map((item) => (
          <Chip key={item.id} selected={voice === item.id} onClick={() => setVoice(item.id)} title={item.hint}>
            {item.label}
          </Chip>
        ))}
      </div>
      <p className="room-setting-copy room-sage-voice-hint">
        {SAGE_VOICES.find((item) => item.id === voice)?.hint}
      </p>

      <label className="room-form-field">
        <span className="room-form-label">What your notes are about</span>
        <input
          className="room-field"
          value={topic}
          onChange={(event) => setTopic(event.target.value)}
          placeholder="Second-year computer science — it helps Sage pick examples"
          maxLength={120}
        />
      </label>

      <label className="room-form-field">
        <span className="room-form-label">Anything else</span>
        <textarea
          className="room-field room-field--area"
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder="Explain things the way I would need them for an exam"
          maxLength={500}
          rows={3}
        />
      </label>

      <div className="room-seg" style={{ marginTop: 22 }}>
        <Pill variant="primary" type="submit">
          Save
        </Pill>
        <Pill onClick={onClose}>Cancel</Pill>
      </div>
    </form>
  );
};

// The overlay unmounts its contents when closed, so every opening starts from what is saved.
const SageInstructions = ({ open, onClose }) => (
  <Overlay open={open} onClose={onClose} title="Sage’s instructions">
    <Form onClose={onClose} />
  </Overlay>
);

export default SageInstructions;
