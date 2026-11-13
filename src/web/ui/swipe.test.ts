import { expect, it } from 'vitest';
import { dragOffset, lockAxis, swipeOutcome, velocity } from './swipe';

it('8px을 넘게 움직여야 방향을 정하고, 같으면 세로로 본다', () => {
  expect([lockAxis(5, 2), lockAxis(9, 3), lockAxis(-12, 11), lockAxis(3, 9), lockAxis(10, -10)]).toEqual([null, 'x', 'x', 'y', 'y']);
});
it('폭의 20%를 넘게 끌었거나 같은 쪽으로 빠르게 튕기면 넘긴다', () => {
  expect([swipeOutcome(-81, 400, 0), swipeOutcome(-80, 400, 0), swipeOutcome(90, 400, 0)]).toEqual([1, 0, -1]);
  expect([swipeOutcome(-30, 400, -0.6), swipeOutcome(-30, 400, 0.6), swipeOutcome(-5, 400, -2)]).toEqual([1, 0, 0]);
});
it('속도는 마지막 100ms의 움직임으로 재고, 끄는 거리는 폭을 넘지 않는다', () => {
  expect(velocity([{ x: 0, t: 0 }, { x: -30, t: 50 }, { x: -60, t: 100 }])).toBeCloseTo(-0.6);
  expect(velocity([{ x: 0, t: 0 }, { x: -100, t: 500 }, { x: -110, t: 600 }])).toBeCloseTo(-0.1);
  expect([velocity([{ x: 5, t: 10 }]), dragOffset(-500, 400), dragOffset(30, 400)]).toEqual([0, -400, 30]);
});
