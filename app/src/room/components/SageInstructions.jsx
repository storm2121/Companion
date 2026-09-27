import { useState } from 'react';
import { useAuth } from '../../context/authState';
import { MAX_SAGE_ADDONS, SAGE_ADDONS } from '../../services/sage';
import { Overlay } from './Overlay';
import { Chip, Pill } from './primitives';

// Sage's standing instructions (design 6e: "Sage's instructions live on the You page").
// What a run should ALSO do (the add-ons, three at most — the server's own limit), what the
// notes are about, and anything else to tell it. The note's Sage panel picks the goals;
// these ride along with every run. Stored on `roomPrefs.sage`, so they follow you.

const Form = ({ onClose }) => {
  const { profile, updateRoomPrefs } = useAuth();
  const saved = profile?.roomPrefs?.sage || {};
  const [addons, setAddons] = useState(() =>
    (Array.isArray(saved.addons) ? saved.addons : []).filter((id) => SAGE_ADDONS.some((addon) => addon.id === id)),
  );
  const [topic, setTopic] = useState(typeof saved.topic === 'string' ? saved.topic : '');
  const [comment, setComment] = useState(typeof saved.comment === 'string' ? saved.comment : '');

  const full = addons.length >= MAX_SAGE_ADDONS;
  const toggle = (id) =>
    setAddons((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id].slice(0, MAX_SAGE_ADDONS)));

  // Not awaited: the preference lands in the local cache at once.
  const save = (event) => {
    event.preventDefault();
    updateRoomPrefs({
      sage: { addons, topic: topic.trim().slice(0, 120), comment: comment.trim().slice(0, 500) },
    }).catch((err) => console.error('Could not save Sage’s instructions', err));
    onClose();
  };

  return (
    <form onSubmit={save}>
      <p className="room-setting-copy" style={{ fontSize: 15 }}>
        Every Sage run in the room uses these. What it should do is picked in the note; this is
        what it should always keep in mind.
      </p>

      <p className="room-form-label">Also do — three at most</p>
      <div className="room-days">
        {SAGE_ADDONS.map((addon) => (
          <Chip
            key={addon.id}
            selected={addons.includes(addon.id)}
            onClick={() => toggle(addon.id)}
            disabled={full && !addons.includes(addon.id)}
            title={addon.hint}
          >
            {addon.label}
          </Chip>
        ))}
      </div>

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
