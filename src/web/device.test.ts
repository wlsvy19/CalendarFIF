import { expect, it } from 'vitest';
import { deviceLabel } from './device';

it('아이폰과 PC를 구분한다', () => {
  expect(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15')).toBe('iphone');
  expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/142.0')).toBe('pc');
});
