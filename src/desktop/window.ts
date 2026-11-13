import { readFile } from 'node:fs/promises';
import { BrowserWindow, app, protocol, screen, session } from 'electron';
import { CSP, contentType, isAppUrl, resolveAppPath } from './protocol';
import { BottomLimiter, Reattacher, isAtBottom, shouldKeepBottom } from './policy';
import type { Runtime } from './runtime';
import { findProgman, isWindow, makeToolWindow, sendToBottom, setOwner, windowsBelow, type Hwnd } from './win32';

const WM_WINDOWPOSCHANGED = 0x47;
const ATTACH_FALLBACK_MS = 2000;
const PROGMAN_POLL_MS = 5000;

export type AttachMode = 'owned' | 'bottom';

// 뒤의 Task들이 바꾸는 상태. keepBottom이 읽는다.
export const windowState = { interactive: false, alwaysOnTop: false, adjusting: false, hidden: false };
// 시험 실행이 읽는 숫자.
export const blocked = { navigations: 0, popups: 0, bottomAsserts: 0 };

let runtime: Runtime;
let preloadPath: string;
let current: BrowserWindow | null = null;
let currentHwnd: Hwnd = 0n;
let currentProgman: Hwnd = 0n;
let mode: AttachMode | null = null;
let quitting = false;
let created = 0;
const reattacher = new Reattacher();
const limiter = new BottomLimiter();

function toBottom(hwnd: Hwnd): boolean {
  blocked.bottomAsserts += 1;
  return sendToBottom(hwnd);
}

export function registerAppProtocol(root: string): void {
  const headers = (file: string) => ({ 'content-type': contentType(file), 'content-security-policy': CSP });
  protocol.handle('app', async (request) => {
    const file = resolveAppPath(request.url, root);
    if (!file) return new Response('not found', { status: 404, headers: { 'content-security-policy': CSP } });
    try {
      return new Response(new Uint8Array(await readFile(file)), { headers: headers(file) });
    } catch {
      return new Response('not found', { status: 404, headers: { 'content-security-policy': CSP } });
    }
  });
}

// 모든 webContents에 붙이는 보안 규칙과 권한 거절.
export function installSecurity(): void {
  const deny = (e: { preventDefault(): void }, url: string) => {
    if (!isAppUrl(url)) {
      e.preventDefault();
      blocked.navigations += 1;
    }
  };
  app.on('web-contents-created', (_e, wc) => {
    wc.on('will-navigate', (e) => deny(e, e.url));
    wc.on('will-redirect', (e) => deny(e, e.url));
    wc.on('will-attach-webview', (e) => e.preventDefault());
    wc.setWindowOpenHandler(() => {
      blocked.popups += 1;
      return { action: 'deny' };
    });
  });
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
}

export const getWindow = (): BrowserWindow | null => (current && !current.isDestroyed() ? current : null);
export const getHwnd = (): Hwnd => currentHwnd;
export const getProgman = (): Hwnd => currentProgman;
export const getMode = (): AttachMode | null => mode;
// 시험 실행이 읽는다.
export const signals = { secondInstance: 0 };
export const windowsCreated = (): number => created;

export function markQuitting(): void {
  quitting = true;
}

// "맨 아래 지키기". 입력 중이 아니고 맨 아래가 아닐 때만 맨 아래로 보낸다.
export function keepBottom(): void {
  const win = getWindow();
  if (!win || !shouldKeepBottom({ ...windowState, hidden: windowState.hidden || !win.isVisible() })) return;
  const hwnd = currentHwnd;
  if (isAtBottom(windowsBelow(hwnd, currentProgman), currentProgman)) {
    limiter.reached();
    return;
  }
  if (!limiter.allow(Date.now())) return;
  setImmediate(() => {
    if (win === current && !win.isDestroyed()) toBottom(hwnd);
  });
}

export function setInteractive(on: boolean): void {
  const win = getWindow();
  if (!win) return;
  windowState.interactive = on;
  if (on) {
    win.setFocusable(true);
    win.focus();
  } else {
    win.setFocusable(false);
    keepBottom();
  }
}

function placement() {
  const wa = screen.getPrimaryDisplay().workArea;
  const width = Math.min(900, wa.width);
  const height = Math.min(700, wa.height);
  return { width, height, x: wa.x + wa.width - width, y: wa.y + Math.round((wa.height - height) / 2) };
}

function adopt(progman: Hwnd): void {
  setOwner(currentHwnd, progman);
  makeToolWindow(currentHwnd);
  currentProgman = progman;
  mode = 'owned';
}

function attach(win: BrowserWindow): void {
  const progman = findProgman();
  if (progman !== 0n) {
    adopt(progman);
    win.showInactive();
    toBottom(currentHwnd);
    return;
  }
  mode = 'bottom';
  win.showInactive();
  toBottom(currentHwnd);
  const poll = setInterval(() => {
    if (win !== current || win.isDestroyed()) return clearInterval(poll);
    const found = findProgman();
    if (found === 0n) return;
    clearInterval(poll);
    adopt(found);
    toBottom(currentHwnd);
  }, PROGMAN_POLL_MS);
}

export function createDesktopWindow(): BrowserWindow {
  const old = getWindow();
  if (old) {
    current = null; // closed 처리기가 예기치 않은 닫힘으로 보지 않게 먼저 뗀다.
    old.destroy();
  }
  const win = new BrowserWindow({
    ...placement(),
    frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false, skipTaskbar: true,
    resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false,
    show: false, focusable: false,
    webPreferences: {
      preload: preloadPath, contextIsolation: true, nodeIntegration: false, sandbox: true,
      spellcheck: false, backgroundThrottling: false, devTools: !app.isPackaged,
    },
  });
  current = win;
  currentHwnd = win.getNativeWindowHandle().readBigInt64LE(0);
  currentProgman = 0n;
  mode = null;
  windowState.interactive = false;
  limiter.reached();
  created += 1;

  // 잠금 화면 등으로 첫 그림이 늦어도 붙도록, ready-to-show가 없으면 잠시 뒤에 붙인다.
  let attached = false;
  const once = () => {
    if (attached || win.isDestroyed() || win !== current) return;
    attached = true;
    attach(win);
  };
  win.once('ready-to-show', once);
  setTimeout(once, ATTACH_FALLBACK_MS);

  win.on('focus', keepBottom);
  win.hookWindowMessage(WM_WINDOWPOSCHANGED, keepBottom);
  win.on('show', () => { windowState.hidden = false; });
  win.on('hide', () => { windowState.hidden = true; });
  win.on('closed', () => {
    if (win !== current) return;
    current = null;
    mode = null;
    reattacher.closed(quitting);
  });

  void win.loadURL(`app://calfif/index.html${runtime.emulator ? '?autologin=1' : ''}`);
  return win;
}

export function showWindow(): void {
  const win = getWindow();
  if (win && !win.isVisible()) win.showInactive();
  keepBottom();
}

// 창 만들기와 탐색기 재시작 대응을 시작한다.
export function startDesktopWindow(rt: Runtime, preload: string): void {
  runtime = rt;
  preloadPath = preload;
  createDesktopWindow();
  setInterval(() => {
    if (!quitting && current && mode === 'owned' && !isWindow(currentProgman)) reattacher.ownerLost();
  }, PROGMAN_POLL_MS);
  setInterval(() => {
    if (!quitting && reattacher.tick(findProgman() !== 0n) === 'create') createDesktopWindow();
  }, 1000);
}
