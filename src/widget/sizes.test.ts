import { describe, expect, it } from 'vitest';
import { widgetSize } from './sizes';

describe('widgetSize', () => {
  it('uses the table', () => {
    expect(widgetSize({ width: 430, height: 932 }, 'small')).toEqual({ width: 170, height: 170 });
    expect(widgetSize({ width: 393, height: 852 }, 'medium')).toEqual({ width: 338, height: 158 });
    expect(widgetSize({ width: 375, height: 667 }, 'large')).toEqual({ width: 321, height: 324 });
  });
  it('falls back to ratios for an unknown screen', () => {
    expect(widgetSize({ width: 402, height: 874 }, 'large')).toEqual({ width: 344, height: 361 });
    expect(widgetSize({ width: 402, height: 874 }, 'medium')).toEqual({ width: 344, height: 161 });
    expect(widgetSize({ width: 402, height: 874 }, 'small')).toEqual({ width: 161, height: 161 });
  });
  it('accepts landscape input', () => {
    expect(widgetSize({ width: 852, height: 393 }, 'large')).toEqual({ width: 338, height: 354 });
  });
});
