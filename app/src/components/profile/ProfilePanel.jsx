import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { FaLock } from 'react-icons/fa';
import { useAuth } from '../../context/AuthContext';
import { doc, updateDoc } from 'firebase/firestore';
import { db, storage } from '../../firebase';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';

const ProfilePanel = () => {
  const { firebaseUser, profile, logout } = useAuth();
  const [username, setUsername] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [avatarUploading, setAvatarUploading] = useState(false);

  useEffect(() => {
    if (profile) {
      setUsername(profile.username || '');
      setNote(profile.note || '');
    }
  }, [profile]);

  if (!firebaseUser || !profile) return null;

  const handleSave = async () => {
    setSaving(true);
    setFeedback('');
    try {
      await updateDoc(doc(db, 'users', firebaseUser.uid), {
        username,
        note,
      });
      setFeedback('Profile updated.');
    } catch (err) {
      setFeedback(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleAvatar = async (file) => {
    if (!file) return;
    setAvatarUploading(true);
    setFeedback('');
    try {
      const ref = storageRef(storage, `avatars/${firebaseUser.uid}`);
      await uploadBytes(ref, file);
      const url = await getDownloadURL(ref);
      await updateDoc(doc(db, 'users', firebaseUser.uid), { photoUrl: url });
      setFeedback('Portrait updated.');
    } catch (err) {
      setFeedback(err.message);
    } finally {
      setAvatarUploading(false);
    }
  };

  return (
    <motion.section className="panel profile" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
      <header className="panel-head">
        <div>
          <p className="pill">Private Folio</p>
          <h2>{profile.username}</h2>
        </div>
        <button className="btn-outline" onClick={logout}>
          Sign Out
        </button>
      </header>
      <div className="profile-grid">
        <div className="folio-card avatar-card">
          <div className="avatar-frame" style={{ backgroundImage: `url(${profile.photoUrl || ''})` }}>
            {!profile.photoUrl && <span>Avatar</span>}
          </div>
          <label className="file-pill">
            Upload Portrait
            <input type="file" accept="image/*" onChange={(e) => handleAvatar(e.target.files[0])} disabled={avatarUploading} />
          </label>
        </div>
        <div className="folio-card span-2">
          <p>
            Email <FaLock className="lock-icon" />
          </p>
          <p>{firebaseUser.email}</p>
        </div>
        <div className="folio-card">
          <label>
            Display Name
            <input value={username} onChange={(e) => setUsername(e.target.value)} />
          </label>
          <label>
            Private Note
            <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a private study note..." />
          </label>
          <button className="btn-accent" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
          {feedback && <p className="microcopy">{feedback}</p>}
        </div>
      </div>
    </motion.section>
  );
};

export default ProfilePanel;
