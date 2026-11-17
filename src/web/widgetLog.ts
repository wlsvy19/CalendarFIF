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
/** SDK가 콘솔에 적는 줄의 첫 인자에 들어 있는 것(`[시각]  @firebase/firestore:`). */
const SDK_MARK = '@firebase/';

type SdkLog = { level: string; message: string; type: string };
type SdkLogApi = { onLog(callback: (log: SdkLog) => void, options: { level: 'warn' }): void };
type ConsoleLike = { warn(...args: unknown[]): void; error(...args: unknown[]): void };

/**
 * SDK의 경고와 오류를 target[LOG_GLOBAL]에 적게 하고(마지막 다섯 줄, 한 줄은 300자까지), SDK가 콘솔에 적는 경고와 오류는 막는다.
 * SDK의 것이 아닌 콘솔 줄은 그대로 둔다.
 */
export function keepSdkLogs(target: Record<string, unknown>, now: () => number = () => Date.now(), api: SdkLogApi = { onLog }, con: ConsoleLike = console): void {
  const kept: { at: number; level: string; type: string; text: string }[] = [];
  api.onLog(
    (log) => {
      try {
        kept.push({ at: now(), level: String(log.level), type: String(log.type), text: String(log.message).slice(0, MAX_TEXT) });
        while (kept.length > KEEP) kept.shift();
        target[LOG_GLOBAL] = JSON.stringify(kept);
      } catch {
        // 적지 못해도 화면은 그대로 돈다.
      }
    },
    { level: 'warn' },
  );
  for (const name of ['warn', 'error'] as const) {
    const original = con[name].bind(con);
    con[name] = (...args: unknown[]): void => {
      if (typeof args[0] === 'string' && args[0].includes(SDK_MARK)) return; // 위에서 받아 적었다
      original(...args);
    };
  }
}
