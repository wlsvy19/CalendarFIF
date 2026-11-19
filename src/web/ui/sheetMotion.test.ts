import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { dismiss, exitMotion, exitTravel, noteReleaseVelocity, translateYOf } from './sheetMotion';

function build() {
  const scrim = document.createElement('div');
  const sheet = document.createElement('div');
  sheet.setAttribute('aria-labelledby', 'sheetTitle');
  sheet.innerHTML = '<h3 id="sheetTitle"></h3><textarea id="memoInput"></textarea>';
  document.body.append(scrim, sheet);
  let finish: () => void = () => {};
  const finished = new Promise<void>((r) => (finish = r));
  const calls: string[] = [];
  (sheet as unknown as { animate: unknown }).animate = vi.fn(() => {
    calls.push('sheet');
    return { finished };
  });
  (scrim as unknown as { animate: unknown }).animate = vi.fn(() => {
    calls.push('scrim');
    return { finished: new Promise(() => {}) };
  });
  return { scrim, sheet, finish };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

it('animate가 false이면 둘 다 바로 없앤다', () => {
  const { scrim, sheet } = build();
  dismiss(scrim, sheet, { animate: false });
  expect(scrim.isConnected).toBe(false);
  expect(sheet.isConnected).toBe(false);
});
it('animate가 true이면 나가는 동안 남겨 두고 inert로 만들며 안의 id를 지운다', () => {
  const { scrim, sheet } = build();
  dismiss(scrim, sheet, { animate: true });
  expect(scrim.isConnected).toBe(true);
  expect(sheet.isConnected).toBe(true);
  expect(scrim.hasAttribute('inert')).toBe(true);
  expect(sheet.hasAttribute('inert')).toBe(true);
  expect(sheet.querySelectorAll('[id]')).toHaveLength(0);
  expect(sheet.hasAttribute('aria-labelledby')).toBe(false);
  expect((sheet as unknown as { animate: ReturnType<typeof vi.fn> }).animate.mock.calls[0][1]).toMatchObject({ duration: 260, fill: 'forwards' });
  expect((sheet as unknown as { animate: ReturnType<typeof vi.fn> }).animate.mock.calls[0][0]).toEqual([{ transform: 'translateY(0)' }, { transform: 'translateY(100%)' }]);
  expect((scrim as unknown as { animate: ReturnType<typeof vi.fn> }).animate.mock.calls[0][0]).toEqual([{ opacity: '1' }, { opacity: 0 }]);
  expect(sheet.style.animation).toBe('none');
  expect(sheet.style.pointerEvents).toBe('none');
  expect(scrim.style.pointerEvents).toBe('none');
});
it('시트의 움직임이 끝나면 둘 다 없앤다', async () => {
  const { scrim, sheet, finish } = build();
  dismiss(scrim, sheet, { animate: true });
  finish();
  await vi.advanceTimersByTimeAsync(0);
  expect(scrim.isConnected).toBe(false);
  expect(sheet.isConnected).toBe(false);
});
it('끝났다는 알림이 오지 않아도 400ms 뒤에 없앤다', () => {
  const { scrim, sheet } = build();
  dismiss(scrim, sheet, { animate: true });
  vi.advanceTimersByTime(399);
  expect(sheet.isConnected).toBe(true);
  vi.advanceTimersByTime(1);
  expect(scrim.isConnected).toBe(false);
  expect(sheet.isConnected).toBe(false);
});
it('두 번 부르거나 늦게 끝나도 오류가 없다', async () => {
  const { scrim, sheet, finish } = build();
  dismiss(scrim, sheet, { animate: true });
  dismiss(scrim, sheet, { animate: true });
  vi.advanceTimersByTime(400);
  finish();
  await vi.advanceTimersByTimeAsync(0);
  expect(sheet.isConnected).toBe(false);
});
it('happy-dom에서는 기본값이 움직이지 않는다', () => {
  const { scrim, sheet } = build();
  dismiss(scrim, sheet);
  expect(sheet.isConnected).toBe(false);
});

function stubMedia(matches: Record<string, boolean>) {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: matches[q] ?? false }));
}
const NARROW = '(max-width: 879.98px)';
const REDUCED = '(prefers-reduced-motion: reduce)';

it('기본값: 좁은 화면이고 움직임 줄이기가 아니며 desk가 아니면 움직인다', () => {
  stubMedia({ [NARROW]: true });
  const { scrim, sheet } = build();
  dismiss(scrim, sheet);
  expect(sheet.isConnected).toBe(true);
  vi.unstubAllGlobals();
});
it('기본값: 움직임 줄이기이면 바로 없앤다', () => {
  stubMedia({ [NARROW]: true, [REDUCED]: true });
  const { scrim, sheet } = build();
  dismiss(scrim, sheet);
  expect(sheet.isConnected).toBe(false);
  vi.unstubAllGlobals();
});
it('기본값: html에 desk가 있으면 바로 없앤다', () => {
  stubMedia({ [NARROW]: true });
  document.documentElement.classList.add('desk');
  const { scrim, sheet } = build();
  dismiss(scrim, sheet);
  expect(sheet.isConnected).toBe(false);
  document.documentElement.classList.remove('desk');
  vi.unstubAllGlobals();
});
it('기본값: 넓은 창이면 바로 없앤다', () => {
  stubMedia({ [NARROW]: false });
  const { scrim, sheet } = build();
  dismiss(scrim, sheet);
  expect(sheet.isConnected).toBe(false);
  vi.unstubAllGlobals();
});

