import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import type { DayChange, MonthDoc } from '../../src/core/types';
import { SyncEngine, type MonthStore } from '../../src/sync/engine';
import { FirestoreMonthStore } from '../../src/sync/firestoreStore';
import { Outbox } from '../../src/sync/outbox';
import { MemoryStorage, rec, val } from '../../src/sync/testing';
import { OWNER, createEnv, ownerDb } from './env';

let env: RulesTestEnvironment;
beforeAll(async () => { env = await createEnv(); });
beforeEach(async () => { await env.clearFirestore(); });
afterAll(async () => { await env.cleanup(); });

function device(name: string) {
  const real = new FirestoreMonthStore(ownerDb(env), OWNER);
  const net = { online: true };
  const store: MonthStore = {
    transactMonth: (monthId: string, decide: (server: MonthDoc | null) => Record<string, DayChange>) =>
      net.online ? real.transactMonth(monthId, decide) : Promise.reject(new Error('offline')),
  };
  const engine = new SyncEngine({ store, outbox: new Outbox(new MemoryStorage(), OWNER), editedBy: name });
  return { real, net, engine };
}

it('오프라인에서 추가한 줄과 다른 기기의 수정이 합쳐진다', async () => {
  const pc = device('pc');
  const phone = device('iphone');
  await pc.real.transactMonth('2026-11', () => ({ '13': rec('A\nB', '', 1, 'pc') }));

  phone.net.online = false;
  phone.engine.saveEdit('2026-11', '13', val('A\nB'), val('A\nB\nC'));
  await phone.engine.flush();
  expect(phone.engine.status()).toEqual({ state: 'waiting', pending: 1 });

  pc.engine.saveEdit('2026-11', '13', val('A\nB'), val('A\nB2'));
  await pc.engine.flush();

  phone.net.online = true;
  await phone.engine.flush();

  let final: MonthDoc | null = null;
  await pc.real.transactMonth('2026-11', (server) => { final = server; return {}; });
  expect(final!.days['13'].text).toBe('A\nB2\nC');
  expect(phone.engine.status()).toEqual({ state: 'synced', pending: 0 });
});
