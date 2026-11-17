/**
 * 위젯에서 연 화면(Scriptable 안의 웹 화면)에서는 Firebase SDK가 콘솔에 아무것도 적지 않게 한다.
 *
 * Scriptable은 웹 화면의 콘솔에 찍힌 오류를 모아, 그 화면을 띄운 스크립트가 끝날 때 "Errors Logged" 상자로 띄운다.
 * SDK는 `console.error("[시각]  @firebase/firestore:", 내용...)`으로 적고 Scriptable은 첫 인자만 보여서, 상자에는 내용 없는 줄만 나온다.
 * 위젯에서 연 달력에서 저장하면 스크립트가 끝나므로(위젯을 새로 그리게 하려고) 저장할 때마다 그 상자가 떴다(2026-11-17 사용자의 아이폰).
 *
 * 0.9.13~0.9.15는 console.warn과 console.error를 바꿔 넣어 SDK의 줄만 걸렀는데 듣지 않았다: Scriptable은 우리가 바꿔 넣은 것보다
 * 먼저 콘솔을 받는다. 그래서 SDK가 콘솔을 아예 부르지 않게 한다(기록 수준을 끈다). Firestore와 Auth는 수준을 보고 기록 자체를
 * 건너뛰므로 콘솔에 닿는 것이 없다. 그 대신 SDK의 경고와 오류의 내용은 이 화면에서 볼 길이 없다(같은 웹앱을 Safari나 PC에서 열어 콘솔로 본다).
 */
import { setLogLevel } from 'firebase/app';

type SdkLogApi = { setLogLevel(level: 'silent'): void };

/**
 * 지금까지 생긴 SDK의 기록 도구를 모두 끈다. 이 뒤에 생기는 것(나중에 불러오는 SDK 모듈)에는 닿지 않으므로,
 * 화면이 뜬 뒤에 한 번 더 부른다(src/web/main.ts). 던지지 않는다.
 */
export function silenceSdkLogs(api: SdkLogApi = { setLogLevel }): void {
  try {
    api.setLogLevel('silent');
  } catch {
    // 끄지 못하면 SDK가 전처럼 콘솔에 적는다.
  }
}
