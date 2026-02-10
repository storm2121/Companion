import { useState } from 'react';
import { createClass } from '../../services/library';
import { useAuth } from '../../context/AuthContext';

const THEMES = [
  { name: 'Slate', color: '#4a5a63' },
  { name: 'Forest', color: '#4b5b49' },
  { name: 'Sand', color: '#b49a62' },
  { name: 'Ink', color: '#3a3c42' },
];

const AddClassSheet = ({ open, onClose }) => {
  const { firebaseUser } = useAuth();
  const [name, setName] = useState('');
  const [theme, setTheme] = useState(THEMES[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    if (!firebaseUser) return;
    setSaving(true);
    setError('');
    try {
      await createClass(firebaseUser.uid, { name, color: theme.color });
      setName('');
      setTheme(THEMES[0]);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className={`overlay ${open ? 'show' : ''}`} onClick={onClose} />
      <div className={`modal ${open ? 'open' : ''}`} role="dialog" aria-modal="true">
        <div className="modal-card">
          <header>
            <h3>New Class</h3>
            <p className="status-text">Create a focused space for a course or project.</p>
          </header>
          <div className="sheet-fields">
            <label>
              Class name
              <input
                placeholder="e.g. CSC 2302"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setError('');
                }}
              />
            </label>
            <label>
              Color theme
              <select
                value={theme.name}
                onChange={(e) => {
                  const selected = THEMES.find((item) => item.name === e.target.value) || THEMES[0];
                  setTheme(selected);
                }}
              >
                {THEMES.map((item) => (
                  <option key={item.name} value={item.name}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            {error && <p className="status-text">{error}</p>}
          </div>
          <footer className="modal-actions">
            <button className="ghost-btn" onClick={onClose}>
              Cancel
            </button>
            <button className="primary-btn" onClick={handleSave} disabled={saving || !name}>
              {saving ? 'Saving...' : 'Create Class'}
            </button>
          </footer>
        </div>
      </div>
    </>
  );
};

export default AddClassSheet;
