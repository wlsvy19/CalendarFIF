/**
 * 위젯에서 연 화면(Scriptable 안의 웹 화면)에서 Firebase SDK가 남기는 경고와 오류.
 * SDK는 그것을 console에 `[시각]  @firebase/firestore:`와 내용을 따로 넘겨 적는다. Scriptable은 웹 화면의 console.error를 모아
 * 스크립트가 끝날 때 "Errors Logged" 상자로 띄우는데, 첫 인자만 보여서 내용이 나오지 않는다(2026-11-17 사용자의 아이폰).
 * 그래서 이 화면에서는 SDK가 콘솔에 적지 않게 하고, 마지막 몇 줄을 window.__calfifLog에 글(JSON)로 적어 둔다.
 * 달력을 띄운 스크립트가 그것을 읽어 Scriptable 메뉴의 상태에 보인다(src/widget/pending.ts의 PROBE_JS, status.ts).
 */
import { onLog, setLogLevel } from 'firebase/app';

/** src/widget/pending.ts의 LOG_GLOBAL과 같아야 한다. */
export const LOG_GLOBAL = '__calfifLog';
const KEEP = 5;
const MAX_TEXT = 300;

type SdkLog = { level: string; message: string; type: string };
type SdkLogApi = { onLog(callback: (log: SdkLog) => void, options: { level: 'warn' }): void; setLogLevel(level: 'silent'): void };

/**
 * SDK의 경고와 오류를 콘솔 대신 target[LOG_GLOBAL]에 적게 한다(마지막 다섯 줄, 한 줄은 300자까지).
 * 먼저 받는 쪽을 걸고 나서 콘솔을 끈다: 받는 쪽은 자기 수준(warn)으로 걸러 받으므로 콘솔을 꺼도 온다.
 */
export function keepSdkLogs(target: Record<string, unknown>, now: () => number = () => Date.now(), api: SdkLogApi = { onLog, setLogLevel }): void {
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
  api.setLogLevel('silent');
}
