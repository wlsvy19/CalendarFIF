import { describe, expect, it } from 'vitest';
import { MemoryStorage } from '../sync/testing';
import { APPEARANCE_KEY, DEFAULT_APPEARANCE, WEB_APPEARANCE, loadAppearance, parseAppearance, saveAppearance } from './appearance';

describe('appearance', () => {
  it('기본값은 설계 8절의 표와 같다', () => {
    expect(DEFAULT_APPEARANCE).toEqual({
      version: 1, layout: 'floating', maxRows: 5, pastWeeks: 1, monthGap: true, weekNumbers: false, shadow: true,
      titleBar: true, holidays: true, lunar: false, bullet: 'none', cellGap: 4, lineSpacing: 1.35, doneToBottom: false,
      showDone: true, doneTone: 'none', calendarFont: { color: 'FFFFFF', size: 13 }, memoFont: { color: 'FFFFFF', size: 14 },
      calendarBg: '141820', restBg: '3A1F24', todayBorder: '6AA6FF', titleButton: 'FFFFFF', holidayInk: 'FF6B6B',
      lunarInk: '9FB3C8', transparency: 60, weekStart: 0, firstWeek: 'jan1', showRestDays: true, restDays: [0, 6],
    });
    expect(WEB_APPEARANCE).toEqual({ ...DEFAULT_APPEARANCE, layout: 'month', holidays: false, monthGap: false, shadow: false });
  });
  it('범위 밖은 범위 안으로, 목록 밖과 틀린 형식은 기본값으로, 색은 대문자 6자리로', () => {
    const a = parseAppearance({ version: 1, maxRows: 12, pastWeeks: -1, cellGap: 30, lineSpacing: 1.333, transparency: 101, weekStart: 7, layout: 'spiral', bullet: 'dot', calendarFont: { color: 'ff0000', size: 40 }, memoFont: 'big' });
    expect([a.maxRows, a.pastWeeks, a.cellGap, a.lineSpacing, a.transparency, a.weekStart, a.layout, a.bullet]).toEqual([8, 0, 12, 1.35, 100, 0, 'floating', 'dot']);
    expect([a.calendarFont, a.memoFont]).toEqual([{ color: 'FF0000', size: 20 }, { color: 'FFFFFF', size: 14 }]);
    const b = parseAppearance({ calendarBg: '', todayBorder: '#6aa6ff', holidayInk: '', lunarInk: 'xyz', restDays: [6, 0, 0, 9] });
    expect([b.calendarBg, b.todayBorder, b.holidayInk, b.lunarInk, b.restDays]).toEqual(['', '6AA6FF', 'FF6B6B', '9FB3C8', [0, 6]]);
  });
  it('깨졌거나 예전 형식의 저장 값에서도 열린다', () => {
    expect(parseAppearance('garbage')).toEqual(DEFAULT_APPEARANCE);
    expect(parseAppearance({ maxRows: 3, unknown: 1 })).toEqual({ ...DEFAULT_APPEARANCE, maxRows: 3 });
    const store = new MemoryStorage();
    store.setItem(APPEARANCE_KEY, '{not json');
    expect(loadAppearance(store)).toEqual(DEFAULT_APPEARANCE);
    saveAppearance(store, { ...DEFAULT_APPEARANCE, lunar: true });
    expect(loadAppearance(store).lunar).toBe(true);
  });
});
