import { afterEach, expect, it, vi } from 'vitest';
import { LogLevel, Logger, setLogLevel as setAll } from '@firebase/logger';
import { silenceSdkLogs } from './widgetLog';

// Firebase SDK가 쓰는 것과 같은 기록 도구(firebase/app의 setLogLevel이 이것을 부른다).
const api = { setLogLevel: (level: 'silent') => setAll(level) };
// Firestore와 Auth는 기록 수준을 보고 나서 적는다(@firebase/firestore의 logError, logWarn과 같은 꼴).
const gated = (logger: Logger) => ({
  error: (message: string, ...more: unknown[]): void => {
    if (logger.logLevel <= LogLevel.ERROR) logger.error(message, ...more);
  },
  warn: (message: string): void => {
    if (logger.logLevel <= LogLevel.WARN) logger.warn(message);
  },
});

afterEach(() => {
  setAll('info');
  vi.restoreAllMocks();
});

it('SDK가 경고와 오류를 콘솔에 적지 않는다: Scriptable이 "Errors Logged" 상자에 넣을 것이 없다', () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const firestore = new Logger('@firebase/firestore');
  const auth = new Logger('@firebase/auth');
  // 끄기 전에는 콘솔에 간다(이 시험이 SDK의 길을 제대로 흉내 내는지 본다).
  gated(firestore).error('Firestore (13.3.0): 끄기 전의 오류');
  expect(error.mock.calls).toHaveLength(1);
  expect(String(error.mock.calls[0][0])).toContain('@firebase/firestore:');
  silenceSdkLogs(api);
  gated(firestore).error('Firestore (13.3.0): 연결이 끊겼다', new Error('transport errored'));
  gated(firestore).warn('경고');
  gated(auth).error('오류');
  // 수준을 보지 않고 바로 적는 SDK의 것도 콘솔에 닿지 않는다.
  firestore.error('바로 적은 오류');
  firestore.warn('바로 적은 경고');
  expect([error.mock.calls.length, warn.mock.calls.length]).toEqual([1, 0]);
});

it('나중에 생긴 기록 도구는 한 번 더 불러야 꺼진다(화면이 뜬 뒤에 다시 부르는 까닭)', () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  silenceSdkLogs(api);
  const late = new Logger('@firebase/messaging');
  gated(late).error('나중에 생긴 것의 오류');
  expect(error.mock.calls).toHaveLength(1);
  silenceSdkLogs(api);
  gated(late).error('다시 끈 뒤의 오류');
  expect(error.mock.calls).toHaveLength(1);
});

it('끄지 못해도 던지지 않는다', () => {
  expect(() => silenceSdkLogs({ setLogLevel: () => { throw new Error('막혔다'); } })).not.toThrow();
});
