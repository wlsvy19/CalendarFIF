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

// 맨 아래로 보내는 횟수를 묶는다: 1초에 세 번까지, 세 번씩 5묶음(15번) 내리 닿지 못하면 30초에 한 번으로 물러선다.
// 닿으면(reached) 모두 처음으로 돌아간다. 다른 바탕화면 프로그램과 맨 아래 자리를 두고 다투지 않기 위해서다.
export class BottomLimiter {
  private recent: number[] = [];
  private attempts = 0;
  private last = 0;
  allow(now: number): boolean {
    if (this.attempts >= BACKOFF_AFTER) {
      if (now - this.last < BACKOFF_MS) return false;
    } else {
      this.recent = this.recent.filter((t) => now - t < WINDOW_MS);
      if (this.recent.length >= PER_WINDOW) return false;
    }
    this.recent.push(now);
    this.last = now;
    this.attempts += 1;
    return true;
  }
  reached(): void {
    this.recent = [];
    this.attempts = 0;
  }
}
const WINDOW_MS = 1000;
const PER_WINDOW = 3;
const BACKOFF_AFTER = 15;
const BACKOFF_MS = 30000;
