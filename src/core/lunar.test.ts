import { expect, it } from 'vitest';
import { lunarDate, lunarLabel, solarOfLunar } from './lunar';

it('양력 날짜의 음력 날짜와 윤달', () => {
  expect([lunarDate('2026-11-13'), lunarDate('2025-07-25')]).toEqual([{ month: 10, day: 5, leap: false }, { month: 6, day: 1, leap: true }]);
  expect([lunarLabel('2026-11-13'), lunarLabel('2025-07-25')]).toEqual(['음 10.5', '음 윤6.1']);
});
it('그해의 음력 날짜를 양력으로 찾는다(윤달은 건너뛴다)', () => {
  expect([solarOfLunar(2026, 1, 1), solarOfLunar(2026, 4, 8), solarOfLunar(2026, 8, 15), solarOfLunar(2028, 1, 1), solarOfLunar(2025, 6, 1)])
    .toEqual(['2026-02-17', '2026-05-24', '2026-09-25', '2028-01-27', '2025-06-25']);
});
