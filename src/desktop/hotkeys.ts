import { normalizeAccelerator } from '../core/accelerator';
import type { HotkeyState } from './api';
import type { DesktopSettings } from './settings';

export type Registrar = { register(accelerator: string, fn: () => void): boolean; unregister(accelerator: string): void };

// 켜 둔 전역 단축키를 등록하고 결과를 알려 준다. electron은 가져오지 않는다(Registrar를 main이 만든다).
export class HotkeyManager {
  private registered: string[] = [];
  constructor(private readonly reg: Registrar) {}

  apply(s: Pick<DesktopSettings, 'hideHotkey' | 'contentHotkey'>, actions: { hide(): void; content(): void }): { hide: HotkeyState; content: HotkeyState } {
    this.dispose();
    const one = (hk: { accelerator: string; enabled: boolean }, fn: () => void): HotkeyState => {
      if (!hk.enabled) return 'off';
      const acc = normalizeAccelerator(hk.accelerator);
      if (acc === null) return 'invalid';
      if (!this.reg.register(acc, fn)) return 'taken';
      this.registered.push(acc);
      return 'ok';
    };
    return { hide: one(s.hideHotkey, actions.hide), content: one(s.contentHotkey, actions.content) };
  }

  dispose(): void {
    for (const acc of this.registered) this.reg.unregister(acc);
    this.registered = [];
  }
}
