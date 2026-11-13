import { buildPage } from '../core/layout';
import type { GridCell } from '../core/dates';
import type { DayValue } from '../core/types';
import type { Family, Size } from './sizes';
import { isColor } from '../core/color';
import { capLines, estimateWidth, fitText, memoLines, wrapText } from './text';
import { PALETTES, dayBackground, type Palette, type Theme } from './theme';

export type Draw =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; color: string; alpha?: number; radius?: number }
  | { kind: 'text'; x: number; y: number; w: number; h: number; text: string; size: number; weight: 'regular' | 'semibold' | 'bold'; color: string; alpha?: number; align: 'left' | 'center' | 'right' }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; color: string; alpha?: number; width: number };
export type Scene = { width: number; height: number; background: string; draws: Draw[] };
export type MonthData = { monthId: string; days: Record<string, DayValue> }; // days의 키는 '01'~'31'

const r2 = (n: number): number => Math.round(n * 100) / 100;
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const MONTH_OPTS = { layout: 'month', maxRows: 6, pastWeeks: 0, weekStart: 0, firstWeek: 'jan1' } as const;

type TextOpts = { size: number; weight?: 'regular' | 'semibold' | 'bold'; color: string; alpha?: number; align?: 'left' | 'center' | 'right' };

/** 글자 폭에 맞게 잘라서 text 명령을 더한다. 높이는 글자 크기의 1.25배. */
const MIN_FONT = 8;

/** 글자 폭에 맞게 잘라서 text 명령을 더한다. 글자는 8 아래로 줄이지 않는다. 아무 글자도 들어가지 않으면 더하지 않고 null을 돌려준다. */
function pushText(draws: Draw[], x: number, y: number, w: number, h: number, text: string, o: TextOpts): Extract<Draw, { kind: 'text' }> | null {
  const size = Math.max(MIN_FONT, o.size);
  const fitted = fitText(text, size, w);
  if (fitted === '') return null;
  const cmd: Extract<Draw, { kind: 'text' }> = {
    kind: 'text', x: r2(x), y: r2(y), w: r2(w), h: r2(h), text: fitted, size: r2(size),
    weight: o.weight ?? 'regular', color: o.color, ...(o.alpha === undefined ? {} : { alpha: o.alpha }), align: o.align ?? 'left',
  };
  draws.push(cmd);
  return cmd;
}

/** 메모 한 줄. 완료 줄은 흐리게 하고 글자 가운데를 지나는 줄을 긋는다. 글자가 안 그려지면 줄도 긋지 않는다. */
function pushMemoLine(draws: Draw[], x: number, y: number, w: number, h: number, line: { text: string; done: boolean }, size: number, color: string, strokeWidth: number): void {
  const cmd = pushText(draws, x, y, w, h, line.text, { size, color, ...(line.done ? { alpha: 0.55 } : {}) });
  if (!cmd || !line.done) return;
  const mid = r2(y + h / 2);
  const len = Math.min(estimateWidth(cmd.text, cmd.size), w);
  draws.push({ kind: 'line', x1: r2(x), y1: mid, x2: r2(x + len), y2: mid, color, alpha: 0.55, width: r2(strokeWidth) });
}

const validColor = (day: DayValue | undefined): string => (day && day.color !== '' && isColor(day.color) ? day.color : '');

function pushRect(draws: Draw[], x: number, y: number, w: number, h: number, color: string, extra: { alpha?: number; radius?: number } = {}): void {
  draws.push({ kind: 'rect', x: r2(x), y: r2(y), w: r2(w), h: r2(h), color, ...extra });
}

const monthTitle = (monthId: string): string => `${monthId.slice(0, 4)}년 ${Number(monthId.slice(5, 7))}월`;
const weekdayOfKey = (key: string): number => new Date(Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8, 10))).getUTCDay();

type Ctx = { draws: Draw[]; p: Palette; theme: Theme; s: number };

const dowColor = (p: Palette, dow: number): string => (dow === 0 ? p.sun : dow === 6 ? p.sat : p.ink);

