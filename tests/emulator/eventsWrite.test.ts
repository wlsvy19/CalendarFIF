import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import type { AlarmRecord } from '../../src/core/events';
import type { PendingChange } from '../../src/sync/eventsDoc';
import { FirestoreEventsSource } from '../../src/sync/firestoreEvents';
import { OWNER, createEnv, ownerDb } from './env';

let env: RulesTestEnvironment;
beforeAll(async () => { env = await createEnv(); });
beforeEach(async () => { await env.clearFirestore(); });
afterAll(async () => { await env.cleanup(); });

const rec = (text: string, repeat: AlarmRecord['repeat'], editedAt = 1): AlarmRecord => ({
  type: 'alarm', date: '2026-11-20', text, done: false, repeat,
  time: '09:00', advance: [0], editedAt, editedBy: 'dev',
});
/** 이 기기에서 만든 항목의 저장(보낼 변경). */
const save = (r: AlarmRecord): PendingChange => ({ change: r, editedAt: r.editedAt, wasNew: true });
const items = async (): Promise<Record<string, any>> => {
  const snap = await getDoc(doc(ownerDb(env), `users/${OWNER}/data/events`));
  return snap.exists() ? (snap.data().items ?? {}) : {};
};

it('항목은 통째로 바뀌어 지운 반복 끝이 남지 않는다', async () => {
  const src = new FirestoreEventsSource(ownerDb(env), OWNER);
  await src.write({ a1: save(rec('가', { freq: 'daily', until: '2026-12-31' }, 1)) });
  expect((await items()).a1.repeat.until).toBe('2026-12-31');
  await src.write({ a1: save(rec('가', { freq: 'daily' }, 2)) });
  expect((await items()).a1.repeat).toEqual({ freq: 'daily' });
});
it('두 항목을 한 번에 쓰고 하나만 지울 수 있다', async () => {
  const src = new FirestoreEventsSource(ownerDb(env), OWNER);
  expect(await src.write({ a1: save(rec('가', { freq: 'none' })), b2: save(rec('나', { freq: 'none' })) })).toEqual({ written: ['a1', 'b2'], dropped: [] });
  expect(Object.keys(await items()).sort()).toEqual(['a1', 'b2']);
  expect(await src.write({ a1: { change: 'delete', editedAt: 2, wasNew: false } })).toEqual({ written: ['a1'], dropped: [] });
  expect(Object.keys(await items())).toEqual(['b2']);
});
