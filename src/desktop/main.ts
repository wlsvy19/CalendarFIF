import { join } from 'node:path';
import { app, ipcMain, protocol } from 'electron';
import { CH } from './api';
import { parseBool, parseDrag } from './ipc';
import { isAppUrl } from './protocol';
import { resolveRuntime } from './runtime';
import { guardLoginItem, runSmoke } from './smoke';
import { beginDrag, dragTo, finishAdjust, installSecurity, markQuitting, registerAppProtocol, setInteractive, showWindow, signals, startDesktopWindow } from './window';

const rt = resolveRuntime({ env: process.env, isPackaged: app.isPackaged, appPath: app.getAppPath(), appData: app.getPath('appData') });
app.setPath('userData', rt.profileDir);
app.enableSandbox();
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
if (rt.smoke) {
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
  guardLoginItem();
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
  // 창이 모두 닫혀도 끝내지 않는다(탐색기가 다시 시작되면 창을 다시 만든다).
  app.on('window-all-closed', () => {});

  void app.whenReady().then(() => {
    registerAppProtocol(rt.rendererDir);
    installSecurity();
    ipcMain.on(CH.interactive, (e, on: unknown) => {
      const value = parseBool(on);
      if (e.senderFrame === e.sender.mainFrame && isAppUrl(e.senderFrame?.url) && value !== null) setInteractive(value);
    });
    // 창 자리 조정 메시지: 보낸 곳이 앱의 화면이고 값이 맞을 때만 쓴다.
    const fromApp = (e: Electron.IpcMainEvent) => e.senderFrame === e.sender.mainFrame && isAppUrl(e.senderFrame?.url);
    ipcMain.on(CH.dragStart, (e) => {
      if (fromApp(e)) beginDrag();
    });
    ipcMain.on(CH.drag, (e, kind: unknown, dx: unknown, dy: unknown) => {
      const drag = parseDrag(kind, dx, dy);
      if (fromApp(e) && drag) dragTo(drag.kind, drag.dx, drag.dy);
    });
    ipcMain.on(CH.adjustDone, (e, apply: unknown) => {
      const value = parseBool(apply);
      if (fromApp(e) && value !== null) finishAdjust(value);
    });
    startDesktopWindow(rt, join(__dirname, 'preload.cjs'));
    if (rt.smoke) void runSmoke(rt);
  });
}
