import { isColor } from '../core/color';
import { holidayLabel } from '../core/holidays';
import { buildPage } from '../core/layout';
import { lunarLabel, lunarShort } from '../core/lunar';
import { seasonNames } from '../core/solarTerms';
import type { GridCell } from '../core/dates';
import type { DayValue } from '../core/types';
import { dayOfCell, type MonthData } from './scene';
import type { Family, Size } from './sizes';
import { ALARM_MARK, COUNTDOWN_MARK } from './eventLines';
import { fitRows } from '../core/memoRows';
import { fitText, memoLines, wrapText } from './text';
import { PALETTES, dayBackground, type Palette } from './theme';

export type Dyn = { light: string; dark: string }; // 밝은 화면과 어두운 화면의 색 ('#RRGGBB')
export type Pad = [top: number, leading: number, bottom: number, trailing: number];
export type TextNode = { kind: 'text'; text: string; size: number; weight: 'regular' | 'medium' | 'semibold' | 'bold'; color: Dyn; opacity?: number; lines: number; minScale?: number }; // lines: 줄 수 제한(0은 제한 없음)
export type SpacerNode = { kind: 'spacer'; length: number | null }; // null은 남는 곳을 채운다
export type StackNode = { kind: 'stack'; dir: 'h' | 'v'; children: Node[]; spacing?: number; padding?: Pad; background?: Dyn; radius?: number; align?: 'top' | 'center' | 'bottom'; size?: [width: number, height: number] }; // size: 고정 크기
/**
 * 작은 그림(알림의 종, 카운트다운의 모래시계). 웹앱의 칸이 줄 앞에 붙이는 것과 같은 모양이다: 선으로 그린 종, 글자와 같은 색.
 * Scriptable에서는 SF Symbols의 그림을 쓴다(symbol). 그림을 쓸 수 없으면 fallback(그림 글자)을 글자로 놓는다.
 */
export type IconNode = { kind: 'icon'; symbol: 'bell' | 'hourglass'; size: number; color: Dyn; opacity?: number; fallback: string };
export type Node = TextNode | SpacerNode | StackNode | IconNode;
/** 위젯 하나. ListWidget 자신이 세로로 쌓는 상자다. */
export type Tree = { background: Dyn; padding: Pad; spacing: number; children: Node[] };

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const MONTH_OPTS = { layout: 'month', maxRows: 6, pastWeeks: 0, weekStart: 0, firstWeek: 'jan1' } as const;

type Colors = { surface: Dyn; ink: Dyn; muted: Dyn; hairline: Dyn; accent: Dyn; onAccent: Dyn; sun: Dyn; sat: Dyn; term: Dyn };
const pair = (key: keyof Palette): Dyn => ({ light: PALETTES.light[key], dark: PALETTES.dark[key] });
const C: Colors = {
  surface: pair('surface'), ink: pair('ink'), muted: pair('muted'), hairline: pair('hairline'),
  accent: pair('accent'), onAccent: pair('onAccent'), sun: pair('sun'), sat: pair('sat'), term: pair('term'),
};

const dowColor = (dow: number): Dyn => (dow === 0 ? C.sun : dow === 6 ? C.sat : C.ink);
const validColor = (day: DayValue | undefined): string => (day && day.color !== '' && isColor(day.color) ? day.color : '');
const dayPair = (color: string): Dyn => ({ light: dayBackground(color, 'light'), dark: dayBackground(color, 'dark') });

/** 완료 줄 앞에 붙이는 표시. 결합 글자(취소선)는 한글 위에서 깨질 수 있어 쓰지 않는다. */
const DONE_MARK = '\u2713 ';

