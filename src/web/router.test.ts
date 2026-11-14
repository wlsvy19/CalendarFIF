import { expect, it } from 'vitest';
import { closeAction, hashFor, parseHash } from './router';

it('주소를 화면으로 바꾼다', () => {
  expect(parseHash('#2026-11-13')).toEqual({ name: 'day', dateKey: '2026-11-13' });
  expect(parseHash('#settings')).toEqual({ name: 'settings' });
  for (const hash of ['', '#', '#abc', '#2026-02-30', '#2026-11-13/extra']) {
    expect(parseHash(hash)).toEqual({ name: 'calendar' });
  }
});
it('화면을 주소로 바꾼다', () => {
  expect(hashFor({ name: 'day', dateKey: '2026-11-13' })).toBe('#2026-11-13');
  expect(hashFor({ name: 'settings' })).toBe('#settings');
  expect(hashFor({ name: 'calendar' })).toBe('');
});
it('#users는 사용자 관리 화면이다', () => {
  expect(parseHash('#users')).toEqual({ name: 'users' });
  expect(hashFor({ name: 'users' })).toBe('#users');
  expect(parseHash('#users/x')).toEqual({ name: 'calendar' });
});
it('시트를 닫을 때: 앱이 쌓은 기록이면 뒤로, 주소로 연 것이면 바꾼다', () => {
  expect(closeAction(true)).toBe('back');
  expect(closeAction(false)).toBe('replace');
});
