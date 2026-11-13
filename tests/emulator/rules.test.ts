import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, it } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import { OWNER, USER, anonDb, createEnv, otherDb, ownerDb, seedDocs, userDb } from './env';

let env: RulesTestEnvironment;
beforeAll(async () => { env = await createEnv(); });
beforeEach(async () => { await env.clearFirestore(); });
afterAll(async () => { await env.cleanup(); });

const month = `users/${OWNER}/months/2026-11`;

it('소유자는 자기 달 문서를 읽고 쓴다', async () => {
  const db = ownerDb(env);
  await assertSucceeds(setDoc(doc(db, month), { days: {} }));
  await assertSucceeds(getDoc(doc(db, month)));
});
it('다른 계정은 소유자의 문서도 자기 문서도 쓰지 못한다', async () => {
  const db = otherDb(env);
  await assertFails(getDoc(doc(db, month)));
  await assertFails(setDoc(doc(db, month), { days: {} }));
  await assertFails(setDoc(doc(db, 'users/someone-else/months/2026-11'), { days: {} }));
});
it('로그인하지 않으면 읽지 못한다', async () => {
  await assertFails(getDoc(doc(anonDb(env), month)));
});
it('달 형식이 아니거나 다른 경로면 소유자도 쓰지 못한다', async () => {
  const db = ownerDb(env);
  await assertFails(setDoc(doc(db, `users/${OWNER}/months/nov`), { days: {} }));
  await assertFails(setDoc(doc(db, `users/${OWNER}/notes/x`), { a: 1 }));
  await assertFails(getDoc(doc(db, 'other/x')));
});

const userMonth = `users/${USER}/months/2026-11`;
const thirdMonth = 'users/third-uid/months/2026-11';
const grant = (email: string, extra: Record<string, unknown> = {}) => ({
  email, role: 'user', disabled: false, createdAt: 1700000000000, ...extra,
});
const ownerAccess = { email: 'test@example.com', role: 'admin', disabled: false, createdAt: 1700000000000 };

