import { expect, it } from 'vitest';
import { buildMonthPatch } from './monthDoc';
import { rec } from './testing';

const sentinels = { deleteField: () => 'DEL', serverTimestamp: () => 'NOW' };

it('바꿀 것이 없으면 null이다', () => {
  expect(buildMonthPatch({}, sentinels)).toBeNull();
});
it('쓸 날짜와 지울 날짜를 한 번에 담는다', () => {
  expect(buildMonthPatch({ '13': rec('A', 'F12424', 100, 'pc'), '14': 'delete' }, sentinels)).toEqual({
    days: { '13': { text: 'A', color: 'F12424', editedAt: 100, editedBy: 'pc' }, '14': 'DEL' },
    updatedAt: 'NOW',
  });
});
