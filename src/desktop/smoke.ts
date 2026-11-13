import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { BrowserWindow, Menu, app, globalShortcut, type MenuItem } from 'electron';
import type { SystemPatch, SystemState } from './api';
import type { MenuAction } from './menu';
import { trayMenu } from './tray';
import { clampBounds, defaultBounds, layoutKey, resolveBounds, type Rect } from './bounds';
import { isAtBottom } from './policy';
import type { Runtime, Scenario } from './runtime';
import { loadDesktopSettings } from './settings';
import { findProgman, getExStyle, getOwner, isWindow, nativeLoaded, nestedNativeCalls, windowsBelow } from './win32';
import {
  blocked, displayInfos, getHwnd, getMode, getProgman, getSettings, getWindow, sendCommand, setStaleProgmanForSmoke, signals, startAdjust, windowState, windowsCreated,
} from './window';

// main.ts가 메뉴 항목과 단축키가 부르는 길을 시험 실행에 건넨다.
export type Desk = { runAction(a: MenuAction): void; applySystem(p: SystemPatch): SystemState };
type Result = { fields: Record<string, unknown>; checks: Record<string, boolean> };
const TOTAL_MS = 60000;
const BRIDGE_KEYS = ['adjustDone', 'drag', 'dragStart', 'getSystem', 'onCommand', 'setInteractive', 'setSystem', 'showMenu'];
const HIDE_KEY = 'Ctrl+Alt+Shift+F9';
const CONTENT_KEY = 'Ctrl+Alt+Shift+F10';
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function until(test: () => boolean | Promise<boolean>, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await test()) return true;
    await sleep(100);
  }
  return test();
}

// 시험 실행에서는 "Windows 시작 시 실행" 등록을 막고 부른 횟수만 센다.
let loginItemCalls = 0;
export function guardLoginItem(): void {
  app.setLoginItemSettings = () => {
    loginItemCalls += 1;
  };
}

const js = (win: BrowserWindow, code: string): Promise<unknown> => win.webContents.executeJavaScript(code, true);
// 화면이 죽어 있는 동안에는 executeJavaScript가 던지거나 끝나지 않을 수 있다. 1초 안에 답이 없으면 fallback이다.
async function jsOr(win: BrowserWindow, code: string, fallback: unknown): Promise<unknown> {
  try {
    return await Promise.race([js(win, code), sleep(1000).then(() => fallback)]);
  } catch {
    return fallback;
  }
}
const bottomNow = (): boolean => isAtBottom(windowsBelow(getHwnd(), getProgman()), getProgman());
// 도구 창 모양: WS_EX_TOOLWINDOW가 켜져 있고 WS_EX_APPWINDOW가 꺼져 있다(작업 표시줄과 Alt+Tab에서 빠짐).
const toolStyle = (): boolean => {
  const ex = getExStyle(getHwnd());
  return (ex & 0x80) !== 0 && (ex & 0x40000) === 0;
};

const RENDERED = "document.querySelector('.app.calendar') ? 'calendar' : (document.querySelector('form') ? 'login' : '')";

async function measure(win: BrowserWindow) {
  const hwnd = getHwnd();
  const progman = getProgman();
  const ex = getExStyle(hwnd);
  return {
    mode: getMode(),
    ownerIsProgman: progman !== 0n && getOwner(hwnd) === progman,
    atBottom: isAtBottom(windowsBelow(hwnd, progman), progman),
    toolWindow: (ex & 0x80) !== 0,
    appWindow: (ex & 0x40000) !== 0,
    focusable: win.isFocusable(),
    visible: win.isVisible(),
    progman: `0x${progman.toString(16)}`,
    owner: `0x${getOwner(hwnd).toString(16)}`,
  };
}

// 잠금 화면 뒤에서는 그림이 비어 있을 수 있다. 비면 shot은 null이다(실패 아님).
async function capture(win: BrowserWindow, scenario: Scenario): Promise<{ shot: string | null; cornerTransparent: boolean | null }> {
  const image = await Promise.race([win.webContents.capturePage(), sleep(5000).then(() => null)]).catch(() => null);
  if (!image || image.isEmpty()) return { shot: null, cornerTransparent: null };
  const shots = join(dirname(dirname(app.getPath('userData'))), 'shots');
  mkdirSync(shots, { recursive: true });
  writeFileSync(join(shots, `desktop-${scenario}.png`), image.toPNG());
  return { shot: `build/shots/desktop-${scenario}.png`, cornerTransparent: image.toBitmap()[3] === 0 };
}

function secondInstance(): Promise<{ exitCode: number | null; notified: boolean }> {
  const before = signals.secondInstance;
  return new Promise((resolve) => {
    const child = spawn(process.execPath, process.argv.slice(1), { env: process.env, stdio: 'ignore', windowsHide: true });
    const timer = setTimeout(() => child.kill(), 15000);
    child.on('exit', async (code) => {
      clearTimeout(timer);
      await until(() => signals.secondInstance > before, 2000);
      resolve({ exitCode: code, notified: signals.secondInstance > before });
    });
    child.on('error', () => resolve({ exitCode: null, notified: false }));
  });
}

