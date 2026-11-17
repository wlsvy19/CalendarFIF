import { expect, it, vi } from 'vitest';
import { LogLevel, Logger, setUserLogHandler } from '@firebase/logger';
import { LOG_GLOBAL as WIDGET_LOG_GLOBAL, webLogOf } from '../widget/pending';
import { LOG_GLOBAL, keepSdkLogs } from './widgetLog';

it('위젯 스크립트가 읽는 이름과 같은 이름에 적는다', () => {
  expect(LOG_GLOBAL).toBe(WIDGET_LOG_GLOBAL);
});

it('SDK의 경고와 오류를 window에 적어 두고 콘솔에는 가지 않게 한다. 마지막 다섯 줄, 한 줄은 300자까지. 위젯이 그대로 읽는다', () => {
  // Firebase SDK가 쓰는 것과 같은 기록 도구(firebase/app의 onLog가 이것을 부른다).
  const api = { onLog: (callback: Parameters<typeof setUserLogHandler>[0], options: { level: 'warn' }) => setUserLogHandler(callback, options) };
  const sdk = new Logger('@firebase/firestore');
  // Firestore와 Auth는 기록 수준을 보고 나서 적는다(@firebase/firestore의 logError, logWarn과 같은 꼴).
  // 그래서 수준을 끄면(silent) 받는 쪽에도 오지 않는다: keepSdkLogs는 수준을 건드리지 않아야 한다.
  const sdkError = (message: string, ...more: unknown[]): void => {
    if (sdk.logLevel <= LogLevel.ERROR) sdk.error(message, ...more);
  };
  const sdkWarn = (message: string): void => {
    if (sdk.logLevel <= LogLevel.WARN) sdk.warn(message);
  };
  const realError = console.error;
  const realWarn = console.warn;
  const error = vi.fn();
  const warn = vi.fn();
  console.error = error;
  console.warn = warn;
  const info = vi.spyOn(console, 'info').mockImplementation(() => {});
  try {
    const target: Record<string, unknown> = {};
    let clock = 1000;
    keepSdkLogs(target, () => (clock += 1), api);
    expect(target[LOG_GLOBAL]).toBeUndefined();
    sdk.info('알림은 적지 않는다');
    sdkError('Firestore (13.3.0): 연결이 끊겼다', new Error('transport errored'));
    sdkWarn('x'.repeat(500));
    // SDK의 줄은 콘솔에 가지 않는다: Scriptable이 "Errors Logged" 상자에 넣지 않는다.
    expect([error.mock.calls.length, warn.mock.calls.length]).toEqual([0, 0]);
    expect(JSON.parse(String(target[LOG_GLOBAL]))).toEqual([
      { at: 1001, level: 'error', type: '@firebase/firestore', text: 'Firestore (13.3.0): 연결이 끊겼다 transport errored' },
      { at: 1002, level: 'warn', type: '@firebase/firestore', text: 'x'.repeat(300) },
    ]);
    // SDK의 것이 아닌 줄은 그대로 콘솔에 간다.
    console.error('앱의 오류', 7);
    console.warn('앱의 경고');
    console.error({ not: 'a string' });
    expect([error.mock.calls, warn.mock.calls]).toEqual([[['앱의 오류', 7], [{ not: 'a string' }]], [['앱의 경고']]]);
    for (let i = 0; i < 6; i += 1) sdkError(`오류 ${i}`);
    const kept = JSON.parse(String(target[LOG_GLOBAL])) as { text: string }[];
    expect(kept.map((l) => l.text)).toEqual(['오류 1', '오류 2', '오류 3', '오류 4', '오류 5']);
    // 위젯 스크립트는 마지막 세 줄을 읽는다.
    expect(webLogOf(String(target[LOG_GLOBAL])).map((l) => l.text)).toEqual(['오류 3', '오류 4', '오류 5']);
    expect(error.mock.calls).toHaveLength(2);
  } finally {
    setUserLogHandler(null);
    console.error = realError;
    console.warn = realWarn;
    info.mockRestore();
  }
});
