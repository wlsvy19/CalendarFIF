import { describe, expect, it } from 'vitest';
import { buildMonthGrid } from './dates';
import { addDays, buildPage, pageMonths, startOfWeek, stepPage, weekNumber, type Page, type PageOptions } from './layout';

const opts = (o: Partial<PageOptions> = {}): PageOptions => ({ layout: 'floating', maxRows: 5, pastWeeks: 1, weekStart: 0, firstWeek: 'jan1', ...o });
const keys = (page: Page) => page.rows.flatMap((r) => r.cells.map((c) => c.dateKey));
const ends = (page: Page) => [keys(page)[0], keys(page).at(-1)];

describe('layout', () => {
  it('날짜를 더하고 주의 시작을 찾는다', () => {
    expect([addDays('2026-12-30', 3), addDays('2026-03-01', -1)]).toEqual(['2027-01-02', '2026-02-28']);
    expect([startOfWeek('2026-11-13', 0), startOfWeek('2026-11-13', 1), startOfWeek('2026-11-08', 0)]).toEqual(['2026-11-08', '2026-11-09', '2026-11-08']);
  });
  it('전체 월은 웹앱의 달력과 같고 시작 요일을 따른다', () => {
    const sun = buildPage(opts({ layout: 'month' }), '2026-11-13');
    expect(keys(sun)).toEqual(buildMonthGrid('2026-11').map((c) => c.dateKey));
    expect([sun.title, sun.weekdays]).toEqual(['2026-11', [0, 1, 2, 3, 4, 5, 6]]);
    const mon = buildPage(opts({ layout: 'month', weekStart: 1 }), '2026-11-13');
    expect([mon.rows.length, ends(mon), mon.weekdays, mon.rows[0].cells[0].inMonth]).toEqual([6, ['2026-10-26', '2026-12-06'], [1, 2, 3, 4, 5, 6, 0], false]);
  });
  it('변동 월은 오늘이 든 주 앞에 지나간 주를 두고 정해진 줄 수만큼, 단일 행은 이번 주 또는 오늘부터 7일', () => {
    const page = buildPage(opts(), '2026-11-13');
    expect([page.rows.length, ends(page), page.rows.every((r) => r.cells.every((c) => c.inMonth))]).toEqual([5, ['2026-11-01', '2026-12-05'], true]);
    const clamped = buildPage(opts({ maxRows: 2, pastWeeks: 3 }), '2026-11-13');
    expect([clamped.rows.length, keys(clamped)[0]]).toEqual([2, '2026-11-01']);
    expect(ends(buildPage(opts({ layout: 'week' }), '2026-11-13'))).toEqual(['2026-11-08', '2026-11-14']);
    const days = buildPage(opts({ layout: 'days' }), '2026-11-13');
    expect([ends(days), days.weekdays]).toEqual([['2026-11-13', '2026-11-19'], [5, 6, 0, 1, 2, 3, 4]]);
  });
  it('주 번호: 1월 1일이 든 주, 또는 ISO 방식', () => {
    expect([weekNumber('2026-11-08', 0, 'jan1'), weekNumber('2026-12-27', 0, 'jan1'), weekNumber('2026-12-20', 0, 'jan1')]).toEqual([46, 1, 52]);
    expect([weekNumber('2026-11-08', 0, 'iso'), weekNumber('2026-12-28', 1, 'iso'), weekNumber('2027-01-04', 1, 'iso')]).toEqual([45, 53, 1]);
    expect(buildPage(opts(), '2026-11-13').rows.map((r) => r.week)).toEqual([45, 46, 47, 48, 49]);
  });
  it('한 쪽씩 넘기고, 쪽에 보이는 달을 모두 알려 준다', () => {
    expect([stepPage(opts({ layout: 'month' }), '2026-11-13', 1), stepPage(opts({ layout: 'month' }), '2026-01-31', -1), stepPage(opts(), '2026-11-13', 1)]).toEqual(['2026-12-01', '2025-12-01', '2026-12-18']);
    expect([stepPage(opts({ layout: 'week' }), '2026-11-13', -1), stepPage(opts({ layout: 'days' }), '2026-11-13', 1)]).toEqual(['2026-11-06', '2026-11-20']);
    expect(keys(buildPage(opts(), '2026-12-18'))[0]).toBe('2026-12-06'); // 이번 쪽의 끝(12-05) 바로 다음
    expect(pageMonths(buildPage(opts({ maxRows: 8, pastWeeks: 0 }), '2026-01-31'))).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(pageMonths(buildPage(opts({ layout: 'week' }), '2026-11-13'))).toEqual(['2026-11']);
  });
});
