/**
 * 웹앱(아이폰 화면)의 설정. 기기의 브라우저 저장소에 따로 저장하고 다른 기기와 동기화하지 않는다.
 * PC 앱은 이것을 쓰지 않는다(appearance.ts의 설정을 쓴다).
 */
import type { KeyValueStore } from '../sync/outbox';
import { WEB_APPEARANCE, type Appearance, type AlarmTone, type Bullet } from './appearance';

export type ThemeMode = 'auto' | 'light' | 'dark';
export type Accent = 'blue' | 'pink' | 'gold' | 'purple' | 'green' | 'orange' | 'yellow' | 'sky';
export type MemoSize = 'small' | 'medium' | 'large';
export type CellGap = 'narrow' | 'normal' | 'wide';
export type LineSpacing = 'tight' | 'normal' | 'loose';
export type { AlarmTone };
export type Prefs = {
  version: 1;
  theme: ThemeMode;
  accent: Accent;
  lunar: boolean;
  holidays: boolean;
  weekNumbers: boolean;
  weekStart: number; // 0(일요일)~6(토요일)
  memoSize: MemoSize;
  showDone: boolean;
  doneToBottom: boolean;
  bullet: Bullet;
  cellGap: CellGap;
  lineSpacing: LineSpacing;
  showAlarmTime: boolean;
  doneTone: 'none' | 'short';
  alarmTone: AlarmTone;
};

export const PREFS_KEY = 'calfif.prefs';

export const DEFAULT_PREFS: Prefs = {
  version: 1, theme: 'auto', accent: 'blue', lunar: true, holidays: true, weekNumbers: false, weekStart: 0,
  memoSize: 'medium', showDone: true, doneToBottom: false, bullet: 'none',
  cellGap: 'narrow', lineSpacing: 'normal', showAlarmTime: true, doneTone: 'none', alarmTone: 'chime',
};

/** 칸 사이 간격(px). styles.css의 --cell-gap으로 간다. */
export const CELL_GAP_PX: Record<CellGap, number> = { narrow: 1, normal: 2, wide: 4 };
/** 메모 줄 높이에 곱하는 값(MEMO_METRICS의 줄 높이 × 이 값, 반올림). */
export const LINE_SPACING_FACTOR: Record<LineSpacing, number> = { tight: 0.9, normal: 1, loose: 1.15 };

/** 강조색. light는 밝은 화면에서, dark는 어두운 화면에서 쓴다. 단추의 글자색이자 오늘 표시의 바탕색이다. */
export const ACCENTS: Record<Accent, { light: string; dark: string; label: string }> = {
  blue: { light: '#2550D0', dark: '#8DAEFF', label: '파랑' },
  pink: { light: '#C2185B', dark: '#FF8FB8', label: '분홍' },
  gold: { light: '#8A6200', dark: '#E8C15A', label: '금색' },
  purple: { light: '#6D3FD4', dark: '#B79DFF', label: '보라' },
  green: { light: '#2E7D32', dark: '#86D98B', label: '연두' },
  orange: { light: '#B4530A', dark: '#FFB067', label: '주황' },
  yellow: { light: '#7A6A00', dark: '#F2DC5D', label: '노랑' },
  sky: { light: '#0B6FA8', dark: '#7CCBF5', label: '하늘' },
};

/** 칸 안 메모 줄의 글자 크기와 줄 높이(px). narrow는 폰 화면, wide는 880px 이상. styles.css의 --memo-size, --memo-line으로 간다. */
export const MEMO_METRICS: Record<MemoSize, { narrow: { size: number; line: number }; wide: { size: number; line: number } }> = {
  small: { narrow: { size: 9, line: 12 }, wide: { size: 12, line: 15 } },
  medium: { narrow: { size: 10, line: 13 }, wide: { size: 13, line: 17 } },
  large: { narrow: { size: 12, line: 16 }, wide: { size: 15, line: 20 } },
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
const choice = <T extends string | number>(v: unknown, list: readonly T[], fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);

export function parsePrefs(input: unknown): Prefs {
  const raw = isObject(input) ? input : {};
  const d = DEFAULT_PREFS;
  return {
    version: 1,
    theme: choice(raw.theme, ['auto', 'light', 'dark'] as const, d.theme),
    accent: choice(raw.accent, Object.keys(ACCENTS) as Accent[], d.accent),
    lunar: bool(raw.lunar, d.lunar),
    holidays: bool(raw.holidays, d.holidays),
    weekNumbers: bool(raw.weekNumbers, d.weekNumbers),
    weekStart: choice(raw.weekStart, [0, 1, 2, 3, 4, 5, 6] as const, d.weekStart),
    memoSize: choice(raw.memoSize, ['small', 'medium', 'large'] as const, d.memoSize),
    showDone: bool(raw.showDone, d.showDone),
    doneToBottom: bool(raw.doneToBottom, d.doneToBottom),
    bullet: choice(raw.bullet, ['none', 'number', 'dot'] as const, d.bullet),
    cellGap: choice(raw.cellGap, ['narrow', 'normal', 'wide'] as const, d.cellGap),
    lineSpacing: choice(raw.lineSpacing, ['tight', 'normal', 'loose'] as const, d.lineSpacing),
    showAlarmTime: bool(raw.showAlarmTime, d.showAlarmTime),
    doneTone: choice(raw.doneTone, ['none', 'short'] as const, d.doneTone),
    alarmTone: choice(raw.alarmTone, ['none', 'chime', 'bell'] as const, d.alarmTone),
  };
}

export function loadPrefs(store: KeyValueStore): Prefs {
  try {
    const text = store.getItem(PREFS_KEY);
    return parsePrefs(text === null ? null : JSON.parse(text));
  } catch {
    return parsePrefs(null);
  }
}

export function savePrefs(store: KeyValueStore, prefs: Prefs): void {
  store.setItem(PREFS_KEY, JSON.stringify(prefs));
}

/** 달력에 넘길 설정. 웹의 기본 배치(전체 월)에 고른 값만 얹는다. */
export function prefsAppearance(p: Prefs): Appearance {
  return {
    ...WEB_APPEARANCE,
    lunar: p.lunar, holidays: p.holidays, weekNumbers: p.weekNumbers, weekStart: p.weekStart,
    showDone: p.showDone, doneToBottom: p.doneToBottom, bullet: p.bullet,
    showAlarmTime: p.showAlarmTime, alarmTone: p.alarmTone, doneTone: p.doneTone,
  };
}

/** 밝기와 강조색을 문서(html)에 건다. 색은 변수 둘로 주고, 지금 어느 쪽을 쓸지는 styles.css가 정한다. */
export function applyPrefs(el: HTMLElement, p: Prefs): void {
  if (p.theme === 'auto') el.removeAttribute('data-theme');
  else el.dataset.theme = p.theme;
  el.style.setProperty('--accent-light', ACCENTS[p.accent].light);
  el.style.setProperty('--accent-dark', ACCENTS[p.accent].dark);
  el.style.setProperty('--cell-gap', `${CELL_GAP_PX[p.cellGap]}px`);
}
