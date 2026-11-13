import { expect, it } from 'vitest';
import type { ConvertedDay } from './convert';
import { planEdits } from './plan';

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
