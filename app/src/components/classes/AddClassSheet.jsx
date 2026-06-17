import { useEffect, useRef, useState } from 'react';
import { FaCheck } from 'react-icons/fa';
import { createClass, renameClass, updateClassColor } from '../../services/library';
import { useAuth } from '../../context/AuthContext';

// Calm, distinguishable tones tuned for both Daylight and Lamplight. Stored as
// oklch strings; previously-saved hex colors keep rendering fine.
const CLASS_PALETTE = [
  { name: 'Honey', color: 'oklch(0.74 0.105 70)' },
  { name: 'Terracotta', color: 'oklch(0.66 0.105 40)' },
  { name: 'Rosewood', color: 'oklch(0.62 0.09 15)' },
  { name: 'Olive', color: 'oklch(0.7 0.085 110)' },
  { name: 'Sage', color: 'oklch(0.68 0.07 145)' },
  { name: 'Dusk blue', color: 'oklch(0.66 0.07 240)' },
  { name: 'Plum', color: 'oklch(0.62 0.075 320)' },
  { name: 'Slate', color: 'oklch(0.62 0.03 250)' },
];

// Create + edit sheet for a class: name, visible color palette, live preview.
const AddClassSheet = ({ open, onClose, editTarget = null, onSaved }) => {
  const { firebaseUser } = useAuth();
  const [name, setName] = useState('');
  const [color, setColor] = useState(CLASS_PALETTE[0].color);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const nameRef = useRef(null);

  const isEdit = Boolean(editTarget);

  // Seed fields each time the sheet opens (fresh for create, prefilled for edit).
  useEffect(() => {
    if (!open) return;
    setName(editTarget?.name || '');
    setColor(editTarget?.color || CLASS_PALETTE[0].color);
    setError('');
    const t = setTimeout(() => nameRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [open, editTarget]);

  useEffect(() => {
    if (!open) return undefined;
    const handleEscape = (event) => {
      if (event.key === 'Escape' && !saving) onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [open, saving, onClose]);

  const handleSave = async () => {
    if (!firebaseUser || saving) return;
    const cleanName = name.trim();
    if (!cleanName) return;
    setSaving(true);
    setError('');
    try {
      if (isEdit) {
        if (cleanName !== editTarget.name) {
          await renameClass(firebaseUser.uid, editTarget.id, cleanName);
        }
        if (color !== editTarget.color) {
          await updateClassColor(firebaseUser.uid, editTarget.id, color);
        }
        onSaved?.('Class updated');
      } else {
        await createClass(firebaseUser.uid, { name: cleanName, color });
        onSaved?.('Class added');
      }
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const selectedTone = CLASS_PALETTE.find((tone) => tone.color === color);

  return (
    <>
      <div className={`overlay ${open ? 'show' : ''}`} onClick={() => !saving && onClose()} />
      <div className={`modal ${open ? 'open' : ''}`} role="dialog" aria-modal="true">
        <div className="modal-card class-sheet">
          <header>
            <h3>{isEdit ? 'Edit class' : 'New class'}</h3>
            <p className="class-sheet-sub">
              {isEdit ? 'Rename it, or give it a new color.' : 'A focused space for one course.'}
            </p>
          </header>

          <div className="sheet-fields">
            <label>
              Class name
              <input
                ref={nameRef}
                placeholder="e.g. CSC 2302"
                value={name}
                maxLength={48}
                onChange={(e) => {
                  setName(e.target.value);
                  setError('');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSave();
                }}
              />
            </label>

            <div className="class-sheet-colors">
              <span className="class-sheet-label">
                Color
                <em>{selectedTone ? ` — ${selectedTone.name}` : ''}</em>
              </span>
              <div className="swatch-grid" role="radiogroup" aria-label="Class color">
                {CLASS_PALETTE.map((tone) => {
                  const active = tone.color === color;
                  return (
                    <button
                      key={tone.name}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      className={`swatch-lg ${active ? 'active' : ''}`}
                      style={{ background: tone.color }}
                      title={tone.name}
                      onClick={() => setColor(tone.color)}
                    >
                      {active && <FaCheck aria-hidden="true" />}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="class-preview" aria-hidden="true">
              <span className="class-sheet-label">Preview</span>
              <div className="class-preview-row">
                <span className="class-dot" style={{ background: color }} />
                <span className="class-preview-name">{name.trim() || 'Class name'}</span>
                <span className="class-preview-count">{isEdit ? editTarget?.noteCount || 0 : 0}</span>
              </div>
            </div>

            {error && <p className="class-sheet-error">{error}</p>}
          </div>

          <footer className="modal-actions">
            <button className="ghost-btn" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button className="btn btn-fill" onClick={handleSave} disabled={saving || !name.trim()}>
              {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create class'}
            </button>
          </footer>
        </div>
      </div>
    </>
  );
};

export default AddClassSheet;
