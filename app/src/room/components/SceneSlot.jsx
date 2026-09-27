import { useRef, useState } from 'react';
import { deleteObject, getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import { storage } from '../../firebase';
import { useAuth } from '../../context/authState';
import {
  AVATAR_MAX_BYTES,
  createImageObjectName,
  IMAGE_ACCEPT,
  validateImageFile,
} from '../../utils/imageUpload';
import { IMMUTABLE_CACHE, prepareImage } from '../imageScale';
import { sayInRoom } from '../roomUndo';
import Paper from './Paper';
import { MenuCard } from './Overlay';

// The lofi scene on Home (design 6a): a sheet of paper around a picture of your own —
// "a window, a desk, a plant". Empty, it is the dashed placeholder the design specifies.
//
// The file lives beside your avatar (`avatars/{uid}/scene-…`) because storage.rules
// already allows that path — a new one would need a deploy. Its address rides
// `roomPrefs.scene`, so it follows you to every device like the rest of the room.

// Drawn at most ~420px wide; 1400px covers a 3x screen with room to spare.
const SCENE_EDGE = 1400;

// Our own validators speak to people; Firebase errors (they carry a `code`) do not.
const readable = (err) =>
  !err?.code && typeof err?.message === 'string' && err.message ? err.message : 'That picture could not be added';

const SceneSlot = ({ stagger }) => {
  const { firebaseUser, profile, updateRoomPrefs } = useAuth();
  const scene = profile?.roomPrefs?.scene;
  const url = typeof scene?.url === 'string' ? scene.url : '';
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // A picture that will not load (removed elsewhere, or offline and never cached) falls
  // back to the placeholder rather than a broken image.
  const [brokenUrl, setBrokenUrl] = useState('');
  const showImage = Boolean(url) && brokenUrl !== url;

  const pick = () => {
    if (!navigator.onLine) {
      sayInRoom('Adding a picture needs a connection');
      return;
    }
    inputRef.current?.click();
  };

  const takeDown = async (path) => {
    if (!path) return;
    try {
      await deleteObject(storageRef(storage, path));
    } catch (err) {
      if (err?.code !== 'storage/object-not-found') console.warn('Could not remove the old picture', err);
    }
  };

  const upload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !firebaseUser) return;
    setBusy(true);
    const previous = typeof scene?.path === 'string' ? scene.path : '';
    try {
      // Scale first, then validate what will actually be sent (imageScale.js).
      const ready = await prepareImage(file, SCENE_EDGE);
      validateImageFile(ready.file, { maxBytes: AVATAR_MAX_BYTES, label: 'Picture' });
      const path = `avatars/${firebaseUser.uid}/${createImageObjectName(ready.file, 'scene')}`;
      const ref = storageRef(storage, path);
      await uploadBytes(ref, ready.file, { contentType: ready.file.type, cacheControl: IMMUTABLE_CACHE });
      const nextUrl = await getDownloadURL(ref);
      await updateRoomPrefs({ scene: { url: nextUrl, path } });
      // Only once the new one is in place — never leave the slot pointing at nothing.
      if (previous && previous !== path) await takeDown(previous);
    } catch (err) {
      console.error('Could not put that picture up', err);
      sayInRoom(readable(err));
    } finally {
      setBusy(false);
    }
  };

  // Needs a connection so the file itself goes too, rather than being orphaned in Storage.
  const remove = () => {
    if (!navigator.onLine) {
      sayInRoom('Taking it down needs a connection');
      return;
    }
    const previous = typeof scene?.path === 'string' ? scene.path : '';
    updateRoomPrefs({ scene: null })
      .then(() => takeDown(previous))
      .catch((err) => console.error('Could not take the picture down', err));
  };

  return (
    <Paper className={`room-scene${menuOpen ? ' is-open' : ''}`} tilt={-1.2} stagger={stagger}>
      <input ref={inputRef} type="file" accept={IMAGE_ACCEPT} hidden onChange={upload} />

      {showImage ? (
        <button
          type="button"
          className="room-scene-frame"
          data-menu-trigger=""
          aria-label="Your scene. Change it or take it down"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <img className="room-scene-img" src={url} alt="" decoding="async" onError={() => setBrokenUrl(url)} />
        </button>
      ) : (
        <button type="button" className="room-scene-inner" onClick={pick} disabled={busy}>
          {busy ? (
            <span>Putting it up…</span>
          ) : (
            <>
              <span>
                A picture of your own —
                <br />a window, a desk, a plant.
              </span>
              <span className="room-scene-add">+ Add a picture</span>
            </>
          )}
        </button>
      )}

      {busy && showImage && <span className="room-scene-busy">Putting it up…</span>}

      {menuOpen && (
        <MenuCard
          onClose={() => setMenuOpen(false)}
          style={{ position: 'absolute', top: 18, right: 18 }}
          items={[
            { id: 'change', label: 'Change the picture', onSelect: pick },
            { id: 'remove', label: 'Take it down', onSelect: remove },
          ]}
        />
      )}
    </Paper>
  );
};

export default SceneSlot;
