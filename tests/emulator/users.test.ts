import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { deleteApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  connectAuthEmulator,
  inMemoryPersistence,
  initializeAuth,
  signInWithEmailAndPassword,
  type Auth,
} from 'firebase/auth';
import {
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocFromServer,
  initializeFirestore,
  setDoc,
  type Firestore,
} from 'firebase/firestore';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { watchAccess, type AccessState } from '../../src/web/access';
import { firestoreAccessSource, firestoreUsersSource } from '../../src/web/accessStore';
import { firebaseAccountMaker } from '../../src/web/accountMaker';
import { changePassword, firebasePasswordDeps, sendReset } from '../../src/web/password';
import type { UserRow } from '../../src/web/users';
import { addUser } from '../../src/web/users';
import { OWNER, createEnv } from './env';

const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8085';
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9095';
const AUTH_URL = `http://${AUTH_HOST}`;
const options = { apiKey: 'fake-api-key', projectId: 'demo-calfif', appId: 'demo-app' };

const run = Date.now().toString(36);
// 시드와 위젯 시험이 쓰는 관리자 계정과 같다(같은 uid에 다른 이메일을 만들 수 없다).
const ADMIN_EMAIL = 'test@example.com';
const ADMIN_PASSWORD = 'test-password';
const NEW_EMAIL = 'new-' + run + '@example.com';
const NEW_PASSWORD = 'first-password';
const STRANGER_EMAIL = 'stranger-' + run + '@example.com';

type Instance = { app: FirebaseApp; auth: Auth; db: Firestore };
const apps: FirebaseApp[] = [];
let counter = 0;
async function instance(email?: string, password?: string, name?: string, firestoreAddress = FIRESTORE_HOST): Promise<Instance> {
  counter += 1;
  const app = initializeApp(options, name ?? `users-test-${run}-${counter}`);
  apps.push(app);
  const auth = initializeAuth(app, { persistence: inMemoryPersistence });
  connectAuthEmulator(auth, AUTH_URL, { disableWarnings: true });
  const db = initializeFirestore(app, {});
  const i = firestoreAddress.lastIndexOf(':');
  connectFirestoreEmulator(db, firestoreAddress.slice(0, i), Number(firestoreAddress.slice(i + 1)));
  if (email && password) await signInWithEmailAndPassword(auth, email, password);
  return { app, auth, db };
}

