import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { dismiss } from './sheetMotion';

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
