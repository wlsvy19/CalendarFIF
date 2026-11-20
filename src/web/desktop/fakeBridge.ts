import type { AlarmPopupItem, AlarmTone, CalfifDesktop, DesktopCommand, DragKind, HoleRect, Hotkey, HotkeyState, Point, SystemPatch, SystemState } from '../../desktop/api';

/** 시험용 다리. 부른 함수는 calls에 [함수 이름, ...인자]로 쌓인다. */
export class FakeBridge implements CalfifDesktop {
  calls: unknown[][] = [];
  taken = new Set<string>();
  system: SystemState = {
    settings: {
      hideHotkey: { accelerator: 'Ctrl+Alt+H', enabled: false },
      contentHotkey: { accelerator: 'Ctrl+Alt+F', enabled: false },
      startWithWindows: null,
    },
    hotkeys: { hide: 'off', content: 'off' },
    canStartWithWindows: false,
  };
  private listeners = new Set<(c: DesktopCommand) => void>();
  private holeListeners = new Set<(holes: HoleRect[]) => void>();

  emitHoles(holes: HoleRect[]): void {
    for (const l of [...this.holeListeners]) l(holes);
  }

  emit(c: DesktopCommand): void {
    for (const l of [...this.listeners]) l(c);
  }
  setInteractive(on: boolean): void {
    this.calls.push(['setInteractive', on]);
  }
  showMenu(at: Point): void {
    this.calls.push(['showMenu', at]);
  }
  onCommand(listener: (c: DesktopCommand) => void): () => void {
    this.calls.push(['onCommand']);
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  async getSystem(): Promise<SystemState> {
    this.calls.push(['getSystem']);
    return this.system;
  }
  async setSystem(patch: SystemPatch): Promise<SystemState> {
    this.calls.push(['setSystem', patch]);
    const settings = {
      ...this.system.settings,
      ...(patch.hideHotkey ? { hideHotkey: patch.hideHotkey } : {}),
      ...(patch.contentHotkey ? { contentHotkey: patch.contentHotkey } : {}),
      ...(patch.startWithWindows !== undefined ? { startWithWindows: patch.startWithWindows } : {}),
    };
    const stateOf = (h: Hotkey): HotkeyState => (!h.enabled ? 'off' : this.taken.has(h.accelerator) ? 'taken' : 'ok');
    this.system = { ...this.system, settings, hotkeys: { hide: stateOf(settings.hideHotkey), content: stateOf(settings.contentHotkey) } };
    return this.system;
  }
  dragStart(): void {
    this.calls.push(['dragStart']);
  }
  drag(kind: DragKind, dx: number, dy: number): void {
    this.calls.push(['drag', kind, dx, dy]);
  }
  setPassThrough(on: boolean): void {
    this.calls.push(['setPassThrough', on]);
  }
  onIconHoles(listener: (holes: HoleRect[]) => void): () => void {
    this.holeListeners.add(listener);
    return () => {
      this.holeListeners.delete(listener);
    };
  }
  adjustDone(apply: boolean): void {
    this.calls.push(['adjustDone', apply]);
  }
  showAlarms(items: AlarmPopupItem[], tone: AlarmTone): void {
    this.calls.push(['showAlarms', items, tone]);
  }
}
