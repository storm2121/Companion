import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import { useAuth } from '../context/authState';
import { storage } from '../firebase';
import ScreenLoader from '../components/ui/ScreenLoader';
import {
  AVATAR_MAX_BYTES,
  createImageObjectName,
  IMAGE_ACCEPT,
  validateImageFile,
} from '../utils/imageUpload';

const MAJORS = [
  'Computer Science',
  'Business Administration',
  'International Relations',
  'Engineering Management',
  'Communication Studies',
  'Psychology',
  'Architecture',
  'Marketing',
  'Finance',
  'Data Science',
];

const ProfileSetup = () => {
  const { updateProfileData, profile, profileReady, firebaseUser, loading } = useAuth();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState(profile?.displayName || '');
  const [major, setMajor] = useState(profile?.major || '');
  const [photoUrl, setPhotoUrl] = useState(profile?.photoUrl || '');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!profile) return;
    setDisplayName((prev) => prev || profile.displayName || '');
    setMajor((prev) => prev || profile.major || '');
    setPhotoUrl((prev) => prev || profile.photoUrl || '');
  }, [profile]);

  if (loading) {
    return <ScreenLoader note="Preparing your profile..." />;
  }

  if (profileReady) {
    return <Navigate to="/dashboard" replace />;
  }

  const handleUpload = async (file) => {
    if (!file || !firebaseUser) return;
    setUploading(true);
    setError('');
    try {
      validateImageFile(file, { maxBytes: AVATAR_MAX_BYTES, label: 'Profile photo' });
      const ref = storageRef(
        storage,
        `avatars/${firebaseUser.uid}/${createImageObjectName(file, 'avatar')}`,
      );
      await uploadBytes(ref, file, {
        contentType: file.type || undefined,
        cacheControl: 'public,max-age=31536000,immutable',
      });
      const url = await getDownloadURL(ref);
      setPhotoUrl(url);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      await updateProfileData({ displayName, major, photoUrl });
      navigate('/dashboard');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const filteredMajors = MAJORS.filter((item) => item.toLowerCase().includes(major.toLowerCase()));

  return (
    <div className="gate-shell">
      <div className="gate-card">
        <h2>Set up your profile</h2>
        <div className="centered">
          <label className="avatar-picker" style={{ backgroundImage: `url(${photoUrl})` }}>
            {!photoUrl && <span>PFP</span>}
            <input type="file" accept={IMAGE_ACCEPT} onChange={(e) => handleUpload(e.target.files[0])} hidden />
          </label>
          <p className="status-text">{uploading ? 'Uploading portrait…' : 'Tap to upload PFP'}</p>
        </div>
        <input
          placeholder="Display Name"
          value={displayName}
          onChange={(e) => {
            setDisplayName(e.target.value);
            setError('');
          }}
        />
        <input
          list="major-options"
          placeholder="Select your major"
          value={major}
          onChange={(e) => {
            setMajor(e.target.value);
            setError('');
          }}
        />
        <p className="status-text">Your major helps personalize your profile.</p>
        <datalist id="major-options">
          {filteredMajors.map((item) => (
            <option key={item} value={item} />
          ))}
        </datalist>
        <button className="primary-btn" onClick={handleSave} disabled={saving || !displayName || !major}>
          {saving ? 'Saving…' : 'Continue'}
        </button>
        {error && <p className="status-text">{error}</p>}
      </div>
    </div>
  );
};

export default ProfileSetup;
