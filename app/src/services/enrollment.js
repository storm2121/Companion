import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { db } from '../firebase';

export const MAX_ACTIVE_COURSES = 7;
export const MAX_ADD_DROP = 5;

export const listenToCourses = (onData, onError) => {
  const q = query(collection(db, 'courses'), orderBy('code'));
  return onSnapshot(q, onData, onError);
};

export const createCourse = async ({ code, section, semester, year }, uid) => {
  const trimmed = {
    code: code.trim().toUpperCase(),
    section: section.padStart(2, '0'),
    semester,
    year,
  };
  const compositeId = `${trimmed.code}-${trimmed.section}-${trimmed.semester}-${trimmed.year}`;
  const docRef = doc(db, 'courses', compositeId);
  const snap = await getDoc(docRef);

  if (snap.exists()) {
    throw new Error('Course already exists in catalog.');
  }

  await setDoc(docRef, {
    ...trimmed,
    courseKey: compositeId,
    createdBy: uid,
    createdAt: serverTimestamp(),
  });
  return compositeId;
};

export const enrollInCourse = async (uid, course) => {
  const userRef = doc(db, 'users', uid);
  const courseRef = doc(db, 'courses', course.courseKey);

  await runTransaction(db, async (transaction) => {
    const userSnap = await transaction.get(userRef);
    const courseSnap = await transaction.get(courseRef);

    if (!userSnap.exists()) throw new Error('User profile missing.');
    if (!courseSnap.exists()) throw new Error('Course not found.');

    const userData = userSnap.data();
    const active = userData.activeCourses || [];
    const counter = userData.enrollmentCounter || 0;

    if (active.find((c) => c.courseKey === course.courseKey)) {
      throw new Error('Already enrolled in this course.');
    }

    if (active.length >= MAX_ACTIVE_COURSES) {
      throw new Error('Max enrollment of 7 courses reached.');
    }

    if (counter >= MAX_ADD_DROP) {
      throw new Error('Add/drop limit reached for this semester.');
    }

    transaction.update(userRef, {
      activeCourses: [...active, course],
      enrollmentCounter: counter + 1,
    });
  });
};

export const dropCourse = async (uid, courseKey) => {
  const userRef = doc(db, 'users', uid);

  await runTransaction(db, async (transaction) => {
    const userSnap = await transaction.get(userRef);
    if (!userSnap.exists()) throw new Error('User profile missing.');

    const data = userSnap.data();
    const active = data.activeCourses || [];
    const counter = data.enrollmentCounter || 0;
    const updated = active.filter((c) => c.courseKey !== courseKey);

    if (active.length === updated.length) {
      throw new Error('Course not found in your schedule.');
    }

    if (counter >= MAX_ADD_DROP) {
      throw new Error('Add/drop limit reached for this semester.');
    }

    transaction.update(userRef, {
      activeCourses: updated,
      enrollmentCounter: counter + 1,
    });
  });
};
