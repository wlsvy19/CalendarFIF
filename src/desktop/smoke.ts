import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { app, globalShortcut, type BrowserWindow, type MenuItem } from 'electron';
import type { SystemPatch, SystemState } from './api';
import type { MenuAction } from './menu';
import { trayMenu } from './tray';
import { clampBounds, defaultBounds, layoutKey, resolveBounds, type Rect } from './bounds';
import { isAtBottom } from './policy';
import type { Runtime, Scenario } from './runtime';
import { loadDesktopSettings } from './settings';
import { getExStyle, getOwner, windowsBelow } from './win32';
import { blocked, displayInfos, getHwnd, getMode, getProgman, getSettings, getWindow, sendCommand, signals, startAdjust, windowState, windowsCreated } from './window';

// main.ts가 메뉴 항목과 단축키가 부르는 길을 시험 실행에 건넨다.
export type Desk = { runAction(a: MenuAction): void; applySystem(p: SystemPatch): SystemState };
type Result = { fields: Record<string, unknown>; checks: Record<string, boolean> };
const TOTAL_MS = 45000;
const BRIDGE_KEYS = ['adjustDone', 'drag', 'dragStart', 'getSystem', 'onCommand', 'setInteractive', 'setSystem', 'showMenu'];
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

async function attach(): Promise<Result> {
  let win = getWindow();
  if (!win) return { fields: {}, checks: { window: false } };
  const first0 = win;
  await until(() => getMode() !== null, 10000);
  await until(async () => (await js(first0, RENDERED)) === 'calendar', 15000);
  const rendered = (await js(first0, RENDERED)) as string;
  // 로그인 화면은 입력을 위해 창을 활성화 가능하게 둔다. 달력으로 넘어가 입력이 끝나면 다시 맨 아래로 간다.
  await until(() => !first0.isFocusable() && isAtBottom(windowsBelow(getHwnd(), getProgman()), getProgman()), 3000);
  const first = await measure(win);
  const bridgeKeys = (await js(win, 'Object.keys(window.calfifDesktop || {}).sort()')) as string[];
  const rendererGlobals = (await js(win, '[typeof require, typeof process].join(",")')) as string;

  const navBefore = blocked.navigations;
  const popBefore = blocked.popups;
  const popup = await js(win, "(() => { const w = window.open('https://example.invalid/'); location.href = 'https://example.invalid/'; return w === null; })()");
  await sleep(500);
  const stayed = win.webContents.getURL().startsWith('app://calfif/');
  const navigationBlocked = stayed && blocked.navigations > navBefore;
  const popupBlocked = popup === true && blocked.popups > popBefore;

  const interactive: boolean[] = [];
  for (const on of [true, false]) {
    await js(first0, `window.calfifDesktop.setInteractive(${on})`);
    await until(() => first0.isFocusable() === on, 2000);
    interactive.push(first0.isFocusable());
  }
  const atBottomAfterInteractive = await until(() => isAtBottom(windowsBelow(getHwnd(), getProgman()), getProgman()), 2000);

  const shotInfo = await capture(first0, 'attach');

  // 탐색기 재시작 흉내: 창을 없애면 5초 안에 다시 붙은 창이 있어야 한다.
  const createdBefore = windowsCreated();
  first0.destroy();
  const recreated = await until(() => windowsCreated() > createdBefore && getMode() === 'owned', 5000);
  win = getWindow();
  const second = win ? await measure(win) : null;

  const instance = await secondInstance();
  const fields = {
    ...first, rendered, bridgeKeys, rendererGlobals, navigationBlocked, popupBlocked, interactive, atBottomAfterInteractive,
    recreated, ownerIsProgmanAfterRecreate: second?.ownerIsProgman ?? false, atBottomAfterRecreate: second?.atBottom ?? false,
    loginItemCalls, bottomAsserts: blocked.bottomAsserts, secondInstance: instance, ...shotInfo,
  };
  const checks = {
    mode: first.mode === 'owned', ownerIsProgman: first.ownerIsProgman, atBottom: first.atBottom, toolWindow: first.toolWindow,
    appWindow: !first.appWindow, focusable: !first.focusable, visible: first.visible, rendered: rendered === 'calendar',
    bridgeKeys: JSON.stringify(bridgeKeys) === JSON.stringify(BRIDGE_KEYS), rendererGlobals: rendererGlobals === 'undefined,undefined',
    navigationBlocked, popupBlocked, interactive: interactive[0] === true && interactive[1] === false, atBottomAfterInteractive,
    recreated, ownerIsProgmanAfterRecreate: fields.ownerIsProgmanAfterRecreate, loginItemCalls: loginItemCalls === 0,
    secondInstance: instance.exitCode === 0 && instance.notified, bottomAsserts: blocked.bottomAsserts <= 20,
  };
  return { fields, checks };
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
const HIDE_KEY = 'Ctrl+Alt+Shift+F9';
const CONTENT_KEY = 'Ctrl+Alt+Shift+F10';

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

  const fields = {
    trayCreated, trayMenu: menuNames, startItem, labelWhenHidden, hiddenState, labelWhenShown, contentLabelWhenHidden, visible, contentHidden,
    contentHiddenSaved: contentSaved.every((v, i) => v === contentHidden[i]), alwaysOnTop: onTop, onTopSaved, onTopChecked, atBottomAfterOnTopOff,
    hotkeys: both.hotkeys, registeredBoth, hotkeysAfterOff: off.hotkeys, hideRegisteredAfterOff, contentRegisteredAfterOff, badPatchIgnored,
    startWithWindowsAfterPatch: startPatch.settings.startWithWindows, canStartWithWindows: system.canStartWithWindows, noneRegistered, loginItemCalls,
  };
  const checks = {
    trayCreated, trayMenu: JSON.stringify(menuNames) === JSON.stringify(TRAY_EXPECTED),
    startItem: startItem.checked === false && startItem.enabled === false,
    visible: visible[0] === false && visible[1] === true, hiddenState, labels: labelWhenHidden === '캘린더 보이기' && labelWhenShown === '캘린더 숨기기' && contentLabelWhenHidden === '내용 보이기',
    contentHidden: contentHidden[0] === true && contentHidden[1] === false, contentHiddenSaved: fields.contentHiddenSaved,
    alwaysOnTop: onTop[0] === true && onTop[1] === false, onTopSaved, onTopChecked: onTopChecked === true, atBottomAfterOnTopOff,
    hotkeys: both.hotkeys.hide === 'ok' && both.hotkeys.content === 'ok', registeredBoth: registeredBoth[0] && registeredBoth[1],
    hideOff: off.hotkeys.hide === 'off' && !hideRegisteredAfterOff && contentRegisteredAfterOff, badPatchIgnored,
    startIgnored: startPatch.settings.startWithWindows === null && system.canStartWithWindows === false, noneRegistered, loginItemCalls: loginItemCalls === 0,
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
  await until(() => globalShortcut.isRegistered(HIDE_KEY), 3000);
  const saved = getSettings().hideHotkey;
  const hotkeyState = desk.applySystem({}).hotkeys.hide;
  const hotkey = { accelerator: saved.accelerator, state: hotkeyState, registered: globalShortcut.isRegistered(HIDE_KEY) };
  const startSwitchDisabled = (await js(win, `${rowOf('Windows 시작 시 실행')}.querySelector('input[role="switch"]').disabled`)) as boolean;

  // 시험이 끝나면 단축키를 풀고 설정도 되돌린다.
  desk.applySystem({ hideHotkey: { accelerator: HIDE_KEY, enabled: false } });
  const noneRegistered = !globalShortcut.isRegistered(HIDE_KEY);

  await js(win, "[...document.querySelectorAll('.desk-settings .textbtn')].find((b) => b.textContent === '닫기').click()");
  const closed = await sheet(false);
  await until(() => !win.isFocusable(), 3000);
  const interactiveAfterClose = win.isFocusable();
  const atBottomAfterClose = await until(bottom, 3000);

  const fields = { opened, tabs, interactiveWhileOpen, cellBg, savedTransparency, hotkey, startSwitchDisabled, noneRegistered, closed, interactiveAfterClose, atBottomAfterClose, loginItemCalls };
  const checks = {
    opened, tabs: JSON.stringify(tabs) === JSON.stringify(['캘린더', '셀', '글꼴 및 색상', '고급', '계정']), interactiveWhileOpen,
    cellBg: cellBg === 'rgba(20, 24, 32, 0.7)', savedTransparency: savedTransparency === 30,
    hotkey: hotkey.accelerator === HIDE_KEY && hotkey.state === 'ok' && hotkey.registered, startSwitchDisabled, noneRegistered, closed,
    interactiveAfterClose: interactiveAfterClose === false, atBottomAfterClose, loginItemCalls: loginItemCalls === 0,
  };
  return { fields, checks };
}

const SCENARIOS: Partial<Record<Scenario, (rt: Runtime, desk: Desk) => Promise<Result>>> = { attach, bounds, tray, settings };

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