/** 오늘 표시의 높이와 두 자리 날의 폭(pt). 11pt 굵은 숫자 두 개가 14pt쯤이다. */
const TODAY_MARK_H = 15;
const TODAY_MARK_W2 = 19;
/** 날짜 숫자의 글자 크기(pt). */
const DAY_NUMBER_SIZE = 11;
/**
 * 기본 글꼴 숫자의 폭 어림(글자 크기에 대한 비율). 숫자마다 폭이 다르다(1이 좁다). 오늘 표시 안에서 숫자를 가운데에 놓을 때 쓴다.
 * 정확하지 않아도 된다: 조금 모자라면 iOS가 글자를 그만큼 줄이고(minScale), 남으면 그만큼 한쪽으로 치우칠 뿐이다.
 */
const DIGIT_EM: Record<string, number> = { '1': 0.48, '7': 0.58 };
const DIGIT_EM_OTHER = 0.63;
export const digitsWidth = (digits: string, size: number): number => [...digits].reduce((w, d) => w + (DIGIT_EM[d] ?? DIGIT_EM_OTHER) * size, 0);

const flex = (): SpacerNode => ({ kind: 'spacer', length: null });
const fixed = (length: number): SpacerNode => ({ kind: 'spacer', length });
const text = (t: string, size: number, weight: TextNode['weight'], color: Dyn, lines: number, extra: Partial<TextNode> = {}): TextNode =>
  ({ kind: 'text', text: t, size, weight, color, lines, ...extra });
/** 글자를 앞쪽 가장자리로 미는 가로 상자. */
const leading = (node: Node): StackNode => ({ kind: 'stack', dir: 'h', children: [node, flex()] });

/** 그림과 글 사이의 틈(pt). */
const ICON_GAP = 2;
/** 접은 메모 한 줄: 행들(rows)과, 알림·카운트다운이면 앞에 놓을 그림. */
type Wrapped = { symbol: IconNode['symbol'] | null; done: boolean; rows: string[]; room: number | null };
/**
 * 메모 한 줄을 폭에 맞춰 여러 행으로 접는다(2026-11-20 사용자: "글이길면 … 안보여 자동으로 줄바꿈되서 최대한 보이게 해줘".
 * 웹앱의 칸도 접는다). 알림과 카운트다운의 줄(eventLines.ts가 그림 글자를 앞에 붙여 둔다)은 그 그림 글자를 떼고 그림 자리만큼 좁다.
 * width: 줄이 쓸 수 있는 폭(없으면 접지 않는다).
 */
function wrapLine(line: { text: string; done: boolean }, size: number, width: number | null): Wrapped {
  const symbol: IconNode['symbol'] | null = line.text.startsWith(`${ALARM_MARK} `) ? 'bell' : line.text.startsWith(`${COUNTDOWN_MARK} `) ? 'hourglass' : null;
  const mark = symbol === 'bell' ? ALARM_MARK : COUNTDOWN_MARK;
  const body = (line.done ? DONE_MARK : '') + (symbol ? line.text.slice(mark.length + 1) : line.text);
  const room = width === null ? null : symbol ? width - size - ICON_GAP : width;
  const rows = room === null ? [body] : wrapText(body, size, room);
  return { symbol, done: line.done, rows: rows.length > 0 ? rows : [body], room };
}

/**
 * 접은 줄의 앞 count행. 줄이 다 보이지 않으면 마지막 행 끝에 "…"를 붙인다(웹앱의 칸과 같다).
 * 알림과 카운트다운은 첫 행 앞에 웹앱과 같은 그림을 놓고 이어지는 행은 그림 자리만큼 들인다
 * (2026-11-18 사용자: 위젯의 종이 달력의 종과 달랐다. "캘린더에서 보이는거와 위젯에서 보이는거가 같아야").
 */
