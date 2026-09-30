import { useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { deleteObject, getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import { storage } from '../firebase';
import { useAuth } from '../context/authState';
import { exportUserData } from '../services/library';
import { DESIGN_CLASSIC } from '../designModes';
import {
  AVATAR_MAX_BYTES,
  createImageObjectName,
  IMAGE_ACCEPT,
  validateImageFile,
} from '../utils/imageUpload';
import RoomShell from './RoomShell';
import Paper from './components/Paper';
import { Pill, Segmented, Toggle } from './components/primitives';
import { Overlay } from './components/Overlay';
import SageInstructions from './components/SageInstructions';
import { downloadBytes, exportMarkdown } from './exportMarkdown';
import { sayInRoom } from './roomUndo';
import { SAGE_VOICES } from './sageChoices';
import { IMMUTABLE_CACHE, prepareImage } from './imageScale';
import { useRoomCourses } from './roomData';
import { MOOD_OPTIONS, MOTION_CALM, MOTION_STILL, resolveRoomPrefs } from './roomPrefs';

// You — design 6e. The few switches that matter.
//
// Everything here writes straight through to the profile doc, so a toggle changes the
// room underneath you immediately: RoomShell reads the same `roomPrefs` and the mood
// cross-fades. No save button, no confirmation — the change IS the feedback.
//
// Design 6e has no sign out, no photo, no major. Full parity puts the profile fields
// behind "Edit profile" and sign out at the foot as plain text in accent-on-paper —
// the design has no red anywhere (dualmode.md §4.2).

const NUMBERS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const numberWord = (n) => NUMBERS[n] || String(n);

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const termLabel = (date = new Date()) => {
  const m = date.getMonth();
  const season = m >= 7 ? 'Fall' : m >= 5 ? 'Summer' : 'Spring';
  return `${season} ${date.getFullYear()}`;
};

// "Talks like a coach · about second-year CS" — or nothing, when nothing is set.
const sageLine = (sage) => {
  if (!sage || typeof sage !== 'object') return '';
  const voice = SAGE_VOICES.find((item) => item.id === sage.voice);
  return [
    voice ? `Talks like ${voice.id === 'quiet' ? 'it has somewhere to be' : `a ${voice.label.toLowerCase()}`}` : '',
    sage.topic ? `about ${sage.topic}` : '',
    sage.comment ? 'plus a note to Sage' : '',
  ]
    .filter(Boolean)
    .join(' · ');
};

const RoomYou = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    firebaseUser,
    profile,
    updateProfileData,
    updateRoomPrefs,
    updateDesignMode,
    logout,
    logoutAndClearDevice,
  } = useAuth();
  const { courses } = useRoomCourses();
  const photoInputRef = useRef(null);

  const prefs = resolveRoomPrefs(profile?.roomPrefs);
  const [editOpen, setEditOpen] = useState(false);
  const [name, setName] = useState(profile?.displayName || '');
  const [major, setMajor] = useState(profile?.major || '');
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  // The Markdown export's progress: '' when idle, else "12 of 40".
  const [packing, setPacking] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  // A note's Sage panel sends you here to change the instructions — arrive with them open.
  const [sageOpen, setSageOpen] = useState(() => location.state?.open === 'sage');

  const set = (patch) => updateRoomPrefs(patch).catch((err) => console.error(err));

  // "Here since August." — omitted entirely when the profile has no createdAt, rather
  // than guessing or printing a dash.
  const since = profile?.createdAt?.toDate?.();
  const initial = (profile?.displayName || firebaseUser?.email || 'M').slice(0, 1).toUpperCase();

  const saveProfile = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await updateProfileData({ displayName: name.trim(), major: major.trim(), photoUrl: profile?.photoUrl || '' });
      setEditOpen(false);
    } catch (err) {
      console.error('Could not save that', err);
    } finally {
      setBusy(false);
    }
  };

  const uploadPhoto = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !firebaseUser) return;
    setBusy(true);
    const previousUrl = profile?.photoUrl || '';
    try {
      // An avatar is drawn at 88px: scale it before it leaves the machine, and validate
      // the scaled file rather than the original.
      const ready = await prepareImage(file, 512);
      validateImageFile(ready.file, { maxBytes: AVATAR_MAX_BYTES, label: 'Photo' });
      const ref = storageRef(
        storage,
        `avatars/${firebaseUser.uid}/${createImageObjectName(ready.file, 'avatar')}`,
      );
      await uploadBytes(ref, ready.file, {
        contentType: ready.file.type,
        cacheControl: IMMUTABLE_CACHE,
      });
      const url = await getDownloadURL(ref);
      await updateProfileData({ displayName: name.trim() || profile?.displayName || '', photoUrl: url });
      // Take the old one down, as classic's Settings does — otherwise every change
      // leaves an orphaned file in Storage. A photo that never lived in Storage (a
      // Google account picture) makes `storageRef` throw, which is caught and ignored.
      if (previousUrl && previousUrl !== url) {
        try {
          await deleteObject(storageRef(storage, previousUrl));
        } catch (cleanupError) {
          if (cleanupError?.code !== 'storage/object-not-found') {
            console.warn('Could not remove the previous photo', cleanupError);
          }
        }
      }
    } catch (err) {
      console.error('Could not upload that photo', err);
    } finally {
      setBusy(false);
    }
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
      a.download = `companion-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed', err);
    } finally {
      setExporting(false);
    }
  };

  // Design 6e's export: Markdown, one folder per course, photos packed where the storage
  // allows it (otherwise linked). Reads everything from the server, so it needs a connection.
  const handleMarkdown = async () => {
    if (!firebaseUser || packing || exporting) return;
    if (!navigator.onLine) {
      sayInRoom('Exporting needs a connection');
      return;
    }
    setPacking('Gathering…');
    try {
      const result = await exportMarkdown(firebaseUser.uid, {
        onProgress: ({ done, total }) => setPacking(`${done} of ${total}`),
      });
      downloadBytes(result.bytes, `Companion ${new Date().toISOString().slice(0, 10)}.zip`);
      const photos = result.photosPacked
        ? ` · ${result.photosPacked} ${result.photosPacked === 1 ? 'photo' : 'photos'} inside`
        : '';
      const links = result.photosLinked ? ` · ${result.photosLinked} linked` : '';
      sayInRoom(`Exported ${result.notes} ${result.notes === 1 ? 'note' : 'notes'}${photos}${links}`);
    } catch (err) {
      console.error('Markdown export failed', err);
      sayInRoom('The export did not finish — try again');
    } finally {
      setPacking('');
    }
  };

  const row = (label, copy, control) => (
    <div className="room-setting-row">
      <div style={{ minWidth: 0 }}>
        <div className="room-setting-name">{label}</div>
        {copy && <p className="room-setting-copy">{copy}</p>}
      </div>
      {control}
    </div>
  );

  return (
    <RoomShell back="Desk" onBack={() => navigate('/room')}>
      <div className="room-you">
        <div className="room-you-side room-rise">
          <div className="room-you-avatar">
            {profile?.photoUrl ? <img src={profile.photoUrl} alt="" /> : initial}
          </div>
          <h1 className="room-you-name">{profile?.displayName || 'You'}</h1>
          <p className="room-you-meta">
            {termLabel()} · {numberWord(courses.length)} course{courses.length === 1 ? '' : 's'}
          </p>
          {since && <p className="room-you-meta">Here since {MONTH_NAMES[since.getMonth()]}.</p>}
          <Pill
            style={{ marginTop: 22 }}
            onClick={() => {
              // Start from what is saved now, not what was there when this page opened.
              setName(profile?.displayName || '');
              setMajor(profile?.major || '');
              setEditOpen(true);
            }}
          >
            Edit profile
          </Pill>
        </div>

        <Paper className="room-you-sheet room-rise" tilt={0.4} style={{ animationDelay: '0.07s' }}>
          <p className="room-you-group">The room</p>
          {row(
            'Mood',
            'Candlelight: a room at night, rain on the window, the city beyond. Rain: a grey, quiet day.',
            <Segmented options={MOOD_OPTIONS} value={prefs.mood} onChange={(mood) => set({ mood })} />,
          )}
          {row(
            'Film grain',
            'A little texture over everything.',
            <Toggle on={prefs.grain} label="Film grain" onChange={(grain) => set({ grain })} />,
          )}
          {row(
            'Hand-drawn touches',
            'Wobbly buttons, pencil rules, tilted paper.',
            <Toggle
              on={prefs.handDrawn}
              label="Hand-drawn touches"
              onChange={(handDrawn) => set({ handDrawn })}
            />,
          )}
          {row(
            'Motion',
            'Paper settles in, drops fall. Never bounces.',
            <Segmented
              options={[
                { id: MOTION_CALM, label: 'Calm' },
                { id: MOTION_STILL, label: 'Still' },
              ]}
              value={prefs.motion}
              onChange={(motion) => set({ motion })}
            />,
          )}
          {row(
            'Lofi radio',
            'Pilot. A small player in the corner of Home.',
            <Toggle on={prefs.radio} label="Lofi radio" onChange={(radio) => set({ radio })} />,
          )}

          <p className="room-you-group">Notes</p>
          {row(
            'Sage',
            sageLine(profile?.roomPrefs?.sage) ||
              'How it talks to you, what your notes are about, anything it should always keep in mind.',
            <button type="button" className="room-you-action" onClick={() => setSageOpen(true)}>
              Instructions
            </button>,
          )}
          {row(
            'Export everything',
            'Markdown, one folder per course, photos included where they can be. Or the whole account as one JSON file.',
            <span className="room-you-actions">
              <button
                type="button"
                className="room-you-action"
                onClick={handleMarkdown}
                disabled={Boolean(packing) || exporting}
              >
                {packing || 'Markdown'}
              </button>
              <button
                type="button"
                className="room-you-action"
                onClick={handleExport}
                disabled={exporting || Boolean(packing)}
              >
                {exporting ? 'Preparing…' : 'JSON'}
              </button>
            </span>,
          )}

          <p className="room-you-group">This account</p>
          {row(
            'Design',
            'Go back to the classic desk. Your room notes stay where they are.',
            <button
              type="button"
              className="room-you-action"
              onClick={() => {
                // /settings follows the preference, so this page simply becomes classic's
                // settings. From /room/you (always the room) it has to move there first.
                updateDesignMode(DESIGN_CLASSIC).catch((err) => console.error(err));
                navigate('/settings', { replace: true });
              }}
            >
              Switch
            </button>,
          )}
          {row(
            'Clear this device',
            'Signs you out and removes what is cached here. Your notes stay in your account.',
            <button type="button" className="room-you-action" onClick={() => setConfirmClear(true)}>
              Clear
            </button>,
          )}
          {row(
            'Sign out',
            null,
            <button
              type="button"
              className="room-you-action"
              onClick={() => logout().catch((err) => console.error(err))}
            >
              Sign out
            </button>,
          )}
        </Paper>
      </div>

      <Overlay open={editOpen} onClose={() => setEditOpen(false)} title="Edit profile">
        <input
          className="room-field"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          aria-label="Your name"
        />
        <input
          className="room-field"
          style={{ marginTop: 18 }}
          value={major}
          onChange={(e) => setMajor(e.target.value)}
          placeholder="Your major"
          aria-label="Your major"
        />
        <input
          ref={photoInputRef}
          type="file"
          accept={IMAGE_ACCEPT}
          onChange={uploadPhoto}
          style={{ display: 'none' }}
        />
        <div className="room-seg" style={{ marginTop: 22 }}>
          <Pill variant="primary" onClick={saveProfile} disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </Pill>
          <Pill onClick={() => photoInputRef.current?.click()} disabled={busy}>
            Change photo
          </Pill>
        </div>
      </Overlay>

      <SageInstructions open={sageOpen} onClose={() => setSageOpen(false)} />

      {/* The one place the room asks before acting: clearing a device cannot be undone,
          so the undo-instead-of-confirm rule does not apply. */}
      <Overlay open={confirmClear} onClose={() => setConfirmClear(false)} title="Clear this device?">
        <p className="room-setting-copy" style={{ fontSize: 15 }}>
          You will be signed out and anything cached in this browser is removed. Unsaved
          local drafts go with it. Everything already saved to your account stays.
        </p>
        <div className="room-seg" style={{ marginTop: 22 }}>
          <Pill
            variant="primary"
            onClick={async () => {
              try {
                await logoutAndClearDevice();
              } catch (err) {
                console.error('Could not fully clear the offline cache', err);
              } finally {
                window.location.replace('/');
              }
            }}
          >
            Clear it
          </Pill>
          <Pill onClick={() => setConfirmClear(false)}>Cancel</Pill>
        </div>
      </Overlay>
    </RoomShell>
  );
};

export default RoomYou;
