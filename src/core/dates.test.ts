import { describe, expect, it } from 'vitest';
import { buildMonthGrid, dateKeyOf, monthIdOf, shiftMonth, splitDateKey, todayKey } from './dates';

describe('dates', () => {
  it('달과 날짜 키를 만든다', () => {
    expect(monthIdOf(2026, 10)).toBe('2026-11');
    expect(dateKeyOf('2026-11', '13')).toBe('2026-11-13');
    expect(todayKey(new Date(2026, 10, 13, 23, 59))).toBe('2026-11-13');
  });
  it('실제로 있는 날짜만 받아들인다', () => {
    expect(splitDateKey('2026-11-13')).toEqual({ monthId: '2026-11', day: '13' });
    expect(splitDateKey('2028-02-29')).toEqual({ monthId: '2028-02', day: '29' });
    for (const bad of ['2026-02-30', '2026-13-01', '2026-1-5', '2026-11-13x', 'abc', '']) {
      expect(splitDateKey(bad)).toBeNull();
    }
  });
  it('해를 넘겨 달을 옮긴다', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
  });
  it('일요일부터 시작하는 주 단위 칸을 만든다', () => {
    const nov = buildMonthGrid('2026-11');
    expect(nov).toHaveLength(35);
    expect(nov[0]).toMatchObject({ dateKey: '2026-11-01', day: '01', dayOfMonth: 1, dow: 0, inMonth: true });
    expect(nov[34]).toMatchObject({ dateKey: '2026-12-05', monthId: '2026-12', dow: 6, inMonth: false });
    expect(buildMonthGrid('2026-08')).toHaveLength(42);
    expect(buildMonthGrid('2026-08')[0]).toMatchObject({ dateKey: '2026-07-26', inMonth: false });
    expect(buildMonthGrid('2026-02')).toHaveLength(28);
  });
});