function drawHeader(c: Ctx, width: number, title: string, offline: boolean): void {
  const { draws, p, s } = c;
  const pad = 12 * s;
  const inner = width - 2 * pad;
  pushText(draws, pad, pad, inner * 0.62, 22 * s, title, { size: 17 * s, weight: 'bold', color: p.ink });
  if (offline) pushText(draws, pad + inner * 0.62, pad + 4 * s, inner * 0.38, 15 * s, '오프라인', { size: 11 * s, color: p.muted, align: 'right' });
}

function drawWeekdays(c: Ctx, gridX: number, cellW: number, gap: number, y: number): void {
  for (let i = 0; i < 7; i++) {
    pushText(c.draws, gridX + i * (cellW + gap), y, cellW, 14 * c.s, WEEKDAYS[i], { size: 11 * c.s, weight: 'semibold', color: i === 0 ? c.p.sun : i === 6 ? c.p.sat : c.p.muted, align: 'center' });
  }
}

function drawCell(c: Ctx, cell: GridCell, x: number, y: number, w: number, h: number, day: DayValue | undefined, today: string, maxLines: number): void {
  const { draws, p, theme, s } = c;
  const color = validColor(day);
  const hasColor = color !== '';
  pushRect(draws, x, y, w, h, hasColor ? dayBackground(color, theme) : p.surface);

  const pad = 3 * s;
  const innerW = w - 2 * pad;
  const numSize = 11 * s;
  const numberColor = hasColor ? p.ink : dowColor(p, cell.dow);
  const dimmed = cell.inMonth ? {} : { alpha: 0.4 };
  const num = String(cell.dayOfMonth);

  if (cell.dateKey === today) {
    const pillW = Math.min(estimateWidth(num, numSize) + 8 * s, w - 2 * s);
    pushRect(draws, x + 2 * s, y + 1 * s, pillW, 15 * s, p.accent, { radius: 7.5 * s });
    pushText(draws, x + 2 * s, y + 1 * s + 1.1 * s, pillW, 13.5 * s, num, { size: numSize, weight: 'semibold', color: p.onAccent, align: 'center' });
  } else {
    pushText(draws, x + pad, y + pad, innerW, 13.5 * s, num, { size: numSize, weight: 'semibold', color: numberColor, ...dimmed });
  }

  if (!cell.inMonth || !day) return;
  const lineH = 11.5 * s;
  const size = 9 * s;
  const capacity = Math.min(maxLines, Math.floor((h - 16 * s) / lineH));
  const { shown, more } = capLines(memoLines(day.text), capacity);
  let ly = y + 16 * s;
  for (const line of shown) {
    pushMemoLine(draws, x + pad, ly, innerW, lineH, line, size, p.ink, 0.75 * s);
    ly += lineH;
  }
  if (more > 0) pushText(draws, x + pad, ly, innerW, lineH, `+${more}`, { size, color: p.muted });
}

/** 큰 위젯(달 전체)과 중간 위젯(오늘이 든 한 주)이 같이 쓰는 그리기. */
function buildGrid(input: Parameters<typeof buildScene>[0], p: Palette): Scene {
  const { family, theme, size, today, month, offline } = input;
  const s = size.width / 364;
  const c: Ctx = { draws: [], p, theme, s };
  const pad = 12 * s;
  const gap = 1 * s;
  const gridX = pad;
  const gridW = size.width - 2 * pad;
  const cellW = (gridW - 6 * gap) / 7;
  const gridTop = pad + 26 * s + 16 * s;
  const gridH = size.height - pad - gridTop;

  drawHeader(c, size.width, monthTitle(month.monthId), offline);
  drawWeekdays(c, gridX, cellW, gap, pad + 26 * s);

  const rows = family === 'medium'
    ? buildPage({ ...MONTH_OPTS, layout: 'week' }, today).rows
    : buildPage(MONTH_OPTS, `${month.monthId}-01`).rows;
  const cellH = (gridH - (rows.length - 1) * gap) / rows.length;
  const maxLines = family === 'medium' ? 6 : Infinity;

  pushRect(c.draws, gridX, gridTop, gridW, gridH, p.hairline);
  rows.forEach((row, r) => {
    row.cells.forEach((cell, i) => {
      const inMonth = cell.monthId === month.monthId;
      const day = inMonth ? month.days[cell.day] : undefined;
      drawCell(c, { ...cell, inMonth }, gridX + i * (cellW + gap), gridTop + r * (cellH + gap), cellW, cellH, day, today, maxLines);
    });
  });
  return { width: size.width, height: size.height, background: p.surface, draws: c.draws };
}

