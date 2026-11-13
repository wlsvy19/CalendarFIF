import koffi from 'koffi';
import type { BelowEntry } from './policy';

export type Hwnd = bigint;

const GWLP_HWNDPARENT = -8;
const GWL_EXSTYLE = -20;
const GW_HWNDNEXT = 2;
const GW_OWNER = 4;
const HWND_BOTTOM = 1;
const SWP_NOSIZE = 0x1;
const SWP_NOMOVE = 0x2;
const SWP_NOZORDER = 0x4;
const SWP_NOACTIVATE = 0x10;
const SWP_FRAMECHANGED = 0x20;
const WS_EX_TOOLWINDOW = 0x80;
const WS_EX_APPWINDOW = 0x40000;

// 처음 부를 때 user32.dll을 읽는다(테스트나 다른 OS에서 이 파일을 가져와도 바로 읽지 않는다).
function load() {
  const user32 = koffi.load('user32.dll');
  return {
    FindWindowW: user32.func('intptr_t __stdcall FindWindowW(str16 cls, str16 title)'),
    SetWindowLongPtrW: user32.func('intptr_t __stdcall SetWindowLongPtrW(intptr_t hWnd, int index, intptr_t value)'),
    GetWindowLongPtrW: user32.func('intptr_t __stdcall GetWindowLongPtrW(intptr_t hWnd, int index)'),
    GetWindow: user32.func('intptr_t __stdcall GetWindow(intptr_t hWnd, uint32_t cmd)'),
    SetWindowPos: user32.func('int __stdcall SetWindowPos(intptr_t hWnd, intptr_t after, int x, int y, int cx, int cy, uint32_t flags)'),
    IsWindow: user32.func('int __stdcall IsWindow(intptr_t hWnd)'),
    IsChild: user32.func('int __stdcall IsChild(intptr_t parent, intptr_t hWnd)'),
  };
}
let api: ReturnType<typeof load> | null = null;
const u = () => (api ??= load());

export function findProgman(): Hwnd {
  return BigInt(u().FindWindowW('Progman', null));
}

export function isWindow(h: Hwnd): boolean {
  return h !== 0n && u().IsWindow(h) !== 0;
}

export function setOwner(h: Hwnd, owner: Hwnd): void {
  u().SetWindowLongPtrW(h, GWLP_HWNDPARENT, owner);
}

export function getOwner(h: Hwnd): Hwnd {
  return BigInt(u().GetWindow(h, GW_OWNER));
}

export function getExStyle(h: Hwnd): number {
  return Number(BigInt(u().GetWindowLongPtrW(h, GWL_EXSTYLE)) & 0xffffffffn);
}

// Alt+Tab 목록에서 빠지도록 WS_EX_TOOLWINDOW를 켜고 WS_EX_APPWINDOW를 끈다.
export function makeToolWindow(h: Hwnd): void {
  const next = (getExStyle(h) | WS_EX_TOOLWINDOW) & ~WS_EX_APPWINDOW;
  u().SetWindowLongPtrW(h, GWL_EXSTYLE, next);
  u().SetWindowPos(h, 0, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED);
}

export function sendToBottom(h: Hwnd): boolean {
  return u().SetWindowPos(h, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE) !== 0;
}

// h 바로 아래 창부터 Progman까지(포함)를 위에서 아래 순서로 돌려준다. Progman을 못 만나면 끝까지(limit까지).
// desktopOwned: 소유자나 자신이 Progman이거나 Progman의 자손인 창(DesktopCal의 달력 창은 목록 보기 컨트롤이 소유한다).
export function windowsBelow(h: Hwnd, progman: Hwnd, limit = 200): BelowEntry[] {
  const f = u();
  const out: BelowEntry[] = [];
  let cur = BigInt(f.GetWindow(h, GW_HWNDNEXT));
  while (cur !== 0n && out.length < limit) {
    const owner = BigInt(f.GetWindow(cur, GW_OWNER));
    const belongs = (w: Hwnd) => progman !== 0n && w !== 0n && (w === progman || f.IsChild(progman, w) !== 0);
    out.push({ hwnd: cur, desktopOwned: belongs(owner) || belongs(cur) });
    if (cur === progman) break;
    cur = BigInt(f.GetWindow(cur, GW_HWNDNEXT));
  }
  return out;
}
