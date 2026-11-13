import { expect, it } from 'vitest';
import { BottomLimiter, Reattacher, adjustStep, isAtBottom, shouldKeepBottom } from './policy';

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

it('맨 아래로 보내기는 1초에 세 번까지, 지나면 다시 허용한다', () => {
  const l = new BottomLimiter();
  expect([l.allow(0), l.allow(100), l.allow(200), l.allow(300)]).toEqual([true, true, true, false]);
  expect([l.allow(999), l.allow(1000)]).toEqual([false, true]);
});
it('5묶음 내리 닿지 못하면 30초에 한 번으로 물러서고, 닿으면 처음으로 돌아간다', () => {
  const l = new BottomLimiter();
  for (let s = 0; s < 5; s++) for (let i = 0; i < 3; i++) expect(l.allow(s * 1000 + i)).toBe(true);
  expect([l.allow(5000), l.allow(10000), l.allow(4002 + 29999), l.allow(4002 + 30000)]).toEqual([false, false, false, true]);
  expect(l.allow(4002 + 30001)).toBe(false);
  l.reached();
  expect([l.allow(40000), l.allow(40001), l.allow(40002), l.allow(40003)]).toEqual([true, true, true, false]);
});

it('위치 조정 상태: 시작, 다시 시작, 화면 다시 읽힘, 끝', () => {
  expect([adjustStep(false, 'start'), adjustStep(true, 'start'), adjustStep(true, 'reload'), adjustStep(true, 'finish'), adjustStep(false, 'finish'), adjustStep(false, 'reload')]).toEqual([
    { adjusting: true, action: 'begin' }, { adjusting: true, action: 'resend' }, { adjusting: false, action: 'cancel' },
    { adjusting: false, action: 'end' }, { adjusting: false, action: 'none' }, { adjusting: false, action: 'none' },
  ]);
});

import { PageInput } from './policy';
it('새 페이지가 뜨기 시작할 때 입력 상태를 되돌리고, 그 뒤의 보고는 새 페이지의 것으로 유지한다', () => {
  const p = new PageInput();
  expect(p.navigationStart()).toBe(false); // 첫 불러오기: 되돌릴 것이 없다
  p.report(true); // 로그인 화면이 입력을 요청
  expect([p.interactive, p.navigationStart(), p.interactive]).toEqual([true, true, false]); // 다시 불러오기 시작
  p.report(true); // 새 페이지의 보고는 그 뒤에 와서 유지된다
  expect(p.interactive).toBe(true);
});
it('옛 페이지의 늦은 되돌리기는 새 페이지가 보고한 뒤에는 무시하고, 렌더러 종료는 되돌린다', () => {
  const p = new PageInput();
  p.navigationStart();
  const old = p.generation;
  p.navigationStart();
  p.report(true);
  expect([p.reset(old), p.interactive]).toEqual([false, true]);
  expect([p.reset(p.generation), p.interactive]).toEqual([true, false]); // 렌더러가 죽었다
  expect(p.reset(p.generation)).toBe(false);
});
