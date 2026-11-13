import { existsSync, statSync, watch } from 'node:fs';
import { win32 } from 'node:path';

export type FollowerOptions = {
  dbPath: string;
  runOnce(): Promise<void>;
  debounceMs?: number;
  pollMs?: number;
  watchDir?(dir: string, onEvent: (fileName: string | null) => void): { close(): void };
  fingerprint?(): string;
  log?(line: string): void;
};

function defaultWatchDir(dir: string, onEvent: (fileName: string | null) => void, log: (line: string) => void): { close(): void } {
  const watcher = watch(dir, (_event, fileName) => onEvent(fileName === null ? null : String(fileName)));
  watcher.on('error', (e) => log(`폴더 감시 오류: ${e instanceof Error ? e.message : String(e)}`));
  return watcher;
}

function defaultFingerprint(dbPath: string): string {
  try {
    const s = statSync(dbPath);
    return `${s.size}:${s.mtimeMs}:${existsSync(`${dbPath}-journal`) ? 'j' : ''}`;
  } catch {
    return 'missing';
  }
}

/**
 * DesktopCal 데이터 폴더를 지켜보다가 바뀌면 runOnce를 부른다.
 * 이벤트는 debounceMs 동안 모아 한 번만 돌고, 도는 중에 온 이벤트는 끝난 뒤 한 번 더 돈다.
 * 감시 이벤트를 놓쳐도 pollMs마다 파일 지문을 견주어 바뀌었으면 돈다.
 */
export function createFollower(opts: FollowerOptions): { start(): void; stop(): void } {
  const debounceMs = opts.debounceMs ?? 2000;
  const pollMs = opts.pollMs ?? 30000;
  const log = opts.log ?? ((line: string) => console.error(line));
  const fingerprint = opts.fingerprint ?? (() => defaultFingerprint(opts.dbPath));
  const watchDir = opts.watchDir ?? ((dir, onEvent) => defaultWatchDir(dir, onEvent, log));
  const dbName = win32.basename(opts.dbPath).toLowerCase();

  let stopped = true;
  let running = false;
  let pending = false;
  let lastPrint = '';
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let poll: ReturnType<typeof setInterval> | undefined;
  let watcher: { close(): void } | undefined;

  const readPrint = (): string => {
    try {
      return fingerprint();
    } catch {
      return 'error';
    }
  };

  async function run(): Promise<void> {
    running = true;
    lastPrint = readPrint();
    try {
      await opts.runOnce();
    } catch (e) {
      log(`올리지 못했습니다: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      running = false;
    }
    if (pending && !stopped) {
      pending = false;
      void run();
    }
  }

  function trigger(): void {
    if (stopped) return;
    if (running) {
      pending = true;
      return;
    }
    void run();
  }

  function onEvent(fileName: string | null): void {
    if (stopped) return;
    // 같은 폴더의 다른 파일은 무시한다. 이름을 모르는 이벤트는 받아들인다.
    if (fileName !== null && !win32.basename(fileName).toLowerCase().startsWith(dbName)) return;
    if (debounce !== undefined) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = undefined;
      trigger();
    }, debounceMs);
  }

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      lastPrint = readPrint();
      watcher = watchDir(win32.dirname(opts.dbPath), onEvent);
      poll = setInterval(() => {
        if (readPrint() !== lastPrint) trigger();
      }, pollMs);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      pending = false;
      if (debounce !== undefined) clearTimeout(debounce);
      if (poll !== undefined) clearInterval(poll);
      debounce = undefined;
      poll = undefined;
      watcher?.close();
      watcher = undefined;
    },
  };
}
