import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withTimeLimit } from './timeLimit';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('withTimeLimit', () => {
  it('제한 안에 끝나면 그 결과를 돌려준다', async () => {
    await expect(withTimeLimit(Promise.resolve(7), 10000)).resolves.toBe(7);
  });
  it('제한 안에 실패하면 그 실패를 돌려준다', async () => {
    await expect(withTimeLimit(Promise.reject({ code: 'permission-denied' }), 10000)).rejects.toEqual({ code: 'permission-denied' });
  });
  it('끝나지 않으면 제한 시간 뒤에 unavailable로 거부한다', async () => {
    const result = withTimeLimit(new Promise<void>(() => {}), 10000);
    const seen = vi.fn();
    result.catch(seen);
    await vi.advanceTimersByTimeAsync(9999);
    expect(seen).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(seen).toHaveBeenCalledWith({ code: 'unavailable' });
  });
  it('끝나면 타이머를 남기지 않는다', async () => {
    await withTimeLimit(Promise.resolve(), 10000);
    expect(vi.getTimerCount()).toBe(0);
  });
});
