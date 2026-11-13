import { expect, it, vi } from 'vitest';
import type { MonthDoc } from '../core/types';
import { SyncEngine } from './engine';
import { Outbox } from './outbox';
import { FakeMonthStore, MemoryStorage, rec, val } from './testing';

function setup(docs: Record<string, MonthDoc> = {}) {
  const store = new FakeMonthStore(docs);
  const outbox = new Outbox(new MemoryStorage(), 'u1');
  let t = 1000;
  const engine = new SyncEngine({ store, outbox, editedBy: 'pc', now: () => t });
  return { store, outbox, engine, setNow: (n: number) => { t = n; } };
}

it('글을 다듬고, 바뀐 것이 없으면 아무것도 하지 않는다', async () => {
  const { store, outbox, engine } = setup();
  engine.saveEdit('2026-11', '13', val('A'), val('A  \r\n'));
  await engine.flush();
  expect(outbox.list()).toEqual([]);
  expect(store.calls).toEqual([]);
});
it('올리면 서버에 기록되고 대기열이 빈다', async () => {
  const { store, outbox, engine } = setup();
  const states: string[] = [];
  engine.subscribe((s) => states.push(s.state));
  engine.saveEdit('2026-11', '13', val(''), val('A', '#f12424'));
  await engine.flush();
  expect(store.docs.get('2026-11')!.days['13']).toEqual({ text: 'A', color: 'F12424', editedAt: 1000, editedBy: 'pc' });
  expect(outbox.list()).toEqual([]);
  expect(states).toContain('sending');
  expect(engine.status()).toEqual({ state: 'synced', pending: 0 });
});
it('달마다 트랜잭션을 한 번만 쓴다', async () => {
  const { store, engine } = setup();
  engine.saveEdit('2026-11', '13', val(''), val('A'));
  engine.saveEdit('2026-11', '14', val(''), val('B'));
  engine.saveEdit('2026-12', '01', val(''), val('C'));
  await Promise.all([engine.flush(), engine.flush()]);
  expect([...store.calls].sort()).toEqual(['2026-11', '2026-12']);
});
it('올리다 실패한 편집은 남고 다음에 다시 올라간다', async () => {
  const { store, outbox, engine } = setup({ '2026-12': { days: { '01': rec('A') } } });
  store.failMonths.add('2026-12');
  engine.saveEdit('2026-11', '13', val(''), val('X'));
  engine.saveEdit('2026-12', '01', val('A'), val('A\nB'));
  await engine.flush();
  expect(outbox.list().map((e) => e.monthId)).toEqual(['2026-12']);
  expect(engine.status()).toEqual({ state: 'waiting', pending: 1 });
  store.failMonths.clear();
  await engine.flush();
  expect(store.docs.get('2026-12')!.days['01'].text).toBe('A\nB');
  expect(engine.status()).toEqual({ state: 'synced', pending: 0 });
});
it('트랜잭션이 다시 실행되면 마지막 서버 값 기준으로 쓴다', async () => {
  const { store, engine } = setup({ '2026-11': { days: { '13': rec('A\nB') } } });
  store.beforeSecondDecide = () => { store.docs.set('2026-11', { days: { '13': rec('A\nB2', '', 300) } }); };
  engine.saveEdit('2026-11', '13', val('A\nB'), val('A\nB\nC'));
  await engine.flush();
  expect(store.docs.get('2026-11')!.days['13'].text).toBe('A\nB2\nC');
});
it('올리는 도중에 같은 날짜를 또 고쳐도 줄이 겹치지 않는다', async () => {
  const { store, engine, setNow } = setup({ '2026-11': { days: { '13': rec('A') } } });
  let release!: () => void;
  store.hold = new Promise<void>((resolve) => { release = resolve; });
  engine.saveEdit('2026-11', '13', val('A'), val('A\nB'));
  await vi.waitFor(() => expect(store.calls).toEqual(['2026-11']));   // 첫 올리기가 진행 중인 상태
  setNow(2000);
  engine.saveEdit('2026-11', '13', val('A\nB'), val('A\nB\nC'));
  store.hold = undefined;
  release();
  await engine.flush();
  expect(store.docs.get('2026-11')!.days['13'].text).toBe('A\nB\nC');
  expect(engine.status().pending).toBe(0);
});
