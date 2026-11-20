import { contextBridge, ipcRenderer } from 'electron';
import { CH, type CalfifDesktop, type DesktopCommand, type HoleRect } from './api';

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
  setPassThrough: (on, armed) => ipcRenderer.send(CH.passThrough, on, armed === true),
  onIconHoles: (listener) => {
    const handler = (_e: unknown, holes: HoleRect[]) => listener(holes);
    ipcRenderer.on(CH.iconHoles, handler);
    return () => {
      ipcRenderer.removeListener(CH.iconHoles, handler);
    };
  },
  adjustDone: (apply) => ipcRenderer.send(CH.adjustDone, apply),
  showAlarms: (items, tone) => ipcRenderer.send(CH.alarm, items, tone),
};

contextBridge.exposeInMainWorld('calfifDesktop', bridge);
