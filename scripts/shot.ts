// 화면 확인용 스크린샷 도구. 헤드리스 Edge를 DevTools 프로토콜로 조작한다.
// 사용법: npx tsx scripts/shot.ts --url <주소> --out <png> [--size 402x874] [--scheme light|dark] [--wait 3000] [--eval "<JS>"]
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const { values } = parseArgs({
  options: {
    url: { type: 'string' },
    out: { type: 'string' },
    size: { type: 'string', default: '402x874' },
    scheme: { type: 'string', default: 'light' },
    wait: { type: 'string', default: '3000' },
    eval: { type: 'string' },
  },
});
if (!values.url || !values.out) {
  console.error('사용법: tsx scripts/shot.ts --url <주소> --out <png> [--size 402x874] [--scheme light|dark] [--wait 3000] [--eval "<JS>"]');
  process.exit(1);
}
const sizeMatch = /^(\d+)x(\d+)$/.exec(values.size!);
if (!sizeMatch) throw new Error(`--size는 402x874 형식이어야 한다: ${values.size}`);
const [width, height] = [Number(sizeMatch[1]), Number(sizeMatch[2])];
if (values.scheme !== 'light' && values.scheme !== 'dark') throw new Error('--scheme은 light 또는 dark');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const port = 9222 + Math.floor(Math.random() * 500);
const profile = resolve('.tools', 'edge-profile');
mkdirSync(profile, { recursive: true });
const edge = spawn(
  EDGE,
  [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

async function main() {
  let wsUrl = '';
  for (let i = 0; i < 100 && !wsUrl; i++) {
    try {
      const targets = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
      wsUrl = targets.find((t) => t.type === 'page')?.webSocketDebuggerUrl ?? '';
    } catch {
      /* 아직 안 떴다 */
    }
    if (!wsUrl) await sleep(300);
  }
  if (!wsUrl) throw new Error('Edge의 DevTools에 연결하지 못했다');

  const ws = new WebSocket(wsUrl);
  await new Promise<void>((ok, fail) => {
    ws.onopen = () => ok();
    ws.onerror = () => fail(new Error('WebSocket 연결 실패'));
  });
  let nextId = 0;
  const pending = new Map<number, (r: { result?: any; error?: { message: string } }) => void>();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(String(ev.data));
    if (msg.id !== undefined) pending.get(msg.id)?.(msg);
  };
  const send = async (method: string, params: object = {}) => {
    const id = ++nextId;
    const reply = await new Promise<{ result?: any; error?: { message: string } }>((ok) => {
      pending.set(id, ok);
      ws.send(JSON.stringify({ id, method, params }));
    });
    if (reply.error) throw new Error(`${method}: ${reply.error.message}`);
    return reply.result;
  };

  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: width < 600 });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: values.scheme }] });
  await send('Page.enable');
  await send('Page.navigate', { url: values.url });
  await sleep(Number(values.wait));
  if (values.eval) {
    const r = await send('Runtime.evaluate', { expression: values.eval, awaitPromise: true });
    if (r.exceptionDetails) console.error('--eval 오류:', r.exceptionDetails.text, r.exceptionDetails.exception?.description ?? '');
    await sleep(500);
  }
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const out = resolve(values.out!);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log(`저장: ${out}`);
  ws.close();
}

try {
  await main();
} finally {
  edge.kill();
  if (edge.pid) spawn('taskkill', ['/PID', String(edge.pid), '/T', '/F'], { stdio: 'ignore' });
}
process.exit(0);