async function attach(_rt: Runtime, desk: Desk): Promise<Result> {
  let win = getWindow();
  if (!win) return { fields: {}, checks: { window: false } };
  const first0 = win;
  const firstHwnd = getHwnd();
  await until(() => getMode() !== null, 10000);
  await until(async () => (await js(first0, RENDERED)) === 'calendar', 15000);
  const rendered = (await js(first0, RENDERED)) as string;
  // 로그인 화면은 입력을 위해 창을 활성화 가능하게 둔다. 달력으로 넘어가 입력이 끝나면 다시 맨 아래로 간다.
  await until(() => !first0.isFocusable() && bottomNow(), 3000);
  const first = await measure(win);
  const bridgeKeys = (await js(win, 'Object.keys(window.calfifDesktop || {}).sort()')) as string[];
  const rendererGlobals = (await js(win, '[typeof require, typeof process].join(",")')) as string;
  // Electron의 기본 메뉴가 없고(그 단축키도 없다) 창은 최소화할 수 없다.
  const applicationMenu = Menu.getApplicationMenu() === null ? null : 'installed';
  const minimizable = first0.isMinimizable();

  const navBefore = blocked.navigations;
  const popBefore = blocked.popups;
  const popup = await js(win, "(() => { const w = window.open('https://example.invalid/'); location.href = 'https://example.invalid/'; return w === null; })()");
  await sleep(500);
  const stayed = win.webContents.getURL().startsWith('app://calfif/');
  const navigationBlocked = stayed && blocked.navigations > navBefore;
  const popupBlocked = popup === true && blocked.popups > popBefore;

  // 입력을 받는 동안과 끝난 뒤에도 도구 창 모양이 남는다(Electron의 setFocusable이 작업 표시줄 단추를 되살리므로 앱이 다시 뺀다).
  const interactive: boolean[] = [];
  const toolWindowDuring: boolean[] = [];
  for (const on of [true, false]) {
    await js(first0, `window.calfifDesktop.setInteractive(${on})`);
    await until(() => first0.isFocusable() === on, 2000);
    interactive.push(first0.isFocusable());
    await sleep(200); // 도구 창 모양은 다음 턴에 다시 건다
    toolWindowDuring.push(toolStyle());
  }
  const atBottomAfterInteractive = await until(bottomNow, 2000);

  const shotInfo = await capture(first0, 'attach');

  // 탐색기 재시작 흉내: 창을 없애면 5초 안에 다시 붙은 창이 있어야 한다.
  const createdBefore = windowsCreated();
  first0.destroy();
  const recreated = await until(() => windowsCreated() > createdBefore && getMode() === 'owned', 5000);
  win = getWindow();
  const second = win ? await measure(win) : null;
  // 맨 아래로 보낸 횟수는 여기까지(보통의 동작)만 센다. 아래 시험은 일부러 맨 아래가 아닌 상태를 만든다.
  const bottomAssertsNormal = blocked.bottomAsserts;

  // 앱이 끝나는 중이 아니면 창을 닫을 수 없다(Alt+F4와 같은 길). 닫혔으면 다시 만든 창으로 이어 간다.
  let closeBlocked = false;
  if (win) {
    const closesBefore = blocked.closes;
    const createdBeforeClose = windowsCreated();
    win.close();
    await sleep(500);
    closeBlocked = !win.isDestroyed() && win.isVisible() && getWindow() === win && windowsCreated() === createdBeforeClose && blocked.closes > closesBefore;
    if (!closeBlocked) await until(() => windowsCreated() > createdBeforeClose && getMode() === 'owned', 5000);
  }

  let minimizeRestored = false;
  let crash: Record<string, unknown> = { crashRecovered: false };
  let ownerLost: Record<string, unknown> = { ownerLostRecovered: false };
  const w = getWindow();
  if (w) {
    await until(async () => (await jsOr(w, RENDERED, '')) === 'calendar' && !w.isFocusable(), 15000);
    // 그래도 최소화되면 활성화하지 않고 되돌린다.
    w.minimize();
    minimizeRestored = await until(() => !w.isMinimized() && w.isVisible() && !w.isFocusable(), 2000);
    crash = await crashAndRecover(w, desk);
    ownerLost = await loseOwner(firstHwnd);
  }

  const instance = await secondInstance();
  const fields = {
    ...first, rendered, bridgeKeys, rendererGlobals, applicationMenu, minimizable, navigationBlocked, popupBlocked, interactive,
    toolWindowWhileInteractive: toolWindowDuring[0], toolWindowAfterInteractive: toolWindowDuring[1], atBottomAfterInteractive, closeBlocked,
    recreated, ownerIsProgmanAfterRecreate: second?.ownerIsProgman ?? false, atBottomAfterRecreate: second?.atBottom ?? false, minimizeRestored, ...crash, ...ownerLost,
    loginItemCalls, nativeLoaded: nativeLoaded(), nestedNativeCalls: nestedNativeCalls(), bottomAsserts: bottomAssertsNormal, bottomAssertsTotal: blocked.bottomAsserts,
    secondInstance: instance, ...shotInfo,
  };
  const checks = {
    mode: first.mode === 'owned', ownerIsProgman: first.ownerIsProgman, atBottom: first.atBottom, toolWindow: first.toolWindow,
    appWindow: !first.appWindow, focusable: !first.focusable, visible: first.visible, rendered: rendered === 'calendar',
    bridgeKeys: JSON.stringify(bridgeKeys) === JSON.stringify(BRIDGE_KEYS), rendererGlobals: rendererGlobals === 'undefined,undefined',
    applicationMenu: applicationMenu === null, minimizable: minimizable === false, closeBlocked, minimizeRestored,
    navigationBlocked, popupBlocked, interactive: interactive[0] === true && interactive[1] === false, atBottomAfterInteractive,
    toolWindowWhileInteractive: toolWindowDuring[0] === true, toolWindowAfterInteractive: toolWindowDuring[1] === true,
    recreated, ownerIsProgmanAfterRecreate: fields.ownerIsProgmanAfterRecreate, crashRecovered: crash.crashRecovered === true, ownerLostRecovered: ownerLost.ownerLostRecovered === true,
    loginItemCalls: loginItemCalls === 0, nativeLoaded: fields.nativeLoaded, nestedNativeCalls: fields.nestedNativeCalls === 0,
    secondInstance: instance.exitCode === 0 && instance.notified, bottomAsserts: bottomAssertsNormal <= 20,
  };
  return { fields, checks };
}

