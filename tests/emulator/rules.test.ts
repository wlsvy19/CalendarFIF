import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, it } from 'vitest';
import { OWNER, anonDb, createEnv, otherDb, ownerDb } from './env';

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
