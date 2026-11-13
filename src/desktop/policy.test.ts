import { expect, it } from 'vitest';
import { BottomLimiter, Reattacher, adjustStep, isAtBottom, shouldKeepBottom } from './policy';

const P = 100n, own = (hwnd: bigint) => ({ hwnd, owner: 0n, desktopOwned: true }), other = (hwnd: bigint) => ({ hwnd, owner: 0n, desktopOwned: false });
it('바탕화면에 붙은 창(DesktopCal 같은)들 말고는 아래에 아무것도 없어야 맨 아래다', () => {
  expect([isAtBottom([other(P)], P), isAtBottom([own(7n), other(P)], P), isAtBottom([other(8n), other(P)], P), isAtBottom([other(8n)], P), isAtBottom([], 0n), isAtBottom([other(8n)], 0n)])
    .toEqual([true, true, false, false, true, false]);
});
it('바탕화면에 붙은 창이 소유한 창(그 창의 입력기 창 등)도 바탕화면 쪽이다. 소유자를 따라가 바탕화면에 닿지 않으면 아니다', () => {
  // 목록은 위에서 아래 순서다. Windows는 소유된 창을 늘 소유자보다 위에 둔다.
  const progman = { hwnd: P, owner: 0n, desktopOwned: true };
  const cal = { hwnd: 20n, owner: P, desktopOwned: true }; // 다른 달력 창(Progman이 소유)
  const ime = { hwnd: 21n, owner: 20n, desktopOwned: false }; // 그 창의 입력기 창(IME)
  const imeUi = { hwnd: 22n, owner: 21n, desktopOwned: false }; // 입력기 창이 소유한 창(MSCTFIME UI)
  const dcal = { hwnd: 40n, owner: 41n, desktopOwned: true }; // DesktopCal의 달력 창(소유자가 Progman의 자손)
  const dcalIme = { hwnd: 42n, owner: 40n, desktopOwned: false };
  const app = { hwnd: 30n, owner: 0n, desktopOwned: false }; // 일반 창
  const appPopup = { hwnd: 31n, owner: 30n, desktopOwned: false }; // 일반 창이 소유한 창
  expect([
    isAtBottom([imeUi, ime, cal, progman], P),
    isAtBottom([dcalIme, dcal, imeUi, ime, cal, progman], P),
    isAtBottom([imeUi, ime, cal, app, progman], P),
    isAtBottom([appPopup, app, cal, progman], P),
    isAtBottom([ime, progman], P), // 소유자가 아래에 없으면 바탕화면 쪽으로 보지 않는다
  ]).toEqual([true, true, false, false, false]);
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

import { leavesPage } from './policy';
it('앱 주소로 가는 주 프레임의 문서 이동만 지금 화면이 떠나는 것으로 본다', () => {
  const nav = { isMainFrame: true, isSameDocument: false, url: 'app://calfif/' };
  expect([
    leavesPage(nav),
    leavesPage({ ...nav, isSameDocument: true, url: 'app://calfif/index.html#settings' }), // 해시만 바뀜
    leavesPage({ ...nav, isMainFrame: false }), // 하위 프레임
    leavesPage({ ...nav, url: 'https://example.com/' }), // installSecurity가 막는 이동
    leavesPage({ ...nav, url: 'app://other/' }), // 다른 호스트
  ]).toEqual([true, false, false, false, false]);
});

import { CrashBackoff, isBlockedKey, ownerStatus } from './policy';
it('맨 아래로 보내기를 거절당하면 다시 해 볼 때는 리미터가 다음에 허락하는 때다', () => {
  const l = new BottomLimiter();
  expect(l.nextAllowedAt(50)).toBe(50); // 아무것도 안 했으면 지금
  [0, 100, 200].forEach((t) => l.allow(t));
  expect([l.nextAllowedAt(300), l.allow(999), l.allow(1000)]).toEqual([1000, false, true]); // 가장 오래된 시도가 1초 창을 벗어날 때
  expect(l.nextAllowedAt(1001)).toBe(1100);
  // 15번 내리 닿지 못해 물러섰다: 마지막 시도(4002)에서 30초 뒤
  const b = new BottomLimiter();
  for (let s = 0; s < 5; s++) for (let i = 0; i < 3; i++) b.allow(s * 1000 + i);
  expect([b.nextAllowedAt(5000), b.allow(4002 + 29999), b.allow(4002 + 30000)]).toEqual([4002 + 30000, false, true]);
  b.reached();
  expect(b.nextAllowedAt(40000)).toBe(40000);
});

it('화면이 죽으면 1초, 5초, 30초, 그 뒤로는 60초 뒤에 다시 띄우고, 60초 넘게 살아 있었으면 처음부터 센다', () => {
  const b = new CrashBackoff();
  const delays: number[] = [];
  let now = 0;
  for (let i = 0; i < 6; i++) {
    const d = b.crashed(now);
    delays.push(d);
    now += d;
    b.reloaded(now);
    now += 2000; // 다시 띄운 뒤 2초 만에 또 죽는다
  }
  expect(delays).toEqual([1000, 5000, 30000, 60000, 60000, 60000]);
  b.reloaded(100000);
  expect(b.crashed(100000 + 59999)).toBe(60000); // 60초가 못 되면 그대로
  b.reloaded(300000);
  expect(b.crashed(360000)).toBe(1000); // 60초 살아 있었으면 처음부터
  b.reloaded(361000);
  expect(b.crashed(362000)).toBe(5000);
});

it('Progman 핸들 확인: 창이면 살아 있고, 창이 아니면 잃은 것이고, 확인하지 못했으면 살아 있는 것으로 본다', () => {
  expect([ownerStatus(true), ownerStatus(false), ownerStatus(null)]).toEqual(['alive', 'lost', 'alive']);
});

it('다시 읽기(Ctrl+R, F5, Ctrl+Shift+R)와 확대·축소 키는 창이 받지 않고, 나머지는 화면으로 간다', () => {
  const key = (k: string, mods: Partial<{ control: boolean; shift: boolean; alt: boolean; meta: boolean }> = {}, type = 'keyDown', code = '') =>
    isBlockedKey({ type, key: k, code, control: false, shift: false, alt: false, meta: false, ...mods });
  expect([
    key('r', { control: true }), key('R', { control: true, shift: true }), key('F5'), key('F5', { control: true }), key('F5', { shift: true }),
    key('=', { control: true }), key('+', { control: true, shift: true }), key('-', { control: true }), key('0', { control: true }),
    key('Add', { control: true }, 'keyDown', 'NumpadAdd'), key('Subtract', { control: true }, 'keyDown', 'NumpadSubtract'),
  ]).toEqual(Array(11).fill(true));
  expect([
    key('r'), key('r', { control: true, alt: true }), key('F5', { alt: true }), key('r', { control: true }, 'keyUp'),
    key('c', { control: true }), key('v', { control: true }), key('0'), key('-', { control: true, alt: true }), key('F9', { control: true, alt: true, shift: true }),
  ]).toEqual(Array(9).fill(false));
});
