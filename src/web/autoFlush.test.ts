import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { startAutoFlush } from './autoFlush';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

it('시작할 때, 온라인으로 돌아올 때, 화면이 다시 보일 때, 대기 건이 있을 때 올린다', () => {
  let pending = 0;
  const engine = { flush: vi.fn(async () => {}), status: () => ({ state: 'waiting' as const, pending }) };
  const target = new EventTarget();
  const doc = { visibilityState: 'hidden' };
  const stop = startAutoFlush(engine, target, doc, 15000);
  expect(engine.flush).toHaveBeenCalledTimes(1);

  target.dispatchEvent(new Event('online'));
  expect(engine.flush).toHaveBeenCalledTimes(2);
  target.dispatchEvent(new Event('visibilitychange'));
  expect(engine.flush).toHaveBeenCalledTimes(2);
  doc.visibilityState = 'visible';
  target.dispatchEvent(new Event('visibilitychange'));
  expect(engine.flush).toHaveBeenCalledTimes(3);

  vi.advanceTimersByTime(15000);
  expect(engine.flush).toHaveBeenCalledTimes(3);
  pending = 1;
  vi.advanceTimersByTime(15000);
  expect(engine.flush).toHaveBeenCalledTimes(4);

  stop();
  target.dispatchEvent(new Event('online'));
  vi.advanceTimersByTime(60000);
  expect(engine.flush).toHaveBeenCalledTimes(4);
});
