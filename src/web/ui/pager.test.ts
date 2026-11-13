import { afterEach, expect, it, vi } from 'vitest';
import { shiftMonth } from '../../core/dates';
import { CENTER, createPager, nearestSlot, SLOTS, type PagerEnv } from './pager';

const S = CENTER * 400; // 폭 400에서 가운데 칸의 스크롤 위치

function setup(neighbours: 0 | 1 = 1, env: PagerEnv = {}) {
  const fill = vi.fn((grid: HTMLElement, anchor: string) => {
    grid.dataset.anchor = anchor;
  });
  const onCurrent = vi.fn();
  const pager = createPager(
    { anchor: '2026-11', neighbours, step: shiftMonth, fill, onCurrent },
    { width: () => 400, reducedMotion: () => false, assist: false, observeResize: () => () => {}, ...env },
  );
  const scrollTo = vi.spyOn(pager.el, 'scrollTo').mockImplementation(() => {});
  const scroll = (left: number) => {
    pager.el.scrollLeft = left;
    pager.el.dispatchEvent(new Event('scroll'));
  };
  const touch = (type: string, count: number, target: EventTarget = pager.el) =>
    target.dispatchEvent(new TouchEvent(type, { bubbles: true, touches: Array.from({ length: count }, () => ({}) as Touch) }));
  const slots = [...pager.el.children];
  const grids = () =>
    [...pager.el.querySelectorAll<HTMLElement>('.grid')].map((g) => ({
      slot: slots.indexOf(g.parentElement!),
      anchor: g.dataset.anchor,
      current: g.classList.contains('current'),
      inert: g.hasAttribute('inert'),
    }));
  return { pager, fill, onCurrent, scrollTo, scroll, touch, grids };
}
const smooth = (slot: number) => ({ left: slot * 400, behavior: 'smooth' });

afterEach(() => {
  vi.useRealTimers();
});

