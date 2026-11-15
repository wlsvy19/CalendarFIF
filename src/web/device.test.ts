import { expect, it } from 'vitest';
import { deviceLabel, isIos } from './device';

it('아이폰과 PC를 구분한다', () => {
  expect(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15')).toBe('iphone');
  expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/142.0')).toBe('pc');
});

it('아이폰과 아이패드(데스크톱 표시)를 iOS로 본다', () => {
  expect(isIos('Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X)', 5)).toBe(true);
  expect(isIos('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', 5)).toBe(true);
  expect(isIos('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', 0)).toBe(false);
  expect(isIos('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/142.0', 10)).toBe(false);
});
