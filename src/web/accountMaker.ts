import { deleteApp, initializeApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app';
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  inMemoryPersistence,
  initializeAuth,
  signInWithEmailAndPassword,
  signOut,
  type Auth,
} from 'firebase/auth';
import { codeOf } from './authCommon';
import type { AccountMaker } from './users';

let counter = 0;

/**
 * 호출마다 두 번째 앱 인스턴스를 만들어 쓰고 지운다. 첫 앱과 그 로그인 사용자는 건드리지 않는다.
 * 팝업·리디렉트 처리기가 없어서 PC 앱에서도 동작한다.
 */
export function firebaseAccountMaker(options: FirebaseOptions, env: { emulatorAuthUrl?: string }): AccountMaker {
  async function withSecondAuth(run: (auth: Auth) => Promise<string>): Promise<string> {
    counter += 1;
    let app: FirebaseApp | undefined;
    let auth: Auth | undefined;
    try {
      app = initializeApp(options, `account-maker-${Date.now()}-${counter}`);
      auth = initializeAuth(app, { persistence: inMemoryPersistence });
      if (env.emulatorAuthUrl) connectAuthEmulator(auth, env.emulatorAuthUrl, { disableWarnings: true });
      return await run(auth);
    } catch (e) {
      throw { code: codeOf(e) };
    } finally {
      if (auth) await signOut(auth).catch(() => undefined);
      if (app) await deleteApp(app).catch(() => undefined);
    }
  }
  return {
    create: (email, password) =>
      withSecondAuth(async (auth) => (await createUserWithEmailAndPassword(auth, email, password)).user.uid),
    lookup: (email, password) =>
      withSecondAuth(async (auth) => (await signInWithEmailAndPassword(auth, email, password)).user.uid),
  };
}