const registeredHotkeys = (): number => [HIDE_KEY, CONTENT_KEY].filter((k) => globalShortcut.isRegistered(k)).length;

// 화면(렌더러)을 Electron의 길로 죽인다. 입력 중(단축키 멈춤)이었어도 죽은 뒤 5초 안에 같은 창에 달력이 다시 그려지고,
// 창은 입력을 받지 않으며 맨 아래에 있고, 켜 둔 단축키(하나)가 다시 등록되어야 한다. 시간은 render-process-gone에서 잰다.
async function crashAndRecover(win: BrowserWindow, desk: Desk): Promise<Record<string, unknown>> {
  desk.applySystem({ hideHotkey: { accelerator: HIDE_KEY, enabled: true } });
  await js(win, 'window.calfifDesktop.setInteractive(true)');
  const pausedBeforeCrash = await until(() => win.isFocusable() && registeredHotkeys() === 0, 3000);
  let goneAt = 0;
  let reloadStartedMs: number | null = null;
  let loaded = false;
  const gone = new Promise<string>((resolve) =>
    win.webContents.once('render-process-gone', (_e, d) => {
      goneAt = Date.now();
      win.webContents.once('did-start-navigation', () => (reloadStartedMs = Date.now() - goneAt));
      win.webContents.once('did-finish-load', () => (loaded = true));
      resolve(d.reason);
    }),
  );
  win.webContents.forcefullyCrashRenderer();
  const crashReason = await Promise.race([gone, sleep(3000).then(() => 'none')]);
  if (crashReason === 'none') return { crashRecovered: false, crashReason, pausedBeforeCrash };
  // 죽은 화면이나 읽는 중인 화면에는 묻지 않는다(executeJavaScript가 늦게 답해 잰 시간이 늘어난다).
  const recovered = async () =>
    loaded && getWindow() === win && !win.isFocusable() && registeredHotkeys() === 1 && bottomNow() && (await jsOr(win, RENDERED, '')) === 'calendar';
  const ok = await until(recovered, Math.max(0, 5000 - (Date.now() - goneAt)));
  const crashRecoveredMs = Date.now() - goneAt;
  desk.applySystem({ hideHotkey: { accelerator: HIDE_KEY, enabled: false } });
  return { crashRecovered: pausedBeforeCrash && ok && crashRecoveredMs <= 5000, crashReason, crashRecoveredMs, reloadStartedMs, pausedBeforeCrash };
}