function memoRows(w: Wrapped, count: number, size: number, extra: Partial<TextNode> = {}): Node[] {
  // 끝낸 줄은 0.55, 다른 달의 칸(extra.opacity 0.4)이면 거기에 곱한다.
  const fade = Math.round((extra.opacity ?? 1) * (w.done ? 0.55 : 1) * 100) / 100;
  const dim = fade < 1 ? { opacity: fade } : {};
  const shown = w.rows.slice(0, count);
  if (count < w.rows.length && count > 0 && w.room !== null) shown[count - 1] = `${fitText(shown[count - 1], size, w.room - size * 0.6).trimEnd()}…`;
  return shown.map((row, i): Node => {
    const words = text(row, size, 'regular', C.ink, 1, { ...extra, ...dim });
    if (!w.symbol) return leading(words);
    if (i > 0) return { kind: 'stack', dir: 'h', children: [fixed(size + ICON_GAP), words, flex()] };
    const icon: IconNode = { kind: 'icon', symbol: w.symbol, size, color: C.ink, ...dim, fallback: w.symbol === 'bell' ? ALARM_MARK : COUNTDOWN_MARK };
    return { kind: 'stack', dir: 'h', align: 'center', children: [icon, fixed(ICON_GAP), words, flex()] };
  });
}

const monthTitle = (monthId: string): string => `${monthId.slice(0, 4)}년 ${Number(monthId.slice(5, 7))}월`;
const weekdayOfKey = (key: string): number => new Date(Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8, 10))).getUTCDay();

function header(title: string, offline: boolean): StackNode {
  const children: Node[] = [text(title, 17, 'bold', C.ink, 1, { minScale: 0.7 }), flex()];
  if (offline) children.push(text('오프라인', 11, 'regular', C.muted, 1));
  return { kind: 'stack', dir: 'h', children };
}

function weekdayRow(): StackNode {
  return {
    kind: 'stack', dir: 'h', spacing: 1,
    children: WEEKDAYS.map((w, i): Node => ({
      kind: 'stack', dir: 'h',
      children: [flex(), text(w, 11, 'semibold', i === 0 ? C.sun : i === 6 ? C.sat : C.muted, 1), flex()],
    })),
  };
}

type CellLayout = { innerWidth: number; capacity: number; lunar: boolean };

