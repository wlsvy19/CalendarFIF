import { expect, it } from 'vitest';
import type { ConvertedDay } from './convert';
import { checkDeletes, planEdits } from './plan';

const day = (dateKey: string, text: string, color = '', editedAt = 100): [string, ConvertedDay] =>
  [dateKey, { dateKey, value: { text, color }, editedAt }];

it('상태 파일이 없으면 모든 날짜가 base 없는 편집이다', () => {
  expect(planEdits(new Map([day('2026-11-13', 'A', 'F12424')]), null, 999)).toEqual([
    { monthId: '2026-11', day: '13', base: { text: '', color: '' }, next: { text: 'A', color: 'F12424' }, editedAt: 100, hasBase: false },
  ]);
});
it('지난번과 달라진 날짜만 편집으로 만든다', () => {
  const state = { '2026-11-13': { text: 'A', color: '' }, '2026-11-14': { text: 'B', color: '' }, '2026-11-15': { text: 'gone', color: '' } };
  const current = new Map([day('2026-11-13', 'A'), day('2026-11-14', 'B\nC', '', 200)]);
  expect(planEdits(current, state, 999)).toEqual([
    { monthId: '2026-11', day: '14', base: { text: 'B', color: '' }, next: { text: 'B\nC', color: '' }, editedAt: 200, hasBase: true },
    { monthId: '2026-11', day: '15', base: { text: 'gone', color: '' }, next: { text: '', color: '' }, editedAt: 999, hasBase: true },
  ]);
});

function days(n: number): Record<string, { text: string; color: string }> {
  const out: Record<string, { text: string; color: string }> = {};
  for (let i = 0; i < n; i++) {
    const d = new Date(2026, 0, 1 + i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    out[key] = { text: `memo ${i}`, color: '' };
  }
  return out;
}
function without(state: Record<string, { text: string; color: string }>, gone: number) {
  return new Map(Object.entries(state).slice(gone).map(([k, value]) => [k, { dateKey: k, value, editedAt: 1 }] as const));
}

it('사라진 날짜가 많으면 막는다', () => {
  const big = days(120);
  expect(checkDeletes(planEdits(without(big, 12), big, 999), big)).toEqual({ deletes: 12, stateDays: 120, blocked: false });
  expect(checkDeletes(planEdits(without(big, 13), big, 999), big)).toEqual({ deletes: 13, stateDays: 120, blocked: true });
  const small = days(30);
  expect(checkDeletes(planEdits(without(small, 9), small, 999), small)).toEqual({ deletes: 9, stateDays: 30, blocked: false });
  expect(checkDeletes(planEdits(new Map(), days(3), 999), days(3))).toEqual({ deletes: 3, stateDays: 3, blocked: true });
  expect(checkDeletes(planEdits(new Map(), days(2), 999), days(2)).blocked).toBe(false);
  expect(checkDeletes([], null)).toEqual({ deletes: 0, stateDays: 0, blocked: false });
});