// 탐색기 재시작 흉내(실제 길): 붙어 있는 Progman 핸들을 이미 없어진 창(앞에서 없앤 첫 창)의 핸들로 바꾼다.
// 주기적인 확인이 이를 알아채고 8초 안에 실제 Progman이 소유한, 보이고 입력을 받지 않으며 맨 아래인 창 하나가 있어야 한다.
async function loseOwner(stale: bigint): Promise<Record<string, unknown>> {
  const staleIsWindow = isWindow(stale);
  const before = getWindow();
  const createdBefore = windowsCreated();
  setStaleProgmanForSmoke(stale);
  const lostAt = Date.now();
  const ok = await until(() => {
    const w = getWindow();
    if (!w || w === before || windowsCreated() <= createdBefore || getMode() !== 'owned') return false;
    const real = findProgman();
    return real !== 0n && getProgman() === real && getOwner(getHwnd()) === real && w.isVisible() && !w.isFocusable() && bottomNow() && BrowserWindow.getAllWindows().length === 1;
  }, 8000);
  return { ownerLostRecovered: staleIsWindow === false && ok, ownerLostRecoveredMs: Date.now() - lostAt, staleIsWindow, windowsAfterOwnerLost: BrowserWindow.getAllWindows().length };
}

const same = (a: Rect, b: Rect | null | undefined) => !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
const rectOf = (r: Rect): Rect => ({ x: r.x, y: r.y, width: r.width, height: r.height });

// 위치 조정을 앱 안의 길(IPC 메시지와 setBounds)로만 움직여 본다. 마우스 입력은 흉내 내지 않는다.
async function bounds(rt: Runtime): Promise<Result> {
  const win = getWindow();
  if (!win) return { fields: {}, checks: { window: false } };
  await until(() => getMode() !== null, 10000);
  await until(async () => (await js(win, RENDERED)) !== '', 15000);
  const displays = displayInfos();
  const key = layoutKey(displays);
  const initial = rectOf(win.getBounds());
  const overlayOpen = async (open: boolean) => until(async () => ((await js(win, "!!document.querySelector('.adjust')")) as boolean) === open, 3000);
  const send = (code: string) => js(win, `window.calfifDesktop.${code}`);
  const bottom = () => isAtBottom(windowsBelow(getHwnd(), getProgman()), getProgman());

  startAdjust();
  const topDuring = win.isAlwaysOnTop();
  const overlayShown = await overlayOpen(true);
  await send('dragStart()');
  await send("drag('move', -50000, 0)");
  await until(() => win.getBounds().x !== initial.x, 3000);
  const offscreen = rectOf(win.getBounds());
  const visibleOverlap = displays.some((d) => {
    const w = d.workArea;
    return Math.min(offscreen.x + offscreen.width, w.x + w.width) - Math.max(offscreen.x, w.x) >= 80 && Math.min(offscreen.y + offscreen.height, w.y + w.height) - Math.max(offscreen.y, w.y) >= 80;
  });
  await send('adjustDone(false)');
  await until(() => !windowState.adjusting, 3000);
  await until(() => win.getBounds().x === initial.x, 3000);
  const cancelled = rectOf(win.getBounds());
  const overlayClosedAfterCancel = await overlayOpen(false);

  startAdjust();
  await send('dragStart()');
  await send("drag('se', -200, -100)");
  await until(() => win.getBounds().width !== initial.width, 3000);
  await send('adjustDone(true)');
  await until(() => !windowState.adjusting, 3000);
  const applied = rectOf(win.getBounds());
  const topAfter = win.isAlwaysOnTop();
  const atBottomAfter = await until(bottom, 3000);
  const overlayClosedAfterApply = await overlayOpen(false);

  const saved = loadDesktopSettings(join(rt.profileDir, 'settings.json'));
  const savedBounds = saved.settings.bounds[key];
  const reloaded = resolveBounds(saved.settings.bounds, displays);
  const fields = {
    layoutKey: key, initial, offscreen, cancelled, cancelRestored: same(cancelled, initial), applied, savedBounds, reloaded,
    settingsStatus: saved.status, alwaysOnTop: [topDuring, topAfter], atBottomAfter, loginItemCalls, overlayShown, overlayClosedAfterCancel, overlayClosedAfterApply,
  };
  const checks = {
    initialIsDefault: same(initial, defaultBounds(displays)),
    offscreenVisible: visibleOverlap && same(offscreen, clampBounds(offscreen, displays.map((d) => d.workArea))),
    cancelRestored: same(cancelled, initial),
    appliedWidth: applied.width === initial.width - 200 && applied.height === initial.height - 100,
    savedMatches: same(applied, savedBounds), reloadedMatches: same(applied, reloaded),
    alwaysOnTop: topDuring === true && topAfter === false, atBottomAfter,
    overlay: overlayShown && overlayClosedAfterCancel && overlayClosedAfterApply, loginItemCalls: loginItemCalls === 0,
  };
  return { fields, checks };
}

const trayLabels = (): string[] => (trayMenu()?.items ?? []).map((i) => (i.type === 'separator' ? '-' : i.label));
const trayItem = (label: string): MenuItem | undefined => trayMenu()?.items.find((i) => i.label === label);
const TRAY_EXPECTED = ['캘린더 숨기기', '내용 숨기기', '맨 위에 보기', '-', '위치 및 크기', '설정', 'Windows 시작 시 실행', '-', '제품 정보', '닫기'];

