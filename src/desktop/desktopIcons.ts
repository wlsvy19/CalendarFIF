/**
 * 바탕화면 아이콘의 자리를 읽는다(읽기만). Windows가 공개한 셸 COM을 쓴다:
 * ShellWindows.FindWindowSW(바탕화면) → IServiceProvider.QueryService(SID_STopLevelBrowser) → IShellBrowser.QueryActiveShellView
 * → IFolderView의 ItemCount, Item, GetItemPosition, GetSpacing. 탐색기에 무엇을 끼워 넣거나 신호를 보내지 않는다.
 * 레이먼드 첸의 "Manipulating the positions of desktop icons"(The Old New Thing)와 같은 길이다.
 *
 * iconWorker(따로 도는 프로세스)에서만 부른다. 다른 프로세스(탐색기)로 가는 COM 호출이라 메인 프로세스에서 부르면 기다리는 동안
 * 창 메시지가 돌 수 있다(win32.ts의 주의). 탐색기가 다시 시작되면 앞의 것이 쓸모없어지므로 읽을 때마다 처음부터 얻는다.
 */
import type { IconGrid } from './holes';

const CLSID_ShellWindows = '9BA05972-F6A8-11CF-A442-00A0C90A8F39';
const IID_IShellWindows = '85CB6900-4D95-11CF-960C-0080C7F4EE85';
const IID_IServiceProvider = '6D5140C1-7436-11CE-8034-00AA006009FA';
const SID_STopLevelBrowser = '4C96BE40-915C-11CF-99D3-00AA004AE837';
const IID_IShellBrowser = '000214E2-0000-0000-C000-000000000046';
const IID_IFolderView = 'CDE725B0-CCC9-4519-917E-325D72FAB4CE';
const CLSCTX_ALL = 0x17;
const SWC_DESKTOP = 8;
const SWFO_NEEDDISPATCH = 1;
const SVGIO_ALLVIEW = 2;
const VT_I4 = 3;
// vtable 자리(IUnknown 0~2 뒤의 차례)
const QUERY_INTERFACE = 0;
const RELEASE = 2;
const SHELLWINDOWS_FIND_WINDOW_SW = 15;
const SERVICE_PROVIDER_QUERY_SERVICE = 3;
const SHELL_BROWSER_QUERY_ACTIVE_SHELL_VIEW = 15;
const FOLDER_VIEW_ITEM = 6;
const FOLDER_VIEW_ITEM_COUNT = 7;
const FOLDER_VIEW_GET_ITEM_POSITION = 11;
const FOLDER_VIEW_GET_SPACING = 12;
/** 아이콘이 이보다 많으면 앞의 것만 본다. */
const MAX_ITEMS = 1000;

export function guidBytes(s: string): Uint8Array {
  const h = s.replace(/[{}-]/g, '');
  const b = new Uint8Array(16);
  const v = new DataView(b.buffer);
  v.setUint32(0, parseInt(h.slice(0, 8), 16), true);
  v.setUint16(4, parseInt(h.slice(8, 12), 16), true);
  v.setUint16(6, parseInt(h.slice(12, 16), 16), true);
  for (let i = 0; i < 8; i++) b[8 + i] = parseInt(h.slice(16 + i * 2, 18 + i * 2), 16);
  return b;
}

export type IconReader = () => IconGrid;

