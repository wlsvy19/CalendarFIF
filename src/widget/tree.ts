import { isColor } from '../core/color';
import { buildPage } from '../core/layout';
import type { GridCell } from '../core/dates';
import type { DayValue } from '../core/types';
import type { MonthData } from './scene';
import type { Family, Size } from './sizes';
import { capLines, fitText, memoLines } from './text';
import { PALETTES, dayBackground, type Palette } from './theme';

export type Dyn = { light: string; dark: string }; // 밝은 화면과 어두운 화면의 색 ('#RRGGBB')
export type Pad = [top: number, leading: number, bottom: number, trailing: number];
export type TextNode = { kind: 'text'; text: string; size: number; weight: 'regular' | 'medium' | 'semibold' | 'bold'; color: Dyn; opacity?: number; lines: number; minScale?: number }; // lines: 줄 수 제한(0은 제한 없음)
export type SpacerNode = { kind: 'spacer'; length: number | null }; // null은 남는 곳을 채운다
export type StackNode = { kind: 'stack'; dir: 'h' | 'v'; children: Node[]; spacing?: number; padding?: Pad; background?: Dyn; radius?: number; align?: 'top' | 'center' | 'bottom' };
export type Node = TextNode | SpacerNode | StackNode;
/** 위젯 하나. ListWidget 자신이 세로로 쌓는 상자다. */
export type Tree = { background: Dyn; padding: Pad; spacing: number; children: Node[] };

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const MONTH_OPTS = { layout: 'month', maxRows: 6, pastWeeks: 0, weekStart: 0, firstWeek: 'jan1' } as const;

type Colors = { surface: Dyn; ink: Dyn; muted: Dyn; hairline: Dyn; accent: Dyn; onAccent: Dyn; sun: Dyn; sat: Dyn };
const pair = (key: keyof Palette): Dyn => ({ light: PALETTES.light[key], dark: PALETTES.dark[key] });
const C: Colors = {
  surface: pair('surface'), ink: pair('ink'), muted: pair('muted'), hairline: pair('hairline'),
  accent: pair('accent'), onAccent: pair('onAccent'), sun: pair('sun'), sat: pair('sat'),
};

const dowColor = (dow: number): Dyn => (dow === 0 ? C.sun : dow === 6 ? C.sat : C.ink);
const validColor = (day: DayValue | undefined): string => (day && day.color !== '' && isColor(day.color) ? day.color : '');
const dayPair = (color: string): Dyn => ({ light: dayBackground(color, 'light'), dark: dayBackground(color, 'dark') });

/** 완료 줄 앞에 붙이는 표시. 결합 글자(취소선)는 한글 위에서 깨질 수 있어 쓰지 않는다. */
const DONE_MARK = '\u2713 ';

const flex = (): SpacerNode => ({ kind: 'spacer', length: null });
const fixed = (length: number): SpacerNode => ({ kind: 'spacer', length });
const text = (t: string, size: number, weight: TextNode['weight'], color: Dyn, lines: number, extra: Partial<TextNode> = {}): TextNode =>
  ({ kind: 'text', text: t, size, weight, color, lines, ...extra });
/** 글자를 앞쪽 가장자리로 미는 가로 상자. */
const leading = (node: Node): StackNode => ({ kind: 'stack', dir: 'h', children: [node, flex()] });

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

type CellLayout = { innerWidth: number; capacity: number };

