import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { app, type BrowserWindow } from 'electron';
import { isAtBottom } from './policy';
import type { Runtime, Scenario } from './runtime';
import { getExStyle, getOwner, windowsBelow } from './win32';
import { blocked, getHwnd, getMode, getProgman, getWindow, signals, windowsCreated } from './window';

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
    loginItemCalls, secondInstance: instance, ...shotInfo,
  };
  const checks = {
    mode: first.mode === 'owned', ownerIsProgman: first.ownerIsProgman, atBottom: first.atBottom, toolWindow: first.toolWindow,
    appWindow: !first.appWindow, focusable: !first.focusable, visible: first.visible, rendered: rendered === 'calendar',
    bridgeKeys: JSON.stringify(bridgeKeys) === JSON.stringify(BRIDGE_KEYS), rendererGlobals: rendererGlobals === 'undefined,undefined',
    navigationBlocked, popupBlocked, interactive: interactive[0] === true && interactive[1] === false, atBottomAfterInteractive,
    recreated, ownerIsProgmanAfterRecreate: fields.ownerIsProgmanAfterRecreate, loginItemCalls: loginItemCalls === 0,
    secondInstance: instance.exitCode === 0 && instance.notified,
  };
  return { fields, checks };
}

const SCENARIOS: Partial<Record<Scenario, () => Promise<Result>>> = { attach };

export async function runSmoke(rt: Runtime): Promise<void> {
  const scenario = rt.smoke as Scenario;
  const run = SCENARIOS[scenario];
  let result: Result;
  let timedOut = false;
  try {
    result = await Promise.race([
      run ? run() : Promise.resolve<Result>({ fields: { error: '시나리오가 아직 없다' }, checks: { implemented: false } }),
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
