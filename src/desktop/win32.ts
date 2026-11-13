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

// koffi는 처음 부를 때 읽는다. 맨 위에서 읽으면 koffi.node가 없거나 막힌 PC에서 메인 프로세스가 whenReady 전에 죽는다.
// 테스트나 다른 OS에서 이 파일을 가져와도 바로 읽지 않는다.
function loadUser32() {
  const koffi = require('koffi') as typeof import('koffi');
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
export type Api = ReturnType<typeof loadUser32>;

// Win32 호출은 이 틀로만 한다. 읽기나 호출이 던지면 이유를 한 번만 적고 안전한 값을 돌려준다(창은 일반 맨 아래 창으로 남는다).
// 읽기에 실패하면 다시 읽지 않는다. 시험에서는 load를 던지는 함수로 바꿔 끼운다.
// 한 번에 하나의 koffi 호출만 한다. 호출이 도는 동안 같은 모듈의 호출이 들어오면(창 메시지 처리 등으로) koffi로 들어가지 않고
// 그 함수의 안전한 값을 돌려주고 nested를 센다. koffi 호출 안에서 다시 koffi를 부르면 바깥 호출의 스택을 망가뜨릴 수 있다.
export function createWin32(load: () => Api = loadUser32, log: (message: string) => void = console.error) {
  let api: Api | null = null;
  let loadFailed = false;
  let logged = false;
  let busy = false;
  let nested = 0;
  const fail = (what: string, e: unknown): void => {
    if (logged) return;
    logged = true;
    log(`Win32 호출을 쓰지 못한다(${what}): ${String(e)}. 창을 일반 맨 아래 창으로 둔다`);
  };
  function u(): Api | null {
    if (api || loadFailed) return api;
    try {
      api = load();
    } catch (e) {
      loadFailed = true;
      fail('user32.dll 읽기', e);
    }
    return api;
  }

  function findProgman(): Hwnd {
    const f = u();
    if (!f) return 0n;
    if (busy) {
      nested += 1;
      return 0n;
    }
    busy = true;
    try {
      return BigInt(f.FindWindowW('Progman', null));
    } catch (e) {
      fail('FindWindowW', e);
      return 0n;
    } finally {
      busy = false;
    }
  }

  // 창이면 true, 창이 아니면 false. 확인하지 못했으면(읽기 실패, 호출이 던짐, 다른 호출 중) null이다.
  function isWindow(h: Hwnd): boolean | null {
    if (h === 0n) return false;
    const f = u();
    if (!f) return null;
    if (busy) {
      nested += 1;
      return null;
    }
    busy = true;
    try {
      return f.IsWindow(h) !== 0;
    } catch (e) {
      fail('IsWindow', e);
      return null;
    } finally {
      busy = false;
    }
  }

  function getOwner(h: Hwnd): Hwnd {
    const f = u();
    if (!f) return 0n;
    if (busy) {
      nested += 1;
      return 0n;
    }
    busy = true;
    try {
      return BigInt(f.GetWindow(h, GW_OWNER));
    } catch (e) {
      fail('GetWindow', e);
      return 0n;
    } finally {
      busy = false;
    }
  }

  function getExStyle(h: Hwnd): number {
    const f = u();
    if (!f) return 0;
    if (busy) {
      nested += 1;
      return 0;
    }
    busy = true;
    try {
      return Number(BigInt(f.GetWindowLongPtrW(h, GWL_EXSTYLE)) & 0xffffffffn);
    } catch (e) {
      fail('GetWindowLongPtrW', e);
      return 0;
    } finally {
      busy = false;
    }
  }

  // 창을 Progman의 소유로 두고 Alt+Tab 목록에서 뺀다(WS_EX_TOOLWINDOW 켜고 WS_EX_APPWINDOW 끔). 못 하면 false다.
  function adopt(h: Hwnd, owner: Hwnd): boolean {
    const f = u();
    if (!f) return false;
    if (busy) {
      nested += 1;
      return false;
    }
    busy = true;
    try {
      f.SetWindowLongPtrW(h, GWLP_HWNDPARENT, owner);
      const style = Number(BigInt(f.GetWindowLongPtrW(h, GWL_EXSTYLE)) & 0xffffffffn);
      f.SetWindowLongPtrW(h, GWL_EXSTYLE, (style | WS_EX_TOOLWINDOW) & ~WS_EX_APPWINDOW);
      f.SetWindowPos(h, 0, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED);
      return true;
    } catch (e) {
      fail('창 붙이기', e);
      return false;
    } finally {
      busy = false;
    }
  }

  // 도구 창 모양(WS_EX_TOOLWINDOW 켬, WS_EX_APPWINDOW 끔)만 다시 건다. 소유자는 건드리지 않는다. 못 하면 false다.
  function setToolStyle(h: Hwnd): boolean {
    const f = u();
    if (!f) return false;
    if (busy) {
      nested += 1;
      return false;
    }
    busy = true;
    try {
      const style = Number(BigInt(f.GetWindowLongPtrW(h, GWL_EXSTYLE)) & 0xffffffffn);
      f.SetWindowLongPtrW(h, GWL_EXSTYLE, (style | WS_EX_TOOLWINDOW) & ~WS_EX_APPWINDOW);
      f.SetWindowPos(h, 0, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED);
      return true;
    } catch (e) {
      fail('도구 창 모양', e);
      return false;
    } finally {
      busy = false;
    }
  }

  function sendToBottom(h: Hwnd): boolean {
    const f = u();
    if (!f) return false;
    if (busy) {
      nested += 1;
      return false;
    }
    busy = true;
    try {
      return f.SetWindowPos(h, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE) !== 0;
    } catch (e) {
      fail('SetWindowPos', e);
      return false;
    } finally {
      busy = false;
    }
  }

  // h 바로 아래 창부터 Progman까지(포함)를 위에서 아래 순서로 돌려준다. Progman을 못 만나면 끝까지(limit까지).
  // desktopOwned: 소유자나 자신이 Progman이거나 Progman의 자손인 창(DesktopCal의 달력 창은 목록 보기 컨트롤이 소유한다).
  function windowsBelow(h: Hwnd, progman: Hwnd, limit = 200): BelowEntry[] {
    const f = u();
    const out: BelowEntry[] = [];
    if (!f) return out;
    if (busy) {
      nested += 1;
      return out;
    }
    busy = true;
    try {
      let cur = BigInt(f.GetWindow(h, GW_HWNDNEXT));
      while (cur !== 0n && out.length < limit) {
        const owner = BigInt(f.GetWindow(cur, GW_OWNER));
        const belongs = (w: Hwnd) => progman !== 0n && w !== 0n && (w === progman || f.IsChild(progman, w) !== 0);
        out.push({ hwnd: cur, desktopOwned: belongs(owner) || belongs(cur) });
        if (cur === progman) break;
        cur = BigInt(f.GetWindow(cur, GW_HWNDNEXT));
      }
    } catch (e) {
      fail('GetWindow', e);
    } finally {
      busy = false;
    }
    return out;
  }

  return { nativeLoaded: (): boolean => u() !== null, nestedNativeCalls: (): number => nested, findProgman, isWindow, getOwner, getExStyle, adopt, setToolStyle, sendToBottom, windowsBelow };
}

export const { nativeLoaded, nestedNativeCalls, findProgman, isWindow, getOwner, getExStyle, adopt: adoptWindow, setToolStyle, sendToBottom, windowsBelow } = createWin32();
