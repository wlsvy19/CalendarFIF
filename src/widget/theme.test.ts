import { describe, expect, it } from 'vitest';
import { PALETTES, dayBackground, mixHex } from './theme';

describe('mixHex', () => {
  it('mixes halfway', () => expect(mixHex('#000000', '#FFFFFF', 0.5)).toBe('#808080'));
  it('returns the ends for ratio 1 and 0', () => {
    expect(mixHex('#12AB34', '#FFFFFF', 1)).toBe('#12AB34');
    expect(mixHex('#12AB34', '#ffffff', 0)).toBe('#FFFFFF');
  });
});

describe('dayBackground', () => {
  it('lays the colour over the light surface at 38%', () => {
    expect(dayBackground('F12424', 'light')).toBe(mixHex('#F12424', '#FFFFFF', 0.38));
  });
  it('lays the colour over the dark surface at 45%', () => {
    expect(dayBackground('F12424', 'dark')).toBe(mixHex('#F12424', PALETTES.dark.surface, 0.45));
  });
});
