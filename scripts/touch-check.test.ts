import { expect, it } from 'vitest';
import { followsFinger, staysPut, translateX } from './touch-check';

it('transform에서 가로 이동량을 읽는다', () => {
  expect(translateX('translate3d(-120.5px, 0px, 0px)')).toBe(-120.5);
  expect(translateX('translateX(40px)')).toBe(40);
  expect(translateX('')).toBeNull();
});
it('왼쪽으로 끌면 음수, 오른쪽이면 양수여야 따라온 것이다', () => {
  expect(followsFinger(['translate3d(-10px,0,0)', 'translate3d(-90px,0,0)'], 'left')).toBe(true);
  expect(followsFinger(['translate3d(-10px,0,0)'], 'right')).toBe(false);
  expect(followsFinger(['translate3d(30px,0,0)', 'translate3d(200px,0,0)'], 'right')).toBe(true);
});
it('움직이지 않았거나 방향이 섞이면 따라온 것이 아니다', () => {
  expect(followsFinger(['', ''], 'left')).toBe(false);
  expect(followsFinger(['translate3d(-10px,0,0)', 'translate3d(5px,0,0)'], 'left')).toBe(false);
});
it('움직임 줄이기에서는 모든 값이 비어 있어야 한다', () => {
  expect(staysPut(['', ''])).toBe(true);
  expect(staysPut(['', 'translate3d(-5px,0,0)'])).toBe(false);
  expect(staysPut([])).toBe(false);
});
