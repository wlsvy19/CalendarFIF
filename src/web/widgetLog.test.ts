import { expect, it, vi } from 'vitest';
import { Logger, setLogLevel as setAll, setUserLogHandler } from '@firebase/logger';
import { LOG_GLOBAL as WIDGET_LOG_GLOBAL, webLogOf } from '../widget/pending';
import { LOG_GLOBAL, keepSdkLogs } from './widgetLog';

it('위젯 스크립트가 읽는 이름과 같은 이름에 적는다', () => {
  expect(LOG_GLOBAL).toBe(WIDGET_LOG_GLOBAL);
});

it('SDK의 경고와 오류를 콘솔에 적지 않고 window에 적어 둔다. 마지막 다섯 줄, 한 줄은 300자까지. 위젯이 그대로 읽는다', () => {
  // Firebase SDK가 쓰는 것과 같은 기록 도구(firebase/app의 onLog와 setLogLevel이 이것을 부른다).
  const api = { onLog: (callback: Parameters<typeof setUserLogHandler>[0], options: { level: 'warn' }) => setUserLogHandler(callback, options), setLogLevel: (level: 'silent') => setAll(level) };
  const sdk = new Logger('@firebase/firestore');
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const info = vi.spyOn(console, 'info').mockImplementation(() => {});
  try {
    const target: Record<string, unknown> = {};
    let clock = 1000;
    keepSdkLogs(target, () => (clock += 1), api);
    expect(target[LOG_GLOBAL]).toBeUndefined();
    sdk.info('알림은 적지 않는다');
    sdk.error('Firestore (13.3.0): 연결이 끊겼다', new Error('transport errored'));
    sdk.warn('x'.repeat(500));
    // 콘솔에는 아무것도 가지 않는다: Scriptable이 "Errors Logged" 상자를 띄우지 않는다.
    expect([error.mock.calls.length, warn.mock.calls.length, info.mock.calls.length]).toEqual([0, 0, 0]);
    expect(JSON.parse(String(target[LOG_GLOBAL]))).toEqual([
      { at: 1001, level: 'error', type: '@firebase/firestore', text: 'Firestore (13.3.0): 연결이 끊겼다 transport errored' },
      { at: 1002, level: 'warn', type: '@firebase/firestore', text: 'x'.repeat(300) },
    ]);
    for (let i = 0; i < 6; i += 1) sdk.error(`오류 ${i}`);
    const kept = JSON.parse(String(target[LOG_GLOBAL])) as { text: string }[];
    expect(kept.map((l) => l.text)).toEqual(['오류 1', '오류 2', '오류 3', '오류 4', '오류 5']);
    // 위젯 스크립트는 마지막 세 줄을 읽는다.
    expect(webLogOf(String(target[LOG_GLOBAL])).map((l) => l.text)).toEqual(['오류 3', '오류 4', '오류 5']);
  } finally {
    setUserLogHandler(null);
    setAll('info');
    error.mockRestore();
    warn.mockRestore();
    info.mockRestore();
  }
});
