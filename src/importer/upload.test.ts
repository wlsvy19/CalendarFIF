import { expect, it, vi } from 'vitest';
import type { DayValue } from '../core/types';
import { FakeMonthStore, rec } from '../sync/testing';
import type { ConvertedDay } from './convert';
import type { ImportEdit } from './plan';
import { decideImport, uploadEdits, verifyAgainstCloud } from './upload';

const v = (text: string, color = ''): DayValue => ({ text, color });
const ie = (day: string, base: DayValue, next: DayValue, editedAt: number, hasBase: boolean, monthId = '2026-11'): ImportEdit =>
  ({ monthId, day, base, next, editedAt, hasBase });

it('지난번 값이 있으면 병합 규칙으로 올린다', () => {
  const server = { days: { '13': rec('A\nP', '', 500, 'iphone') } };
  expect(decideImport([ie('13', v('A'), v('A\nB'), 300, true)], server))
    .toEqual({ '13': { text: 'A\nB\nP', color: '', editedAt: 500, editedBy: 'import' } });
});
it('지난번 값이 없으면 수정 시각이 더 늦을 때만 덮어쓴다', () => {
  const fresh = [ie('13', v(''), v('A'), 300, false)];
  expect(decideImport(fresh, null)).toEqual({ '13': { text: 'A', color: '', editedAt: 300, editedBy: 'import' } });
  expect(decideImport(fresh, { days: { '13': rec('A', '', 1) } })).toEqual({});
  expect(decideImport(fresh, { days: { '13': rec('old', '', 200) } })).toEqual({ '13': { text: 'A', color: '', editedAt: 300, editedBy: 'import' } });
  expect(decideImport(fresh, { days: { '13': rec('newer', '', 400) } })).toEqual({});
});
it('휴대폰에서만 적은 날짜에 DesktopCal 글이 생기면 둘 다 남는다', () => {
  const server = { days: { '13': rec('PHONE', 'F12424', 200, 'iphone') } };
  expect(decideImport([ie('13', v(''), v('DC'), 300, true)], server))
    .toEqual({ '13': { text: 'PHONE\nDC', color: 'F12424', editedAt: 300, editedBy: 'import' } });
});
it('base 없이 건너뛴 날짜는 기록 대상에서 빠진다', async () => {
  const store = new FakeMonthStore({ '2026-11': { days: { '13': rec('newer', '', 400), '14': rec('B', '', 1) } } });
  const edits = [ie('13', v(''), v('A'), 300, false), ie('14', v(''), v('B'), 300, false), ie('15', v(''), v('C'), 300, false)];
  const recorded: string[] = [];
  await uploadEdits(store, edits, (_m, done) => recorded.push(...done.map((e) => e.day)));
  expect(recorded).toEqual(['14', '15']);
  expect(store.docs.get('2026-11')!.days['13'].text).toBe('newer');
});
it('트랜잭션이 다시 돌면 마지막에 본 서버 값으로 기록 대상을 정한다', async () => {
  const store = new FakeMonthStore({ '2026-11': { days: { '13': rec('newer', '', 400) } } });
  store.beforeSecondDecide = () => { store.docs.set('2026-11', { days: {} }); };
  const recorded: string[] = [];
  await uploadEdits(store, [ie('13', v(''), v('A'), 300, false)], (_m, done) => recorded.push(...done.map((e) => e.day)));
  expect(recorded).toEqual(['13']);
  expect(store.docs.get('2026-11')!.days['13'].text).toBe('A');
});
it('달마다 한 번씩 올리고, 끊기면 다시 돌려 이어서 끝낸다', async () => {
  const store = new FakeMonthStore();
  const edits = [ie('13', v(''), v('A'), 1, false), ie('14', v(''), v('B'), 1, false), ie('01', v(''), v('C'), 1, false, '2026-12')];
  const done = vi.fn();
  store.failMonths.add('2026-12');
  await expect(uploadEdits(store, edits, done)).rejects.toThrow();
  expect(done).toHaveBeenCalledTimes(1);
  expect(done.mock.calls[0][0]).toBe('2026-11');
  store.failMonths.clear();
  expect(await uploadEdits(store, edits, done)).toEqual({ months: 2, days: 3 });
  expect(store.docs.get('2026-11')!.days['13'].text).toBe('A');
  expect(store.docs.get('2026-12')!.days['01'].text).toBe('C');
});
it('쓴 뒤에 실패로 보고된 달을 다시 돌려도 줄이 겹치지 않는다', async () => {
  const store = new FakeMonthStore({ '2026-11': { days: { '13': rec('A\nP', '', 500, 'iphone') } } });
  const edits = [ie('13', v('A'), v('A\nB'), 300, true)];
  store.failAfterCommit.add('2026-11');
  await expect(uploadEdits(store, edits, () => {})).rejects.toThrow();
  expect(store.docs.get('2026-11')!.days['13'].text).toBe('A\nB\nP');
  store.failAfterCommit.clear();
  expect(await uploadEdits(store, edits, () => {})).toEqual({ months: 1, days: 1 });
  expect(store.docs.get('2026-11')!.days['13'].text).toBe('A\nB\nP');
});
it('원본과 클라우드를 날짜별로 대조한다', async () => {
  const days = new Map<string, ConvertedDay>([
    ['2026-11-13', { dateKey: '2026-11-13', value: v('A'), editedAt: 1 }],
    ['2026-11-14', { dateKey: '2026-11-14', value: v('B'), editedAt: 1 }],
    ['2026-12-01', { dateKey: '2026-12-01', value: v('C'), editedAt: 1 }],
  ]);
  const docs: Record<string, { days: Record<string, ReturnType<typeof rec>> }> = { '2026-11': { days: { '13': rec('A'), '14': rec('B\nextra') } } };
  const store = { getMonth: async (monthId: string) => docs[monthId] ?? null };
  expect(await verifyAgainstCloud(store, days)).toEqual({
    source: 3, same: 1, different: 1, missing: 1, differentDates: ['2026-11-14'], missingDates: ['2026-12-01'],
  });
});