it('스크롤 위치에서 가장 가까운 칸을 고르고 양 끝에서 자른다', () => {
  expect([nearestSlot(480000, 400), nearestSlot(480199, 400), nearestSlot(480200, 400)]).toEqual([1200, 1200, 1201]);
  expect([nearestSlot(-50, 400), nearestSlot(1e9, 400)]).toEqual([0, 2400]);
});
it('지금 쪽과 양옆 쪽을 칸에 붙이고, 지금 쪽만 누를 수 있다', () => {
  const { pager, grids } = setup();
  expect(pager.el.children).toHaveLength(SLOTS);
  expect(grids()).toEqual([
    { slot: 1199, anchor: '2026-10', current: false, inert: true },
    { slot: 1200, anchor: '2026-11', current: true, inert: false },
    { slot: 1201, anchor: '2026-12', current: false, inert: true },
  ]);
  expect([pager.anchor(), pager.anchors(), pager.current().dataset.anchor]).toEqual(['2026-11', ['2026-10', '2026-11', '2026-12'], '2026-11']);
  pager.place();
  expect(pager.el.scrollLeft).toBe(1200 * 400);
});
it('옆 쪽을 붙이지 않으면 칸 하나에 쪽 하나만 있고 폭과 상관없이 스크롤 위치는 0이며, 다음으로 가면 그 자리에서 바로 바뀐다', () => {
  let width = 400;
  const { pager, fill, onCurrent, scrollTo, scroll, grids } = setup(0, { width: () => width });
  expect(pager.el.children).toHaveLength(1);
  pager.place();
  expect([grids(), pager.el.scrollLeft]).toEqual([[{ slot: 0, anchor: '2026-11', current: true, inert: false }], 0]);
  width = 800.4;
  scroll(0);
  pager.place();
  expect(pager.el.scrollLeft).toBe(0);
  const grid = pager.current();
  fill.mockClear();
  pager.go(1);
  expect([pager.anchor(), fill.mock.calls, onCurrent.mock.calls]).toEqual(['2026-12', [[grid, '2026-12']], [['2026-12']]]);
  pager.jump('2027-05');
  expect([grids(), pager.el.scrollLeft, fill.mock.lastCall]).toEqual([[{ slot: 0, anchor: '2027-05', current: true, inert: false }], 0, [grid, '2027-05']]);
  expect(scrollTo).not.toHaveBeenCalled();
});
it('반을 넘게 스크롤하면 다음 쪽이 지금 쪽이 되고, 새로 붙는 쪽만 그린다', () => {
  const { pager, fill, onCurrent, scroll, grids } = setup();
  pager.place();
  const middle = pager.current();
  fill.mockClear();
  scroll(S + 201);
  expect(pager.anchor()).toBe('2026-12');
  expect(onCurrent.mock.calls).toEqual([['2026-12']]);
  expect(grids()).toEqual([
    { slot: 1200, anchor: '2026-11', current: false, inert: true },
    { slot: 1201, anchor: '2026-12', current: true, inert: false },
    { slot: 1202, anchor: '2027-01', current: false, inert: true },
  ]);
  expect(fill.mock.calls).toEqual([[expect.any(HTMLElement), '2027-01']]);
  expect(fill.mock.calls[0][0]).not.toBe(middle);
});
it('자리를 잡기 전의 스크롤은 무시한다', () => {
  const { pager, onCurrent, scroll } = setup();
  scroll(S + 201);
  expect([pager.anchor(), onCurrent.mock.calls.length]).toEqual(['2026-11', 0]);
});
it('폭이 바뀌면 쪽을 바꾸지 않고 지금 칸에 다시 맞춘다', () => {
  let width = 400;
  let resized = () => {};
  const { pager, onCurrent, scroll } = setup(1, {
    width: () => width,
    observeResize: (_el, cb) => {
      resized = cb;
      return () => {};
    },
  });
  pager.place();
  width = 800;
  scroll(S); // 폭이 바뀐 뒤에 옛 위치로 오는 스크롤
  expect([pager.anchor(), pager.el.scrollLeft, onCurrent.mock.calls.length]).toEqual(['2026-11', 1200 * 800, 0]);
  width = 600;
  resized();
  expect([pager.anchor(), pager.el.scrollLeft]).toEqual(['2026-11', 1200 * 600]);
});
it('다음 단추는 한 칸을 부드럽게 스크롤하고, 멈추기 전에 또 누르면 한 칸 더 간다', () => {
  vi.useFakeTimers();
  const { pager, scrollTo } = setup();
  pager.place();
  pager.go(1);
  expect(scrollTo).toHaveBeenLastCalledWith(smooth(1201));
  pager.go(1);
  expect(scrollTo).toHaveBeenLastCalledWith(smooth(1202));
  vi.advanceTimersByTime(150);
  pager.go(1);
  expect(scrollTo).toHaveBeenLastCalledWith(smooth(1201));
});
it('동작 줄이기에서는 단추가 쪽을 바로 바꾼다', () => {
  const { pager, scrollTo } = setup(1, { reducedMotion: () => true });
  pager.place();
  pager.go(1);
  expect(pager.anchor()).toBe('2026-12');
  expect(scrollTo).not.toHaveBeenCalled();
});
it('바로 가기는 붙은 쪽을 모두 다시 그리고, 끝에 가까우면 가운데 칸으로 돌아온다', () => {
  const { pager, fill, onCurrent, scroll, grids } = setup();
  pager.place();
  fill.mockClear();
  pager.jump('2027-05');
  expect(fill.mock.calls.map((c) => c[1])).toEqual(['2027-04', '2027-05', '2027-06']);
  expect([onCurrent.mock.lastCall, pager.el.scrollLeft]).toEqual([['2027-05'], S]);

  pager.go(-1); // 단추로 스크롤하는 중이라 먼 위치(칸 1)도 따라간다
  scroll(400);
  expect(grids().map((g) => g.slot)).toEqual([0, 1, 2]);
  pager.jump('2026-11');
  expect(grids()).toEqual([
    { slot: 1199, anchor: '2026-10', current: false, inert: true },
    { slot: 1200, anchor: '2026-11', current: true, inert: false },
    { slot: 1201, anchor: '2026-12', current: false, inert: true },
  ]);
  expect(pager.el.scrollLeft).toBe(S);
});
it('다시 그리기는 붙은 쪽을 한 번씩 그리고 쪽을 바꾸지 않는다', () => {
  const { pager, fill, onCurrent } = setup();
  pager.place();
  fill.mockClear();
  pager.refresh();
  expect(fill.mock.calls.map((c) => c[1])).toEqual(['2026-10', '2026-11', '2026-12']);
  expect(new Set(fill.mock.calls.map((c) => c[0])).size).toBe(3);
  expect([pager.anchor(), onCurrent.mock.calls.length]).toEqual(['2026-11', 0]);
});
it('손가락이 멈춘 뒤 떼서 브라우저가 넘기지 않으면 끌던 쪽으로 마저 넘긴다', () => {
  vi.useFakeTimers();
  const { pager, scrollTo, scroll, touch } = setup(1, { assist: true });
  pager.place();
  const swipe = (to: number) => {
    pager.el.scrollLeft = S;
    scrollTo.mockClear();
    touch('touchstart', 1);
    pager.el.scrollLeft = to;
    touch('touchend', 0);
  };

  swipe(S + 25);
  scroll(S + 20); // 제자리로 돌아가기 시작했다
  expect(scrollTo.mock.calls).toEqual([[smooth(1201)]]);

  swipe(S + 25);
  scroll(S + 40); // 브라우저가 이어서 넘긴다
  vi.advanceTimersByTime(80);
  expect(scrollTo).not.toHaveBeenCalled();

  swipe(S + 25);
  vi.advanceTimersByTime(80);
  expect(scrollTo.mock.calls).toEqual([[smooth(1201)]]);

  swipe(S + 6);
  vi.advanceTimersByTime(80);
  expect(scrollTo).not.toHaveBeenCalled();

  swipe(S - 25);
  vi.advanceTimersByTime(80);
  expect(scrollTo.mock.calls).toEqual([[smooth(1199)]]);
});
it('도움이 꺼져 있으면 멈췄다 뗀 끌기를 넘기지 않는다', () => {
  vi.useFakeTimers();
  const { pager, scrollTo, scroll, touch } = setup(1, { assist: false });
  pager.place();
  touch('touchstart', 1);
  pager.el.scrollLeft = S + 25;
  touch('touchend', 0);
  scroll(S + 20);
  vi.advanceTimersByTime(80);
  expect(scrollTo).not.toHaveBeenCalled();
});
it('없앤 뒤에는 스크롤에 반응하지 않는다', () => {
  const { pager, onCurrent, scroll } = setup();
  pager.place();
  pager.destroy();
  scroll(S + 201);
  expect([pager.anchor(), onCurrent.mock.calls.length]).toEqual(['2026-11', 0]);
});
it('폭이 조금만 바뀌어도 가운데 칸의 위치가 반 화소 넘게 어긋나면 다시 맞춘다', () => {
  let width = 400;
  let resized = () => {};
  const { pager, onCurrent, scroll } = setup(1, {
    width: () => width,
    observeResize: (_el, cb) => {
      resized = cb;
      return () => {};
    },
  });
  pager.place();
  width = 400.2; // 칸 1200의 위치가 240px 옮겨진다
  scroll(S);
  expect([pager.anchor(), pager.el.scrollLeft, onCurrent.mock.calls.length]).toEqual(['2026-11', 1200 * 400.2, 0]);
  width = 400.4;
  resized();
  expect([pager.anchor(), pager.el.scrollLeft]).toEqual(['2026-11', 1200 * 400.4]);
});
it('폭이 그대로면 크기 알림은 스크롤 위치를 건드리지 않는다', () => {
  let resized = () => {};
  const { pager } = setup(1, {
    observeResize: (_el, cb) => {
      resized = cb;
      return () => {};
    },
  });
  pager.place();
  pager.el.scrollLeft = S + 30; // 손가락이 끄는 중이다
  resized();
  expect(pager.el.scrollLeft).toBe(S + 30);
});
it('단추나 도움이 스크롤하는 중이 아니면 먼 위치를 따라가지 않고 지금 칸으로 되돌린다', () => {
  const { pager, onCurrent, scroll } = setup();
  pager.place();
  scroll(1300 * 400);
  expect([pager.anchor(), pager.el.scrollLeft, onCurrent.mock.calls.length]).toEqual(['2026-11', S, 0]);
  pager.go(1); // 단추로 스크롤하는 중에는 따라간다
  scroll(1300 * 400);
  expect([pager.anchor(), onCurrent.mock.lastCall]).toEqual(['2035-03', ['2035-03']]);
});
it('폭이 없으면 바로 가기가 끝 쪽 칸을 가운데로 옮기지 않는다', () => {
  let width = 400;
  const { pager, onCurrent, scroll, grids } = setup(1, { width: () => width });
  pager.place();
  pager.go(-1);
  scroll(400); // 칸 1
  width = 0;
  pager.jump('2027-05');
  expect(grids().map((g) => [g.slot, g.anchor])).toEqual([[0, '2027-04'], [1, '2027-05'], [2, '2027-06']]);
  expect(onCurrent.mock.lastCall).toEqual(['2027-05']);
});
it('scrollend와 touchstart는 단추로 가던 칸을 잊게 한다', () => {
  const { pager, scrollTo, touch } = setup();
  pager.place();
  pager.go(1);
  pager.el.dispatchEvent(new Event('scrollend'));
  pager.go(1);
  touch('touchstart', 1);
  pager.go(1);
  expect(scrollTo.mock.calls).toEqual([[smooth(1201)], [smooth(1201)], [smooth(1201)]]);
});
it('단추와 바로 가기는 지켜보던 도움을 멈춘다', () => {
  vi.useFakeTimers();
  const { pager, scrollTo, touch } = setup(1, { assist: true });
  pager.place();
  const stoppedSwipe = () => {
    pager.el.scrollLeft = S;
    touch('touchstart', 1);
    pager.el.scrollLeft = S + 25;
    touch('touchend', 0);
    scrollTo.mockClear();
  };
  stoppedSwipe();
  pager.go(1);
  vi.advanceTimersByTime(80);
  expect(scrollTo.mock.calls).toEqual([[smooth(1201)]]); // 단추의 것 하나뿐
  stoppedSwipe();
  pager.jump('2027-01');
  vi.advanceTimersByTime(80);
  expect(scrollTo).not.toHaveBeenCalled();
});
it('끄는 중에 손가락 밑의 요소가 다시 그려져 빠져도 손을 뗀 것을 알고, 한 손짓은 한 번만 처리한다', () => {
  vi.useFakeTimers();
  const { pager, scrollTo, touch } = setup(1, { assist: true });
  pager.place();
  const cellUnderFinger = () => pager.current().appendChild(document.createElement('button'));

  let finger = cellUnderFinger();
  touch('touchstart', 1, finger);
  pager.el.scrollLeft = S + 25;
  finger.remove(); // 쪽이 다시 그려졌다: 나머지 터치 이벤트는 떨어져 나간 칸에만 간다
  touch('touchend', 0, finger);
  vi.advanceTimersByTime(80);
  expect(scrollTo.mock.calls).toEqual([[smooth(1201)]]);

  vi.advanceTimersByTime(200); // 넘긴 뒤의 멈춤 타이머까지 끝낸다
  scrollTo.mockClear();
  pager.el.scrollLeft = S;
  finger = cellUnderFinger();
  touch('touchstart', 1, finger);
  pager.el.scrollLeft = S + 25;
  touch('touchend', 0, finger); // 칸이 받고 거품으로 .pager에도 온다
  expect(vi.getTimerCount()).toBe(1); // 지켜보기는 하나만 시작했다
  vi.advanceTimersByTime(80);
  expect(scrollTo.mock.calls).toEqual([[smooth(1201)]]);
});