// 트레이 메뉴 항목을 실제 Menu의 항목으로 눌러 본다. 단축키는 눌러 볼 수 없으므로 같은 동작 함수를 부른다.
async function tray(rt: Runtime, desk: Desk): Promise<Result> {
  const win = getWindow();
  if (!win) return { fields: {}, checks: { window: false } };
  await until(() => getMode() !== null, 10000);
  await until(async () => (await js(win, RENDERED)) !== '', 15000);
  const settingsFile = join(rt.profileDir, 'settings.json');
  const savedSettings = () => loadDesktopSettings(settingsFile).settings;
  const htmlHidden = async () => (await js(win, "document.documentElement.classList.contains('content-hidden')")) as boolean;
  const bottom = () => isAtBottom(windowsBelow(getHwnd(), getProgman()), getProgman());
  const click = (label: string) => trayItem(label)?.click();

  const trayCreated = trayMenu() !== null;
  const menuNames = trayLabels();
  const start = trayItem('Windows 시작 시 실행');
  const startItem = { checked: start?.checked, enabled: start?.enabled };

  const visible: boolean[] = [];
  click('캘린더 숨기기');
  visible.push(win.isVisible());
  const labelWhenHidden = trayLabels()[0];
  const hiddenState = windowState.hidden;
  click('캘린더 보이기');
  visible.push(win.isVisible());
  const labelWhenShown = trayLabels()[0];

  const contentHidden: boolean[] = [];
  const contentSaved: boolean[] = [];
  click('내용 숨기기');
  await until(htmlHidden, 3000);
  contentHidden.push(await htmlHidden());
  contentSaved.push(savedSettings().contentHidden);
  const contentLabelWhenHidden = trayLabels()[1];
  click('내용 보이기');
  await until(async () => !(await htmlHidden()), 3000);
  contentHidden.push(await htmlHidden());
  contentSaved.push(savedSettings().contentHidden);

  const onTop: boolean[] = [];
  click('맨 위에 보기');
  onTop.push(win.isAlwaysOnTop());
  const onTopSaved = savedSettings().alwaysOnTop;
  const onTopChecked = trayItem('맨 위에 보기')?.checked;
  click('맨 위에 보기');
  onTop.push(win.isAlwaysOnTop());
  const atBottomAfterOnTopOff = await until(bottom, 3000);

  // 화면이 입력을 받는 동안(로그인 화면 포함)은 단축키가 멈춰 등록되지 않는다. 달력이 뜨고 입력이 끝난 뒤에 등록을 본다.
  // 끝나지 않으면 단축키 실패가 아니라 이것으로 알린다.
  const inputEndedBeforeHotkeys = await until(async () => (await js(win, RENDERED)) === 'calendar' && !win.isFocusable(), 15000);
  // 설정 바꾸기는 화면의 다리(IPC)로 보낸다.
  const bridge = (patch: string) => js(win, `window.calfifDesktop.setSystem(${patch})`) as Promise<SystemState>;
  const hotkeyPatch = (key: string, name: 'hideHotkey' | 'contentHotkey', enabled: boolean) => `{ ${name}: { accelerator: '${key}', enabled: ${enabled} } }`;
  await bridge(hotkeyPatch(HIDE_KEY, 'hideHotkey', true));
  const both = await bridge(hotkeyPatch(CONTENT_KEY, 'contentHotkey', true));
  const registeredBoth = [globalShortcut.isRegistered(HIDE_KEY), globalShortcut.isRegistered(CONTENT_KEY)];
  const off = await bridge(hotkeyPatch(HIDE_KEY, 'hideHotkey', false));
  const hideRegisteredAfterOff = globalShortcut.isRegistered(HIDE_KEY);
  const contentRegisteredAfterOff = globalShortcut.isRegistered(CONTENT_KEY);
  const badPatchState = (await js(win, "window.calfifDesktop.setSystem('x')")) as SystemState;
  const badPatchIgnored = JSON.stringify(badPatchState.settings) === JSON.stringify(off.settings);
  const startPatch = await bridge('{ startWithWindows: true }');
  const system = (await js(win, 'window.calfifDesktop.getSystem()')) as SystemState;

  // 시험이 끝나면 단축키를 모두 풀고 설정도 되돌린다.
  desk.applySystem({ hideHotkey: { accelerator: HIDE_KEY, enabled: false }, contentHotkey: { accelerator: CONTENT_KEY, enabled: false } });
  const noneRegistered = !globalShortcut.isRegistered(HIDE_KEY) && !globalShortcut.isRegistered(CONTENT_KEY);

  // 숨긴 채로 창이 다시 만들어져도(탐색기 재시작과 같은 길) 새 창은 보이지 않게 붙고, 보이기를 누르면 보인다.
  click('캘린더 숨기기');
  const createdBefore = windowsCreated();
  win.destroy();
  await until(() => windowsCreated() > createdBefore && getMode() === 'owned', 5000);
  const win2 = getWindow();
  const hiddenSurvivesRecreate = !!win2 && win2 !== win && getMode() === 'owned' && !win2.isVisible() && windowState.hidden && trayLabels()[0] === '캘린더 보이기';
  click('캘린더 보이기');
  const shownAfterRecreate = !!win2 && (await until(() => win2.isVisible() && getOwner(getHwnd()) === getProgman(), 2000));

  const fields = {
    trayCreated, trayMenu: menuNames, startItem, labelWhenHidden, hiddenState, labelWhenShown, contentLabelWhenHidden, visible, contentHidden,
    contentHiddenSaved: contentSaved.every((v, i) => v === contentHidden[i]), alwaysOnTop: onTop, onTopSaved, onTopChecked, atBottomAfterOnTopOff,
    inputEndedBeforeHotkeys, hotkeys: both.hotkeys, registeredBoth, hotkeysAfterOff: off.hotkeys, hideRegisteredAfterOff, contentRegisteredAfterOff, badPatchIgnored,
    startWithWindowsAfterPatch: startPatch.settings.startWithWindows, canStartWithWindows: system.canStartWithWindows, noneRegistered, hiddenSurvivesRecreate, shownAfterRecreate, loginItemCalls,
  };
  const checks = {
    trayCreated, trayMenu: JSON.stringify(menuNames) === JSON.stringify(TRAY_EXPECTED),
    startItem: startItem.checked === false && startItem.enabled === false,
    visible: visible[0] === false && visible[1] === true, hiddenState, labels: labelWhenHidden === '캘린더 보이기' && labelWhenShown === '캘린더 숨기기' && contentLabelWhenHidden === '내용 보이기',
    contentHidden: contentHidden[0] === true && contentHidden[1] === false, contentHiddenSaved: fields.contentHiddenSaved,
    alwaysOnTop: onTop[0] === true && onTop[1] === false, onTopSaved, onTopChecked: onTopChecked === true, atBottomAfterOnTopOff,
    inputEndedBeforeHotkeys, hotkeys: both.hotkeys.hide === 'ok' && both.hotkeys.content === 'ok', registeredBoth: registeredBoth[0] && registeredBoth[1],
    hideOff: off.hotkeys.hide === 'off' && !hideRegisteredAfterOff && contentRegisteredAfterOff, badPatchIgnored,
    startIgnored: startPatch.settings.startWithWindows === null && system.canStartWithWindows === false, noneRegistered, hiddenSurvivesRecreate, shownAfterRecreate,
    loginItemCalls: loginItemCalls === 0,
  };
  return { fields, checks };
}

