import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { enableIndexedDbPersistence, getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: 'AIzaSyCV4AC0oWmbKW8KD558ZEbabpCiDZvkzZ8',
  authDomain: 'companion-c4a42.firebaseapp.com',
  projectId: 'companion-c4a42',
  storageBucket: 'companion-c4a42.firebasestorage.app',
  messagingSenderId: '513580087116',
  appId: '1:513580087116:web:968646c19885867401c1e9',
  measurementId: 'G-Q4FPJB9SXK',
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

enableIndexedDbPersistence(db).catch((err) => {
  console.warn('Firestore persistence unavailable', err);
});
