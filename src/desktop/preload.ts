import { contextBridge, ipcRenderer } from 'electron';
import { CH, type CalfifDesktop, type DesktopCommand } from './api';

const bridge: CalfifDesktop = {
  setInteractive: (on) => ipcRenderer.send(CH.interactive, on),
  showMenu: (at) => ipcRenderer.send(CH.menu, at),
  onCommand: (listener) => {
    const handler = (_e: unknown, c: DesktopCommand) => listener(c);
    ipcRenderer.on(CH.command, handler);
    return () => {
      ipcRenderer.removeListener(CH.command, handler);
    };
  },
  getSystem: () => ipcRenderer.invoke(CH.getSystem),
  setSystem: (patch) => ipcRenderer.invoke(CH.setSystem, patch),
  dragStart: () => ipcRenderer.send(CH.dragStart),
  drag: (kind, dx, dy) => ipcRenderer.send(CH.drag, kind, dx, dy),
  adjustDone: (apply) => ipcRenderer.send(CH.adjustDone, apply),
};

contextBridge.exposeInMainWorld('calfifDesktop', bridge);
