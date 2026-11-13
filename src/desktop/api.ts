// 화면(renderer)은 타입만 쓰고, preload와 메인은 CH도 쓴다.
export const CH = {
  interactive: 'calfif:interactive',
  menu: 'calfif:menu',
  command: 'calfif:command',
  getSystem: 'calfif:get-system',
  setSystem: 'calfif:set-system',
  dragStart: 'calfif:drag-start',
  drag: 'calfif:drag',
  adjustDone: 'calfif:adjust-done',
} as const;

export type Point = { x: number; y: number };
export type DragKind = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
export type Hotkey = { accelerator: string; enabled: boolean };
export type HotkeyState = 'ok' | 'off' | 'taken' | 'invalid';
export type SystemSettings = { hideHotkey: Hotkey; contentHotkey: Hotkey; startWithWindows: boolean | null };
export type SystemPatch = { hideHotkey?: Hotkey; contentHotkey?: Hotkey; startWithWindows?: boolean };
export type SystemState = { settings: SystemSettings; hotkeys: { hide: HotkeyState; content: HotkeyState }; canStartWithWindows: boolean };
export type SettingsPage = 'calendar' | 'cell' | 'font' | 'advanced' | 'account';
export type DesktopCommand =
  | { type: 'today' }
  | { type: 'openSettings'; page?: SettingsPage }
  | { type: 'signOut' }
  | { type: 'contentHidden'; hidden: boolean }
  | { type: 'adjust'; active: boolean };

export interface CalfifDesktop {
  setInteractive(on: boolean): void; // send CH.interactive
  showMenu(at: Point): void; // send CH.menu (제목 줄 메뉴)
  onCommand(listener: (c: DesktopCommand) => void): () => void; // CH.command, 메인 → 화면
  getSystem(): Promise<SystemState>; // invoke CH.getSystem
  setSystem(patch: SystemPatch): Promise<SystemState>; // invoke CH.setSystem
  dragStart(): void; // send CH.dragStart
  drag(kind: DragKind, dx: number, dy: number): void; // send CH.drag
  adjustDone(apply: boolean): void; // send CH.adjustDone
}

declare global {
  interface Window {
    calfifDesktop?: CalfifDesktop;
  }
}