// 설정 화면을 앱 안의 길(openSettings 명령, 화면의 입력 이벤트, 다리)로 열어 보고 닫는다. 단축키는 끝날 때 모두 푼다.
async function settings(_rt: Runtime, desk: Desk): Promise<Result> {
  const win = getWindow();
  if (!win) return { fields: {}, checks: { window: false } };
  await until(() => getMode() !== null, 10000);
  await until(async () => (await js(win, RENDERED)) === 'calendar', 15000);
  await until(() => !win.isFocusable(), 3000);
  const bottom = () => isAtBottom(windowsBelow(getHwnd(), getProgman()), getProgman());
  const sheet = async (open: boolean) => until(async () => ((await js(win, "!!document.querySelector('.desk-settings')")) as boolean) === open, 5000);
  const clickTab = (name: string) => js(win, `[...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent === '${name}').click()`);
  const rowOf = (label: string) => `[...document.querySelectorAll('.srow')].find((r) => r.querySelector('.srow-label').textContent === '${label}')`;

  sendCommand({ type: 'openSettings' });
  const opened = await sheet(true);
  const tabs = (await js(win, "[...document.querySelectorAll('[role=\"tab\"]')].map((t) => t.textContent)")) as string[];
  const interactiveWhileOpen = await until(() => win.isFocusable(), 3000);

  await clickTab('글꼴 및 색상');
  await js(win, `(() => { const i = ${rowOf('투명도')}.querySelector('input[type="range"]'); i.value = '30'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const cellBg = (await js(win, "document.documentElement.style.getPropertyValue('--desk-cell-bg')")) as string;
  const savedTransparency = (await js(win, "JSON.parse(localStorage.getItem('calfif.appearance')).transparency")) as number;

  await clickTab('고급');
  const hideRow = rowOf('캘린더 숨기기 단축키');
  await until(async () => ((await js(win, `${hideRow}.querySelector('input.hotkey').disabled`)) as boolean) === false, 5000);
  await js(win, `${hideRow}.querySelector('input.hotkey').dispatchEvent(new KeyboardEvent('keydown', { code: 'F9', key: 'F9', ctrlKey: true, altKey: true, shiftKey: true, bubbles: true }))`);
  await js(win, `${hideRow}.querySelector('input[role="switch"]').click()`);
  // 설정 화면이 열려 있는 동안은 전역 단축키를 모두 멈춘다. 바꾼 값은 저장되고 결과(ok)는 등록해 보고 풀어서 알린다.
  await until(() => getSettings().hideHotkey.enabled, 3000);
  const registered = () => [HIDE_KEY, CONTENT_KEY].filter((k) => globalShortcut.isRegistered(k)).length;
  const registeredWhileInteractive = registered();
  const saved = getSettings().hideHotkey;
  const hotkeyState = desk.applySystem({}).hotkeys.hide;
  const registeredWhileInteractiveAfterApply = registered();
  const startSwitchDisabled = (await js(win, `${rowOf('Windows 시작 시 실행')}.querySelector('input[role="switch"]').disabled`)) as boolean;

  await js(win, "[...document.querySelectorAll('.desk-settings .textbtn')].find((b) => b.textContent === '닫기').click()");
  const closed = await sheet(false);
  await until(() => !win.isFocusable(), 3000);
  const interactiveAfterClose = win.isFocusable();
  const atBottomAfterClose = await until(bottom, 3000);
  // 입력이 끝나면 켜 둔 단축키(하나)가 다시 등록된다.
  const registeredAfterClose = await until(() => registered() === 1, 3000) ? 1 : registered();
  const hotkey = { accelerator: saved.accelerator, state: hotkeyState, registered: globalShortcut.isRegistered(HIDE_KEY) };

  // 입력 중에 화면이 사라지면(창을 없애고 다시 만드는 길) 멈춘 단축키가 다시 등록되고 창은 입력을 받지 않는다.
  await js(win, 'window.calfifDesktop.setInteractive(true)');
  const pausedBeforeRecreate = await until(() => win.isFocusable() && registered() === 0, 3000);
  const createdBefore = windowsCreated();
  win.destroy();
  await until(() => windowsCreated() > createdBefore && getMode() === 'owned', 5000);
  const win2 = getWindow();
  if (win2) await until(async () => (await js(win2, RENDERED)) === 'calendar', 15000);
  const registeredAfterRecreate = await until(() => registered() === 1, 3000) ? 1 : registered();
  const focusableAfterRecreate = win2 ? win2.isFocusable() : null;

  // 첫 시작의 순서: 열린 설정 위에서 페이지를 다시 불러와도, 새 페이지가 다시 열어 입력을 요청하면 그 요청이 남는다(되돌리기가 늦지 않다).
  let reloadFocusable: boolean | null = null;
  let reloadRegistered: number | null = null;
  if (win2) {
    const sheetOn = (open: boolean) => until(async () => ((await js(win2, "!!document.querySelector('.desk-settings')")) as boolean) === open, 5000);
    sendCommand({ type: 'openSettings' });
    await sheetOn(true);
    win2.webContents.reload();
    await until(async () => (await js(win2, RENDERED)) === 'calendar', 15000);
    if (!(await sheetOn(true))) {
      sendCommand({ type: 'openSettings' });
      await sheetOn(true);
    }
    await until(() => win2.isFocusable() && registered() === 0, 3000);
    reloadFocusable = win2.isFocusable();
    reloadRegistered = registered();
    await js(win2, "[...document.querySelectorAll('.desk-settings .textbtn')].find((b) => b.textContent === '닫기').click()");
    await sheetOn(false);
    await until(() => !win2.isFocusable(), 3000);
  }

  // 시험이 끝나면 단축키를 풀고 설정도 되돌린다.
  desk.applySystem({ hideHotkey: { accelerator: HIDE_KEY, enabled: false } });
  const noneRegistered = registered() === 0;

  const fields = { opened, tabs, interactiveWhileOpen, cellBg, savedTransparency, hotkey, registeredWhileInteractive, registeredWhileInteractiveAfterApply, registeredAfterClose, pausedBeforeRecreate, registeredAfterRecreate, focusableAfterRecreate, reloadFocusable, reloadRegistered, startSwitchDisabled, noneRegistered, closed, interactiveAfterClose, atBottomAfterClose, loginItemCalls };
  const checks = {
    opened, tabs: JSON.stringify(tabs) === JSON.stringify(['캘린더', '셀', '글꼴 및 색상', '고급', '계정']), interactiveWhileOpen,
    cellBg: cellBg === 'rgba(20, 24, 32, 0.7)', savedTransparency: savedTransparency === 30,
    hotkey: hotkey.accelerator === HIDE_KEY && hotkey.state === 'ok' && hotkey.registered, startSwitchDisabled,
    registeredWhileInteractive: registeredWhileInteractive === 0 && registeredWhileInteractiveAfterApply === 0, registeredAfterClose: registeredAfterClose === 1,
    pausedBeforeRecreate, registeredAfterRecreate: registeredAfterRecreate === 1, focusableAfterRecreate: focusableAfterRecreate === false,
    reloadFocusable: reloadFocusable === true, reloadRegistered: reloadRegistered === 0, noneRegistered, closed,
    interactiveAfterClose: interactiveAfterClose === false, atBottomAfterClose, loginItemCalls: loginItemCalls === 0,
  };
  return { fields, checks };
}

// 끝에서 끝까지: 시험 스크립트(desktop-run.ts)가 에뮬레이터에 아이폰의 편집을 흉내 내어 쓰면 앱이 5초 안에 보여 주고,
// 앱에서 바꾼 배경색이 에뮬레이터에 올라간다. 진행은 e2e.json에 단계마다 적어 스크립트가 읽는다.
async function e2e(rt: Runtime): Promise<Result> {
  const win = getWindow();
  if (!win) return { fields: {}, checks: { window: false } };
  const dir = rt.statusDir as string;
  const progress: Record<string, unknown> = {};
  const mark = (patch: Record<string, unknown>) => {
    Object.assign(progress, patch);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'e2e.json'), JSON.stringify({ scenario: 'e2e', ...progress }));
  };
  const todayHas = "!!document.querySelector('.cell.today')?.textContent.includes('원격 시험 메모')";
  const synced = async () => ((await js(win, "document.querySelector('.sync-text')?.textContent")) as string | null) === '동기화됨';
  const menuClick = (selector: string) => js(win, `document.querySelector('${selector}').click()`);

  await until(() => getMode() !== null, 10000);
  const ready = await until(async () => (await js(win, RENDERED)) === 'calendar', 15000);
  mark({ phase: ready ? 'ready' : 'failed' });

  let remoteSeen = false;
  const waitEnd = Date.now() + 30000;
  while (ready && !remoteSeen && Date.now() < waitEnd) {
    remoteSeen = (await js(win, todayHas)) === true;
    if (!remoteSeen) await sleep(250);
  }
  mark({ remoteSeen });

  let localEditDone = false;
  let uploaded = false;
  if (remoteSeen) {
    await js(win, "document.querySelector('.cell.today').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }))");
    await until(async () => (await js(win, "!!document.querySelector('.cellmenu [data-action=\"color\"]')")) as boolean, 3000);
    await menuClick('.cellmenu [data-action="color"]');
    await menuClick('.cellmenu .swatch[data-color="F12424"]');
    // 색을 고르면 메뉴가 닫힌다.
    localEditDone = await until(async () => !((await js(win, "!!document.querySelector('.cellmenu')")) as boolean), 3000);
    mark({ localEditDone });
    // 올리는 중으로 바뀌었다가 다시 동기화됨이 되면 올라간 것이다. 너무 빨라 못 본 경우도 있어 기다림은 짧게 둔다.
    await until(async () => !(await synced()), 2000);
    uploaded = await until(synced, 20000);
    mark({ uploaded });
  }
  // 시험 스크립트가 에뮬레이터에서 색을 확인해 결과 파일을 쓸 때까지 기다린다. 그 전에 끝나면 올리는 일이 끊긴다.
  const verified = await until(() => existsSync(join(dir, 'e2e-result.json')), 20000);
  return { fields: { ...progress, loginItemCalls }, checks: { ready, remoteSeen, localEditDone, uploaded, verified, loginItemCalls: loginItemCalls === 0 } };
}

const SCENARIOS: Partial<Record<Scenario, (rt: Runtime, desk: Desk) => Promise<Result>>> = { attach, bounds, tray, settings, e2e };

export async function runSmoke(rt: Runtime, desk: Desk): Promise<void> {
  const scenario = rt.smoke as Scenario;
  const run = SCENARIOS[scenario];
  let result: Result;
  let timedOut = false;
  try {
    result = await Promise.race([
      run ? run(rt, desk) : Promise.resolve<Result>({ fields: { error: '시나리오가 아직 없다' }, checks: { implemented: false } }),
      sleep(TOTAL_MS).then(() => {
        timedOut = true;
        return { fields: {}, checks: {} } as Result;
      }),
    ]);
  } catch (e) {
    result = { fields: { error: String(e) }, checks: { noError: false } };
  }
  const failures = [...Object.entries(result.checks).filter(([, ok]) => !ok).map(([name]) => name), ...(timedOut ? ['timeout'] : [])];
  mkdirSync(rt.statusDir as string, { recursive: true });
  writeFileSync(join(rt.statusDir as string, `${scenario}.json`), JSON.stringify({ scenario, ok: failures.length === 0, failures, ...result.fields }, null, 2));
  app.quit();
}
