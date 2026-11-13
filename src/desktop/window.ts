import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BrowserWindow, app, protocol, screen, session } from 'electron';
import { CH, type DesktopCommand, type DragKind } from './api';
import { applyDrag, clampBounds, layoutKey, resolveBounds, type DisplayInfo, type Rect } from './bounds';
import { CSP, contentType, isAppUrl, resolveAppPath } from './protocol';
import { BottomLimiter, PageInput, Reattacher, adjustStep, isAtBottom, shouldKeepBottom } from './policy';
import type { Runtime } from './runtime';
import { loadDesktopSettings, saveDesktopSettings, type DesktopSettings } from './settings';
import { findProgman, isWindow, makeToolWindow, sendToBottom, setOwner, windowsBelow, type Hwnd } from './win32';

const WM_WINDOWPOSCHANGED = 0x47;
const ATTACH_FALLBACK_MS = 2000;
const PROGMAN_POLL_MS = 5000;
const DISPLAY_DEBOUNCE_MS = 500;

export type AttachMode = 'owned' | 'bottom';

// 뒤의 Task들이 바꾸는 상태. keepBottom이 읽는다.
export const windowState = { interactive: false, alwaysOnTop: false, adjusting: false, hidden: false };
// 시험 실행이 읽는 숫자.
export const blocked = { navigations: 0, popups: 0, bottomAsserts: 0 };

let runtime: Runtime;
let settings: DesktopSettings;
let settingsFile = '';
let adjustBefore: Rect | null = null;
let adjustBase: Rect | null = null;
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

// 창 상태가 바뀌었음을 알리는 곳(트레이 메뉴가 다시 만든다).
export const events = { onChange: (): void => {}, onPageGone: (): void => {} };

const pageInput = new PageInput();

// 입력 상태를 보고하던 화면이 사라졌거나 새로 뜨기 시작했다(다시 불러옴, 렌더러 종료, 창을 닫고 다시 만듦). 새 화면에는 열린 시트가 없으므로
// 창을 다시 입력을 받지 않는 상태로 돌리고 단축키 멈춤도 푼다. 새 페이지는 뜨기 시작할 때 되돌리므로(스크립트가 돌기 전)
// 로그인 화면 같은 새 페이지의 보고는 그 뒤에 와서 유지된다. 지금 창이 아닌 창의 늦은 사건과 끝내는 중에는 하지 않는다.
function pageGone(win: BrowserWindow, navigation: boolean): void {
  if (quitting || win !== current) return;
  if (navigation ? pageInput.navigationStart() : pageInput.reset(pageInput.generation)) {
    windowState.interactive = false;
    if (!win.isDestroyed()) {
      win.setFocusable(false);
      keepBottom();
    }
  }
  events.onPageGone();
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
  pageInput.report(on);
  windowState.interactive = on;
  if (on) {
    win.setFocusable(true);
    win.focus();
  } else {
    win.setFocusable(false);
    keepBottom();
  }
}

export const getSettings = (): DesktopSettings => settings;
export const settingsPath = (): string => settingsFile;

export function displayInfos(): DisplayInfo[] {
  const primary = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d) => ({ bounds: d.bounds, workArea: d.workArea, primary: d.id === primary }));
}
const workAreas = (): Rect[] => displayInfos().map((d) => d.workArea);

// 설정을 바꾸고 저장한다. 설정은 모두 이 길로만 쓴다.
export function updateSettings(patch: Partial<DesktopSettings>): void {
  settings = { ...settings, ...patch };
  saveSettings();
}

function saveSettings(): void {
  try {
    saveDesktopSettings(settingsFile, settings);
  } catch (e) {
    console.error('설정을 저장하지 못했다', e);
  }
}

// 메인 → 화면 명령. 화면이 죽었으면 보낼 곳이 없다.
export function sendCommand(c: DesktopCommand): void {
  const win = getWindow();
  try {
    if (win) win.webContents.send(CH.command, c);
  } catch {
    // 화면이 죽었으면 보낼 곳이 없다.
  }
}

