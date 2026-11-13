import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createFollower } from './follow';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

function setup(runOnce: () => Promise<void>) {
  let emit!: (fileName: string | null) => void;
  const close = vi.fn();
  let print = 'v1';
  const log = vi.fn();
  const follower = createFollower({
    dbPath: 'C:\\x\\Db\\calendar.db', runOnce, debounceMs: 2000, pollMs: 30000, log,
    watchDir: (_dir, onEvent) => { emit = onEvent; return { close }; },
    fingerprint: () => print,
  });
  follower.start();
  return { follower, emit: (name: string | null) => emit(name), close, log, setPrint: (p: string) => { print = p; } };
}

it('이벤트가 몰려 와도 한 번만 돈다', async () => {
  const runOnce = vi.fn(async () => {});
  const { emit } = setup(runOnce);
  emit('calendar.db'); emit('calendar.db-journal'); emit('calendar.db');
  await vi.advanceTimersByTimeAsync(1999);
  expect(runOnce).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(runOnce).toHaveBeenCalledTimes(1);
});
it('도는 중에 온 이벤트는 끝난 뒤 한 번 더 돈다', async () => {
  let finish!: () => void;
  const runOnce = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
  const { emit } = setup(runOnce);
  emit('calendar.db');
  await vi.advanceTimersByTimeAsync(2000);
  emit('calendar.db');
  await vi.advanceTimersByTimeAsync(2000);
  expect(runOnce).toHaveBeenCalledTimes(1);
  finish();
  await vi.advanceTimersByTimeAsync(0);
  expect(runOnce).toHaveBeenCalledTimes(2);
});
it('이벤트가 없어도 파일이 바뀌었으면 돈다', async () => {
  const runOnce = vi.fn(async () => {});
  const { setPrint } = setup(runOnce);
  await vi.advanceTimersByTimeAsync(30000);
  expect(runOnce).not.toHaveBeenCalled();
  setPrint('v2');
  await vi.advanceTimersByTimeAsync(30000);
  expect(runOnce).toHaveBeenCalledTimes(1);
});
it('실패한 뒤에는 파일이 그대로여도 다음 확인 때 다시 돈다', async () => {
  const runOnce = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined);
  const { emit } = setup(runOnce);
  emit('calendar.db');
  await vi.advanceTimersByTimeAsync(2000);
  expect(runOnce).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(30000);
  expect(runOnce).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(30000);
  expect(runOnce).toHaveBeenCalledTimes(2);
});
it('실패해도 계속 돌고, 멈추면 더 돌지 않는다', async () => {
  const runOnce = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined);
  const { follower, emit, close, log } = setup(runOnce);
  emit('calendar.db');
  await vi.advanceTimersByTimeAsync(2000);
  expect(log).toHaveBeenCalledWith(expect.stringContaining('boom'));
  emit('calendar.db');
  await vi.advanceTimersByTimeAsync(2000);
  expect(runOnce).toHaveBeenCalledTimes(2);
  follower.stop();
  expect(close).toHaveBeenCalledTimes(1);
  emit('calendar.db');
  await vi.advanceTimersByTimeAsync(60000);
  expect(runOnce).toHaveBeenCalledTimes(2);
});
