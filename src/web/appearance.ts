import type { Layout, PageOptions, WeekRule } from '../core/layout';
import type { KeyValueStore } from '../sync/outbox';

export type Bullet = 'none' | 'number' | 'dot';
export type FontSetting = { color: string; size: number };
export type Appearance = {
  version: 1; layout: Layout; maxRows: number; pastWeeks: number; monthGap: boolean; weekNumbers: boolean;
  shadow: boolean; titleBar: boolean; holidays: boolean; lunar: boolean; bullet: Bullet; cellGap: number;
  lineSpacing: number; doneToBottom: boolean; showDone: boolean; doneTone: 'none' | 'short';
  calendarFont: FontSetting; memoFont: FontSetting; calendarBg: string; restBg: string; todayBorder: string;
  titleButton: string; holidayInk: string; lunarInk: string; transparency: number; weekStart: number;
  firstWeek: WeekRule; showRestDays: boolean; restDays: number[];
};

export const APPEARANCE_KEY = 'calfif.appearance';

export const DEFAULT_APPEARANCE: Appearance = {
  version: 1, layout: 'floating', maxRows: 5, pastWeeks: 1, monthGap: true, weekNumbers: false, shadow: true,
  titleBar: true, holidays: true, lunar: false, bullet: 'none', cellGap: 4, lineSpacing: 1.35, doneToBottom: false,
  showDone: true, doneTone: 'none', calendarFont: { color: 'FFFFFF', size: 13 }, memoFont: { color: 'FFFFFF', size: 14 },
  calendarBg: '141820', restBg: '3A1F24', todayBorder: '6AA6FF', titleButton: 'FFFFFF', holidayInk: 'FF6B6B',
  lunarInk: '9FB3C8', transparency: 60, weekStart: 0, firstWeek: 'jan1', showRestDays: true, restDays: [0, 6],
};

export const WEB_APPEARANCE: Appearance = { ...DEFAULT_APPEARANCE, layout: 'month', holidays: false, monthGap: false, shadow: false };

type Raw = Record<string, unknown>;

const isObject = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);

function readBool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function readInt(v: unknown, min: number, max: number, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.round(v)));
}

function readLineSpacing(v: unknown, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.round(Math.min(2, Math.max(1, v)) * 20) / 20;
}

function readChoice<T extends string | number>(v: unknown, list: readonly T[], fallback: T): T {
  return list.includes(v as T) ? (v as T) : fallback;
}

function readColor(v: unknown, fallback: string, allowEmpty: boolean): string {
  if (typeof v !== 'string') return fallback;
  if (v === '') return allowEmpty ? '' : fallback;
  const hex = v.replace(/^#/, '');
  return /^[0-9a-fA-F]{6}$/.test(hex) ? hex.toUpperCase() : fallback;
}

function readFont(v: unknown, fallback: FontSetting, minSize: number, maxSize: number): FontSetting {
  const o = isObject(v) ? v : {};
  return { color: readColor(o.color, fallback.color, false), size: readInt(o.size, minSize, maxSize, fallback.size) };
}

function readRestDays(v: unknown, fallback: number[]): number[] {
  if (!Array.isArray(v)) return fallback;
  const days = v.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6);
  return [...new Set(days)].sort((a, b) => a - b);
}

export function parseAppearance(input: unknown): Appearance {
  const raw: Raw = isObject(input) ? input : {};
  const d = DEFAULT_APPEARANCE;
  return {
    version: 1,
    layout: readChoice(raw.layout, ['floating', 'month', 'week', 'days'] as const, d.layout),
    maxRows: readInt(raw.maxRows, 2, 8, d.maxRows),
    pastWeeks: readInt(raw.pastWeeks, 0, 3, d.pastWeeks),
    monthGap: readBool(raw.monthGap, d.monthGap),
    weekNumbers: readBool(raw.weekNumbers, d.weekNumbers),
    shadow: readBool(raw.shadow, d.shadow),
    titleBar: readBool(raw.titleBar, d.titleBar),
    holidays: readBool(raw.holidays, d.holidays),
    lunar: readBool(raw.lunar, d.lunar),
    bullet: readChoice(raw.bullet, ['none', 'number', 'dot'] as const, d.bullet),
    cellGap: readInt(raw.cellGap, 0, 12, d.cellGap),
    lineSpacing: readLineSpacing(raw.lineSpacing, d.lineSpacing),
    doneToBottom: readBool(raw.doneToBottom, d.doneToBottom),
    showDone: readBool(raw.showDone, d.showDone),
    doneTone: readChoice(raw.doneTone, ['none', 'short'] as const, d.doneTone),
    calendarFont: readFont(raw.calendarFont, d.calendarFont, 11, 20),
    memoFont: readFont(raw.memoFont, d.memoFont, 11, 22),
    calendarBg: readColor(raw.calendarBg, d.calendarBg, true),
    restBg: readColor(raw.restBg, d.restBg, true),
    todayBorder: readColor(raw.todayBorder, d.todayBorder, true),
    titleButton: readColor(raw.titleButton, d.titleButton, false),
    holidayInk: readColor(raw.holidayInk, d.holidayInk, false),
    lunarInk: readColor(raw.lunarInk, d.lunarInk, false),
    transparency: readInt(raw.transparency, 0, 100, d.transparency),
    weekStart: readChoice(raw.weekStart, [0, 1, 2, 3, 4, 5, 6] as const, d.weekStart),
    firstWeek: readChoice(raw.firstWeek, ['jan1', 'iso'] as const, d.firstWeek),
    showRestDays: readBool(raw.showRestDays, d.showRestDays),
    restDays: readRestDays(raw.restDays, [...d.restDays]),
  };
}

export function loadAppearance(store: KeyValueStore): Appearance {
  const text = store.getItem(APPEARANCE_KEY);
  if (text === null) return parseAppearance(null);
  try {
    return parseAppearance(JSON.parse(text));
  } catch {
    return parseAppearance(null);
  }
}

export function saveAppearance(store: KeyValueStore, a: Appearance): void {
  store.setItem(APPEARANCE_KEY, JSON.stringify(a));
}

export function pageOptions(a: Appearance): PageOptions {
  return { layout: a.layout, maxRows: a.maxRows, pastWeeks: a.pastWeeks, weekStart: a.weekStart, firstWeek: a.firstWeek };
}

function rgb(hex: string, alpha: number): string {
  if (hex === '') return 'transparent';
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const solid = (hex: string): string => (hex === '' ? 'transparent' : `#${hex}`);

export function appearanceVars(a: Appearance): Record<string, string> {
  const alpha = Math.round(100 - a.transparency) / 100;
  return {
    '--desk-cal-ink': solid(a.calendarFont.color),
    '--desk-cal-size': `${a.calendarFont.size}px`,
    '--desk-memo-ink': solid(a.memoFont.color),
    '--desk-memo-size': `${a.memoFont.size}px`,
    '--desk-line': String(a.lineSpacing),
    '--desk-gap': `${a.cellGap}px`,
    '--desk-cell-bg': rgb(a.calendarBg, alpha),
    '--desk-rest-bg': rgb(a.restBg, alpha),
    '--desk-today': solid(a.todayBorder),
    '--desk-btn': solid(a.titleButton),
    '--desk-holiday-ink': solid(a.holidayInk),
    '--desk-lunar-ink': solid(a.lunarInk),
    '--desk-day-pct': `${Math.round(Math.max(0.5, alpha) * 100)}%`,
  };
}

export function applyAppearance(el: HTMLElement, a: Appearance): void {
  for (const [name, value] of Object.entries(appearanceVars(a))) el.style.setProperty(name, value);
}