function sendAdjust(win: BrowserWindow, active: boolean): void {
  if (win === current) sendCommand({ type: 'adjust', active });
}

// IPC를 보낸 곳이 지금 창의 앱 화면(주 프레임)인지 본다. 모든 처리기가 쓴다.
export function isFromWindow(e: { sender: Electron.WebContents; senderFrame?: Electron.WebFrameMain | null }): boolean {
  const win = getWindow();
  return !!win && e.sender === win.webContents && e.senderFrame === e.sender.mainFrame && isAppUrl(e.senderFrame?.url);
}

// 위치 및 크기 조정을 연다(메뉴의 "위치 및 크기"와 시험 실행이 부른다).
export function startAdjust(): void {
  const win = getWindow();
  if (!win) return;
  const step = adjustStep(windowState.adjusting, 'start');
  if (step.action === 'resend') {
    sendAdjust(win, true); // 덮개가 사라졌어도 다시 열린다
    return;
  }
  adjustBefore = win.getBounds();
  adjustBase = null;
  windowState.adjusting = step.adjusting;
  win.setFocusable(true); // 덮개에서 Esc를 받으려면 눌렀을 때 활성화될 수 있어야 한다
  win.setAlwaysOnTop(true);
  if (!win.isVisible()) win.showInactive();
  sendAdjust(win, true);
}

export function beginDrag(): void {
  const win = getWindow();
  if (win && windowState.adjusting) adjustBase = win.getBounds();
}

export function dragTo(kind: DragKind, dx: number, dy: number): void {
  const win = getWindow();
  if (!win || !windowState.adjusting || !adjustBase) return;
  win.setBounds(applyDrag(adjustBase, kind, dx, dy, workAreas()));
}

export function finishAdjust(apply: boolean, event: 'finish' | 'reload' = 'finish'): void {
  const win = getWindow();
  const step = adjustStep(windowState.adjusting, event);
  if (!win || step.action === 'none') return;
  const areas = workAreas();
  if (apply && event === 'finish') {
    const placed = clampBounds(win.getBounds(), areas);
    win.setBounds(placed);
    const displays = displayInfos();
    if (displays.length > 0) {
      settings = { ...settings, bounds: { ...settings.bounds, [layoutKey(displays)]: placed } };
      saveSettings();
    }
  } else if (adjustBefore) {
    win.setBounds(clampBounds(adjustBefore, areas)); // 그 사이 모니터가 빠졌어도 보이는 곳으로
  }
  adjustBefore = null;
  adjustBase = null;
  windowState.adjusting = step.adjusting;
  win.setFocusable(windowState.interactive);
  win.setAlwaysOnTop(settings.alwaysOnTop);
  windowState.alwaysOnTop = settings.alwaysOnTop;
  limiter.reached(); // 사용자가 직접 한 동작 뒤이므로 맨 아래로 보내는 횟수를 처음부터 센다.
  keepBottom();
  sendAdjust(win, false);
  if (layoutPending) scheduleLayout(); // 조정 중에 온 화면 구성 변화를 이제 반영한다
}

let layoutPending = false;
let layoutTimer: ReturnType<typeof setTimeout> | null = null;

// 화면 구성에 맞는 자리로 옮긴다. 모니터가 하나도 없거나 조정 중이면 미루고 다음 때에 다시 한다.
function scheduleLayout(): void {
  layoutPending = true;
  if (layoutTimer) clearTimeout(layoutTimer);
  layoutTimer = setTimeout(() => {
    layoutTimer = null;
    const win = getWindow();
    if (!win || windowState.adjusting) return; // finishAdjust가 다시 부른다
    const placed = resolveBounds(settings.bounds, displayInfos());
    if (!placed) return scheduleLayout();
    layoutPending = false;
    win.setBounds(placed);
  }, DISPLAY_DEBOUNCE_MS);
}