it('들어오는 중이면 지금 값에서 내려가기 시작한다', () => {
  vi.stubGlobal('getComputedStyle', (el: HTMLElement) => (el === document.body ? {} : { transform: 'matrix(1, 0, 0, 1, 0, 140)', opacity: '0.4' }));
  const { scrim, sheet } = build();
  dismiss(scrim, sheet, { animate: true });
  expect((sheet as unknown as { animate: ReturnType<typeof vi.fn> }).animate.mock.calls[0][0][0]).toEqual({ transform: 'matrix(1, 0, 0, 1, 0, 140)' });
  expect((scrim as unknown as { animate: ReturnType<typeof vi.fn> }).animate.mock.calls[0][0][0]).toEqual({ opacity: '0.4' });
  vi.unstubAllGlobals();
});

it('계산된 transform에서 세로 이동을 읽는다', () => {
  expect(translateYOf('matrix(1, 0, 0, 1, 0, 140)')).toBe(140);
  expect(translateYOf('matrix(1, 0, 0, 1, 0, -12.5)')).toBe(-12.5);
  expect(translateYOf('matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 96, 0, 1)')).toBe(96);
  expect(translateYOf('none')).toBe(0);
  expect(translateYOf('')).toBe(0);
  expect(translateYOf(undefined)).toBe(0);
});
it('나가는 시간은 남은 거리에 비례해 짧아지되 260ms의 45%보다 짧지 않다', () => {
  expect(exitMotion(0, 800)).toEqual({ duration: 260, easing: 'cubic-bezier(0.4, 0, 1, 1)' });
  expect(exitMotion(400, 800).duration).toBe(130);
  expect(exitMotion(700, 800).duration).toBe(117);
  expect(exitMotion(900, 800).duration).toBe(117);
  expect(exitMotion(140, 0)).toEqual({ duration: 260, easing: 'cubic-bezier(0.4, 0, 1, 1)' }); // 높이를 모르면 전과 같다
});
it('놓을 때의 속도가 있으면 그 속도로 내려가기 시작한다', () => {
  // 60px 내려간 시트를 1.2px/ms로 놓았다: 남은 740px을 241ms에(평균 3.07px/ms), 처음 기울기 1.2 / 3.07
  const flick = exitMotion(60, 800, 1.2);
  expect(flick.duration).toBe(241);
  expect(flick.easing).toBe('cubic-bezier(0.4, 0.156, 1, 1)');
  // 평균보다 빠르게 놓았으면 그 속도에 맞게 더 짧아지고 곧은 선이 된다
  expect(exitMotion(100, 800, 5)).toEqual({ duration: 140, easing: 'cubic-bezier(0.4, 0.4, 1, 1)' });
});
it('적어 둔 놓은 속도는 다음 dismiss가 한 번 쓴다', () => {
  const { scrim, sheet } = build();
  Object.defineProperty(sheet, 'offsetHeight', { value: 800 });
  vi.stubGlobal('getComputedStyle', (el: HTMLElement) => (el === sheet ? { transform: 'matrix(1, 0, 0, 1, 0, 60)' } : { opacity: '0.8' }));
  noteReleaseVelocity(sheet, 1.2);
  dismiss(scrim, sheet, { animate: true, screenBottom: 740 }); // 위 끝 -60에서 화면 끝까지 800 = 제 높이
  const sheetAnimate = (sheet as unknown as { animate: ReturnType<typeof vi.fn> }).animate;
  expect(sheetAnimate.mock.calls[0][1]).toMatchObject({ duration: 241, easing: 'cubic-bezier(0.4, 0.156, 1, 1)' });
  expect((scrim as unknown as { animate: ReturnType<typeof vi.fn> }).animate.mock.calls[0][1]).toMatchObject({ duration: 241 });
  dismiss(scrim, sheet, { animate: true, screenBottom: 740 });
  expect(sheetAnimate.mock.calls[1][1]).toMatchObject({ duration: 241, easing: 'cubic-bezier(0.4, 0, 1, 1)' });
  vi.unstubAllGlobals();
});

it('글자판 위에 앉은 시트는 제 높이가 아니라 화면 아래 끝까지 내려간다', () => {
  expect(exitTravel(400, 52, 852)).toBe(800); // 글자판이 떠서 시트가 화면 가운데에 있다
  expect(exitTravel(800, 52, 852)).toBe(800); // 글자판이 없으면 제 높이
  expect(exitTravel(800, 52, 600)).toBe(800); // 제 높이보다 덜 내려가지 않는다
  expect(exitTravel(0, 52, 852)).toBe(0); // 높이를 모르면 전처럼 100%
  expect(exitTravel(400, Number.NaN, 852)).toBe(400);
});
it('글자판 위에 앉은 시트를 닫으면 화면 밖까지 px로 내려가고, 글 칸의 초점을 바로 놓는다', () => {
  const { scrim, sheet } = build();
  Object.defineProperty(sheet, 'offsetHeight', { value: 400 });
  sheet.getBoundingClientRect = () => ({ top: 52 }) as DOMRect;
  const area = sheet.querySelector('textarea')!;
  area.focus();
  expect(document.activeElement).toBe(area);
  dismiss(scrim, sheet, { animate: true, screenBottom: 852 });
  const call = (sheet as unknown as { animate: ReturnType<typeof vi.fn> }).animate.mock.calls[0];
  expect(call[0]).toEqual([{ transform: 'translateY(0)' }, { transform: 'translateY(800px)' }]);
  expect(call[1]).toMatchObject({ duration: 260 });
  expect(document.activeElement).not.toBe(area);
});
