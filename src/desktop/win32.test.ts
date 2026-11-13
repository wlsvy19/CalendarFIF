import { expect, it } from 'vitest';
import { createWin32 } from './win32';

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
