import { expect, it } from 'vitest';
import { between, followsFinger, monthDelta, onSlot } from './touch-check';

it('손가락을 왼쪽으로 밀면 스크롤 위치가 커지는 쪽으로만 가야 따라간 것이다', () => {
  expect(followsFinger([1010, 1100, 1100, 1250], 1000, 'left')).toBe(true);
  expect(followsFinger([990, 900, 780], 1000, 'right')).toBe(true);
  expect(followsFinger([1010, 1100, 1090, 1250], 1000, 'left')).toBe(false); // 한 걸음 거꾸로 갔다
  expect(followsFinger([1010, 1150], 1000, 'left')).toBe(false); // 200px을 못 갔다
  expect(followsFinger([1010, 1250], 1000, 'right')).toBe(false);
  expect(followsFinger([], 1000, 'left')).toBe(false);
});
it('스크롤 위치가 칸의 시작에 맞는지 본다', () => {
  expect([onSlot(482400, 402), onSlot(482400.33, 402), onSlot(482401, 402), onSlot(482602, 402)]).toEqual([true, true, false, false]);
  expect(onSlot(0, 0)).toBe(false);
});
it('두 위치 사이에 적힌 중간 위치를 센다', () => {
  expect(between([100, 150, 250, 380, 400], 100, 400)).toBe(3);
  expect(between([400, 300, 100], 400, 100)).toBe(1);
  expect(between([], 100, 400)).toBe(0);
});
it('제목 두 개 사이의 달 수를 센다', () => {
  expect([monthDelta('2026년 11월', '2026년 12월'), monthDelta('2026년 12월', '2027년 1월'), monthDelta('2026년 11월', '2026년 9월')]).toEqual([1, 1, -2]);
  expect(monthDelta('', '2026년 1월')).toBeNull();
});