/** koffi를 읽고 읽기 함수를 만든다. 실패하면 던진다(iconWorker가 잡는다). */
export function createIconReader(): IconReader {
  const koffi = require('koffi') as typeof import('koffi');
  const ole = koffi.load('ole32.dll');
  const u32 = koffi.load('user32.dll');
  const CoInitializeEx = ole.func('int32_t __stdcall CoInitializeEx(void *reserved, uint32_t coinit)');
  const CoCreateInstance = ole.func('int32_t __stdcall CoCreateInstance(uint8_t *clsid, void *outer, uint32_t ctx, uint8_t *iid, _Out_ void **out)');
  const CoTaskMemFree = ole.func('void __stdcall CoTaskMemFree(void *p)');
  const FindWindowW = u32.func('intptr_t __stdcall FindWindowW(str16 cls, str16 title)');
  const FindWindowExW = u32.func('intptr_t __stdcall FindWindowExW(intptr_t parent, intptr_t after, str16 cls, str16 title)');
  const GetWindowRect = u32.func('int __stdcall GetWindowRect(intptr_t hWnd, _Out_ int32_t *rect)');
  // 실제 픽셀로 읽는다(모니터마다 배율이 달라도 셸의 자리와 같은 단위).
  try {
    u32.func('intptr_t __stdcall SetThreadDpiAwarenessContext(intptr_t ctx)')(-4); // PER_MONITOR_AWARE_V2
  } catch {
    // 옛 Windows: 프로세스 설정을 따른다.
  }
  CoInitializeEx(null, 0); // COINIT_MULTITHREADED: 다른 프로세스로 가는 호출이 메시지를 돌리지 않는다

  const protos = new Map<string, import('koffi').TypeObject>();
  const call = (obj: unknown, index: number, sig: string, ...args: unknown[]): number => {
    let proto = protos.get(sig);
    if (!proto) {
      proto = koffi.proto(`int32_t __stdcall calfif_m${protos.size}(void *self${sig ? `, ${sig}` : ''})`);
      protos.set(sig, proto);
    }
    const fn = koffi.decode(koffi.decode(obj, 'void *'), index * 8, 'void *');
    return koffi.call(fn, proto, obj, ...args) as number;
  };
  const ok = (hr: number, what: string): void => {
    if (hr < 0) throw new Error(`${what}: 0x${(hr >>> 0).toString(16)}`);
  };

  return () => {
    const held: unknown[] = [];
    const take = (out: unknown[]): unknown => {
      held.push(out[0]);
      return out[0];
    };
    try {
      const sw: unknown[] = [null];
      ok(CoCreateInstance(guidBytes(CLSID_ShellWindows), null, CLSCTX_ALL, guidBytes(IID_IShellWindows), sw), 'ShellWindows');
      const shellWindows = take(sw);
      const loc = new Uint8Array(24);
      loc[0] = VT_I4; // CSIDL_DESKTOP = 0
      const disp: unknown[] = [null];
      ok(call(shellWindows, SHELLWINDOWS_FIND_WINDOW_SW, 'uint8_t *loc, uint8_t *root, int cls, _Out_ int32_t *hwnd, int opts, _Out_ void **disp', loc, new Uint8Array(24), SWC_DESKTOP, [0], SWFO_NEEDDISPATCH, disp), 'FindWindowSW');
      const sp: unknown[] = [null];
      ok(call(take(disp), QUERY_INTERFACE, 'uint8_t *iid, _Out_ void **out', guidBytes(IID_IServiceProvider), sp), 'IServiceProvider');
      const browser: unknown[] = [null];
      ok(call(take(sp), SERVICE_PROVIDER_QUERY_SERVICE, 'uint8_t *sid, uint8_t *iid, _Out_ void **out', guidBytes(SID_STopLevelBrowser), guidBytes(IID_IShellBrowser), browser), 'QueryService');
      const view: unknown[] = [null];
      ok(call(take(browser), SHELL_BROWSER_QUERY_ACTIVE_SHELL_VIEW, '_Out_ void **out', view), 'QueryActiveShellView');
      const fvOut: unknown[] = [null];
      ok(call(take(view), QUERY_INTERFACE, 'uint8_t *iid, _Out_ void **out', guidBytes(IID_IFolderView), fvOut), 'IFolderView');
      const fv = take(fvOut);
      const count = [0];
      ok(call(fv, FOLDER_VIEW_ITEM_COUNT, 'uint32_t flags, _Out_ int32_t *n', SVGIO_ALLVIEW, count), 'ItemCount');
      const spacing = new Int32Array(2);
      ok(call(fv, FOLDER_VIEW_GET_SPACING, '_Out_ int32_t *pt', spacing), 'GetSpacing');
      const points: [number, number][] = [];
      for (let i = 0; i < Math.min(count[0], MAX_ITEMS); i++) {
        const pidl: unknown[] = [null];
        if (call(fv, FOLDER_VIEW_ITEM, 'int index, _Out_ void **pidl', i, pidl) < 0 || !pidl[0]) continue;
        const pt = new Int32Array(2);
        const hr = call(fv, FOLDER_VIEW_GET_ITEM_POSITION, 'void *pidl, _Out_ int32_t *pt', pidl[0], pt);
        CoTaskMemFree(pidl[0]);
        if (hr >= 0) points.push([pt[0], pt[1]]);
      }
      // 자리는 바탕화면 목록 창(SysListView32) 안의 좌표다.
      const progman = FindWindowW('Progman', null);
      const defView = progman ? FindWindowExW(progman, 0, 'SHELLDLL_DefView', null) : 0;
      const list = defView ? FindWindowExW(defView, 0, 'SysListView32', null) : 0;
      if (!list) throw new Error('바탕화면 목록 창을 찾지 못했다');
      const rect = new Int32Array(4);
      if (!GetWindowRect(list, rect)) throw new Error('바탕화면 목록 창의 자리를 읽지 못했다');
      return { origin: [rect[0], rect[1]], spacing: [spacing[0], spacing[1]], points };
    } finally {
      for (const obj of held.reverse()) {
        try {
          if (obj) call(obj, RELEASE, '');
        } catch {
          // 놓지 못해도 계속한다.
        }
      }
    }
  };
}
