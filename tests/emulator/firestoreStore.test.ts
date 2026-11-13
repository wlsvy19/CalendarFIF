import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { getDoc, type Firestore } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { MonthDoc } from '../../src/core/types';
import { FirestoreMonthStore, monthDocRef } from '../../src/sync/firestoreStore';
import { parseMonthDoc } from '../../src/sync/monthDoc';
import { rec } from '../../src/sync/testing';
import { OWNER, createEnv, ownerDb } from './env';

let env: RulesTestEnvironment;
let db: Firestore;
let store: FirestoreMonthStore;
beforeAll(async () => { env = await createEnv(); });
beforeEach(async () => {
  await env.clearFirestore();
  db = ownerDb(env);
  store = new FirestoreMonthStore(db, OWNER);
});
afterAll(async () => { await env.cleanup(); });

const snap = (monthId: string) => getDoc(monthDocRef(db, OWNER, monthId));

it('없는 달 문서에 날짜를 쓰면 문서가 생긴다', async () => {
  await store.transactMonth('2026-11', (server) => {
    expect(server).toBeNull();
    return { '13': rec('A', 'F12424', 100, 'pc') };
  });
  const data = (await snap('2026-11')).data()!;
  expect(data.days['13']).toEqual({ text: 'A', color: 'F12424', editedAt: 100, editedBy: 'pc' });
  expect(data.updatedAt).toBeDefined();
});
it('delete는 그 날짜만 지운다', async () => {
  await store.transactMonth('2026-11', () => ({ '13': rec('A'), '14': rec('B') }));
  await store.transactMonth('2026-11', (server) => {
    expect(Object.keys(server!.days).sort()).toEqual(['13', '14']);
    return { '13': 'delete' };
  });
  expect(Object.keys((await snap('2026-11')).data()!.days)).toEqual(['14']);
});
it('바꿀 것이 없으면 문서를 만들지 않는다', async () => {
  await store.transactMonth('2026-11', () => ({}));
  expect((await snap('2026-11')).exists()).toBe(false);
});
it('형식이 다른 문서도 읽는다', () => {
  expect(parseMonthDoc(undefined)).toEqual({ days: {} });
  expect(parseMonthDoc({ days: { '13': { text: 'A' }, '14': 'x' } }))
    .toEqual({ days: { '13': { text: 'A', color: '', editedAt: 0, editedBy: '' } } });
});
it('다른 기기가 쓴 내용이 5초 안에 구독자에게 온다', async () => {
  const other = new FirestoreMonthStore(ownerDb(env), OWNER);
  const seen: (MonthDoc | null)[] = [];
  const stop = store.subscribeMonth('2026-11', (doc) => seen.push(doc));
  await vi.waitFor(() => expect(seen).toHaveLength(1));
  expect(seen[0]).toBeNull();
  const started = Date.now();
  await other.transactMonth('2026-11', () => ({ '13': rec('A') }));
  await vi.waitFor(() => expect(seen.at(-1)?.days['13']?.text).toBe('A'), { timeout: 5000 });
  expect(Date.now() - started).toBeLessThan(5000);
  stop();
});