function dayCell(cell: GridCell, day: DayValue | undefined, today: string, lay: CellLayout): StackNode {
  const color = validColor(day);
  const hasColor = color !== '';
  // 공휴일과 대체공휴일은 요일과 상관없이 빨간 날이다.
  const holiday = holidayLabel(cell.dateKey);
  const numberColor = cell.dateKey === today ? C.onAccent : hasColor ? C.ink : holiday !== '' ? C.sun : dowColor(cell.dow);
  const numberText = text(String(cell.dayOfMonth), DAY_NUMBER_SIZE, 'semibold', numberColor, 1, cell.inMonth ? {} : { opacity: 0.4 });
  // 머리 줄: 숫자는 앞쪽, 음력은 뒤쪽 가장자리. 절기나 복날이면 음력 대신 그 이름을 초록으로 적는다(둘이 겹치면 절기).
  // 다른 달의 칸(앞뒤 며칠)도 웹앱의 칸처럼 음력, 공휴일 이름, 메모를 흐리게(0.4) 적고 배경은 그대로 칠한다.
  const faded: Partial<TextNode> = cell.inMonth ? {} : { opacity: 0.4 };
  const season = lay.lunar ? seasonNames(cell.dateKey)[0] ?? '' : '';
  const lunar = season !== '' ? season : lay.lunar ? lunarShort(cell.dateKey) : '';
  // 오늘 표시: 크기를 정한 동그라미(두 자리 날은 조금 넓은 알약). 크기를 정하지 않으면 iOS가 머리 줄의 폭을
  // 숫자, 빈칸, 음력에 나눠 줄 때 숫자 상자가 모자라 날짜가 "…"로 잘린다(2026-11-17 아이폰에서 17일이 그랬다).
  // 그 안에서 숫자는 양옆의 안쪽 여백으로 가운데에 놓는다. 늘어나는 빈칸(flex)을 양옆에 두면 iOS가 상자의 폭을
  // 빈칸, 숫자, 빈칸에 셋으로 나눠 숫자에 6pt쯤만 주어서 "17"이 "1"로 잘린다(같은 날 0.9.5~0.9.13에서 그랬다).
  // 안쪽 여백은 제 몫만 가져가고 나머지가 모두 숫자에 간다(상자 안에는 숫자뿐이라 나눌 것이 없다).
  // 여백은 숫자의 어림 폭으로 정한다. 어림보다 숫자가 넓으면 iOS가 그만큼 줄여서 보인다.
  const markWidth = cell.dayOfMonth >= 10 ? TODAY_MARK_W2 : TODAY_MARK_H;
  const markSide = Math.max(0.5, Math.round(((markWidth - digitsWidth(String(cell.dayOfMonth), DAY_NUMBER_SIZE)) / 2) * 10) / 10);
  const number: Node = cell.dateKey === today
    ? {
      kind: 'stack', dir: 'h', align: 'center', background: C.accent, radius: TODAY_MARK_H / 2,
      size: [markWidth, TODAY_MARK_H], padding: [0, markSide, 0, markSide],
      children: [{ ...numberText, minScale: 0.6 }],
    }
    : numberText;
  const head: Node[] = [number, flex()];
  // 폭이 모자라면 iOS가 글자를 이만큼까지 줄인다. 그래도 안 들어가면 "…"로 자른다.
  if (lunar !== '') head.push(text(lunar, 7.5, 'regular', season !== '' ? C.term : C.muted, 1, { minScale: 0.7, ...faded }));
  const children: Node[] = [{ kind: 'stack', dir: 'h', align: 'center', children: head }];
  // 공휴일 이름은 메모 한 줄의 자리를 쓴다.
  let capacity = lay.capacity;
  if (holiday !== '' && capacity > 0) {
    children.push(leading(text(holiday, 8, 'semibold', C.sun, 1, { minScale: 0.8, ...faded })));
    capacity -= 1;
  }
  if (day && capacity > 0) {
    // 긴 줄은 칸 폭(어림)에서 접어 여러 행을 쓴다. capacity는 행 수다. 행마다 한 줄짜리 글이고, 실제 폭이 어림보다 좁으면
    // iOS가 조금 줄이고 그래도 넘치면 "…"로 자른다.
    const memo = (t: string, extra: Partial<TextNode> = {}): Node => leading(text(t, 9, 'regular', C.ink, 1, { minScale: 0.9, ...extra }));
    const wrapped = memoLines(day.text).map((l) => wrapLine(l, 9, lay.innerWidth));
    const { counts, more } = fitRows(wrapped.map((w) => w.rows.length), capacity);
    counts.forEach((n, i) => children.push(...memoRows(wrapped[i], n, 9, { minScale: 0.9, ...faded })));
    if (more > 0) children.push(memo(`+${more}`, faded));
  }
  children.push(flex());
  return { kind: 'stack', dir: 'v', padding: [2, 2, 2, 2], background: hasColor ? dayPair(color) : C.surface, children };
}

function weekRow(cells: GridCell[], month: MonthData, today: string, lay: CellLayout): StackNode {
  return {
    kind: 'stack', dir: 'h', spacing: 1,
    children: cells.map((c) => {
      const inMonth = c.monthId === month.monthId;
      return dayCell({ ...c, inMonth }, dayOfCell(month, c), today, lay);
    }),
  };
}

function gridTree(input: TreeInput): Tree {
  const { family, size, today, month, offline } = input;
  const rows = family === 'medium'
    ? buildPage({ ...MONTH_OPTS, layout: 'week' }, today).rows
    : buildPage(MONTH_OPTS, `${month.monthId}-01`).rows;
  const weeks = rows.length;
  const cellHeight = (size.height - 24 - 22 - 4 - 14 - 3 - (weeks - 1)) / weeks;
  const lay: CellLayout = {
    innerWidth: (size.width - 24 - 6) / 7 - 4,
    capacity: Math.min(family === 'medium' ? 6 : Infinity, Math.max(0, Math.floor((cellHeight - 4 - 15 - 2) / 11))),
    lunar: input.lunar !== false,
  };
  return {
    background: C.surface, padding: [12, 12, 12, 12], spacing: 0,
    children: [
      header(monthTitle(month.monthId), offline),
      fixed(4),
      weekdayRow(),
      fixed(3),
      { kind: 'stack', dir: 'v', spacing: 1, background: C.hairline, children: rows.map((r) => weekRow(r.cells, month, today, lay)) },
    ],
  };
}

