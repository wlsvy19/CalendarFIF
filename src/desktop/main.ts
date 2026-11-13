import { join } from 'node:path';
import { app, dialog, globalShortcut, ipcMain, protocol } from 'electron';
import { CH, type SystemPatch, type SystemState } from './api';
import { HotkeyManager } from './hotkeys';
import { parseBool, parseDrag, parsePoint, parseSystemPatch } from './ipc';
import type { MenuAction, MenuState } from './menu';
import { resolveRuntime } from './runtime';
import { guardLoginItem, runSmoke } from './smoke';
import { startupAction } from './startup';
import { buildMenu, createTray, destroyTray, refreshTray } from './tray';
import {
  beginDrag, dragTo, events, finishAdjust, getSettings, getWindow, installSecurity, isFromWindow, isHidden, keepBottom, markQuitting, registerAppProtocol,
  sendCommand, setAlwaysOnTop, setContentHidden, setInteractive, showWindow, signals, startAdjust, startDesktopWindow, toggleHidden, updateSettings,
} from './window';

const rt = resolveRuntime({ env: process.env, isPackaged: app.isPackaged, appPath: app.getAppPath(), appData: app.getPath('appData') });
app.setPath('userData', rt.profileDir);
app.enableSandbox();
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
if (rt.smoke) {
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
  guardLoginItem();
}

const hotkeys = new HotkeyManager({
  register: (accelerator, fn) => {
    try {
      return globalShortcut.register(accelerator, fn) && globalShortcut.isRegistered(accelerator);
    } catch {
      return false;
    }
  },
  unregister: (accelerator) => globalShortcut.unregister(accelerator),
});
let hotkeyState: SystemState['hotkeys'] = { hide: 'off', content: 'off' };

// Windows 시작 시 실행은 꾸린 앱의 실제 실행에서만 건다.
function setLoginItem(openAtLogin: boolean): void {
  if (rt.manageLoginItem) app.setLoginItemSettings({ openAtLogin });
}
const loginItemOn = (): boolean | null => (rt.manageLoginItem ? app.getLoginItemSettings().openAtLogin : getSettings().startWithWindows);

const menuState = (): MenuState => ({
  hidden: isHidden(), contentHidden: getSettings().contentHidden, alwaysOnTop: getSettings().alwaysOnTop,
  startWithWindows: loginItemOn(), canStartWithWindows: rt.manageLoginItem,
});

function systemState(): SystemState {
  const { hideHotkey, contentHotkey } = getSettings();
  return { settings: { hideHotkey, contentHotkey, startWithWindows: loginItemOn() }, hotkeys: hotkeyState, canStartWithWindows: rt.manageLoginItem };
}

function applyHotkeys(): void {
  hotkeyState = hotkeys.apply(getSettings(), { hide: () => runAction('toggleHidden'), content: () => runAction('toggleContent') });
}

// 메뉴 항목과 단축키가 부르는 같은 길. 시험 실행도 이것을 부른다.
function runAction(action: MenuAction): void {
  perform(action);
  refresh(); // 메뉴의 글자와 체크가 지금 상태를 따르도록
}

function perform(action: MenuAction): void {
  switch (action) {
    case 'toggleHidden': return toggleHidden();
    case 'toggleContent': return setContentHidden(!getSettings().contentHidden);
    case 'toggleOnTop': return setAlwaysOnTop(!getSettings().alwaysOnTop);
    case 'adjust': return startAdjust();
    case 'settings':
      showWindow();
      return sendCommand({ type: 'openSettings' });
    case 'toggleStart':
      if (rt.manageLoginItem) applySystem({ startWithWindows: loginItemOn() !== true });
      return;
    case 'about':
      void dialog.showMessageBox({ type: 'info', title: '제품 정보', message: `CalendarFIF ${app.getVersion()}`, detail: 'PC와 아이폰의 날짜별 메모를 동기화하는 개인용 달력입니다.', buttons: ['확인'] });
      return;
    case 'today': return sendCommand({ type: 'today' });
    case 'signOut': return sendCommand({ type: 'signOut' });
    case 'quit':
      markQuitting();
      app.quit();
  }
}

const refresh = (): void => refreshTray(menuState, runAction);

function applySystem(patch: SystemPatch): SystemState {
  const next: Parameters<typeof updateSettings>[0] = {};
  if (patch.hideHotkey) next.hideHotkey = patch.hideHotkey;
  if (patch.contentHotkey) next.contentHotkey = patch.contentHotkey;
  if (patch.startWithWindows !== undefined && rt.manageLoginItem) {
    setLoginItem(patch.startWithWindows);
    next.startWithWindows = patch.startWithWindows;
  }
  updateSettings(next);
  applyHotkeys();
  refresh();
  return systemState();
}

// 잠금은 프로필 폴더마다 따로다.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    signals.secondInstance += 1;
    showWindow();
  });
  app.on('before-quit', markQuitting);
  app.on('will-quit', () => {
    hotkeys.dispose();
    globalShortcut.unregisterAll();
    destroyTray();
  });
  // 창이 모두 닫혀도 끝내지 않는다(탐색기가 다시 시작되면 창을 다시 만든다).
  app.on('window-all-closed', () => {});

  void app.whenReady().then(() => {
    registerAppProtocol(rt.rendererDir);
    installSecurity();
    ipcMain.on(CH.interactive, (e, on: unknown) => {
      const value = parseBool(on);
      if (isFromWindow(e) && value !== null) setInteractive(value);
    });
    // 창 자리 조정 메시지: 보낸 곳이 앱의 화면이고 값이 맞을 때만 쓴다.
    ipcMain.on(CH.dragStart, (e) => {
      if (isFromWindow(e)) beginDrag();
    });
    ipcMain.on(CH.drag, (e, kind: unknown, dx: unknown, dy: unknown) => {
      const drag = parseDrag(kind, dx, dy);
      if (isFromWindow(e) && drag) dragTo(drag.kind, drag.dx, drag.dy);
    });
    ipcMain.on(CH.adjustDone, (e, apply: unknown) => {
      const value = parseBool(apply);
      if (isFromWindow(e) && value !== null) finishAdjust(value);
    });
    ipcMain.on(CH.menu, (e, at: unknown) => {
      const point = parsePoint(at);
      const win = getWindow();
      if (!isFromWindow(e) || !point || !win) return;
      buildMenu(menuState(), 'title', runAction).popup({ window: win, x: Math.round(point.x), y: Math.round(point.y), callback: keepBottom });
    });
    ipcMain.handle(CH.getSystem, (e) => {
      if (!isFromWindow(e)) throw new Error('거절');
      return systemState();
    });
    ipcMain.handle(CH.setSystem, (e, patch: unknown) => {
      if (!isFromWindow(e)) throw new Error('거절');
      const parsed = parseSystemPatch(patch);
      return parsed ? applySystem(parsed) : systemState(); // 틀린 요청은 바꾸지 않고 지금 상태만 돌려준다

    });
    startDesktopWindow(rt, join(__dirname, 'preload.cjs'));
    const startup = startupAction({ manage: rt.manageLoginItem, saved: getSettings().startWithWindows });
    if (startup.register !== null) setLoginItem(startup.register);
    if (startup.save !== null) updateSettings({ startWithWindows: startup.save });
    applyHotkeys();
    events.onChange = refresh;
    createTray(rt.rendererDir, menuState, runAction, () => {
      if (isHidden()) runAction('toggleHidden');
    });
    if (rt.smoke) void runSmoke(rt, { runAction, applySystem });
  });
}
