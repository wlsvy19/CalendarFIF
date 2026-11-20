/**
 * 저수준 마우스 훅(WH_MOUSE_LL). iconWorker 프로세스 안의 따로 도는 스레드(worker_threads)에서만 돈다. 이 스레드는 메시지를
 * 기다리는 데 묶이고(GetMessageW), Windows가 마우스 사건마다 이 스레드에서 콜백을 부른다. 콜백은 빨리 돌아와야 한다
 * (늦으면 컴퓨터 전체의 마우스가 늦는다). 그래서 단추 사건만 보고, 움직임은 바로 넘긴다.
 *
 * DesktopCal은 탐색기 안에 자기 DLL을 넣어 바탕화면의 마우스를 받는다(dkdockexplorerx64.dll). 우리는 탐색기에 아무것도 넣지 않고
 * Windows가 공개한 훅으로 사건을 보기만 한다. 삼키는 것은 날짜 칸 위의 오른쪽 단추뿐이다(deskClicks.ts).
 *
 * 메인이 알려 주는 상태는 공유 메모리(state)로 읽는다. 이 스레드는 메시지를 받을 수 없기 때문이다.
 */
import { createClickTracker, type DeskButton, type DeskEmit } from './deskClicks';

/** state의 칸: 0 날짜 칸 위인지(1), 1~4 창의 왼, 위, 오른, 아래(실제 픽셀, 오른과 아래는 밖), 5~6 시험용 가짜 바탕화면 창 번호(아래, 위 32비트). */
export const MOUSE_STATE = { armed: 0, left: 1, top: 2, right: 3, bottom: 4, testLo: 5, testHi: 6, length: 8 } as const;

const WH_MOUSE_LL = 14;
const GA_ROOT = 2;
const BUTTONS: Record<number, DeskButton> = { 0x201: 'ldown', 0x202: 'lup', 0x204: 'rdown', 0x205: 'rup' };
const DESKTOP_CLASSES = new Set(['Progman', 'WorkerW']);

export function runMouseHook(state: Int32Array, emit: (e: DeskEmit) => void, report: (message: string) => void, trace: (line: string) => void): void {
  const koffi = require('koffi') as typeof import('koffi');
  const u32 = koffi.load('user32.dll');
  const k32 = koffi.load('kernel32.dll');
  const MSLL = koffi.struct('CALFIF_MSLLHOOKSTRUCT', { x: 'int32_t', y: 'int32_t', mouseData: 'uint32_t', flags: 'uint32_t', time: 'uint32_t', extra: 'uintptr_t' });
  const HookProc = koffi.proto('intptr_t __stdcall CalfifMouseProc(int code, uintptr_t wParam, void *lParam)');
  const SetWindowsHookExW = u32.func('intptr_t __stdcall SetWindowsHookExW(int id, CalfifMouseProc *fn, intptr_t hmod, uint32_t tid)');
  const CallNextHookEx = u32.func('intptr_t __stdcall CallNextHookEx(intptr_t hhk, int code, uintptr_t wParam, void *lParam)');
  const GetMessageW = u32.func('int __stdcall GetMessageW(void *msg, intptr_t hwnd, uint32_t min, uint32_t max)');
  const WindowFromPoint = u32.func('intptr_t __stdcall WindowFromPoint(int64_t pt)');
  const GetAncestor = u32.func('intptr_t __stdcall GetAncestor(intptr_t h, uint32_t flags)');
  const GetClassNameW = u32.func('int __stdcall GetClassNameW(intptr_t h, void *buf, int max)');
  const GetDoubleClickTime = u32.func('uint32_t __stdcall GetDoubleClickTime()');
  const GetSystemMetrics = u32.func('int __stdcall GetSystemMetrics(int index)');
  const GetModuleHandleW = k32.func('intptr_t __stdcall GetModuleHandleW(void *name)');

  const track = createClickTracker({ time: GetDoubleClickTime(), width: GetSystemMetrics(36), height: GetSystemMetrics(37) });
  const nameBuf = Buffer.alloc(64);
  const testDesk = (): bigint => (BigInt(state[MOUSE_STATE.testHi] >>> 0) << 32n) | BigInt(state[MOUSE_STATE.testLo] >>> 0);
  // 그 자리가 날짜 칸이고, 그 자리의 맨 위 창이 바탕화면(달력 창은 마우스를 흘려보내는 중이라 건너뛴다)인지. 아니면 까닭을 돌려준다.
  const why = (x: number, y: number): string => {
    if (Atomics.load(state, MOUSE_STATE.armed) !== 1) return 'unarmed';
    if (x < state[MOUSE_STATE.left] || x >= state[MOUSE_STATE.right] || y < state[MOUSE_STATE.top] || y >= state[MOUSE_STATE.bottom]) return 'outside';
    const root = BigInt(GetAncestor(WindowFromPoint((BigInt(y) << 32n) | (BigInt(x) & 0xffffffffn)), GA_ROOT));
    if (root === 0n) return 'no window';
    const test = testDesk();
    if (test !== 0n) return root === test ? 'ok' : 'not test desk';
    const n = GetClassNameW(root, nameBuf, 32);
    const name = nameBuf.toString('utf16le', 0, n * 2);
    return DESKTOP_CLASSES.has(name) ? 'ok' : `covered by ${name}`;
  };

  let failures = 0;
  const proc = koffi.register((code: number, wParam: number, lParam: unknown): number | bigint => {
    if (code >= 0) {
      const button = BUTTONS[Number(wParam)];
      if (button) {
        try {
          const info = koffi.decode(lParam, MSLL) as { x: number; y: number; time: number };
          const reason = why(info.x, info.y);
          const d = track(button, info.x, info.y, info.time, reason === 'ok');
          if (d.emit) emit(d.emit);
          trace(`${button} ${reason}${d.emit ? ` > ${d.emit.kind}` : ''}`);
          if (d.swallow) return 1;
        } catch (e) {
          if (failures++ < 5) report(String(e instanceof Error ? e.message : e));
        }
      }
    }
    return CallNextHookEx(0, code, wParam, lParam);
  }, koffi.pointer(HookProc));

  const hook = SetWindowsHookExW(WH_MOUSE_LL, proc, GetModuleHandleW(null), 0);
  if (!hook) throw new Error('SetWindowsHookExW 실패');
  const msg = Buffer.alloc(48);
  // 훅의 콜백은 이 기다림 안에서 불린다. 프로세스가 끝나면 Windows가 훅을 걷는다.
  while (GetMessageW(msg, 0, 0, 0) > 0) {
    // 이 스레드에 오는 메시지는 없다.
  }
}
