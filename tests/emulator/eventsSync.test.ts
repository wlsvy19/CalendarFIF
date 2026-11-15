import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { disableNetwork, doc, enableNetwork, getDoc, waitForPendingWrites, type Firestore } from 'firebase/firestore';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { AlarmRecord } from '../../src/core/events';
import { FirestoreEventsSource } from '../../src/sync/firestoreEvents';
import { MemoryStorage } from '../../src/sync/testing';
import { EventsStore, type EventsSource } from '../../src/web/eventsStore';
import { OWNER, createEnv, ownerDb } from './env';

// 알림 문서의 쓰기는 트랜잭션이다: 오래된 보내지 않은 편집이 다른 기기의 더 새 편집을 덮거나, 다른 곳에서 지운 항목을
// 되살리지 않는다. 연결이 없을 때의 쓰기는 SDK의 대기열이 아니라 EventsStore의 보내지 않은 변경이 맡아 다시 보낸다.

let env: RulesTestEnvironment;
let clock = 0;
const opened: EventsStore[] = [];
beforeAll(async () => { env = await createEnv(); });
beforeEach(async () => {
  await env.clearFirestore();
  clock = 1000;
});
afterEach(() => {
  for (const s of opened.splice(0)) s.destroy();
});
afterAll(async () => { await env.cleanup(); });

const KEY = `calfif.eventsPending.${OWNER}`;
const WAIT = { timeout: 5000 };
const alarm = (text: string): AlarmRecord => ({
  type: 'alarm', date: '2026-11-20', text, done: false, repeat: { freq: 'none' },
  time: '09:00', advance: [0], editedAt: 0, editedBy: '',
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 에뮬레이터에 지금 있는 알림 항목(다른 인스턴스로 읽는다). */
async function serverItems(): Promise<Record<string, { text: string; editedAt: number }>> {
  const snap = await getDoc(doc(ownerDb(env), `users/${OWNER}/data/events`));
  return snap.exists() ? (snap.data().items ?? {}) : {};
}

/**
 * 기기 하나(앱 한 번 열기). 같은 기기를 다시 열 때는 storage를 넘긴다.
 * net.online이 false면 쓰기가 연결 없는 트랜잭션처럼 실패한다. 트랜잭션은 disableNetwork를 따르지 않으므로 원본을 감싸서 흉내 낸다.
 */
function device(name: string, storage = new MemoryStorage()): { db: Firestore; net: { online: boolean }; storage: MemoryStorage; store: EventsStore } {
  const db = ownerDb(env);
  const real = new FirestoreEventsSource(db, OWNER);
  const net = { online: true };
  const source: EventsSource = {
    subscribe: (onData, onError) => real.subscribe(onData, onError),
    write: (pending) => (net.online ? real.write(pending) : Promise.reject(Object.assign(new Error('offline'), { code: 'unavailable' }))),
  };
  const store = new EventsStore({ source, storage, uid: OWNER, editedBy: name, now: () => clock });
  opened.push(store);
  return { db, net, storage, store };
}

it('다시 열자마자 보내는 오래된 편집은 그 사이 다른 기기가 쓴 더 새 편집을 덮지 않는다', async () => {
  const pc = device('pc');
  pc.store.save('a1', alarm('처음'));
  await pc.store.flush();

  // 아이폰이 그것을 보고, 연결이 없을 때 고친 뒤 앱을 닫았다.
  clock = 2000;
  const phone = device('iphone');
  await vi.waitFor(() => expect(phone.store.items().a1?.text).toBe('처음'), WAIT);
  phone.net.online = false;
  phone.store.save('a1', alarm('아이폰의 오래된 편집'));
  await expect(phone.store.flush()).rejects.toThrow();
  phone.store.destroy();

  // 그 사이 PC가 더 늦게 고쳤다.
  clock = 3000;
  pc.store.save('a1', alarm('PC의 새 편집'));
  await pc.store.flush();

  // 아이폰을 다시 연다. 저장소에 남은 편집을 스냅숏이 오기 전에 바로 보낸다.
  const again = device('iphone', phone.storage);
  await again.store.flush();
  expect((await serverItems()).a1).toMatchObject({ text: 'PC의 새 편집', editedAt: 3000 });
  expect(phone.storage.getItem(KEY)).toBeNull();
  await vi.waitFor(() => expect(again.store.items().a1?.text).toBe('PC의 새 편집'), WAIT);
});

it('다른 곳에서 지운 항목을 고친 오래된 편집은 그 항목을 되살리지 않는다', async () => {
  const pc = device('pc');
  pc.store.save('a1', alarm('처음'));
  await pc.store.flush();

  clock = 2000;
  const phone = device('iphone');
  await vi.waitFor(() => expect(phone.store.items().a1?.text).toBe('처음'), WAIT);
  phone.net.online = false;
  phone.store.save('a1', alarm('아이폰의 편집'));
  await expect(phone.store.flush()).rejects.toThrow();
  phone.store.destroy();

  clock = 3000;
  pc.store.remove('a1');
  await pc.store.flush();
  expect(await serverItems()).toEqual({});

  const again = device('iphone', phone.storage);
  await again.store.flush();
  expect(await serverItems()).toEqual({});
  expect(phone.storage.getItem(KEY)).toBeNull();
  await vi.waitFor(() => expect(again.store.loaded()).toBe(true), WAIT);
  expect(again.store.items().a1).toBeUndefined();
});

it('이 기기에서 새로 만든 항목은 서버에 없어도 쓴다(문서가 아직 없어도)', async () => {
  const phone = device('iphone');
  await vi.waitFor(() => expect(phone.store.loaded()).toBe(true), WAIT);
  phone.net.online = false;
  phone.store.save('n1', alarm('새 알림'));
  await expect(phone.store.flush()).rejects.toThrow();
  phone.store.destroy();

  const again = device('iphone', phone.storage);
  await again.store.flush();
  expect((await serverItems()).n1).toMatchObject({ text: '새 알림', editedAt: 1000, editedBy: 'iphone' });
  expect(phone.storage.getItem(KEY)).toBeNull();
});

it('연결이 없을 때의 쓰기는 SDK에 쌓이지 않고, 저장소가 남겨 두었다가 다시 보낸다', async () => {
  const phone = device('iphone');
  await vi.waitFor(() => expect(phone.store.loaded()).toBe(true), WAIT);
  await disableNetwork(phone.db); // 기기가 연결을 잃었다(SDK의 대기열을 쓰는 쓰기라면 여기서 쌓인다)
  phone.net.online = false;
  phone.store.save('x1', alarm('오프라인 알림'));
  await expect(phone.store.flush()).rejects.toThrow();
  expect(phone.storage.getItem(KEY)).toContain('오프라인 알림');
  expect(phone.store.items().x1?.text).toBe('오프라인 알림'); // 화면에는 보인다
  // 이 인스턴스의 SDK에는 서버가 받기를 기다리는 쓰기가 없다.
  expect(await Promise.race([waitForPendingWrites(phone.db).then(() => 'none'), sleep(2000).then(() => 'queued')])).toBe('none');

  await enableNetwork(phone.db);
  phone.net.online = true;
  await sleep(500);
  expect((await serverItems()).x1).toBeUndefined(); // 연결이 돌아와도 SDK가 저절로 다시 쓰지 않는다

  await phone.store.flush(); // 브라우저에서는 online 사건과 30초 타이머가 부른다
  expect((await serverItems()).x1).toMatchObject({ text: '오프라인 알림' });
  expect(phone.storage.getItem(KEY)).toBeNull();
});
