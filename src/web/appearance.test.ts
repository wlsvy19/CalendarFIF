import { describe, expect, it } from 'vitest';
import { MemoryStorage } from '../sync/testing';
import { APPEARANCE_KEY, appearanceVars, DEFAULT_APPEARANCE, WEB_APPEARANCE, loadAppearance, parseAppearance, saveAppearance } from './appearance';

describe('appearance', () => {
  it('기본값은 설계 8절의 표와 같다', () => {
    expect(DEFAULT_APPEARANCE).toEqual({
      version: 1, layout: 'floating', maxRows: 5, pastWeeks: 1, monthGap: true, weekNumbers: false, shadow: true,
      titleBar: true, holidays: true, lunar: false, solarTerms: true, bullet: 'dot', bulletPicked: false, cellGap: 4, lineSpacing: 1.35, doneToBottom: false,
      showDone: true, doneTone: 'none', calendarFont: { color: 'FFFFFF', size: 13 }, memoFont: { color: 'FFFFFF', size: 14 },
      calendarBg: '141820', restBg: '3A1F24', todayBorder: '6AA6FF', titleButton: 'FFFFFF', holidayInk: 'FF6B6B',
      lunarInk: '9FB3C8', termInk: '5FD37A', transparency: 60, weekStart: 0, firstWeek: 'jan1', showRestDays: true, restDays: [0, 6],
      showAlarmTime: true, alarmTone: 'chime',
    });
    expect(WEB_APPEARANCE).toEqual({ ...DEFAULT_APPEARANCE, layout: 'month', holidays: true, lunar: true, monthGap: false, shadow: false });
  });
  it('PC 앱도 줄 머리의 기본은 점이다. 고른 적이 없는 옛 설정은 점이 되고, 고른 것은 그대로다', () => {
    expect(parseAppearance({ ...DEFAULT_APPEARANCE, bullet: 'none', bulletPicked: undefined })).toMatchObject({ bullet: 'dot', bulletPicked: false });
    expect(parseAppearance({ bullet: 'none', bulletPicked: true })).toMatchObject({ bullet: 'none', bulletPicked: true });
  });
  it('범위 밖은 범위 안으로, 목록 밖과 틀린 형식은 기본값으로, 색은 대문자 6자리로', () => {
    const a = parseAppearance({ version: 1, maxRows: 12, pastWeeks: -1, cellGap: 30, lineSpacing: 1.333, transparency: 101, weekStart: 7, layout: 'spiral', bullet: 'dot', calendarFont: { color: 'ff0000', size: 40 }, memoFont: 'big' });
    expect([a.maxRows, a.pastWeeks, a.cellGap, a.lineSpacing, a.transparency, a.weekStart, a.layout, a.bullet]).toEqual([8, 0, 12, 1.35, 100, 0, 'floating', 'dot']);
    expect([a.calendarFont, a.memoFont]).toEqual([{ color: 'FF0000', size: 20 }, { color: 'FFFFFF', size: 14 }]);
    const b = parseAppearance({ calendarBg: '', todayBorder: '#6aa6ff', holidayInk: '', lunarInk: 'xyz', termInk: '', restDays: [6, 0, 0, 9] });
    expect([b.calendarBg, b.todayBorder, b.holidayInk, b.lunarInk, b.termInk, b.restDays]).toEqual(['', '6AA6FF', 'FF6B6B', '9FB3C8', '5FD37A', [0, 6]]);
    expect(parseAppearance({ termInk: '#00c853' }).termInk).toBe('00C853');
  });
  it('깨졌거나 예전 형식의 저장 값에서도 열린다', () => {
    expect(parseAppearance('garbage')).toEqual(DEFAULT_APPEARANCE);
    expect(parseAppearance({ maxRows: 3, unknown: 1 })).toEqual({ ...DEFAULT_APPEARANCE, maxRows: 3 });
    const store = new MemoryStorage();
    store.setItem(APPEARANCE_KEY, '{not json');
    expect(loadAppearance(store)).toEqual(DEFAULT_APPEARANCE);
    saveAppearance(store, { ...DEFAULT_APPEARANCE, lunar: true, solarTerms: false });
    expect([loadAppearance(store).lunar, loadAppearance(store).solarTerms]).toEqual([true, false]);
  });
});
it('설정을 CSS 변수로 바꾼다', () => {
  expect(appearanceVars(DEFAULT_APPEARANCE)).toEqual({
    '--desk-cal-ink': '#FFFFFF', '--desk-cal-size': '13px', '--desk-memo-ink': '#FFFFFF', '--desk-memo-size': '14px',
    '--desk-line': '1.35', '--desk-gap': '4px', '--desk-cell-bg': 'rgba(20, 24, 32, 0.4)', '--desk-rest-bg': 'rgba(58, 31, 36, 0.4)',
    '--desk-today': '#6AA6FF', '--desk-btn': '#FFFFFF', '--desk-holiday-ink': '#FF6B6B', '--desk-lunar-ink': '#9FB3C8', '--desk-term-ink': '#5FD37A', '--desk-day-pct': '50%',
  });
  const v = appearanceVars({ ...DEFAULT_APPEARANCE, transparency: 30, calendarBg: '', todayBorder: '' });
  expect([v['--desk-cell-bg'], v['--desk-rest-bg'], v['--desk-today'], v['--desk-day-pct']]).toEqual(['transparent', 'rgba(58, 31, 36, 0.7)', 'transparent', '70%']);
});
it('알림 시각 표시와 알림 소리: 기본값과 틀린 값의 되돌림', () => {
  expect([DEFAULT_APPEARANCE.showAlarmTime, DEFAULT_APPEARANCE.alarmTone]).toEqual([true, 'chime']);
  expect(parseAppearance({ showAlarmTime: false, alarmTone: 'bell' })).toMatchObject({ showAlarmTime: false, alarmTone: 'bell' });
  expect(parseAppearance({ showAlarmTime: 'x', alarmTone: 'horn' })).toMatchObject({ showAlarmTime: true, alarmTone: 'chime' });
});