function watchDisplays(): void {
  screen.on('display-added', scheduleLayout);
  screen.on('display-removed', scheduleLayout);
  screen.on('display-metrics-changed', scheduleLayout);
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
    if (shouldKeepBottom(windowState)) toBottom(currentHwnd);
    return;
  }
  mode = 'bottom';
  win.showInactive();
  if (shouldKeepBottom(windowState)) toBottom(currentHwnd);
  const poll = setInterval(() => {
    if (win !== current || win.isDestroyed()) return clearInterval(poll);
    const found = findProgman();
    if (found === 0n) return;
    clearInterval(poll);
    adopt(found);
    if (shouldKeepBottom(windowState)) toBottom(currentHwnd);
  }, PROGMAN_POLL_MS);
}

export function createDesktopWindow(): BrowserWindow {
  const old = getWindow();
  if (old) {
    current = null; // closed 처리기가 예기치 않은 닫힘으로 보지 않게 먼저 뗀다.
    old.destroy();
  }
  const placed = resolveBounds(settings.bounds, displayInfos());
  if (!placed) scheduleLayout(); // 모니터가 없으면 기본 자리로 만들고 곧 제자리를 찾는다
  const win = new BrowserWindow({
    ...(placed ?? {}),
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
  windowState.adjusting = false;
  windowState.alwaysOnTop = settings.alwaysOnTop;
  win.setAlwaysOnTop(settings.alwaysOnTop);
  adjustBefore = null;
  adjustBase = null;
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

  win.webContents.on('render-process-gone', () => {
    finishAdjust(false, 'reload');
    pageGone(win, false);
  });
  win.webContents.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) pageGone(win, true);
  });
  win.webContents.on('did-finish-load', () => {
    finishAdjust(false, 'reload');
    sendCommand({ type: 'contentHidden', hidden: settings.contentHidden });
  });
  win.on('focus', keepBottom);
  win.hookWindowMessage(WM_WINDOWPOSCHANGED, keepBottom);
  win.on('show', () => {
    windowState.hidden = false;
    events.onChange();
  });
  win.on('hide', () => {
    windowState.hidden = true;
    events.onChange();
  });
  win.on('closed', () => {
    if (win !== current) return;
    pageGone(win, false);
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

export const isHidden = (): boolean => {
  const win = getWindow();
  return !win || !win.isVisible();
};

// 캘린더 숨기기와 보이기. 숨김은 저장하지 않는다. 위치 조정 중에는 숨기지 않는다.
export function toggleHidden(): void {
  const win = getWindow();
  if (!win) return;
  if (win.isVisible()) {
    if (!windowState.adjusting) win.hide();
  } else {
    showWindow();
  }
}

// 맨 위에 보기. 켜면 맨 아래 지키기가 멈추고, 끄면 다시 맨 아래로 보낸다. 위치 조정 중에는 조정이 끝날 때 반영된다.
export function setAlwaysOnTop(on: boolean): void {
  updateSettings({ alwaysOnTop: on });
  const win = getWindow();
  if (!win || windowState.adjusting) return;
  windowState.alwaysOnTop = on;
  win.setAlwaysOnTop(on);
  if (!on) {
    limiter.reached();
    keepBottom();
  }
}

export function setContentHidden(hidden: boolean): void {
  updateSettings({ contentHidden: hidden });
  sendCommand({ type: 'contentHidden', hidden });
}

// 창 만들기와 탐색기 재시작 대응을 시작한다.
export function startDesktopWindow(rt: Runtime, preload: string): void {
  runtime = rt;
  preloadPath = preload;
  settingsFile = join(rt.profileDir, 'settings.json');
  const loaded = loadDesktopSettings(settingsFile);
  if (loaded.status === 'corrupt') console.error('settings.json이 깨져 있어 settings.json.corrupt로 옮기고 기본 설정으로 시작한다');
  settings = loaded.settings;
  windowState.alwaysOnTop = settings.alwaysOnTop;
  watchDisplays();
  createDesktopWindow();
  setInterval(() => {
    if (!quitting && current && mode === 'owned' && !isWindow(currentProgman)) reattacher.ownerLost();
  }, PROGMAN_POLL_MS);
  setInterval(() => {
    if (!quitting && reattacher.tick(findProgman() !== 0n) === 'create') createDesktopWindow();
  }, 1000);
}
