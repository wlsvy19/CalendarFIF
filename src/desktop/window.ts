import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BrowserWindow, app, protocol, screen, session } from 'electron';
import { CH, type DesktopCommand, type DragKind } from './api';
import { applyDrag, clampBounds, layoutKey, resolveBounds, type DisplayInfo, type Rect } from './bounds';
import { CSP, contentType, isAppUrl, resolveAppPath } from './protocol';
import { BottomLimiter, CrashBackoff, PageInput, Reattacher, adjustStep, isAtBottom, isBlockedKey, leavesPage, ownerStatus, shouldKeepBottom } from './policy';
import type { Runtime } from './runtime';
import { loadDesktopSettings, saveDesktopSettings, type DesktopSettings } from './settings';
import { adoptWindow, findProgman, isWindow, sendToBottom, setToolStyle, windowsBelow, type Hwnd } from './win32';

const WM_WINDOWPOSCHANGED = 0x47;
const ATTACH_FALLBACK_MS = 2000;
const PROGMAN_POLL_MS = 5000;
const DISPLAY_DEBOUNCE_MS = 500;

export type AttachMode = 'owned' | 'bottom';

// 뒤의 Task들이 바꾸는 상태. keepBottom이 읽는다.
// hidden은 사용자가 캘린더를 숨겼는지다. 프로세스가 사는 동안 메인 프로세스가 갖고, 다시 만든 창에도 그대로 쓴다(저장하지 않는다).
export const windowState = { interactive: false, alwaysOnTop: false, adjusting: false, hidden: false };
// 시험 실행이 읽는 숫자.
export const blocked = { navigations: 0, popups: 0, bottomAsserts: 0, closes: 0, keys: 0 };

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
const crashes = new CrashBackoff();
// 지금 창에 걸린 타이머: 거절당한 맨 아래 보내기를 다시 해 보기, 죽은 화면을 다시 띄우기. 창이 없어지거나 앱이 끝나면 지운다.
let bottomRetry: ReturnType<typeof setTimeout> | null = null;
let reloadTimer: ReturnType<typeof setTimeout> | null = null;

function clearTimers(): void {
  if (bottomRetry) clearTimeout(bottomRetry);
  if (reloadTimer) clearTimeout(reloadTimer);
  bottomRetry = null;
  reloadTimer = null;
}

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
    if (!win.isDestroyed()) endInput(win);
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
  clearTimers();
}

// "맨 아래 지키기". 입력 중이 아니고 맨 아래가 아닐 때만 맨 아래로 보낸다.
// 리미터가 거절하면 리미터가 다음에 허락하는 때에 한 번 다시 해 본다.
export function keepBottom(): void {
  const win = getWindow();
  if (!win || !shouldKeepBottom({ ...windowState, hidden: windowState.hidden || !win.isVisible() })) return;
  const hwnd = currentHwnd;
  if (isAtBottom(windowsBelow(hwnd, currentProgman), currentProgman)) {
    limiter.reached();
    return;
  }
  const now = Date.now();
  if (!limiter.allow(now)) return retryBottom(limiter.nextAllowedAt(now) - now);
  setImmediate(() => {
    if (win === current && !win.isDestroyed()) toBottom(hwnd);
  });
}

// 기다리는 다시 해 보기는 하나뿐이다. 창이 없어지거나 앱이 끝나면 clearTimers가 지운다.
function retryBottom(delay: number): void {
  if (bottomRetry || quitting) return;
  bottomRetry = setTimeout(() => {
    bottomRetry = null;
    keepBottom();
  }, delay);
}

// 창 메시지 처리(Electron이 창 프로시저 안에서 동기로 부른다) 안에서는 Win32를 부르지 않는다. 확인은 다음 턴으로 미룬다.
const scheduleKeepBottom = (): void => {
  setImmediate(keepBottom);
};

// Electron은 Windows에서 setFocusable을 부를 때마다 작업 표시줄 단추를 되살린다(skipTaskbar를 끈다).
// 바꿀 때마다 작업 표시줄에서 다시 빼고, 붙어 있는 창이면 도구 창 모양(Alt+Tab에서 빠짐)을 다음 턴에 다시 건다.
function setFocusable(win: BrowserWindow, on: boolean): void {
  win.setFocusable(on);
  win.setSkipTaskbar(true);
  setImmediate(() => {
    if (win === current && !win.isDestroyed() && mode === 'owned') setToolStyle(currentHwnd);
  });
}

// 입력을 받는 상태가 끝났다(편집이나 설정을 닫음, 화면이 사라짐). 사용자가 한 동작 뒤이므로 맨 아래로 보내는 횟수를
// 처음부터 세고, 다음 턴에 맨 아래인지 본다.
function endInput(win: BrowserWindow): void {
  setFocusable(win, false);
  limiter.reached();
  scheduleKeepBottom();
}

