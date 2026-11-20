/**
 * 바탕화면 아이콘의 자리를 몇 초마다 읽어 메인 프로세스에 알리는 따로 도는 프로세스(Electron utilityProcess).
 * 셸 COM 호출을 메인 프로세스 밖에서 하므로 여기서 무엇이 잘못되어도 달력 창은 그대로다(holes.ts, desktopIcons.ts).
 * 보내는 것: 바뀌었을 때 { grid }(holes.ts의 IconGrid), 읽지 못하면 { error }(처음 한 번과 바뀔 때만).
 *
 * 같은 프로세스의 다른 스레드(같은 파일을 worker_threads로 다시 연다)에서 저수준 마우스 훅을 돌린다(mouseHook.ts).
 * 메인이 보내는 { mouse }(날짜 칸 위인지, 창의 자리)를 공유 메모리에 적어 훅이 읽게 하고, 훅이 알아챈 것을 { deskClick }으로 보낸다.
 */
import { isMainThread, parentPort as threadPort, Worker, workerData } from 'node:worker_threads';
import type { DeskEmit } from './deskClicks';
import { createIconReader, type IconReader } from './desktopIcons';
import { MOUSE_STATE, runMouseHook } from './mouseHook';

type ParentPort = { postMessage(m: unknown): void; on(event: 'message', listener: (e: { data: unknown }) => void): void };

if (!isMainThread && (workerData as { role?: string } | null)?.role === 'mouse') {
  const sab = (workerData as { sab: SharedArrayBuffer }).sab;
  try {
    runMouseHook(
      new Int32Array(sab),
      (e: DeskEmit) => threadPort?.postMessage({ deskClick: e }),
      (message) => threadPort?.postMessage({ mouseError: message }),
      (line) => threadPort?.postMessage({ mouseTrace: line }),
    );
  } catch (e) {
    threadPort?.postMessage({ mouseError: String(e instanceof Error ? e.message : e) });
  }
} else {
  const POLL_MS = 2000;
  const port = (process as unknown as { parentPort?: ParentPort }).parentPort;

  let reader: IconReader | null = null;
  let last = '';
  let lastError = '';

  const tick = (): void => {
    try {
      reader ??= createIconReader();
      const grid = reader();
      const text = JSON.stringify(grid);
      lastError = '';
      if (text === last) return;
      last = text;
      port?.postMessage({ grid });
    } catch (e) {
      const message = String(e instanceof Error ? e.message : e);
      if (message === lastError) return;
      lastError = message;
      last = '';
      port?.postMessage({ error: message });
    }
  };

  // 마우스 훅 스레드. 죽으면 몇 번까지 다시 띄운다.
  const sab = new SharedArrayBuffer(4 * MOUSE_STATE.length);
  const state = new Int32Array(sab);
  let hookStarts = 0;
  const startHook = (): void => {
    hookStarts += 1;
    let worker: Worker;
    try {
      worker = new Worker(__filename, { workerData: { role: 'mouse', sab } });
    } catch (e) {
      port?.postMessage({ mouseError: String(e instanceof Error ? e.message : e) });
      return;
    }
    worker.on('message', (m) => port?.postMessage(m));
    worker.on('error', (e) => port?.postMessage({ mouseError: String(e instanceof Error ? e.message : e) }));
    worker.on('exit', () => {
      if (hookStarts < 5) setTimeout(startHook, 5000 * hookStarts);
    });
  };

  port?.on('message', (e) => {
    const m = e.data as { mouse?: { armed: boolean; rect: [number, number, number, number]; testDesk?: string } } | null;
    const mouse = m?.mouse;
    if (!mouse) return;
    const [l, t, r, b] = mouse.rect;
    state[MOUSE_STATE.left] = l;
    state[MOUSE_STATE.top] = t;
    state[MOUSE_STATE.right] = r;
    state[MOUSE_STATE.bottom] = b;
    const test = BigInt(mouse.testDesk ?? '0');
    state[MOUSE_STATE.testLo] = Number(test & 0xffffffffn) | 0;
    state[MOUSE_STATE.testHi] = Number(test >> 32n) | 0;
    Atomics.store(state, MOUSE_STATE.armed, mouse.armed ? 1 : 0);
  });

  startHook();
  tick();
  setInterval(tick, POLL_MS);
}
