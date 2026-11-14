import { describe, expect, it } from 'vitest';
import { DEFAULT_APPEARANCE, WEB_APPEARANCE } from './appearance';
import { ACCENTS, applyPrefs, DEFAULT_PREFS, loadPrefs, MEMO_METRICS, parsePrefs, PREFS_KEY, prefsAppearance, savePrefs, type Prefs } from './prefs';

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k), data };
}

describe('웹앱 설정(기기마다 따로 저장한다)', () => {
  it('기본값: 자동 밝기, 파랑, 음력과 공휴일을 보이고 일요일에 시작한다', () => {
    expect(DEFAULT_PREFS).toEqual({
      version: 1, theme: 'auto', accent: 'blue', lunar: true, holidays: true, weekNumbers: false, weekStart: 0,
      memoSize: 'medium', showDone: true, doneToBottom: false, bullet: 'none',
    });
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(parsePrefs('글')).toEqual(DEFAULT_PREFS);
  });

  it('읽을 때 값마다 따로 확인하고, 틀린 값은 기본값으로 둔다', () => {
    const good: Prefs = { version: 1, theme: 'dark', accent: 'gold', lunar: false, holidays: false, weekNumbers: true, weekStart: 1, memoSize: 'large', showDone: false, doneToBottom: true, bullet: 'dot' };
    expect(parsePrefs(good)).toEqual(good);
    expect(parsePrefs({ theme: 'neon', accent: 'red', lunar: 'yes', weekStart: 7, memoSize: 12, bullet: null, weekNumbers: true })).toEqual({ ...DEFAULT_PREFS, weekNumbers: true });
    expect(parsePrefs({ ...good, weekStart: 6, extra: 1 })).toEqual({ ...good, weekStart: 6 });
  });

  it('저장하고 다시 읽는다. 깨진 글은 기본값이다', () => {
    const store = memory();
    expect(loadPrefs(store)).toEqual(DEFAULT_PREFS);
    const next: Prefs = { ...DEFAULT_PREFS, theme: 'light', accent: 'sky', weekStart: 1 };
    savePrefs(store, next);
    expect(JSON.parse(store.data.get(PREFS_KEY)!)).toEqual(next);
    expect(loadPrefs(store)).toEqual(next);
    expect(loadPrefs(memory({ [PREFS_KEY]: '{깨짐' }))).toEqual(DEFAULT_PREFS);
  });

  it('달력에 넘길 설정으로 바꾼다: 웹의 기본 배치에 고른 값만 얹는다', () => {
    expect(prefsAppearance(DEFAULT_PREFS)).toEqual(WEB_APPEARANCE);
    const a = prefsAppearance({ ...DEFAULT_PREFS, lunar: false, holidays: false, weekNumbers: true, weekStart: 1, showDone: false, doneToBottom: true, bullet: 'number' });
    expect(a).toEqual({ ...WEB_APPEARANCE, lunar: false, holidays: false, weekNumbers: true, weekStart: 1, showDone: false, doneToBottom: true, bullet: 'number' });
    expect(a.layout).toBe('month');
    expect(DEFAULT_APPEARANCE.layout).toBe('floating'); // PC 앱의 기본값과는 다르다
  });

  it('밝기와 색상을 문서에 건다: 자동이면 data-theme을 지우고, 색상은 밝은 화면용과 어두운 화면용 변수 둘을 준다', () => {
    const el = document.createElement('html');
    applyPrefs(el, { ...DEFAULT_PREFS, theme: 'dark', accent: 'pink' });
    expect([el.dataset.theme, el.style.getPropertyValue('--accent-light'), el.style.getPropertyValue('--accent-dark')]).toEqual(['dark', ACCENTS.pink.light, ACCENTS.pink.dark]);
    applyPrefs(el, { ...DEFAULT_PREFS, theme: 'light' });
    expect([el.dataset.theme, el.style.getPropertyValue('--accent-light')]).toEqual(['light', ACCENTS.blue.light]);
    applyPrefs(el, DEFAULT_PREFS);
    expect(el.hasAttribute('data-theme')).toBe(false);
  });

  it('색상 여덟 가지는 밝은 바탕과 어두운 바탕에서 글자로 읽힌다(명암비 4.5 이상)', () => {
    const channel = (v: number): number => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    const luminance = (hex: string): number => {
      const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16) / 255));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrast = (a: string, b: string): number => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    expect(Object.keys(ACCENTS)).toEqual(['blue', 'pink', 'gold', 'purple', 'green', 'orange', 'yellow', 'sky']);
    for (const [name, { light, dark }] of Object.entries(ACCENTS)) {
      // 밝은 화면: 흰 바탕(#FFFFFF)의 글자이자 흰 글자의 바탕. 어두운 화면: 시트 바탕(#161B22)의 글자이자 어두운 글자(#0D1116)의 바탕.
      expect(contrast(light, '#FFFFFF'), `${name} light`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(dark, '#161B22'), `${name} dark`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(dark, '#0D1116'), `${name} dark chip`).toBeGreaterThanOrEqual(4.5);
    }
    expect(ACCENTS.blue).toEqual({ light: '#2550D0', dark: '#8DAEFF', label: '파랑' }); // styles.css의 기본 --accent와 같다
  });

  it('메모 글자 크기는 좁은 화면과 넓은 화면의 글자 크기와 줄 높이를 정한다(보통은 지금까지의 값)', () => {
    expect(MEMO_METRICS.medium).toEqual({ narrow: { size: 10, line: 13 }, wide: { size: 13, line: 17 } });
    for (const m of Object.values(MEMO_METRICS)) for (const { size, line } of [m.narrow, m.wide]) expect(line).toBeGreaterThan(size);
    expect(MEMO_METRICS.small.narrow.size).toBeLessThan(MEMO_METRICS.medium.narrow.size);
    expect(MEMO_METRICS.large.narrow.size).toBeGreaterThan(MEMO_METRICS.medium.narrow.size);
  });
});
