/**
 * 바탕화면 아이콘의 자리를 몇 초마다 읽어 메인 프로세스에 알리는 따로 도는 프로세스(Electron utilityProcess).
 * 셸 COM 호출을 메인 프로세스 밖에서 하므로 여기서 무엇이 잘못되어도 달력 창은 그대로다(holes.ts, desktopIcons.ts).
 * 보내는 것: 바뀌었을 때 { grid }(holes.ts의 IconGrid), 읽지 못하면 { error }(처음 한 번과 바뀔 때만).
 */
import { createIconReader, type IconReader } from './desktopIcons';

const POLL_MS = 2000;
const port = (process as unknown as { parentPort?: { postMessage(m: unknown): void } }).parentPort;

let reader: IconReader | null = null;
let last = '';
let lastError = '';

function tick(): void {
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
}

tick();
setInterval(tick, POLL_MS);
