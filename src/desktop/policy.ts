export type BelowEntry = { hwnd: bigint; desktopOwned: boolean };

// below는 창 바로 아래부터 Progman까지(포함)의 목록이다. Progman 앞에는 바탕화면에 붙은 창만 있어야 맨 아래다.
export function isAtBottom(below: BelowEntry[], progman: bigint): boolean {
  if (progman === 0n) return below.length === 0;
  const i = below.findIndex((e) => e.hwnd === progman);
  return i >= 0 && below.slice(0, i).every((e) => e.desktopOwned);
}

export function shouldKeepBottom(s: { interactive: boolean; alwaysOnTop: boolean; adjusting: boolean; hidden: boolean }): boolean {
  return !s.interactive && !s.alwaysOnTop && !s.adjusting && !s.hidden;
}

// 예기치 않게 없어진 창을 Progman이 다시 생길 때 한 번 다시 만들게 한다.
export class Reattacher {
  private waiting = false;
  closed(byApp: boolean): void {
    this.waiting = !byApp;
  }
  ownerLost(): void {
    this.waiting = true;
  }
  tick(progmanAlive: boolean): 'idle' | 'wait' | 'create' {
    if (!this.waiting) return 'idle';
    if (!progmanAlive) return 'wait';
    this.waiting = false;
    return 'create';
  }
}
