import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LogLevel, Logger, setUserLogHandler } from '@firebase/logger';
import { LOG_GLOBAL as WIDGET_LOG_GLOBAL, webLogOf } from '../widget/pending';
import { LOG_GLOBAL, keepSdkLogs } from './widgetLog';

// Firebase SDK가 쓰는 것과 같은 기록 도구(firebase/app의 onLog가 이것을 부른다).
const api = { onLog: (callback: Parameters<typeof setUserLogHandler>[0], options: { level: 'warn' }) => setUserLogHandler(callback, options) };
// Firestore와 Auth는 기록 수준을 보고 나서 적는다(@firebase/firestore의 logError, logWarn과 같은 꼴).
// 그래서 수준을 끄면(silent) 받는 쪽에도 오지 않는다: keepSdkLogs는 수준을 건드리지 않아야 한다.
const gated = (logger: Logger) => ({
  error: (message: string, ...more: unknown[]): void => {
    if (logger.logLevel <= LogLevel.ERROR) logger.error(message, ...more);
  },
  warn: (message: string): void => {
    if (logger.logLevel <= LogLevel.WARN) logger.warn(message);
  },
});

// keepSdkLogs는 콘솔의 warn과 error 자리를 바꿔 놓는다. 시험마다 가짜를 넣고, 끝나면 원래 것으로 되돌린다.
const real = { error: console.error, warn: console.warn };
const put = (name: 'error' | 'warn', value: (...args: unknown[]) => void): void => {
  Object.defineProperty(console, name, { value, writable: true, configurable: true, enumerable: true });
};
let error = vi.fn();
let warn = vi.fn();
beforeEach(() => {
  error = vi.fn();
  warn = vi.fn();
  put('error', error);
  put('warn', warn);
});
afterEach(() => {
  setUserLogHandler(null);
  put('error', real.error);
  put('warn', real.warn);
});

it('위젯 스크립트가 읽는 이름과 같은 이름에 적는다', () => {
  expect(LOG_GLOBAL).toBe(WIDGET_LOG_GLOBAL);
});

it('SDK의 경고와 오류를 window에 적어 두고 콘솔에는 가지 않게 한다. 마지막 다섯 줄, 한 줄은 300자까지. 위젯이 그대로 읽는다', () => {
  const sdk = new Logger('@firebase/firestore');
  const firestore = gated(sdk);
  const info = vi.spyOn(console, 'info').mockImplementation(() => {});
  try {
    const target: Record<string, unknown> = {};
    let clock = 1000;
    keepSdkLogs(target, () => (clock += 1), api);
    expect(target[LOG_GLOBAL]).toBeUndefined();
    sdk.info('알림은 적지 않는다');
    firestore.error('Firestore (13.3.0): 연결이 끊겼다', new Error('transport errored'));
    firestore.warn('x'.repeat(500));
    // SDK의 줄은 콘솔에 가지 않는다: Scriptable이 "Errors Logged" 상자에 넣지 않는다. 한 줄은 한 번만 적힌다.
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
    // 이 뒤에 생긴 SDK의 기록 도구에는 받는 쪽이 걸리지 않는다. 그것이 콘솔에 적는 줄도 막고, 콘솔의 것을 적어 둔다.
    const late = gated(new Logger('@firebase/messaging'));
    late.error('토큰을 받지 못했다', { code: 'messaging/failed' }, 3);
    expect(error.mock.calls).toHaveLength(2);
    expect((JSON.parse(String(target[LOG_GLOBAL])) as unknown[]).at(-1)).toEqual({ at: 1003, level: 'error', type: '@firebase/messaging', text: '토큰을 받지 못했다 {"code":"messaging/failed"} 3' });
    // 그 뒤에 앞의 SDK가 적어도 한 번만 적힌다.
    for (let i = 0; i < 6; i += 1) firestore.error(`오류 ${i}`);
    const kept = JSON.parse(String(target[LOG_GLOBAL])) as { text: string }[];
    expect(kept.map((l) => l.text)).toEqual(['오류 1', '오류 2', '오류 3', '오류 4', '오류 5']);
    // 위젯 스크립트는 마지막 세 줄을 읽는다.
    expect(webLogOf(String(target[LOG_GLOBAL])).map((l) => l.text)).toEqual(['오류 3', '오류 4', '오류 5']);
    expect([error.mock.calls.length, warn.mock.calls.length]).toEqual([2, 1]);
  } finally {
    info.mockRestore();
  }
});

it('나중에 누가 콘솔을 가로채도(Scriptable이 웹 화면의 콘솔을 바꿔 넣는 때를 모른다) SDK의 줄은 거기에 가지 않는다', () => {
  const firestore = gated(new Logger('@firebase/firestore'));
  const target: Record<string, unknown> = {};
  keepSdkLogs(target, () => 1, api);
  // 가로채는 쪽이 흔히 하는 꼴: 지금의 console.error를 "원래 것"으로 잡아 두고, 자기 것을 바꿔 넣어 받은 것을 적은 뒤 원래 것을 부른다.
  const seen: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]): void => {
    seen.push(args);
    original(...args);
  };
  firestore.error('Firestore (13.3.0): 연결이 끊겼다');
  // 가로채는 쪽에도, 처음의 콘솔에도 가지 않았고, 적어 두기는 했다.
  expect([seen, error.mock.calls]).toEqual([[], []]);
  expect(JSON.parse(String(target[LOG_GLOBAL]))).toEqual([{ at: 1, level: 'error', type: '@firebase/firestore', text: 'Firestore (13.3.0): 연결이 끊겼다' }]);
  // SDK의 것이 아닌 줄은 가로채는 쪽에 한 번, 처음의 콘솔에 한 번 간다(끝없이 서로 부르지 않는다).
  console.error('앱의 오류');
  expect([seen, error.mock.calls]).toEqual([[['앱의 오류']], [['앱의 오류']]]);
  // 한 번 더 가로채도 같다.
  const again = console.error;
  const seenAgain: unknown[][] = [];
  console.error = (...args: unknown[]): void => {
    seenAgain.push(args);
    again(...args);
  };
  firestore.error('또 끊겼다');
  console.error('둘째 오류');
  expect([seen.length, seenAgain, error.mock.calls.length]).toEqual([1, [['둘째 오류']], 2]);
});
