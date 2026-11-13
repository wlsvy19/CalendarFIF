import { normalizeAccelerator } from '../core/accelerator';
import type { HotkeyState } from './api';
import type { DesktopSettings } from './settings';

export type Registrar = { register(accelerator: string, fn: () => void): boolean; unregister(accelerator: string): void };
type Settings = Pick<DesktopSettings, 'hideHotkey' | 'contentHotkey'>;
type Actions = { hide(): void; content(): void };
type States = { hide: HotkeyState; content: HotkeyState };

// 켜 둔 전역 단축키를 등록하고 결과를 알려 준다. electron은 가져오지 않는다(Registrar를 main이 만든다).
// 창이 입력을 받는 동안(편집, 설정, 로그인)은 멈춘다. 그동안은 아무것도 등록하지 않고, 바꾼 설정은 저장만 되며
// 등록은 다시 켤 때 그때의 설정으로 한다. 멈춘 동안의 결과(ok, taken, invalid)는 등록해 보고 곧바로 풀어서 알아낸다.
export class HotkeyManager {
  private registered: string[] = [];
  private paused = false;
  private settings: Settings | null = null;
  private actions: Actions | null = null;
  constructor(private readonly reg: Registrar) {}

  apply(s: Settings, actions: Actions): States {
    this.settings = s;
    this.actions = actions;
    return this.register();
  }

  // 멈추면 등록을 모두 풀고, 다시 켜면 마지막 설정으로 등록한 결과를 돌려준다(그 밖에는 null).
  setPaused(paused: boolean): States | null {
    if (paused === this.paused) return null;
    this.paused = paused;
    this.dispose();
    return !paused && this.settings && this.actions ? this.register() : null;
  }

  private register(): States {
    this.dispose();
    const s = this.settings!;
    const actions = this.actions!;
    const probed = new Set<string>();
    const one = (hk: { accelerator: string; enabled: boolean }, fn: () => void): HotkeyState => {
      if (!hk.enabled) return 'off';
      const acc = normalizeAccelerator(hk.accelerator);
      if (acc === null) return 'invalid';
      if (this.paused) {
        if (probed.has(acc) || !this.reg.register(acc, fn)) return 'taken';
        this.reg.unregister(acc);
        probed.add(acc);
        return 'ok';
      }
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
