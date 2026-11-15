import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import type { AlarmRecord } from '../../src/core/events';
import { FirestoreEventsSource } from '../../src/sync/firestoreEvents';
import { OWNER, createEnv, ownerDb } from './env';

let env: RulesTestEnvironment;
beforeAll(async () => { env = await createEnv(); });
beforeEach(async () => { await env.clearFirestore(); });
afterAll(async () => { await env.cleanup(); });

const rec = (text: string, repeat: AlarmRecord['repeat']): AlarmRecord => ({
  type: 'alarm', date: '2026-11-20', text, done: false, repeat,
  time: '09:00', advance: [0], editedAt: 1, editedBy: 'dev',
});
const items = async (): Promise<Record<string, any>> => {
  const snap = await getDoc(doc(ownerDb(env), `users/${OWNER}/data/events`));
  return snap.exists() ? (snap.data().items ?? {}) : {};
};

it('항목은 통째로 바뀌어 지운 반복 끝이 남지 않는다', async () => {
  const src = new FirestoreEventsSource(ownerDb(env), OWNER);
  await src.write({ a1: rec('가', { freq: 'daily', until: '2026-12-31' }) });
  expect((await items()).a1.repeat.until).toBe('2026-12-31');
  await src.write({ a1: rec('가', { freq: 'daily' }) });
  expect((await items()).a1.repeat).toEqual({ freq: 'daily' });
});
it('두 항목을 한 번에 쓰고 하나만 지울 수 있다', async () => {
  const src = new FirestoreEventsSource(ownerDb(env), OWNER);
  await src.write({ a1: rec('가', { freq: 'none' }), b2: rec('나', { freq: 'none' }) });
  expect(Object.keys(await items()).sort()).toEqual(['a1', 'b2']);
  await src.write({ a1: 'delete' });
  expect(Object.keys(await items())).toEqual(['b2']);
});