it('허가된 사용자는 자기 달 문서를 읽고 쓴다', async () => {
  await seedDocs(env, { [`access/${USER}`]: grant('user@example.com') });
  const db = userDb(env);
  await assertSucceeds(setDoc(doc(db, userMonth), { days: {} }));
  await assertSucceeds(getDoc(doc(db, userMonth)));
});
it('허가된 사용자도 소유자나 허가된 제3자의 달 문서는 읽고 쓰지 못한다', async () => {
  await seedDocs(env, {
    [`access/${USER}`]: grant('user@example.com'),
    'access/third-uid': grant('third@example.com'),
    [thirdMonth]: { days: {} },
    [month]: { days: {} },
  });
  const db = userDb(env);
  await assertFails(getDoc(doc(db, month)));
  await assertFails(setDoc(doc(db, month), { days: {} }));
  await assertFails(getDoc(doc(db, thirdMonth)));
  await assertFails(setDoc(doc(db, thirdMonth), { days: {} }));
});
it('사용 허가 문서가 없는 계정은 자기 달 문서도 읽고 쓰지 못한다', async () => {
  const db = userDb(env);
  await assertFails(getDoc(doc(db, userMonth)));
  await assertFails(setDoc(doc(db, userMonth), { days: {} }));
});
it('사용 중지된 사용자는 자기 달 문서를 읽고 쓰지 못한다', async () => {
  await seedDocs(env, { [`access/${USER}`]: grant('user@example.com', { disabled: true }) });
  const db = userDb(env);
  await assertFails(getDoc(doc(db, userMonth)));
  await assertFails(setDoc(doc(db, userMonth), { days: {} }));
});
it('소유자는 다른 사용자의 달 문서를 읽고 쓰지 못한다', async () => {
  await seedDocs(env, { [`access/${USER}`]: grant('user@example.com'), [userMonth]: { days: {} } });
  const db = ownerDb(env);
  await assertFails(getDoc(doc(db, userMonth)));
  await assertFails(setDoc(doc(db, userMonth), { days: {} }));
});
it('소유자는 사용자의 허가 문서를 만들고 고치고 지우고, 목록을 본다', async () => {
  const db = ownerDb(env);
  const ref = doc(db, `access/${USER}`);
  await assertSucceeds(setDoc(ref, grant('user@example.com')));
  await assertSucceeds(setDoc(ref, grant('user@example.com', { disabled: true })));
  await assertSucceeds(getDocs(collection(db, 'access')));
  await assertSucceeds(deleteDoc(ref));
});
it('사용자는 자기 허가 문서만 읽고, 목록과 모든 쓰기는 거절된다', async () => {
  await seedDocs(env, {
    [`access/${USER}`]: grant('user@example.com'),
    'access/third-uid': grant('third@example.com'),
  });
  const db = userDb(env);
  await assertSucceeds(getDoc(doc(db, `access/${USER}`)));
  await assertFails(getDoc(doc(db, 'access/third-uid')));
  await assertFails(getDocs(collection(db, 'access')));
  await assertFails(setDoc(doc(db, 'access/third-uid'), grant('third@example.com')));
  await assertFails(setDoc(doc(db, `access/${USER}`), grant('user@example.com', { disabled: false })));
  await assertFails(setDoc(doc(db, `access/${USER}`), grant('user@example.com', { role: 'admin' })));
  await assertFails(updateDoc(doc(db, `access/${USER}`), { disabled: false }));
  await assertFails(deleteDoc(doc(db, `access/${USER}`)));
  await assertFails(deleteDoc(doc(db, 'access/third-uid')));
  // 아직 없는 문서를 새로 만드는 시도
  await assertFails(setDoc(doc(db, 'access/new-uid'), grant('new@example.com')));
});
it('가입만 한 낯선 계정은 자기 허가 문서를 스스로 만들지 못한다', async () => {
  const db = otherDb(env);
  await assertFails(setDoc(doc(db, 'access/someone-else'), grant('x@example.com')));
  await assertFails(setDoc(doc(db, 'access/someone-else'), grant('x@example.com', { role: 'admin' })));
  await assertFails(setDoc(doc(db, `users/someone-else/months/2026-11`), { days: {} }));
});
it('소유자의 관리자 허가 문서는 사용자 역할이나 사용 중지로 고쳐지지 않는다', async () => {
  await seedDocs(env, { [`access/${OWNER}`]: ownerAccess });
  const ref = doc(ownerDb(env), `access/${OWNER}`);
  await assertFails(setDoc(ref, { ...ownerAccess, role: 'user' }));
  await assertFails(setDoc(ref, { ...ownerAccess, disabled: true }));
  await assertFails(updateDoc(ref, { role: 'user' }));
  await assertFails(updateDoc(ref, { disabled: true }));
  await assertSucceeds(updateDoc(ref, { email: 'new@example.com' }));
});
it('달 컬렉션 목록 읽기는 누구에게도 열려 있지 않다', async () => {
  // 규칙이 monthId를 쓰므로 컬렉션 쿼리는 허가된 사용자와 소유자도 거절된다. 앱은 달 문서를 하나씩만 읽는다.
  await seedDocs(env, {
    [`access/${USER}`]: grant('user@example.com'),
    'access/off-uid': grant('off@example.com', { disabled: true }),
  });
  const off = env.authenticatedContext('off-uid').firestore() as unknown as Firestore;
  await assertFails(getDocs(collection(userDb(env), `users/${USER}/months`)));
  await assertFails(getDocs(collection(ownerDb(env), `users/${OWNER}/months`)));
  await assertFails(getDocs(collection(off, 'users/off-uid/months')));
  await assertFails(getDocs(collection(otherDb(env), 'users/someone-else/months')));
  await assertFails(getDocs(collection(userDb(env), `users/${OWNER}/months`)));
});
it('허가된 두 사용자는 서로의 달 문서를 읽고 쓰지 못한다', async () => {
  const aMonth = 'users/user-a/months/2026-11';
  const bMonth = 'users/user-b/months/2026-11';
  await seedDocs(env, {
    'access/user-a': grant('a@example.com'),
    'access/user-b': grant('b@example.com'),
    [aMonth]: { days: {} },
    [bMonth]: { days: {} },
  });
  const a = env.authenticatedContext('user-a').firestore() as unknown as Firestore;
  const b = env.authenticatedContext('user-b').firestore() as unknown as Firestore;
  await assertSucceeds(getDoc(doc(a, aMonth)));
  await assertSucceeds(getDoc(doc(b, bMonth)));
  await assertFails(getDoc(doc(a, bMonth)));
  await assertFails(setDoc(doc(a, bMonth), { days: {} }));
  await assertFails(getDoc(doc(b, aMonth)));
  await assertFails(setDoc(doc(b, aMonth), { days: {} }));
});
it('소유자는 자기 허가 문서를 관리자로 만들 수 있고, 다른 값이나 삭제는 거절된다', async () => {
  const db = ownerDb(env);
  const ref = doc(db, `access/${OWNER}`);
  await assertFails(setDoc(ref, { ...ownerAccess, role: 'user' }));
  await assertFails(setDoc(ref, { ...ownerAccess, disabled: true }));
  await assertSucceeds(setDoc(ref, ownerAccess));
  await assertFails(deleteDoc(ref));
});
it('소유자도 사용자의 허가 문서를 관리자 역할로 만들지 못한다', async () => {
  await assertFails(setDoc(doc(ownerDb(env), `access/${USER}`), grant('user@example.com', { role: 'admin' })));
});
it('허가 문서의 모양이 틀리면 소유자도 쓰지 못한다', async () => {
  const db = ownerDb(env);
  const ref = doc(db, `access/${USER}`);
  const { createdAt: _drop, ...missing } = grant('user@example.com');
  await assertFails(setDoc(ref, missing));
  await assertFails(setDoc(ref, grant('user@example.com', { extra: 1 })));
  await assertFails(setDoc(ref, grant('')));
  await assertFails(setDoc(ref, grant('user@example.com', { disabled: 'no' })));
  await assertFails(setDoc(ref, grant('user@example.com', { createdAt: 'today' })));
  await assertFails(setDoc(ref, grant('user@example.com', { role: 'owner' })));
  await assertFails(setDoc(ref, grant('a'.repeat(321))));
  await assertFails(setDoc(ref, grant('user@example.com', { email: 42 })));
  await assertSucceeds(setDoc(ref, grant('user@example.com')));
});
it('로그인하지 않으면 사용 허가 문서를 읽지 못한다', async () => {
  await seedDocs(env, { [`access/${USER}`]: grant('user@example.com') });
  const db = anonDb(env);
  await assertFails(getDoc(doc(db, `access/${USER}`)));
  await assertFails(getDocs(collection(db, 'access')));
});
