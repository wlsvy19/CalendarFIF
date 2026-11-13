import { expect, it } from 'vitest';
import { Reattacher, isAtBottom, shouldKeepBottom } from './policy';

const P = 100n, own = (hwnd: bigint) => ({ hwnd, desktopOwned: true }), other = (hwnd: bigint) => ({ hwnd, desktopOwned: false });
it('바탕화면에 붙은 창(DesktopCal 같은)들 말고는 아래에 아무것도 없어야 맨 아래다', () => {
  expect([isAtBottom([other(P)], P), isAtBottom([own(7n), other(P)], P), isAtBottom([other(8n), other(P)], P), isAtBottom([other(8n)], P), isAtBottom([], 0n), isAtBottom([other(8n)], 0n)])
    .toEqual([true, true, false, false, true, false]);
});
it('입력 중, 맨 위에 보기, 위치 조정, 숨김 중에는 맨 아래로 보내지 않는다', () => {
  const idle = { interactive: false, alwaysOnTop: false, adjusting: false, hidden: false };
  expect([idle, ...(['interactive', 'alwaysOnTop', 'adjusting', 'hidden'] as const).map((k) => ({ ...idle, [k]: true }))].map(shouldKeepBottom)).toEqual([true, false, false, false, false]);
});
it('예기치 않게 없어진 창만, Progman이 다시 생기면 한 번 다시 만든다', () => {
  const r = new Reattacher();
  r.closed(true);
  expect(r.tick(true)).toBe('idle');
  r.closed(false);
  expect([r.tick(false), r.tick(false), r.tick(true), r.tick(true)]).toEqual(['wait', 'wait', 'create', 'idle']);
  r.ownerLost();
  expect([r.tick(true), r.tick(true)]).toEqual(['create', 'idle']);
});
