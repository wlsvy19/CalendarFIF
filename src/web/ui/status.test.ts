import { expect, it } from 'vitest';
import { statusText } from './status';

it('동기화 상태를 문구로 바꾼다', () => {
  expect(statusText({ state: 'synced', pending: 0 })).toBe('동기화됨');
  expect(statusText({ state: 'sending', pending: 1 })).toBe('올리는 중');
  expect(statusText({ state: 'waiting', pending: 2 })).toBe('오프라인 (대기 2건)');
});