function buildSmall(input: Parameters<typeof buildScene>[0], p: Palette): Scene {
  const { size, today, month, offline } = input;
  const s = size.width / 170;
  const draws: Draw[] = [];
  const dow = weekdayOfKey(today);
  const day = month.days[today.slice(8, 10)];
  const pad = 12 * s;

  const barColor = validColor(day);
  if (barColor !== '') pushRect(draws, 0, 0, 4 * s, size.height, `#${barColor}`);
  pushText(draws, pad, pad, 46 * s, 41 * s, String(Number(today.slice(8, 10))), { size: 34 * s, weight: 'bold', color: dowColor(p, dow) });
  const labelX = pad + 48 * s;
  const labelW = size.width - labelX - pad;
  pushText(draws, labelX, pad + 4 * s, labelW, 15 * s, `${Number(today.slice(5, 7))}월`, { size: 12 * s, color: p.muted });
  pushText(draws, labelX, pad + 19 * s, labelW, 15 * s, `${WEEKDAYS[dow]}요일`, { size: 12 * s, weight: 'semibold', color: p.muted });

  const lineH = 14.5 * s;
  const lines = day ? memoLines(day.text) : [];
  if (lines.length === 0) {
    pushText(draws, pad, 62 * s, size.width - 2 * pad, lineH, '메모 없음', { size: 11 * s, color: p.muted });
  } else {
    const { shown, more } = capLines(lines, 6);
    let y = 62 * s;
    for (const line of shown) {
      pushMemoLine(draws, pad, y, size.width - 2 * pad, lineH, line, 11 * s, p.ink, 0.75 * s);
      y += lineH;
    }
    if (more > 0) pushText(draws, pad, y, size.width - 2 * pad, lineH, `+${more}`, { size: 11 * s, color: p.muted });
  }
  if (offline) pushText(draws, pad, size.height - 21 * s, size.width - 2 * pad, 12 * s, '오프라인', { size: 10 * s, color: p.muted, align: 'right' });
  return { width: size.width, height: size.height, background: p.surface, draws };
}

export function buildScene(input: {
  family: Family;
  theme: Theme;
  size: Size;
  today: string; // 'YYYY-MM-DD'
  month: MonthData; // 오늘이 속한 달
  offline: boolean; // 보관해 둔 자료를 그리는 중인가
}): Scene {
  const p = PALETTES[input.theme];
  return input.family === 'small' ? buildSmall(input, p) : buildGrid(input, p);
}

/** 로그인 안내나 오류처럼 글만 보여 주는 화면. */
export function messageScene(input: { theme: Theme; size: Size; title: string; lines: string[] }): Scene {
  const p = PALETTES[input.theme];
  const { size } = input;
  const draws: Draw[] = [];
  const pad = 14;
  const w = size.width - 2 * pad;
  pushText(draws, pad, pad, w, 19, input.title, { size: 15, weight: 'bold', color: p.ink });
  const wrapped = input.lines.flatMap((line) => wrapText(line, 12, w));
  wrapped.forEach((line, i) => {
    const y = pad + 25 + i * 17;
    if (y + 15 <= size.height - pad) pushText(draws, pad, y, w, 15, line, { size: 12, color: p.muted });
  });
  return { width: size.width, height: size.height, background: p.surface, draws };
}