async function createAccount(localId: string | undefined, email: string, password: string): Promise<void> {
  const res = await fetch(`${AUTH_URL}/identitytoolkit.googleapis.com/v1/projects/demo-calfif/accounts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer owner' },
    body: JSON.stringify({ localId, email, password }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    const message = body.error?.message ?? String(res.status);
    if (!/EMAIL_EXISTS|DUPLICATE_LOCAL_ID/.test(message)) throw new Error(`계정을 만들지 못했다: ${message}`);
  }
}

function until(read: () => AccessState | undefined, want: AccessState): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (read() === want) resolve();
      else if (Date.now() - started > 10000) reject(new Error(`상태가 ${want}이 되지 않았다: ${read()}`));
      else setTimeout(tick, 25);
    };
    tick();
  });
}

let env: RulesTestEnvironment;
let admin: Instance;
let newUid = '';
const monthOf = (uid: string) => `users/${uid}/months/2026-11`;

beforeAll(async () => {
  env = await createEnv();
  await env.clearFirestore();
  await createAccount(OWNER, ADMIN_EMAIL, ADMIN_PASSWORD);
  await createAccount(undefined, STRANGER_EMAIL, 'stranger-password');
  // 실제 앱처럼 관리자는 기본 앱 인스턴스에서 로그인한다.
  admin = await instance(ADMIN_EMAIL, ADMIN_PASSWORD, '[DEFAULT]');
});
afterAll(async () => {
  await Promise.all(apps.map((a) => deleteApp(a).catch(() => undefined)));
  await env.cleanup();
});

it('관리자가 사용자를 추가해도 관리자의 로그인은 그대로이고 사용 허가 문서가 생긴다', async () => {
  expect(admin.auth.currentUser?.uid).toBe(OWNER);
  await setDoc(doc(admin.db, monthOf(OWNER)), { days: {} });
  const result = await addUser(
    { accounts: firebaseAccountMaker(options, { emulatorAuthUrl: AUTH_URL }), users: firestoreUsersSource(admin.db), now: Date.now },
    ' ' + NEW_EMAIL.toUpperCase() + ' ',
    NEW_PASSWORD,
  );
  expect(result).toMatchObject({ ok: true, existed: false });
  if (!result.ok) return;
  newUid = result.uid;
  expect(admin.auth.currentUser?.uid).toBe(OWNER);
  expect(getApps().map((a) => a.name).sort()).toEqual(apps.map((a) => a.name).sort());
  const snap = await getDoc(doc(admin.db, 'access', newUid));
  expect(snap.data()).toMatchObject({ email: NEW_EMAIL, role: 'user', disabled: false });
});

it('새 사용자는 자기 달을 읽고 쓰지만 관리자의 달은 읽지 못한다', async () => {
  const user = await instance(NEW_EMAIL, NEW_PASSWORD);
  expect(user.auth.currentUser?.uid).toBe(newUid);
  await assertSucceeds(setDoc(doc(user.db, monthOf(newUid)), { days: {} }));
  await assertSucceeds(getDoc(doc(user.db, monthOf(newUid))));
  await assertFails(getDoc(doc(user.db, monthOf(OWNER))));
});

it('관리자가 막으면 사용자의 쓰기가 실패하고 풀면 다시 성공한다', async () => {
  const users = firestoreUsersSource(admin.db);
  const user = await instance(NEW_EMAIL, NEW_PASSWORD);
  await users.setDisabled(newUid, true);
  await assertFails(setDoc(doc(user.db, monthOf(newUid)), { days: { '01': 1 } }));
  await users.setDisabled(newUid, false);
  await assertSucceeds(setDoc(doc(user.db, monthOf(newUid)), { days: {} }));
});

it('같은 이메일과 비밀번호로 다시 추가하면 existed이고 틀린 비밀번호는 거부한다', async () => {
  const deps = { accounts: firebaseAccountMaker(options, { emulatorAuthUrl: AUTH_URL }), users: firestoreUsersSource(admin.db), now: Date.now };
  expect(await addUser(deps, NEW_EMAIL, NEW_PASSWORD)).toEqual({ ok: true, uid: newUid, existed: true });
  expect(await addUser(deps, NEW_EMAIL, 'wrong-password-1')).toMatchObject({ ok: false, reason: 'exists-wrong-password' });
  expect(admin.auth.currentUser?.uid).toBe(OWNER);
});

it('사용자가 자기 비밀번호를 바꾼다', async () => {
  const user = await instance(NEW_EMAIL, NEW_PASSWORD);
  const deps = firebasePasswordDeps(user.auth);
  expect(await changePassword(deps, 'not-the-password', 'second-password')).toMatchObject({ ok: false, reason: 'wrong-current' });
  expect(await changePassword(deps, NEW_PASSWORD, 'second-password')).toEqual({ ok: true });
  const again = await instance(NEW_EMAIL, 'second-password');
  expect(again.auth.currentUser?.uid).toBe(newUid);
});

it('사용 허가 문서를 지우면 사용자의 읽기가 실패한다', async () => {
  const user = await instance(NEW_EMAIL, 'second-password');
  await assertSucceeds(getDoc(doc(user.db, monthOf(newUid))));
  await firestoreUsersSource(admin.db).remove(newUid);
  await assertFails(getDoc(doc(user.db, monthOf(newUid))));
});

it('watchAccess: 관리자는 admin이 되고 문서가 만들어지며, 허가 없는 계정은 none이고 문서가 없다', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(`access/${OWNER}`).delete();
  });
  let adminState: AccessState | undefined;
  const stopAdmin = watchAccess(firestoreAccessSource(admin.db), { uid: OWNER, email: ADMIN_EMAIL }, (s) => { adminState = s; });
  await until(() => adminState, 'admin');
  stopAdmin();
  const created = await getDoc(doc(admin.db, 'access', OWNER));
  expect(created.data()).toMatchObject({ email: ADMIN_EMAIL, role: 'admin', disabled: false });

  const stranger = await instance(STRANGER_EMAIL, 'stranger-password');
  const strangerUid = stranger.auth.currentUser!.uid;
  const strangerStates: AccessState[] = [];
  const stopStranger = watchAccess(firestoreAccessSource(stranger.db), { uid: strangerUid, email: STRANGER_EMAIL }, (s) => { strangerStates.push(s); });
  await until(() => strangerStates.at(-1), 'none');
  await new Promise((r) => setTimeout(r, 300));
  stopStranger();
  expect(strangerStates).not.toContain('admin');
  expect(strangerStates).not.toContain('user');
  await env.withSecurityRulesDisabled(async (ctx) => {
    expect((await ctx.firestore().doc(`access/${strangerUid}`).get()).exists).toBe(false);
  });
});

it('연결이 없으면 관리자의 목록 쓰기는 기다리지 않고 실패하고 대기열에 남지 않는다', async () => {
  await firestoreUsersSource(admin.db).put(newUid, { email: NEW_EMAIL, role: 'user', disabled: false, createdAt: 1 });
  // 관리자가 로그인한 채로 서버에 닿지 않는 Firestore(아무도 듣지 않는 포트)를 쓴다.
  const offline = await instance(ADMIN_EMAIL, ADMIN_PASSWORD, undefined, '127.0.0.1:1');
  const users = firestoreUsersSource(offline.db);
  const entry = { email: NEW_EMAIL, role: 'user' as const, disabled: false, createdAt: 2 };
  await Promise.all([
    expect(users.setDisabled(newUid, true)).rejects.toMatchObject({ code: 'unavailable' }),
    expect(users.remove(newUid)).rejects.toMatchObject({ code: 'unavailable' }),
    expect(users.put(newUid, entry)).rejects.toMatchObject({ code: 'unavailable' }),
  ]);
  const snap = await getDocFromServer(doc(admin.db, 'access', newUid));
  expect(snap.data()).toMatchObject({ email: NEW_EMAIL, disabled: false });
});

it('watchAll: 이메일 순이고 모양이 틀린 문서는 건너뛴다', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc('access/zz-' + run).set({ email: 'zz-' + run + '@example.com', role: 'user', disabled: false, createdAt: 1 });
    await db.doc('access/aa-' + run).set({ email: 'aa-' + run + '@example.com', role: 'user', disabled: false, createdAt: 1 });
    await db.doc('access/malformed-' + run).set({ email: 5, role: 'user' });
  });
  let rows: UserRow[] = [];
  const stop = firestoreUsersSource(admin.db).watchAll((r) => { rows = r; }, () => {});
  const started = Date.now();
  while (!rows.some((r) => r.uid === 'zz-' + run) && Date.now() - started < 10000) await new Promise((r) => setTimeout(r, 25));
  stop();
  const emails = rows.map((r) => r.email);
  expect(emails).toEqual([...emails].sort((a, b) => a.localeCompare(b)));
  expect(emails.indexOf('aa-' + run + '@example.com')).toBeLessThan(emails.indexOf('zz-' + run + '@example.com'));
  expect(rows.map((r) => r.uid)).not.toContain('malformed-' + run);
});

it('sendReset: 있는 주소에는 성공하고 언어를 ko로 둔다', async () => {
  const other = await instance();
  await expect(sendReset(other.auth, ' ' + ADMIN_EMAIL.toUpperCase() + ' ')).resolves.toBeUndefined();
  expect(other.auth.languageCode).toBe('ko');
});
