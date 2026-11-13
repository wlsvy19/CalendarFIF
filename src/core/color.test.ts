import { expect, it } from 'vitest';
import { PALETTE, isColor, normalizeColor } from './color';

it('팔레트는 DesktopCal과 같은 22색이다', () => {
  expect(PALETTE).toEqual([
    'FF9595', 'F9BC0B', 'FBF078', 'CBFB91', 'B5CEF6', 'D7B1F9', 'E6C9A8',
    '282828', 'F12424', 'FF6821', 'F5D107', '009300', '3737F4', '4A0081', '61D2BA',
    '65C444', '90949D', 'FFD9E9', 'FAE3CE', 'CDF0EB', 'D9E8FF', 'D4CDF0',
  ]);
});
it('색은 빈 값이거나 대문자 6자리다', () => {
  expect(normalizeColor('#f12424')).toBe('F12424');
  expect(normalizeColor('')).toBe('');
  expect(normalizeColor('red')).toBe('');
  expect(isColor('F12424')).toBe(true);
  expect(isColor('')).toBe(true);
  expect(isColor('f12424')).toBe(false);
});
