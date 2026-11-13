import { initializeApp, type FirebaseApp } from 'firebase/app';
import { browserLocalPersistence, connectAuthEmulator, getAuth, indexedDBLocalPersistence, initializeAuth, type Auth } from 'firebase/auth';
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore';

// app은 사용자 추가가 두 번째 앱 인스턴스를 같은 설정(app.options)으로 만들 때 쓴다.
export type FirebaseHandles = { app: FirebaseApp; auth: Auth; db: Firestore };

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
  // PC 앱은 팝업과 리디렉트 처리기 없이 만든다. 그 처리기가 Auth 도메인의 페이지를 읽기 때문이다.
  const auth =
    env.VITE_DESKTOP === '1'
      ? initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] })
      : getAuth(app);
  if (env.VITE_USE_EMULATOR === '1') {
    connectFirestoreEmulator(db, '127.0.0.1', 8085);
    connectAuthEmulator(auth, 'http://127.0.0.1:9095', { disableWarnings: true });
  }
  return { app, auth, db };
}
