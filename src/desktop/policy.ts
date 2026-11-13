import { isAppUrl } from './protocol';

// owner는 소유자 창(없으면 0), visible은 WS_VISIBLE이 켜져 있는지, desktopOwned는 자신이나 소유자가 Progman이거나 Progman의 자손인지다.
export type BelowEntry = { hwnd: bigint; owner: bigint; visible: boolean; desktopOwned: boolean };

// below는 창 바로 아래부터 Progman까지(포함)의 목록이다(위에서 아래 순서). Progman 앞에는 바탕화면 쪽 창만 있어야 맨 아래다.
// 바탕화면 쪽 창은 바탕화면에 붙은 창(desktopOwned, 보이든 숨었든)과, 바탕화면 쪽 창이 소유한 숨은 창이다. 바탕화면에 붙은 다른 창
// (꾸린 앱의 달력, DesktopCal)도 숨은 입력기 창(IME, MSCTFIME UI)을 소유하고, Windows는 그 창들을 늘 소유자 바로 위에 둔다.
// 이를 남의 창으로 보면 서로 맨 아래를 다툰다. 보이는 창은 소유자가 바탕화면 쪽이어도(대화 상자, 설정 창) 일반 창이다. 달력이 그 위에 있으면 가린다.
// 소유된 창은 늘 소유자보다 위에 있으므로 소유자는 목록에서 더 아래에 있다. 그래서 아래에서부터 보고, 아래에 없는 소유자는 모르는 것으로 본다.
export function isAtBottom(below: BelowEntry[], progman: bigint): boolean {
  if (progman === 0n) return below.length === 0;
  const i = below.findIndex((e) => e.hwnd === progman);
  if (i < 0) return false;
  const desktop = new Set<bigint>();
  for (const e of below.slice(0, i).reverse()) {
    if (!e.desktopOwned && (e.visible || !desktop.has(e.owner))) return false;
    desktop.add(e.hwnd);
  }
  return true;
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
  // allow(t)가 처음으로 참이 될 때(t >= now). 거절당한 뒤 한 번 다시 해 볼 때를 정한다.
  nextAllowedAt(now: number): number {
    if (this.attempts >= BACKOFF_AFTER) return Math.max(now, this.last + BACKOFF_MS);
    const inWindow = this.recent.filter((t) => now - t < WINDOW_MS);
    return inWindow.length < PER_WINDOW ? now : inWindow[inWindow.length - PER_WINDOW] + WINDOW_MS;
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

// 이 이동이 시작되면 지금 화면이 떠나는가. 주 프레임의 문서 이동이고 앱 주소로 갈 때만이다.
// 해시만 바뀌는 이동, 하위 프레임, installSecurity가 막는 다른 주소로의 이동은 화면을 그대로 둔다.
export function leavesPage(nav: { isMainFrame: boolean; isSameDocument: boolean; url: string }): boolean {
  return nav.isMainFrame && !nav.isSameDocument && isAppUrl(nav.url);
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

// 렌더러(화면)가 죽으면 다시 띄우기까지 기다리는 시간: 1초, 5초, 30초, 그 뒤로는 60초마다.
// 다시 띄운 화면이 60초 넘게 살아 있었으면 처음(1초)부터 센다.
export class CrashBackoff {
  private count = 0;
  private since = 0;
  crashed(now: number): number {
    if (this.count > 0 && now - this.since >= ALIVE_RESET_MS) this.count = 0;
    this.count += 1;
    return RELOAD_DELAYS[Math.min(this.count, RELOAD_DELAYS.length) - 1];
  }
  reloaded(now: number): void {
    this.since = now;
  }
}
const RELOAD_DELAYS = [1000, 5000, 30000, 60000];
const ALIVE_RESET_MS = 60000;

// 붙어 있는 Progman 핸들의 확인 결과(IsWindow). 확인하지 못했으면(호출이 던지거나 다른 호출 중이라 들어가지 못함, null) 살아 있는 것으로 본다.
export function ownerStatus(isWindow: boolean | null): 'alive' | 'lost' {
  return isWindow === false ? 'lost' : 'alive';
}

// 창이 받지 않는 키: 다시 읽기(Ctrl+R, Ctrl+Shift+R, F5)와 확대·축소(Ctrl과 +, -, 0). 누르는 순간(keyDown)만 본다.
// Alt를 함께 누른 조합은 화면으로 보낸다(전역 단축키로 고를 수 있게).
export type KeyInput = { type: string; key: string; code: string; control: boolean; shift: boolean; alt: boolean; meta: boolean };
const ZOOM_KEYS = ['+', '=', '-', '_', '0'];
const ZOOM_CODES = ['NumpadAdd', 'NumpadSubtract', 'Numpad0'];
export function isBlockedKey(i: KeyInput): boolean {
  if (i.type !== 'keyDown' || i.alt) return false;
  if (i.key === 'F5') return true;
  if (!i.control) return false;
  return i.key.toLowerCase() === 'r' || ZOOM_KEYS.includes(i.key) || ZOOM_CODES.includes(i.code);
}
