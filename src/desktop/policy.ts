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

// 위치 조정 상태의 전이. 시작을 또 요청하면 덮개를 다시 보내고, 화면이 다시 읽히면 취소로 끝낸다.
export type AdjustEvent = 'start' | 'reload' | 'finish';
export type AdjustAction = 'begin' | 'resend' | 'cancel' | 'end' | 'none';
export function adjustStep(adjusting: boolean, event: AdjustEvent): { adjusting: boolean; action: AdjustAction } {
  if (event === 'start') return { adjusting: true, action: adjusting ? 'resend' : 'begin' };
  if (!adjusting) return { adjusting: false, action: 'none' };
  return { adjusting: false, action: event === 'reload' ? 'cancel' : 'end' };
}

// 화면(페이지)이 보고한 "입력을 받는 중" 상태. 새 페이지가 뜨기 시작할 때(그 페이지의 스크립트가 돌기 전) 되돌리므로,
// 그 뒤에 온 보고는 새 페이지의 것이라 유지된다. generation은 페이지마다 하나 늘어난다.
export class PageInput {
  generation = 0;
  interactive = false;
  report(on: boolean): void {
    this.interactive = on;
  }
  // 새 페이지가 뜨기 시작했다. 돌려받는 값은 되돌릴 입력 상태가 있었는지다.
  navigationStart(): boolean {
    this.generation += 1;
    return this.reset(this.generation);
  }
  // generation 페이지가 사라졌다(렌더러 종료, 창 닫힘). 이미 새 페이지가 떴으면 무시한다.
  reset(generation: number): boolean {
    if (generation !== this.generation) return false;
    const was = this.interactive;
    this.interactive = false;
    return was;
  }
}
