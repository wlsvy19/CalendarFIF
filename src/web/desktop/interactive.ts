export type InteractiveReason = 'editor' | 'settings' | 'login' | 'blocked' | 'users';

/** 창이 마우스와 키보드 입력을 받아야 하는 이유들을 세어, 하나라도 있는 동안만 켠다. */
export class Interactivity {
  private readonly reasons = new Set<InteractiveReason>();

  constructor(private readonly send: (on: boolean) => void) {}

  begin(r: InteractiveReason): void {
    const was = this.active();
    this.reasons.add(r);
    if (!was) this.send(true);
  }

  end(r: InteractiveReason): void {
    if (!this.reasons.delete(r)) return;
    if (!this.active()) this.send(false);
  }

  active(): boolean {
    return this.reasons.size > 0;
  }
}
