import { join } from 'node:path';
import { Menu, app, dialog, globalShortcut, ipcMain, protocol } from 'electron';
import { CH, type SystemPatch, type SystemState } from './api';
import { HotkeyManager } from './hotkeys';
import { showAlarmWindow } from './alarmWindow';
import { handleAlarm, parseBool, parseDrag, parsePoint, parseSystemPatch } from './ipc';
import type { MenuAction, MenuState } from './menu';
import { resolveRuntime } from './runtime';
import { guardLoginItem, runSmoke } from './smoke';
import { startupAction, tryLoginItem } from './startup';
import { buildMenu, createTray, destroyTray, refreshTray } from './tray';
import {
  beginDrag, dragTo, endDrag, setPassThrough, events, finishAdjust, getSettings, getWindow, installSecurity, isFromWindow, isHidden, keepBottom, markQuitting, registerAppProtocol,
  sendCommand, setAlwaysOnTop, setContentHidden, setInteractive, showWindow, signals, startAdjust, startDesktopWindow, toggleHidden, updateSettings,
} from './window';

// 빌드할 때 vite.desktop.config.ts가 정한다. 에뮬레이터용으로 꾸린 앱이면 true다.
declare const __CALFIF_EMU_BUILD__: boolean;

const rt = resolveRuntime({ env: process.env, isPackaged: app.isPackaged, appPath: app.getAppPath(), appData: app.getPath('appData'), emulatorBuild: __CALFIF_EMU_BUILD__ });
app.setPath('userData', rt.profileDir);
app.enableSandbox();
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
// 모든 실행(개발, 시험, 꾸린 앱)에서 같은 Chromium 설정을 쓴다. 다른 창에 가려졌다고 보고 그리기를 멈추면
// Win+D나 잠금을 풀고 난 뒤 바탕화면의 달력이 비어 보일 수 있다.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
if (rt.smoke) guardLoginItem();

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
// 던지면 적용하지 못한 것으로 보고 false를 돌려준다.
const setLoginItem = (openAtLogin: boolean): boolean => !rt.manageLoginItem || tryLoginItem((v) => app.setLoginItemSettings({ openAtLogin: v }), openAtLogin);
function loginItemOn(): boolean | null {
  if (!rt.manageLoginItem) return getSettings().startWithWindows;
  try {
    return app.getLoginItemSettings().openAtLogin;
  } catch {
    return getSettings().startWithWindows;
  }
}

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
  // 걸지 못하면 저장하지 않는다. 돌려주는 상태의 값이 요청과 다르므로 화면이 알 수 있다.
  if (patch.startWithWindows !== undefined && rt.manageLoginItem && setLoginItem(patch.startWithWindows)) next.startWithWindows = patch.startWithWindows;
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
    // Electron의 기본 메뉴를 없앤다. 그 단축키(Ctrl+W, Ctrl+R, Ctrl+M, 확대·축소 등)가 입력 중인 창을 닫거나 다시 읽지 않게, 창을 만들기 전에 한다.
    Menu.setApplicationMenu(null);
    registerAppProtocol(rt.rendererDir);
    installSecurity();
    ipcMain.on(CH.interactive, (e, on: unknown) => {
      const value = parseBool(on);
      if (!isFromWindow(e) || value === null) return;
      setInteractive(value);
      // 입력을 받는 동안은 전역 단축키를 멈춘다(누르는 조합을 화면이 받을 수 있게). 끝나면 그때의 설정으로 다시 등록한다.
      hotkeyState = hotkeys.setPaused(value) ?? hotkeyState;
    });
    // 창 자리 조정 메시지: 보낸 곳이 앱의 화면이고 값이 맞을 때만 쓴다.
    ipcMain.on(CH.dragStart, (e) => {
      if (isFromWindow(e)) beginDrag();
    });
    ipcMain.on(CH.drag, (e, kind: unknown, dx: unknown, dy: unknown) => {
      const drag = parseDrag(kind, dx, dy);
      if (isFromWindow(e) && drag) dragTo(drag.kind, drag.dx, drag.dy);
    });
    ipcMain.on(CH.dragEnd, (e) => {
      if (isFromWindow(e)) endDrag();
    });
    // 아이콘 자리 위에 마우스가 있는지(화면이 알린다).
    ipcMain.on(CH.passThrough, (e, on: unknown) => {
      const value = parseBool(on);
      if (isFromWindow(e) && value !== null) setPassThrough(value);
    });
    ipcMain.on(CH.adjustDone, (e, apply: unknown) => {
      const value = parseBool(apply);
      if (isFromWindow(e) && value !== null) finishAdjust(value);
    });
    ipcMain.on(CH.alarm, (e, items: unknown, tone: unknown) => handleAlarm(isFromWindow(e), items, tone, showAlarmWindow));
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
    startDesktopWindow(rt, join(__dirname, 'preload.cjs'), join(__dirname, 'iconWorker.cjs'));
    // 꾸린 앱의 실제 실행이면 시작할 때마다 본다. 켜 두었는데 이 실행 파일로 걸려 있지 않으면(폴더를 옮김) 다시 건다.
    const startup = startupAction({ manage: rt.manageLoginItem, saved: getSettings().startWithWindows, system: loginItemOn() });
    // 걸지 못하면 저장하지 않아 다음 시작에 다시 시도한다.
    if (startup.register === null || setLoginItem(startup.register)) {
      if (startup.save !== null) updateSettings({ startWithWindows: startup.save });
    }
    applyHotkeys();
    events.onChange = refresh;
    events.onPageGone = () => {
      hotkeyState = hotkeys.setPaused(false) ?? hotkeyState; // 화면이 사라져 멈춤을 풀 사람이 없다
    };
    createTray(rt.rendererDir, menuState, runAction, () => {
      if (isHidden()) runAction('toggleHidden');
    });
    if (rt.smoke) void runSmoke(rt, { runAction, applySystem });
  });
}
