import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  isSignInWithEmailLink,
  onAuthStateChanged,
  sendEmailVerification,
  sendSignInLinkToEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithEmailLink,
  signOut,
  updateProfile,
} from 'firebase/auth';
import { doc, onSnapshot, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { THEME_DEFAULT_MODE, THEME_PRESETS } from '../themePresets';
import { DEFAULT_TEMPLATE_ID } from '../data/noteTemplates';

const AuthContext = createContext(null);

const EMAIL_REGEX = /^[A-Z0-9._%+-]+@aui\.ma$/i;

const resolveThemeMode = (mode) => (THEME_PRESETS[mode] ? mode : THEME_DEFAULT_MODE);

const applyThemeMode = (mode) => {
  if (typeof document === 'undefined') return;
  const themeKey = resolveThemeMode(mode);
  const theme = THEME_PRESETS[themeKey];
  const root = document.documentElement;
  root.style.setProperty('--bg', theme.bg);
  root.style.setProperty('--surface-1', theme.surface1);
  root.style.setProperty('--surface-2', theme.surface2);
  root.style.setProperty('--surface-3', theme.surface3);
  root.style.setProperty('--border', theme.border);
  root.style.setProperty('--text', theme.text);
  root.style.setProperty('--text-secondary', theme.textSecondary);
  root.style.setProperty('--text-muted', theme.textMuted);
  root.style.setProperty('--accent', theme.accent);
  root.style.setProperty('--accent-hover', theme.accentHover);
  root.style.setProperty('--accent-pressed', theme.accentPressed);
};

const buildActionCodeSettings = () => ({
  url: `${window.location.origin}/auth/complete`,
  handleCodeInApp: true,
});

export const AuthProvider = ({ children }) => {
  const [firebaseUser, setFirebaseUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [statusMessage, setStatusMessage] = useState('');

  useEffect(() => {
    setPersistence(auth, browserLocalPersistence).catch((err) => {
      console.error('Failed to set auth persistence', err);
    });
  }, []);

  useEffect(() => {
    applyThemeMode(profile?.themeMode || THEME_DEFAULT_MODE);
  }, [profile?.themeMode]);

  useEffect(() => {
    let profileUnsub = null;
    const unsub = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      if (profileUnsub) {
        profileUnsub();
        profileUnsub = null;
      }

      if (!user) {
        setProfile(null);
        setLoading(false);
        return;
      }

      if (!user.emailVerified) {
        setProfile(null);
        setLoading(false);
        return;
      }

      const profileRef = doc(db, 'users', user.uid);
      profileUnsub = onSnapshot(
        profileRef,
        async (snap) => {
          if (!snap.exists()) {
            const seed = {
              uid: user.uid,
              email: user.email,
              displayName: user.displayName || '',
              photoUrl: user.photoURL || '',
              major: '',
              profileComplete: false,
              themeMode: THEME_DEFAULT_MODE,
              noteTemplateDefault: DEFAULT_TEMPLATE_ID,
              createdAt: serverTimestamp(),
            };
            try {
              await setDoc(profileRef, seed);
              setProfile(seed);
            } catch (err) {
              console.error('Failed to seed profile', err);
            }
            setLoading(false);
            return;
          }

          const data = snap.data();
          const updates = {};
          const displayName = data.displayName || data.username || data.name || user.displayName || '';
          const majorValue = data.major || data.majorName || data.department || '';

          if (!data.displayName && data.username) {
            updates.displayName = data.username;
          } else if (!data.displayName && user.displayName) {
            updates.displayName = user.displayName;
          }
          if (!data.major && data.majorName) {
            updates.major = data.majorName;
          } else if (!data.major && displayName) {
            updates.major = 'Undeclared';
          }
          if (!data.photoUrl && user.photoURL) {
            updates.photoUrl = user.photoURL;
          }
          if (!data.themeMode) {
            updates.themeMode = THEME_DEFAULT_MODE;
          }
          if (!data.noteTemplateDefault) {
            updates.noteTemplateDefault = DEFAULT_TEMPLATE_ID;
          }
          const hasProfileData = Boolean(displayName || majorValue || data.photoUrl || updates.photoUrl);
          if (!data.profileComplete && hasProfileData && (majorValue || updates.major)) {
            updates.profileComplete = true;
            updates.setupCompletedAt = data.setupCompletedAt || serverTimestamp();
          }

          if (Object.keys(updates).length) {
            try {
              await updateDoc(profileRef, updates);
              setProfile({ ...data, ...updates });
            } catch (err) {
              console.error('Failed to sync profile fields', err);
              setProfile(data);
            }
          } else {
            setProfile(data);
          }
          setLoading(false);
        },
        (err) => {
          console.error('Profile listener error', err);
          setProfile(null);
          setLoading(false);
        },
      );
    });

    return () => {
      if (profileUnsub) profileUnsub();
      unsub();
    };
  }, []);

  const registerWithPassword = async (email, password) => {
    if (!EMAIL_REGEX.test(email)) {
      throw new Error('Only @aui.ma email addresses are permitted.');
    }
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    await sendEmailVerification(credential.user, {
      url: `${window.location.origin}/`,
      handleCodeInApp: false,
    });
    setStatusMessage('Verification email sent. Please verify before logging in.');
    await signOut(auth);
  };

  const loginWithPassword = async (email, password) => {
    if (!EMAIL_REGEX.test(email)) {
      throw new Error('Only @aui.ma email addresses are permitted.');
    }
    const result = await signInWithEmailAndPassword(auth, email, password);
    if (!result.user.emailVerified) {
      await sendEmailVerification(result.user, {
        url: `${window.location.origin}/`,
        handleCodeInApp: false,
      });
      await signOut(auth);
      throw new Error('Verify your email first. We sent a new verification link.');
    }
    return result.user;
  };

  const sendLoginLink = async (email) => {
    if (!EMAIL_REGEX.test(email)) {
      throw new Error('Only @aui.ma email addresses are permitted.');
    }
    await sendSignInLinkToEmail(auth, email, buildActionCodeSettings());
    localStorage.setItem('authEmail', email);
    setStatusMessage('Sign-in link sent. Check your university inbox.');
  };

  const completeEmailLinkSignIn = async (email, link) => {
    const targetLink = link || window.location.href;
    if (!isSignInWithEmailLink(auth, targetLink)) {
      throw new Error('Invalid or expired sign-in link.');
    }
    const storedEmail = localStorage.getItem('authEmail');
    const resolvedEmail = email || storedEmail;
    if (!resolvedEmail) {
      throw new Error('Please confirm your email to finish sign-in.');
    }
    const result = await signInWithEmailLink(auth, resolvedEmail, targetLink);
    localStorage.removeItem('authEmail');
    setFirebaseUser(result.user);
    return result.user;
  };

  const logout = () => signOut(auth);

  const updateProfileData = async ({ displayName, major, photoUrl }) => {
    if (!firebaseUser) throw new Error('No authenticated user.');
    if (displayName) {
      await updateProfile(firebaseUser, { displayName, photoURL: photoUrl || firebaseUser.photoURL || '' });
    }
    await setDoc(
      doc(db, 'users', firebaseUser.uid),
      {
        uid: firebaseUser.uid,
        email: firebaseUser.email,
        displayName: displayName ?? firebaseUser.displayName ?? '',
        major: major ?? profile?.major ?? '',
        photoUrl: photoUrl ?? firebaseUser.photoURL ?? profile?.photoUrl ?? '',
        profileComplete: true,
        setupCompletedAt: serverTimestamp(),
      },
      { merge: true },
    );
  };

  const updateThemeMode = async (value) => {
    if (!firebaseUser) throw new Error('No authenticated user.');
    const themeMode = resolveThemeMode(value);
    await updateDoc(doc(db, 'users', firebaseUser.uid), { themeMode });
  };

  const updateNoteTemplateDefault = async (value) => {
    if (!firebaseUser) throw new Error('No authenticated user.');
    await updateDoc(doc(db, 'users', firebaseUser.uid), { noteTemplateDefault: value });
  };

  const profileReady = useMemo(() => {
    const nameValue = profile?.displayName || profile?.username || profile?.name || firebaseUser?.displayName;
    const majorValue = profile?.major || profile?.majorName || profile?.department;
    return Boolean(profile?.profileComplete || profile?.setupCompletedAt || (nameValue && majorValue));
  }, [profile, firebaseUser]);

  const value = useMemo(
    () => ({
      firebaseUser,
      profile,
      profileReady,
      loading,
      statusMessage,
      setStatusMessage,
      registerWithPassword,
      loginWithPassword,
      sendLoginLink,
      completeEmailLinkSignIn,
      updateProfileData,
      updateThemeMode,
      updateNoteTemplateDefault,
      applyThemeMode,
      logout,
    }),
    [firebaseUser, profile, profileReady, loading, statusMessage],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth() {
  return useContext(AuthContext);
}