export function setInteractive(on: boolean): void {
  const win = getWindow();
  if (!win) return;
  pageInput.report(on);
  windowState.interactive = on;
  if (on) {
    setFocusable(win, true);
    win.focus();
  } else {
    endInput(win);
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
  setFocusable(win, true); // 덮개에서 Esc를 받으려면 눌렀을 때 활성화될 수 있어야 한다
  win.setAlwaysOnTop(true);
  if (!win.isVisible()) {
    windowState.hidden = false; // 조정하려고 보인 캘린더는 숨김이 풀린 것으로 둔다
    win.showInactive();
  }
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
  setFocusable(win, windowState.interactive);
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

// 못 붙이면(Win32 호출이 막히면) 일반 맨 아래 창으로 남는다.
function adopt(progman: Hwnd): boolean {
  if (!adoptWindow(currentHwnd, progman)) return false;
  currentProgman = progman;
  mode = 'owned';
  return true;
}

// 붙인 창을 보인다. 사용자가 숨겨 둔 캘린더면 보이지 않은 채로 둔다(보이기를 누르면 showWindow가 보인다).
function reveal(win: BrowserWindow): void {
  if (windowState.hidden) return;
  win.showInactive();
  if (shouldKeepBottom(windowState)) toBottom(currentHwnd);
}

function attach(win: BrowserWindow): void {
  const progman = findProgman();
  if (progman !== 0n && adopt(progman)) {
    reveal(win);
    return;
  }
  mode = 'bottom';
  reveal(win);
  const poll = setInterval(() => {
    if (win !== current || win.isDestroyed()) return clearInterval(poll);
    const found = findProgman();
    if (found === 0n) return;
    clearInterval(poll);
    if (!adopt(found)) return;
    if (shouldKeepBottom(windowState)) toBottom(currentHwnd);
  }, PROGMAN_POLL_MS);
}

const startUrl = (): string => `app://calfif/index.html${runtime.emulator ? '?autologin=1' : ''}`;

// 화면(렌더러)이 죽었다. 투명한 창이 자리를 덮고 동기화도 멈추므로 잠시 뒤 같은 창에 화면을 다시 띄운다.
// 기다리는 시간은 CrashBackoff가 정한다. 끝내는 중이거나 그 사이 창이 바뀌었으면 하지 않는다.
function scheduleReload(win: BrowserWindow): void {
  if (quitting || win !== current) return;
  if (reloadTimer) clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    reloadTimer = null;
    if (quitting || win !== current || win.isDestroyed()) return;
    crashes.reloaded(Date.now());
    win.loadURL(startUrl()).catch(() => {}); // 다시 죽으면 render-process-gone이 다음 시도를 건다
  }, crashes.crashed(Date.now()));
}

// 화면 확대·축소는 늘 1이다(키는 isBlockedKey가 막고, 손가락 확대도 막는다).
function resetZoom(win: BrowserWindow): void {
  win.webContents.setZoomFactor(1);
  win.webContents.setVisualZoomLevelLimits(1, 1).catch(() => {});
}

export function createDesktopWindow(): BrowserWindow {
  const old = getWindow();
  clearTimers(); // 옛 창의 타이머는 새 창에 쓰지 않는다
  if (old) {
    current = null; // closed 처리기가 예기치 않은 닫힘으로 보지 않게 먼저 뗀다. destroy()는 close 사건을 내지 않는다.
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
    scheduleReload(win);
  });
  win.webContents.on('did-start-navigation', (details) => {
    if (leavesPage(details)) pageGone(win, true);
  });
  win.webContents.on('did-finish-load', () => {
    finishAdjust(false, 'reload');
    resetZoom(win);
    sendCommand({ type: 'contentHidden', hidden: settings.contentHidden });
  });
  // 다시 읽기와 확대·축소 키는 화면에 보내지 않는다(편집 중에 누르면 쓰던 글이 없어진다).
  win.webContents.on('before-input-event', (e, input) => {
    if (!isBlockedKey(input)) return;
    e.preventDefault();
    blocked.keys += 1;
  });
  // 사용자는 창을 닫을 수 없다(Alt+F4, 화면의 window.close). 앱이 끝날 때만 닫힌다.
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    blocked.closes += 1;
  });
  // 최소화할 수 없는 창이지만 그래도 최소화되면 활성화하지 않고 되돌린다. 창 메시지 처리 안이므로 다음 턴에 한다.
  win.on('minimize', () => {
    setImmediate(() => {
      if (win === current && !win.isDestroyed() && win.isMinimized() && !windowState.hidden) win.showInactive();
    });
  });
  win.on('focus', scheduleKeepBottom);
  win.hookWindowMessage(WM_WINDOWPOSCHANGED, scheduleKeepBottom);
  win.on('show', () => events.onChange());
  win.on('hide', () => events.onChange());
  win.on('closed', () => {
    if (win !== current) return;
    clearTimers();
    pageGone(win, false);
    current = null;
    mode = null;
    reattacher.closed(quitting);
  });

  void win.loadURL(startUrl());
  return win;
}

// 캘린더를 보인다(보이기, 설정 열기, 두 번째 실행). 아직 붙이지 않은 창은 붙일 때 보인다.
export function showWindow(): void {
  windowState.hidden = false;
  const win = getWindow();
  if (win && mode !== null && !win.isVisible()) win.showInactive();
  keepBottom();
}

export const isHidden = (): boolean => windowState.hidden;

// 캘린더 숨기기와 보이기. 숨김은 저장하지 않는다. 위치 조정 중에는 숨기지 않는다.
export function toggleHidden(): void {
  if (windowState.hidden) return showWindow();
  if (windowState.adjusting) return;
  windowState.hidden = true;
  getWindow()?.hide();
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

// 시험 실행에서만 쓴다: 붙어 있는 Progman 핸들을 이미 없어진 창의 핸들로 바꾼다.
// 탐색기가 다시 시작되어 Progman이 바뀌었을 때처럼, 주기적인 확인이 이를 알아채고 창을 다시 만들어야 한다.
export function setStaleProgmanForSmoke(stale: Hwnd): void {
  if (runtime.smoke) currentProgman = stale;
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
    if (!quitting && current && mode === 'owned' && ownerStatus(isWindow(currentProgman)) === 'lost') reattacher.ownerLost();
  }, PROGMAN_POLL_MS);
  setInterval(() => {
    if (!quitting && reattacher.tick(findProgman() !== 0n) === 'create') createDesktopWindow();
  }, 1000);
}
