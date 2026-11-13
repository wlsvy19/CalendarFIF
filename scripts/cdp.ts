// Edge를 DevTools 프로토콜로 조작하는 공용 부분. shot.ts, mobile-preview.ts, touch-check.ts가 쓴다.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

export const EDGE_PATHS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

export function findEdge(exists: (p: string) => boolean = existsSync): string | null {
  return EDGE_PATHS.find((p) => exists(p)) ?? null;
}

export type Cdp = {
  send(method: string, params?: object): Promise<any>;
  evaluate<T>(expression: string): Promise<T>;
  close(): void;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Edge를 띄워 첫 페이지에 DevTools로 연결한다. `closed`는 브라우저가 끝나거나 그 페이지의 창이 닫히면 풀린다.
 * 창을 닫아도 Edge가 백그라운드에 남는 PC가 있어서 프로세스가 끝나기만 기다리지 않는다.
 */
export async function launchEdge(opts: {
  headless: boolean;
  profileDir: string;
  args?: string[];
  url?: string;
}): Promise<{ cdp: Cdp; closed: Promise<void>; kill(): void }> {
  const exe = findEdge();
  if (!exe) throw new Error('Microsoft Edge를 찾지 못했습니다.');
  const port = 9222 + Math.floor(Math.random() * 500);
  mkdirSync(opts.profileDir, { recursive: true });
  const edge: ChildProcess = spawn(
    exe,
    [
      ...(opts.headless ? ['--headless=new', '--disable-gpu'] : []),
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${resolve(opts.profileDir)}`,
      '--no-first-run',
      '--no-default-browser-check',
      ...(opts.args ?? []),
      ...((opts.args ?? []).some((a) => a.startsWith('--app=')) ? [] : [opts.url ?? 'about:blank']),
    ],
    { stdio: 'ignore' },
  );
  let markClosed = (): void => {};
  const closed = new Promise<void>((done) => {
    markClosed = done;
  });
  edge.once('exit', markClosed);
  const kill = (): void => {
    edge.kill();
    if (edge.pid) spawnSync('taskkill', ['/PID', String(edge.pid), '/T', '/F'], { stdio: 'ignore' });
  };
  try {
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
    ws.onclose = () => markClosed();
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
      pending.delete(id);
      if (reply.error) throw new Error(`${method}: ${reply.error.message}`);
      return reply.result;
    };
    const evaluate = async <T>(expression: string): Promise<T> => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value as T;
    };
    return { cdp: { send, evaluate, close: () => ws.close() }, closed, kill };
  } catch (e) {
    kill();
    throw e;
  }
}

/** 폰 크기 창이 쓰는 프로필 폴더 이름. 내 PC의 주소(에뮬레이터)는 실제 웹앱과 폴더를 따로 쓴다. */
export function previewProfile(url: string): string {
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    /* 주소로 읽을 수 없으면 실제 웹앱 쪽 폴더를 쓴다 */
  }
  return host === 'localhost' || host === '127.0.0.1' ? 'edge-profile-mobile-emu' : 'edge-profile-mobile';
}

export type EdgeProcess = { pid: number; port: number | null };

/**
 * `Get-CimInstance Win32_Process | ConvertTo-Json`의 출력에서, 그 프로필 폴더로 뜬 브라우저 본체를 고른다.
 * 자식 프로세스(--type=...)와 이름이 이어지는 다른 폴더는 뺀다. port는 명령줄의 DevTools 포트다.
 */
export function parseEdgeProcesses(json: string, profileDir: string): EdgeProcess[] {
  let rows: unknown;
  try {
    rows = JSON.parse(json);
  } catch {
    return [];
  }
  const needle = `--user-data-dir=${resolve(profileDir)}`.toLowerCase();
  const found: EdgeProcess[] = [];
  for (const row of Array.isArray(rows) ? rows : [rows]) {
    const { ProcessId, CommandLine } = (row ?? {}) as { ProcessId?: unknown; CommandLine?: unknown };
    if (typeof ProcessId !== 'number' || typeof CommandLine !== 'string' || CommandLine.includes('--type=')) continue;
    const at = CommandLine.toLowerCase().indexOf(needle);
    if (at < 0) continue;
    const after = CommandLine[at + needle.length];
    if (after !== undefined && after !== ' ' && after !== '"') continue;
    const port = /--remote-debugging-port=(\d+)/.exec(CommandLine);
    found.push({ pid: ProcessId, port: port ? Number(port[1]) : null });
  }
  return found;
}

/** 이 프로필 폴더로 지금 떠 있는 Edge(브라우저 본체)를 찾는다. 다른 Edge의 명령줄은 PowerShell 밖으로 나오지 않는다. */
export function findEdgeByProfile(profileDir: string): EdgeProcess[] {
  const script =
    "Get-CimInstance Win32_Process -Filter 'Name=''msedge.exe''' | Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($env:CALFIF_PROFILE_DIR, [StringComparison]::OrdinalIgnoreCase) -ge 0 } | Select-Object ProcessId, CommandLine | ConvertTo-Json -Compress";
  const out = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    env: { ...process.env, CALFIF_PROFILE_DIR: resolve(profileDir) },
  });
  return parseEdgeProcesses(out.stdout ?? '', profileDir);
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * 이 프로필 폴더로 떠 있는 Edge를 닫고, 닫은 개수를 돌려준다. 같은 폴더로 Edge를 또 띄우면 새 프로세스가 뜨지 않고
 * 먼저 뜬 쪽이 빈 창만 하나 더 열기 때문에, 띄우기 전에 부른다. DevTools로 닫기를 청하고(로그인 정보가 저장된다) 5초 안에 안 끝나면 끝낸다.
 */
export async function closeEdgeByProfile(profileDir: string): Promise<number> {
  const running = findEdgeByProfile(profileDir);
  for (const { pid, port } of running) {
    if (port !== null) {
      try {
        const version = (await (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(2000) })).json()) as { webSocketDebuggerUrl: string };
        const ws = new WebSocket(version.webSocketDebuggerUrl);
        await new Promise<void>((ok, fail) => {
          ws.onopen = () => ok();
          ws.onerror = () => fail(new Error('WebSocket 연결 실패'));
        });
        ws.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
      } catch {
        /* 답이 없으면 아래에서 끝낸다 */
      }
    }
    for (let i = 0; i < 50 && alive(pid); i++) await sleep(100);
    if (alive(pid)) spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    for (let i = 0; i < 30 && alive(pid); i++) await sleep(100);
  }
  return running.length;
}

// iPhone 17 Pro의 CSS 크기. 사용자 에이전트는 최근 아이폰 Safari의 것이다.
export const PHONE = {
  width: 402,
  height: 874,
  deviceScaleFactor: 3,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
} as const;

/** 페이지를 폰처럼 보이게 한다. 마우스 끌기는 터치 입력으로 전달된다. */
export async function emulatePhone(cdp: Cdp, opts: { reducedMotion?: boolean } = {}): Promise<void> {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: PHONE.width,
    height: PHONE.height,
    deviceScaleFactor: PHONE.deviceScaleFactor,
    mobile: true,
  });
  await cdp.send('Emulation.setUserAgentOverride', { userAgent: PHONE.userAgent });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await cdp.send('Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' });
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: opts.reducedMotion ? 'reduce' : 'no-preference' }],
  });
}

/** `vite --mode emulator`를 띄우고 주소가 열릴 때까지 기다린다. stop()으로 끝낸다. */
export async function startVite(url = 'http://localhost:5173/'): Promise<{ stop(): void }> {
  const vite = spawn('npx', ['vite', '--mode', 'emulator', '--port', '5173', '--strictPort'], { stdio: 'ignore', shell: true });
  const stop = (): void => {
    // 바로 process.exit()로 끝나도 남지 않게 기다렸다가 돌아온다.
    if (vite.pid) spawnSync('taskkill', ['/PID', String(vite.pid), '/T', '/F'], { stdio: 'ignore' });
  };
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url)).ok) return { stop };
    } catch {
      /* 아직 안 떴다 */
    }
    await sleep(300);
  }
  stop();
  throw new Error('Vite 개발 서버가 뜨지 않았다');
}
