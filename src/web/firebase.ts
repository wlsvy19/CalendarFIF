import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth';
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore';

export type FirebaseHandles = { auth: Auth; db: Firestore };

export function initFirebase(env: Record<string, string | undefined>): FirebaseHandles {
  const app = initializeApp({
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    appId: env.VITE_FIREBASE_APP_ID,
  });
  const forceLongPolling = env.VITE_FORCE_LONG_POLLING === '1';
  const db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    ...(forceLongPolling ? { experimentalForceLongPolling: true } : { experimentalAutoDetectLongPolling: true }),
  });
  const auth = getAuth(app);
  if (env.VITE_USE_EMULATOR === '1') {
    connectFirestoreEmulator(db, '127.0.0.1', 8085);
    connectAuthEmulator(auth, 'http://127.0.0.1:9095', { disableWarnings: true });
  }
  return { auth, db };
}
