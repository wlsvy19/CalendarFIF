// 화면(renderer)은 타입만 쓰고, preload와 메인은 CH도 쓴다.
export const CH = {
  interactive: 'calfif:interactive',
  menu: 'calfif:menu',
  command: 'calfif:command',
  getSystem: 'calfif:get-system',
  setSystem: 'calfif:set-system',
  dragStart: 'calfif:drag-start',
  drag: 'calfif:drag',
  passThrough: 'calfif:pass-through',
  iconHoles: 'calfif:icon-holes',
  adjustDone: 'calfif:adjust-done',
  alarm: 'calfif:alarm',
} as const;

export type AlarmTone = 'none' | 'chime' | 'bell';
export type AlarmPopupItem = { time: string; text: string; date: string; advance: number };
export type Point = { x: number; y: number };
/** 창 안의 네모(CSS 픽셀, 창의 왼쪽 위 기준). 바탕화면 아이콘이 있는 자리. */
export type HoleRect = { x: number; y: number; width: number; height: number };
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
  | { type: 'adjust'; active: boolean }
  /** 입력을 받는 창이 앞에 왔다: 글 칸의 초점을 다시 준다(한/영 키, src/web/desktop/imeRefocus.ts). */
  | { type: 'refocusText' };

export interface CalfifDesktop {
  setInteractive(on: boolean): void; // send CH.interactive
  showMenu(at: Point): void; // send CH.menu (제목 줄 메뉴)
  onCommand(listener: (c: DesktopCommand) => void): () => void; // CH.command, 메인 → 화면
  getSystem(): Promise<SystemState>; // invoke CH.getSystem
  setSystem(patch: SystemPatch): Promise<SystemState>; // invoke CH.setSystem
  dragStart(): void; // send CH.dragStart
  drag(kind: DragKind, dx: number, dy: number): void; // send CH.drag
  setPassThrough(on: boolean): void; // send CH.passThrough (아이콘 자리 위: 마우스를 바탕화면으로 보낸다)
  onIconHoles(listener: (holes: HoleRect[]) => void): () => void; // CH.iconHoles, 메인 → 화면
  adjustDone(apply: boolean): void; // send CH.adjustDone
  showAlarms(items: AlarmPopupItem[], tone: AlarmTone): void; // send CH.alarm (맨 위 알림 창)
}

declare global {
  interface Window {
    calfifDesktop?: CalfifDesktop;
  }
}
