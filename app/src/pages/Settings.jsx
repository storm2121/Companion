import { useEffect, useRef, useState } from 'react';
import { FaArrowLeft, FaCamera, FaCheck, FaDownload, FaMoon, FaSignOutAlt, FaSun } from 'react-icons/fa';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { exportUserData, fetchNoteTemplates } from '../services/library';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import { storage } from '../firebase';
import { THEME_DEFAULT_MODE, THEME_OPTIONS, THEME_PRESETS } from '../themePresets';
import { DEFAULT_TEMPLATE_ID } from '../data/noteTemplates';

const normalizeThemeMode = (mode) => (THEME_PRESETS[mode] ? mode : THEME_DEFAULT_MODE);

const Settings = () => {
  const { firebaseUser, profile, updateProfileData, updateThemeMode, updateNoteTemplateDefault, applyThemeMode, logout } =
    useAuth();
  const navigate = useNavigate();
  const photoInputRef = useRef(null);

  const [name, setName] = useState(profile?.displayName || '');
  const [savingName, setSavingName] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [defaultTemplate, setDefaultTemplate] = useState(profile?.noteTemplateDefault || DEFAULT_TEMPLATE_ID);
  const [exporting, setExporting] = useState(false);
  const [status, setStatus] = useState('');

  const themeMode = normalizeThemeMode(profile?.themeMode);

  useEffect(() => setName(profile?.displayName || ''), [profile?.displayName]);
  useEffect(() => setDefaultTemplate(profile?.noteTemplateDefault || DEFAULT_TEMPLATE_ID), [profile?.noteTemplateDefault]);

  useEffect(() => {
    if (!firebaseUser) return;
    fetchNoteTemplates(firebaseUser.uid).then(setTemplates).catch(() => setTemplates([]));
  }, [firebaseUser]);

  // Esc → back to the dashboard (blur first if typing in a field).
  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) {
        el.blur();
        return;
      }
      navigate('/dashboard');
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [navigate]);

  const flash = (msg) => {
    setStatus(msg);
    setTimeout(() => setStatus(''), 2200);
  };

  const handleSaveName = async () => {
    const cleaned = name.trim();
    if (!cleaned || cleaned === profile?.displayName || savingName) return;
    setSavingName(true);
    try {
      await updateProfileData({ displayName: cleaned, photoUrl: profile?.photoUrl || '' });
      flash('Name updated');
    } catch (err) {
      console.error(err);
      flash('Could not save name');
    } finally {
      setSavingName(false);
    }
  };

  const handlePhoto = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !firebaseUser) return;
    setPhotoBusy(true);
    try {
      const ref = storageRef(storage, `avatars/${firebaseUser.uid}/${Date.now()}-${file.name}`);
      await uploadBytes(ref, file, { contentType: file.type || undefined });
      const url = await getDownloadURL(ref);
      await updateProfileData({ displayName: profile?.displayName || name.trim(), photoUrl: url });
      flash('Photo updated');
    } catch (err) {
      console.error(err);
      flash('Could not upload photo');
    } finally {
      setPhotoBusy(false);
    }
  };

  const handleTheme = (mode) => {
    const next = normalizeThemeMode(mode);
    applyThemeMode(next);
    updateThemeMode(next).catch((err) => console.error(err));
  };

  const handleDefaultTemplate = (value) => {
    setDefaultTemplate(value);
    updateNoteTemplateDefault(value)
      .then(() => flash('Default template saved'))
      .catch((err) => console.error(err));
  };

  const handleExport = async () => {
    if (!firebaseUser || exporting) return;
    setExporting(true);
    try {
      const data = await exportUserData(firebaseUser.uid);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `companion-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      flash('Export downloaded');
    } catch (err) {
      console.error(err);
      flash('Export failed');
    } finally {
      setExporting(false);
    }
  };

  const initial = (profile?.displayName || firebaseUser?.email || 'A').slice(0, 1).toUpperCase();

  return (
    <div className="app-shell settings-shell">
      <header className="app-bar topbar">
        <div className="app-bar-inner settings-bar">
          <button className="ghost-btn note-back" onClick={() => navigate('/dashboard')} title="Back">
            <FaArrowLeft />
            <span className="note-back-label">Back</span>
          </button>
          <div className="brand">
            <h1>Settings</h1>
          </div>
          <span />
        </div>
      </header>

      <div className="settings-page">
        {/* Profile */}
        <section className="settings-card">
          <h2>Profile</h2>
          <div className="settings-profile">
            <button
              type="button"
              className="settings-avatar"
              onClick={() => photoInputRef.current?.click()}
              disabled={photoBusy}
              title="Change photo"
              style={profile?.photoUrl ? { backgroundImage: `url(${profile.photoUrl})` } : undefined}
            >
              {!profile?.photoUrl && <span>{initial}</span>}
              <span className="settings-avatar-edit">
                <FaCamera />
              </span>
            </button>
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={handlePhoto}
            />
            <div className="settings-field">
              <label htmlFor="settings-name">Display name</label>
              <div className="settings-row">
                <input
                  id="settings-name"
                  value={name}
                  maxLength={60}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveName()}
                  placeholder="Your name"
                />
                <button
                  className="btn btn-fill btn-sm"
                  onClick={handleSaveName}
                  disabled={savingName || !name.trim() || name.trim() === profile?.displayName}
                >
                  {savingName ? 'Saving…' : 'Save'}
                </button>
              </div>
              <p className="settings-hint">{firebaseUser?.email}</p>
            </div>
          </div>
        </section>

        {/* Appearance */}
        <section className="settings-card">
          <h2>Appearance</h2>
          <div className="settings-themes">
            {THEME_OPTIONS.map((option) => {
              const active = normalizeThemeMode(option.id) === themeMode;
              const isLight = THEME_PRESETS[option.id]?.attr === 'light';
              return (
                <button
                  key={option.id}
                  type="button"
                  className={`theme-card ${active ? 'active' : ''}`}
                  onClick={() => handleTheme(option.id)}
                >
                  <span className="theme-card-icon">{isLight ? <FaSun /> : <FaMoon />}</span>
                  <span className="theme-card-name">{option.label}</span>
                  {active && <FaCheck className="theme-card-check" />}
                </button>
              );
            })}
          </div>
        </section>

        {/* Defaults */}
        <section className="settings-card">
          <h2>New notes</h2>
          <div className="settings-field">
            <label htmlFor="settings-template">Default template for Quick add</label>
            <select
              id="settings-template"
              value={defaultTemplate}
              onChange={(e) => handleDefaultTemplate(e.target.value)}
            >
              <option value={DEFAULT_TEMPLATE_ID}>Blank</option>
              {templates.map((tpl) => (
                <option key={tpl.id} value={`custom:${tpl.id}`}>
                  {tpl.name || 'Custom template'}
                </option>
              ))}
            </select>
          </div>
        </section>

        {/* Data */}
        <section className="settings-card">
          <h2>Your data</h2>
          <p className="settings-hint">Download every class, note, and template as a JSON file.</p>
          <button className="btn btn-soft" onClick={handleExport} disabled={exporting}>
            <FaDownload /> {exporting ? 'Preparing…' : 'Export my data'}
          </button>
        </section>

        {/* Account */}
        <section className="settings-card">
          <h2>Account</h2>
          <button className="btn btn-soft danger-soft" onClick={logout}>
            <FaSignOutAlt /> Sign out
          </button>
        </section>

        {status && (
          <div className="toast" role="status">
            <FaCheck aria-hidden="true" /> {status}
          </div>
        )}
      </div>
    </div>
  );
};

export default Settings;
