import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { getAuth } from 'firebase/auth';
import {
  clearIndexedDbPersistence,
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  terminate,
} from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getFunctions } from 'firebase/functions';

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

const appCheckSiteKey = import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY;
if (appCheckSiteKey) {
  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey),
    isTokenAutoRefreshEnabled: true,
  });
}

export const auth = getAuth(app);
let dbInstance;
try {
  dbInstance = initializeFirestore(app, {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager(),
    }),
  });
} catch (err) {
  console.warn('Falling back to default Firestore initialization', err);
  dbInstance = getFirestore(app);
}
export const db = dbInstance;
export const storage = getStorage(app);
export const functions = getFunctions(app, 'europe-west1');

// Persistent multi-tab caching remains the default. Clearing it is deliberately
// separate so normal sign-out keeps the offline/load-saving behavior intact.
export const clearFirestoreOfflineCache = async () => {
  await terminate(db);
  await clearIndexedDbPersistence(db);
};
