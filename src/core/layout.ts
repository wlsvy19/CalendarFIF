import { shiftMonth, type GridCell } from './dates';

export type Layout = 'floating' | 'month' | 'week' | 'days'; // 변동 월, 전체 월, 고정 단일 행, 변동 단일 행
export type WeekRule = 'jan1' | 'iso'; // 1월 1일이 든 주, ISO 방식
export type PageOptions = { layout: Layout; maxRows: number; pastWeeks: number; weekStart: number; firstWeek: WeekRule };
export type Page = { anchor: string; title: string; weekdays: number[]; rows: { week: number; cells: GridCell[] }[] };

const DAY_MS = 86_400_000;
const pad2 = (n: number): string => String(n).padStart(2, '0');

function toDayNumber(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

function fromDayNumber(n: number): string {
  const d = new Date(n * DAY_MS);
  return `${String(d.getUTCFullYear()).padStart(4, '0')}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

const dowOf = (dateKey: string): number => new Date(toDayNumber(dateKey) * DAY_MS).getUTCDay();

export function addDays(dateKey: string, n: number): string {
  return fromDayNumber(toDayNumber(dateKey) + n);
}

export function startOfWeek(dateKey: string, weekStart: number): string {
  return addDays(dateKey, -((dowOf(dateKey) - weekStart + 7) % 7));
}

export function weekNumber(rowStart: string, weekStart: number, rule: WeekRule): number {
  // jan1: 줄의 마지막 날이 속한 해의 1월 1일이 든 주가 1주. iso: 줄의 넷째 날이 속한 해의 1월 4일이 든 주가 1주.
  const reference = addDays(rowStart, rule === 'jan1' ? 6 : 3);
  const anchorDay = rule === 'jan1' ? '01' : '04';
  const firstWeekStart = startOfWeek(`${reference.slice(0, 4)}-01-${anchorDay}`, weekStart);
  return Math.floor((toDayNumber(rowStart) - toDayNumber(firstWeekStart)) / 7) + 1;
}

function cellOf(dateKey: string, inMonth: boolean): GridCell {
  const day = dateKey.slice(8);
  return { dateKey, monthId: dateKey.slice(0, 7), day, dayOfMonth: Number(day), dow: dowOf(dateKey), inMonth };
}

export function buildPage(opts: PageOptions, anchor: string): Page {
  const { layout, maxRows, pastWeeks, weekStart, firstWeek } = opts;
  const anchorMonth = anchor.slice(0, 7);
  let start: string;
  let rowCount: number;
  switch (layout) {
    case 'month': {
      const last = addDays(`${shiftMonth(anchorMonth, 1)}-01`, -1);
      start = startOfWeek(`${anchorMonth}-01`, weekStart);
      rowCount = (toDayNumber(startOfWeek(last, weekStart)) - toDayNumber(start)) / 7 + 1;
      break;
    }
    case 'floating':
      start = addDays(startOfWeek(anchor, weekStart), -7 * Math.min(pastWeeks, maxRows - 1));
      rowCount = maxRows;
      break;
    case 'week':
      start = startOfWeek(anchor, weekStart);
      rowCount = 1;
      break;
    case 'days':
      start = anchor;
      rowCount = 1;
      break;
  }
  const rows: Page['rows'] = [];
  for (let r = 0; r < rowCount; r++) {
    const rowFirst = addDays(start, r * 7);
    const cells: GridCell[] = [];
    for (let i = 0; i < 7; i++) {
      const dateKey = addDays(rowFirst, i);
      cells.push(cellOf(dateKey, layout === 'month' ? dateKey.slice(0, 7) === anchorMonth : true));
    }
    rows.push({ week: weekNumber(startOfWeek(rowFirst, weekStart), weekStart, firstWeek), cells });
  }
  return { anchor, title: anchorMonth, weekdays: rows[0].cells.map((c) => c.dow), rows };
}

export function stepPage(opts: PageOptions, anchor: string, delta: number): string {
  switch (opts.layout) {
    case 'month':
      return `${shiftMonth(anchor.slice(0, 7), delta)}-01`;
    case 'floating':
      return addDays(anchor, opts.maxRows * 7 * delta);
    default:
      return addDays(anchor, 7 * delta);
  }
}

export function pageMonths(page: Page): string[] {
  return [...new Set(page.rows.flatMap((r) => r.cells.map((c) => c.monthId)))].sort();
}
