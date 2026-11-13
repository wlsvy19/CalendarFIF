import { describe, expect, it } from 'vitest';
import { bgrToRgb, convertRows, decodeContent, parseItemKey } from './convert';

describe('DesktopCal 변환', () => {
  it('키에서 날짜를 읽는다', () => {
    expect(parseItemKey('dkcal_mdays_20261113')).toBe('2026-11-13');
    expect(parseItemKey('dkcal_mdays_20260230')).toBeNull();
    expect(parseItemKey('something_else')).toBeNull();
  });
  it.each([
    ['', ''], ['ff', 'FF0000'], ['0000FF', 'FF0000'], ['2424F1', 'F12424'], ['2424f1', 'F12424'],
    ['2aa5', 'A52A00'], ['009300', '009300'], ['78F0FB', 'FBF078'], ['81004A', '4A0081'], ['9595FF', 'FF9595'],
  ])('색 %s → %s', (stored, rgb) => {
    expect(bgrToRgb(stored)).toBe(rgb);
  });
  it('색이 아닌 값은 null이다', () => {
    expect(bgrToRgb('zz')).toBeNull();
    expect(bgrToRgb('1234567')).toBeNull();
  });
  it('본문은 세 가지 표기만 되돌린다', () => {
    expect(decodeContent('a\r\nb &lt;- c &gt; d &quot;e&quot; &amp;')).toEqual({ text: 'a\nb <- c > d "e" &amp;', fontTags: 0 });
    expect(decodeContent('[+]done  \r\n')).toEqual({ text: '[+]done', fontTags: 0 });
    expect(decodeContent('<font color=#ff0000>x</font>\r\ny')).toEqual({ text: 'x\ny', fontTags: 1 });
  });
  it('행을 날짜별 값으로 바꾸고 건너뛴 것을 센다', () => {
    const { days, stats } = convertRows([
      { key: 'dkcal_mdays_20261113', content: 'a', bgcolor: '2424F1', stime: 100 },
      { key: 'dkcal_mdays_20261114', content: '', bgcolor: '', stime: 5 },
      { key: 'dkcal_mdays_20270102', content: null, bgcolor: 'ff', stime: null },
      { key: 'bad', content: 'x', bgcolor: '', stime: 1 },
      { key: 'dkcal_mdays_20261115', content: 'x', bgcolor: 'zz', stime: 7 },
    ]);
    expect([...days.keys()]).toEqual(['2026-11-13', '2027-01-02', '2026-11-15']);
    expect(days.get('2026-11-13')).toEqual({ dateKey: '2026-11-13', value: { text: 'a', color: 'F12424' }, editedAt: 100000 });
    expect(days.get('2027-01-02')).toEqual({ dateKey: '2027-01-02', value: { text: '', color: 'FF0000' }, editedAt: 0 });
    expect(days.get('2026-11-15')!.value).toEqual({ text: 'x', color: '' });
    expect(stats).toMatchObject({ rows: 5, converted: 3, skippedEmpty: 1, skippedBadKey: 1, badColors: 1, fontTags: 0 });
    expect(stats.colors).toEqual([
      { stored: '2424F1', rgb: 'F12424', count: 1 },
      { stored: 'ff', rgb: 'FF0000', count: 1 },
    ]);
  });
});
