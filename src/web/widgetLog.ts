/**
 * 위젯에서 연 화면(Scriptable 안의 웹 화면)에서 Firebase SDK가 남기는 경고와 오류.
 * SDK는 그것을 console에 `[시각]  @firebase/firestore:`와 내용을 따로 넘겨 적는다. Scriptable은 웹 화면의 console 오류를 모아
 * 스크립트가 끝날 때 "Errors Logged" 상자로 띄우는데, 첫 인자만 보여서 내용이 나오지 않는다(2026-11-17 사용자의 아이폰).
 * 그래서 이 화면에서는 SDK의 경고와 오류의 마지막 몇 줄을 window.__calfifLog에 글(JSON)로 적어 두고, SDK가 콘솔에 적는 그 줄은 막는다.
 * 달력을 띄운 스크립트가 적어 둔 것을 읽어 Scriptable 메뉴의 상태에 보인다(src/widget/pending.ts의 PROBE_JS, status.ts).
 *
 * SDK의 기록 수준을 끄는 것(setLogLevel('silent'))으로는 안 된다: Firestore와 Auth는 수준을 보고 기록 자체를 건너뛰어서
 * 받는 쪽(onLog)에도 오지 않는다. 수준은 그대로 두고 콘솔로 가는 줄만 막는다.
 */
import { onLog } from 'firebase/app';

/** src/widget/pending.ts의 LOG_GLOBAL과 같아야 한다. */
export const LOG_GLOBAL = '__calfifLog';
const KEEP = 5;
const MAX_TEXT = 300;
/** SDK가 콘솔에 적는 줄의 첫 인자(`[시각]  @firebase/firestore:`)에서 SDK의 이름을 찾는다. */
const SDK_NAME = /@firebase\/[\w-]+/;

type SdkLog = { level: string; message: string; type: string };
type SdkLogApi = { onLog(callback: (log: SdkLog) => void, options: { level: 'warn' }): void };
type ConsoleLike = { warn(...args: unknown[]): void; error(...args: unknown[]): void };

/** 콘솔에 넘긴 인자들을 한 줄로(SDK의 받는 쪽이 만드는 글과 같은 꼴로). */
function textOf(args: unknown[]): string {
  return args
    .map((a) => {
      if (a == null) return '';
      if (typeof a === 'string') return a;
      if (typeof a === 'number' || typeof a === 'boolean') return String(a);
      if (a instanceof Error) return a.message;
      try {
        return JSON.stringify(a);
      } catch {
        return '';
      }
    })
    .filter((t) => t !== '')
    .join(' ');
}

/**
 * SDK의 경고와 오류를 target[LOG_GLOBAL]에 적게 하고(마지막 다섯 줄, 한 줄은 300자까지), SDK가 콘솔에 적는 경고와 오류는 막는다.
 * SDK의 것이 아닌 콘솔 줄은 그대로 둔다.
 * 받는 길이 둘이다. SDK의 받는 쪽(onLog)으로 오면 그것을 적는다. 그 줄은 바로 이어서 콘솔로도 오므로 그때는 버리기만 한다.
 * 받는 쪽으로 오지 않고 콘솔로만 온 줄(이 함수를 부른 뒤에 생긴 SDK의 기록 도구에는 받는 쪽이 걸리지 않는다)은 콘솔의 것을 적는다.
 */
export function keepSdkLogs(target: Record<string, unknown>, now: () => number = () => Date.now(), api: SdkLogApi = { onLog }, con: ConsoleLike = console): void {
  const kept: { at: number; level: string; type: string; text: string }[] = [];
  const keep = (level: string, type: string, text: string): void => {
    try {
      kept.push({ at: now(), level, type, text: text.slice(0, MAX_TEXT) });
      while (kept.length > KEEP) kept.shift();
      target[LOG_GLOBAL] = JSON.stringify(kept);
    } catch {
      // 적지 못해도 화면은 그대로 돈다.
    }
  };
  let taken = false; // 방금 받는 쪽으로 온 줄이다: 이어서 콘솔로 오는 같은 줄은 적지 않는다
  api.onLog(
    (log) => {
      taken = true;
      keep(String(log.level), String(log.type), String(log.message));
    },
    { level: 'warn' },
  );
  for (const name of ['warn', 'error'] as const) {
    const base = con[name].bind(con);
    // 이 뒤에 누가 콘솔의 이 자리를 바꿔 넣으면(Scriptable이 웹 화면의 콘솔을 가로채는 때를 모른다) 그것을 아래에 두고, 거르는 것은 그대로 맨 앞에 둔다.
    let under: (...args: unknown[]) => void = base;
    let inside = false;
    const filter = (...args: unknown[]): void => {
      const sdk = typeof args[0] === 'string' ? SDK_NAME.exec(args[0]) : null;
      if (sdk) {
        if (!taken) keep(name, sdk[0], textOf(args.slice(1)));
        taken = false;
        return;
      }
      taken = false;
      // 바꿔 넣은 것이 "원래 것"으로 이 거르는 것을 다시 부르면(가로채는 쪽이 흔히 그렇게 한다) 맨 처음의 콘솔로 보낸다: 끝없이 돌지 않게.
      if (inside) {
        base(...args);
        return;
      }
      inside = true;
      try {
        under(...args);
      } finally {
        inside = false;
      }
    };
    try {
      Object.defineProperty(con, name, {
        configurable: true,
        enumerable: true,
        get: () => filter,
        set: (next: unknown) => {
          if (typeof next === 'function' && next !== filter) under = next as (...args: unknown[]) => void;
        },
      });
    } catch {
      con[name] = filter; // 자리를 지키지 못하면 바꿔 넣기만 한다
    }
  }
}