function dayCell(cell: GridCell, day: DayValue | undefined, today: string, lay: CellLayout): StackNode {
  const color = validColor(day);
  const hasColor = color !== '';
  const numberText = text(String(cell.dayOfMonth), 11, 'semibold', cell.dateKey === today ? C.onAccent : hasColor ? C.ink : dowColor(cell.dow), 1, cell.inMonth ? {} : { opacity: 0.4 });
  const number: Node = cell.dateKey === today
    ? { kind: 'stack', dir: 'h', background: C.accent, radius: 7.5, padding: [1, 4, 1, 4], children: [numberText] }
    : numberText;
  const children: Node[] = [leading(number)];
  if (cell.inMonth && day && lay.capacity > 0) {
    // 줄마다 한 줄짜리 글이다. 실제 폭이 어림보다 좁으면 iOS가 조금 줄이고, 그래도 넘치면 "…"로 자른다(다음 줄로 접지 않는다).
    const memo = (t: string, extra: Partial<TextNode> = {}): Node => leading(text(t, 9, 'regular', C.ink, 1, { minScale: 0.9, ...extra }));
    const { shown, more } = capLines(memoLines(day.text), lay.capacity);
    for (const l of shown) {
      children.push(l.done ? memo(fitText(DONE_MARK + l.text, 9, lay.innerWidth), { opacity: 0.55 }) : memo(fitText(l.text, 9, lay.innerWidth)));
    }
    if (more > 0) children.push(memo(`+${more}`));
  }
  children.push(flex());
  return { kind: 'stack', dir: 'v', padding: [2, 2, 2, 2], background: hasColor && cell.inMonth ? dayPair(color) : C.surface, children };
}

function weekRow(cells: GridCell[], month: MonthData, today: string, lay: CellLayout): StackNode {
  return {
    kind: 'stack', dir: 'h', spacing: 1,
    children: cells.map((c) => {
      const inMonth = c.monthId === month.monthId;
      return dayCell({ ...c, inMonth }, inMonth ? month.days[c.day] : undefined, today, lay);
    }),
  };
}

function gridTree(input: { family: Family; size: Size; today: string; month: MonthData; offline: boolean }): Tree {
  const { family, size, today, month, offline } = input;
  const rows = family === 'medium'
    ? buildPage({ ...MONTH_OPTS, layout: 'week' }, today).rows
    : buildPage(MONTH_OPTS, `${month.monthId}-01`).rows;
  const weeks = rows.length;
  const cellHeight = (size.height - 24 - 22 - 4 - 14 - 3 - (weeks - 1)) / weeks;
  const lay: CellLayout = {
    innerWidth: (size.width - 24 - 6) / 7 - 4,
    capacity: Math.min(family === 'medium' ? 6 : Infinity, Math.max(0, Math.floor((cellHeight - 4 - 15 - 2) / 11))),
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

function smallTree(input: { today: string; month: MonthData; offline: boolean }): Tree {
  const { today, month, offline } = input;
  const dow = weekdayOfKey(today);
  const day = month.days[today.slice(8, 10)];
  const color = validColor(day);
  const lines = day ? memoLines(day.text) : [];
  const memo: Node[] = [];
  if (lines.length === 0) {
    memo.push(leading(text('메모 없음', 11, 'regular', C.muted, 1)));
  } else {
    const { shown, more } = capLines(lines, 6);
    for (const l of shown) memo.push(leading(l.done ? text(DONE_MARK + l.text, 11, 'regular', C.ink, 1, { opacity: 0.55 }) : text(l.text, 11, 'regular', C.ink, 1)));
    if (more > 0) memo.push(leading(text(`+${more}`, 11, 'regular', C.muted, 1)));
  }
  const children: Node[] = [
    {
      kind: 'stack', dir: 'h', spacing: 8, align: 'center',
      children: [
        text(String(Number(today.slice(8, 10))), 34, 'bold', dowColor(dow), 1),
        { kind: 'stack', dir: 'v', children: [text(`${Number(today.slice(5, 7))}월`, 12, 'regular', C.muted, 1), text(`${WEEKDAYS[dow]}요일`, 12, 'semibold', C.muted, 1)] },
        flex(),
      ],
    },
    fixed(6),
    ...memo,
    flex(),
  ];
  if (offline) children.push({ kind: 'stack', dir: 'h', children: [flex(), text('오프라인', 10, 'regular', C.muted, 1)] });
  return { background: color !== '' ? dayPair(color) : C.surface, padding: [12, 12, 12, 12], spacing: 0, children };
}

/** 위젯에 놓을 것을 정한다. size는 줄 수와 글자 수를 가늠하는 데만 쓰고, 나무의 어느 것도 고정된 크기를 갖지 않는다. */
export function buildTree(input: { family: Family; size: Size; today: string; month: MonthData; offline: boolean }): Tree {
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
