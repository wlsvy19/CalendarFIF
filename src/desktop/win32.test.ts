import { expect, it } from 'vitest';
import { createWin32, type Api } from './win32';

it('user32를 읽지 못해도 던지지 않고 안전한 값을 돌려주며 이유를 한 번만 적고 다시 읽지 않는다', () => {
  const logs: string[] = [];
  let loads = 0;
  const w = createWin32(() => {
    loads += 1;
    throw new Error('koffi 실패');
  }, (m) => logs.push(m));
  // findProgman이 0이고 adopt가 false이면 창은 'bottom' 모드로 남는다.
  expect([w.findProgman(), w.adopt(1n, 2n), w.sendToBottom(1n), w.isWindow(1n), w.getOwner(1n), w.getExStyle(1n), w.windowsBelow(1n, 2n), w.nativeLoaded()])
    .toEqual([0n, false, false, false, 0n, 0, [], false]);
  expect(loads).toBe(1);
  expect(logs).toHaveLength(1);
  expect(logs[0]).toContain('koffi 실패');
});

// 시험용 가짜 user32. 부르는 함수가 정한 값을 돌려준다.
const fakeApi = (over: Record<string, (...a: never[]) => unknown> = {}): Api =>
  ({ FindWindowW: () => 7, SetWindowLongPtrW: () => 0, GetWindowLongPtrW: () => 0, GetWindow: () => 0, SetWindowPos: () => 1, IsWindow: () => 1, IsChild: () => 0, ...over }) as unknown as Api;

it('좋게 읽은 뒤 한 호출이 던지면 그 호출만 안전한 값을 돌려주고 나머지는 계속 되며 한 번만 적는다', () => {
  const logs: string[] = [];
  const w = createWin32(() => fakeApi({ IsWindow: () => { throw new Error('호출 실패'); } }), (m) => logs.push(m));
  expect([w.isWindow(1n), w.findProgman(), w.sendToBottom(1n), w.isWindow(1n)]).toEqual([false, 7n, true, false]);
  expect(logs).toHaveLength(1);
  expect(logs[0]).toContain('호출 실패');
  expect(w.nativeLoaded()).toBe(true);
});

it('호출이 도는 동안 같은 모듈의 호출이 들어오면 koffi로 들어가지 않고 안전한 값을 돌려주며 센다', () => {
  let w!: ReturnType<typeof createWin32>;
  let inner: unknown[] = [];
  let entered = 0;
  w = createWin32(() => fakeApi({
    FindWindowW: () => {
      inner = [w.getOwner(1n), w.isWindow(1n), w.sendToBottom(1n), w.windowsBelow(1n, 2n), w.adopt(1n, 2n)];
      return 7;
    },
    GetWindow: () => { entered += 1; return 0; },
  }), () => {});
  expect(w.findProgman()).toBe(7n);
  expect(inner).toEqual([0n, false, false, [], false]);
  expect(entered).toBe(0);
  expect(w.nestedNativeCalls()).toBe(5);
  expect(w.getOwner(1n)).toBe(0n); // 끝난 뒤에는 다시 들어간다
  expect(entered).toBe(1);
  expect(w.nestedNativeCalls()).toBe(5);
});
