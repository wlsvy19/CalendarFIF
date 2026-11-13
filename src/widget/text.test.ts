import { describe, expect, it } from 'vitest';
import { capLines, estimateWidth, fitText, memoLines } from './text';

describe('estimateWidth', () => {
  it('is 0 for an empty string', () => expect(estimateWidth('', 10)).toBe(0));
  it('counts Hangul as full width and Latin as 0.6', () => {
    expect(estimateWidth('가나', 10)).toBe(20);
    expect(estimateWidth('ab', 10)).toBeCloseTo(12);
    expect(estimateWidth('회의a', 10)).toBeCloseTo(26);
  });
  it('counts CJK and full-width forms as full width', () => {
    expect(estimateWidth('日本', 10)).toBe(20);
    expect(estimateWidth('Ａ', 10)).toBe(10);
  });
});

describe('fitText', () => {
  it('returns an empty string for an empty string', () => expect(fitText('', 10, 50)).toBe(''));
  it('keeps text that fits', () => expect(fitText('회의', 10, 20)).toBe('회의'));
  it('cuts exactly at the limit', () => {
    expect(fitText('가나다라', 10, 30)).toBe('가나다');
    expect(fitText('가나다라', 10, 29.9)).toBe('가나');
  });
  it('cuts mixed text', () => expect(fitText('회의 meeting', 10, 40)).toBe('회의 me'));
  it('returns nothing when not even one character fits', () => expect(fitText('가', 10, 5)).toBe(''));
});

describe('memoLines', () => {
  it('is empty for an empty memo', () => expect(memoLines('')).toEqual([]));
  it('drops blank lines and strips the done mark', () => {
    expect(memoLines('회의\n\n[+]장보기\n  \nlunch')).toEqual([
      { text: '회의', done: false },
      { text: '장보기', done: true },
      { text: 'lunch', done: false },
    ]);
  });
});

describe('capLines', () => {
  it('replaces the overflow with a count', () => expect(capLines(['a', 'b', 'c', 'd'], 3)).toEqual({ shown: ['a', 'b'], more: 2 }));
  it('keeps lines that fit', () => expect(capLines(['a', 'b'], 3)).toEqual({ shown: ['a', 'b'], more: 0 }));
  it('keeps exactly max lines', () => expect(capLines(['a', 'b', 'c'], 3)).toEqual({ shown: ['a', 'b', 'c'], more: 0 }));
  it('shows nothing for max <= 0', () => expect(capLines(['a', 'b'], 0)).toEqual({ shown: [], more: 2 }));
});
