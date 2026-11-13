import { expect, it, vi } from 'vitest';
import type { DayChange, MonthDoc } from '../core/types';
import { SyncEngine } from './engine';
import { Outbox } from './outbox';
import { FakeMonthStore, MemoryStorage, edit, rec, val } from './testing';

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
it('올린 직후 지운 줄을 다시 써도 사라지지 않는다', async () => {
  const { store, outbox, engine } = setup({ '2026-11': { days: { '13': rec('A\nB') } } });
  store.afterCommit = () => { engine.saveEdit('2026-11', '13', val('A'), val('A\nB')); };
  engine.saveEdit('2026-11', '13', val('A\nB'), val('A'));
  await engine.flush();
  expect(store.docs.get('2026-11')!.days['13'].text).toBe('A\nB');
  expect(outbox.list()).toEqual([]);
});
it('올린 직후 일부를 되돌려도 지운 줄이 살아나지 않는다', async () => {
  const { store, engine } = setup({ '2026-11': { days: { '13': rec('A') } } });
  store.afterCommit = () => { engine.saveEdit('2026-11', '13', val('A\nB'), val('A\nC')); };
  engine.saveEdit('2026-11', '13', val('A'), val('A\nB'));
  await engine.flush();
  expect(store.docs.get('2026-11')!.days['13'].text).toBe('A\nC');
});
it('올린 직후 배경색을 지워도 색이 되살아나지 않는다', async () => {
  const { store, engine, setNow } = setup({ '2026-11': { days: { '13': rec('A') } } });
  store.afterCommit = () => {
    setNow(2000);
    engine.saveEdit('2026-11', '13', val('A', 'F12424'), val('A'));
  };
  engine.saveEdit('2026-11', '13', val('A'), val('A', 'F12424'));
  await engine.flush();
  expect(store.docs.get('2026-11')!.days['13'].color).toBe('');
});
it('서버에 반영됐는데 실패로 알려져도 다시 써서 되돌리지 않는다', async () => {
  const { store, outbox, engine } = setup({ '2026-11': { days: { '13': rec('A\nB') } } });
  store.failAfterCommit.add('2026-11');
  engine.saveEdit('2026-11', '13', val('A\nB'), val('A'));
  await engine.flush();
  expect(store.docs.get('2026-11')!.days['13'].text).toBe('A');
  expect(outbox.list()).toHaveLength(1);
  expect(engine.status().state).toBe('waiting');
  engine.saveEdit('2026-11', '13', val('A'), val('A\nB'));
  store.failAfterCommit.clear();
  await engine.flush();
  expect(store.docs.get('2026-11')!.days['13'].text).toBe('A\nB');
  expect(engine.status().pending).toBe(0);
});
it('decide 뒤에 실패하면 두 편집이 모두 남아 다음에 한 번에 올라간다', async () => {
  const { store, outbox, engine } = setup({ '2026-11': { days: { '13': rec('A') } } });
  store.failAfterDecide.add('2026-11');
  engine.saveEdit('2026-11', '13', val('A'), val('A\nB'));
  await engine.flush();
  expect(store.docs.get('2026-11')!.days['13'].text).toBe('A');
  expect(outbox.list()).toHaveLength(1);
  engine.saveEdit('2026-11', '13', val('A\nB'), val('A\nB\nC'));
  expect(outbox.list()).toHaveLength(2);
  store.failAfterDecide.clear();
  store.calls.length = 0;
  await engine.flush();
  expect(store.docs.get('2026-11')!.days['13'].text).toBe('A\nB\nC');
  expect(engine.status().pending).toBe(0);
  expect(store.calls).toEqual(['2026-11']);
});
it('같은 날짜의 따로 넣은 편집 두 개가 모두 반영된다', async () => {
  const { store, outbox, engine } = setup({ '2026-11': { days: { '13': rec('A') } } });
  outbox.put(edit('2026-11', '13', 'A', 'A\nX', 100));
  outbox.put(edit('2026-11', '13', 'A', 'A\nY', 200));
  await engine.flush();
  expect(store.docs.get('2026-11')!.days['13'].text).toBe('A\nY\nX');
  expect(outbox.list()).toEqual([]);
});
it('올린 달의 변경을 알리고, 실패했거나 바뀐 것이 없으면 알리지 않는다', async () => {
  const { store, outbox, engine } = setup({ '2026-12': { days: { '01': rec('B') } } });
  const seen: [string, Record<string, DayChange>, number][] = [];
  engine.onCommit((monthId, changes) => seen.push([monthId, changes, outbox.list().length]));
  store.failMonths.add('2026-11');
  engine.saveEdit('2026-11', '13', val(''), val('A'));
  await engine.flush();
  expect(seen).toEqual([]);
  store.failMonths.clear();
  await engine.flush();
  expect(seen).toEqual([['2026-11', { '13': { text: 'A', color: '', editedAt: 1000, editedBy: 'pc' } }, 0]]);
  outbox.put(edit('2026-12', '01', '', 'B'));
  await engine.flush();
  expect(seen).toHaveLength(1);
  expect(outbox.list()).toEqual([]);
});
it('트랜잭션이 다시 돌면 마지막 decide의 변경을 알린다', async () => {
  const { store, engine } = setup({ '2026-11': { days: { '13': rec('A\nB') } } });
  const seen: Record<string, DayChange>[] = [];
  engine.onCommit((_monthId, changes) => seen.push(changes));
  store.beforeSecondDecide = () => { store.docs.set('2026-11', { days: { '13': rec('A\nB2', '', 300) } }); };
  engine.saveEdit('2026-11', '13', val('A\nB'), val('A\nB\nC'));
  await engine.flush();
  expect(seen).toEqual([{ '13': { text: 'A\nB2\nC', color: '', editedAt: 1000, editedBy: 'pc' } }]);
});
it('권한 오류로 실패하면 이유를 알리고, 성공하거나 대기열이 비면 지운다', async () => {
  const { store, outbox, engine } = setup();
  store.failMonths.add('2026-11');
  store.failCode = 'permission-denied';
  engine.saveEdit('2026-11', '13', val(''), val('A'));
  await engine.flush();
  expect(engine.status()).toEqual({ state: 'waiting', pending: 1, reason: 'denied' });
  store.failCode = 'unavailable';
  await engine.flush();
  expect(engine.status()).toEqual({ state: 'waiting', pending: 1 });
  store.failCode = 'unauthenticated';
  await engine.flush();
  expect(engine.status().reason).toBe('denied');
  store.failMonths.clear();
  await engine.flush();
  expect(engine.status()).toEqual({ state: 'synced', pending: 0 });

  store.failMonths.add('2026-11');
  store.failCode = 'permission-denied';
  engine.saveEdit('2026-11', '14', val(''), val('B'));
  await engine.flush();
  expect(engine.status().reason).toBe('denied');
  outbox.put(edit('2026-11', '14', 'B', ''));
  expect(outbox.list()).toEqual([]);
  engine.saveEdit('2026-11', '15', val(''), val('C'));
  expect(engine.status().reason).toBeUndefined();
  await engine.flush();
});
it('실패한 뒤 다시 올리는 동안에는 계속 대기로 알린다', async () => {
  const { store, engine } = setup();
  const states: string[] = [];
  engine.subscribe((s) => states.push(s.state));
  store.failMonths.add('2026-11');
  engine.saveEdit('2026-11', '13', val(''), val('A'));
  await engine.flush();
  expect(states).toContain('sending');
  expect(states.at(-1)).toBe('waiting');
  const afterFirstFailure = states.length;
  await engine.flush();
  await engine.flush();
  expect(states.slice(afterFirstFailure)).not.toContain('sending');
  expect(states.at(-1)).toBe('waiting');
  store.failMonths.clear();
  await engine.flush();
  expect(states.at(-1)).toBe('synced');
});
