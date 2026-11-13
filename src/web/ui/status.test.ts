import { expect, it } from 'vitest';
import type { SyncStatus } from '../../sync/engine';
import { statusText } from './status';

it('동기화 상태를 문구로 바꾼다', () => {
  expect(statusText({ state: 'synced', pending: 0 })).toBe('동기화됨');
  expect(statusText({ state: 'sending', pending: 1 })).toBe('올리는 중');
  expect(statusText({ state: 'waiting', pending: 2 })).toBe('오프라인 (대기 2건)');
});
it('읽기 문제와 권한, 연결 상태를 차례로 따져 문구를 고른다', () => {
  const synced: SyncStatus = { state: 'synced', pending: 0 };
  const waiting: SyncStatus = { state: 'waiting', pending: 2 };
  const denied: SyncStatus = { state: 'waiting', pending: 3, reason: 'denied' };
  expect(statusText(denied, 'denied')).toBe('권한이 없어 읽지 못했습니다');
  expect(statusText(synced, 'denied', false)).toBe('권한이 없어 읽지 못했습니다');
  expect(statusText(denied, 'failed')).toBe('읽지 못했습니다. 다시 연결하는 중');
  expect(statusText(synced, 'failed')).toBe('읽지 못했습니다. 다시 연결하는 중');
  expect(statusText(denied)).toBe('권한이 없어 올리지 못했습니다 (대기 3건)');
  expect(statusText(denied, null, false)).toBe('권한이 없어 올리지 못했습니다 (대기 3건)');
  expect(statusText(waiting, null, true)).toBe('오프라인 (대기 2건)');
  expect(statusText({ state: 'sending', pending: 1 }, null, false)).toBe('올리는 중');
  expect(statusText(synced, null, false)).toBe('오프라인');
  expect(statusText(synced, null, true)).toBe('동기화됨');
});