function smallTree(input: TreeInput): Tree {
  const { today, month, offline } = input;
  const dow = weekdayOfKey(today);
  const holiday = holidayLabel(today);
  // 날짜 아래 한 줄: 음력, 절기와 복날, 공휴일 이름. 모두 없으면 줄을 두지 않는다.
  const under = [...(input.lunar !== false ? [lunarLabel(today), ...seasonNames(today)] : []), holiday].filter((t) => t !== '').join(' · ');
  const day = month.days[today.slice(8, 10)];
  const color = validColor(day);
  const lines = day ? memoLines(day.text) : [];
  const memo: Node[] = [];
  if (lines.length === 0) {
    memo.push(leading(text('메모 없음', 11, 'regular', C.muted, 1)));
  } else {
    // 날짜 아래 줄이 있으면 메모 한 행을 덜 넣는다(작은 위젯의 높이를 넘지 않게). 긴 줄은 위젯 폭(어림)에서 접는다.
    const wrapped = lines.map((l) => wrapLine(l, 11, input.size.width - 24));
    const { counts, more } = fitRows(wrapped.map((w) => w.rows.length), under === '' ? 6 : 5);
    counts.forEach((n, i) => memo.push(...memoRows(wrapped[i], n, 11)));
    if (more > 0) memo.push(leading(text(`+${more}`, 11, 'regular', C.muted, 1)));
  }
  const children: Node[] = [
    {
      kind: 'stack', dir: 'h', spacing: 8, align: 'center',
      children: [
        text(String(Number(today.slice(8, 10))), 34, 'bold', holiday !== '' ? C.sun : dowColor(dow), 1),
        { kind: 'stack', dir: 'v', children: [text(`${Number(today.slice(5, 7))}월`, 12, 'regular', C.muted, 1), text(`${WEEKDAYS[dow]}요일`, 12, 'semibold', C.muted, 1)] },
        flex(),
      ],
    },
    ...(under === '' ? [] : [leading(text(under, 10, 'regular', holiday !== '' ? C.sun : C.muted, 1, { minScale: 0.8 }))]),
    fixed(6),
    ...memo,
    flex(),
  ];
  if (offline) children.push({ kind: 'stack', dir: 'h', children: [flex(), text('오프라인', 10, 'regular', C.muted, 1)] });
  return { background: color !== '' ? dayPair(color) : C.surface, padding: [12, 12, 12, 12], spacing: 0, children };
}

/** lunar: 음력을 적을지(없으면 적는다). 공휴일은 늘 표시한다. */
export type TreeInput = { family: Family; size: Size; today: string; month: MonthData; offline: boolean; lunar?: boolean };

/** 위젯에 놓을 것을 정한다. size는 줄 수와 글자 수를 가늠하는 데만 쓰고, 나무의 어느 것도 고정된 크기를 갖지 않는다. */
export function buildTree(input: TreeInput): Tree {
  return input.family === 'small' ? smallTree(input) : gridTree(input);
}

/** 로그인 안내나 오류처럼 글만 보여 주는 위젯. */
export function messageTree(input: { title: string; lines: string[] }): Tree {
  return {
    background: C.surface, padding: [14, 14, 14, 14], spacing: 0,
    children: [
      text(input.title, 15, 'bold', C.ink, 2),
      fixed(6),
      ...input.lines.map((l) => text(l, 12, 'regular', C.muted, 0)),
      flex(),
    ],
  };
}
