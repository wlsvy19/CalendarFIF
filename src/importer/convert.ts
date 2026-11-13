import { splitDateKey } from '../core/dates';
import { normalizeText } from '../core/text';
import type { DayValue } from '../core/types';

export type SourceRow = { key: string; content: string | null; bgcolor: string | null; stime: number | null };
export type ConvertedDay = { dateKey: string; value: DayValue; editedAt: number };
export type ConvertStats = {
  rows: number;
  converted: number;
  skippedEmpty: number;
  skippedBadKey: number;
  badColors: number;
  fontTags: number;
  /** 저장 값 그대로(대소문자 포함)별 집계, count 내림차순 */
  colors: { stored: string; rgb: string; count: number }[];
};

/** 'dkcal_mdays_20261113' → '2026-11-13'. 형식이 다르거나 실제로 없는 날짜면 null. */
export function parseItemKey(key: string): string | null {
  const m = /^dkcal_mdays_(\d{4})(\d{2})(\d{2})$/.exec(key);
  if (!m) return null;
  const dateKey = `${m[1]}-${m[2]}-${m[3]}`;
  return splitDateKey(dateKey) ? dateKey : null;
}

/** DesktopCal은 색을 BGR 순서의 16진수로 저장하고 앞의 0을 생략하기도 한다. 잘못된 값이면 null. */
export function bgrToRgb(stored: string): string | null {
  if (stored === '') return '';
  if (!/^[0-9a-fA-F]{1,6}$/.test(stored)) return null;
  const bgr = stored.padStart(6, '0');
  return (bgr.slice(4, 6) + bgr.slice(2, 4) + bgr.slice(0, 2)).toUpperCase();
}

export function decodeContent(raw: string): { text: string; fontTags: number } {
  let fontTags = 0;
  const stripped = raw
    .replace(/\r\n/g, '\n')
    .replace(/<font\b[^>]*>/gi, () => {
      fontTags++;
      return '';
    })
    .replace(/<\/font>/gi, '');
  const decoded = stripped.replace(/&(lt|gt|quot);/g, (_, name: string) => (name === 'lt' ? '<' : name === 'gt' ? '>' : '"'));
  return { text: normalizeText(decoded), fontTags };
}

export function convertRows(rows: SourceRow[]): { days: Map<string, ConvertedDay>; stats: ConvertStats } {
  const days = new Map<string, ConvertedDay>();
  const colorCounts = new Map<string, { stored: string; rgb: string; count: number }>();
  const stats: ConvertStats = { rows: rows.length, converted: 0, skippedEmpty: 0, skippedBadKey: 0, badColors: 0, fontTags: 0, colors: [] };

  // 같은 날짜가 여러 번 나오면 stime이 가장 큰 행 하나만 본다(같으면 입력에서 나중 행).
  const latest = new Map<string, SourceRow>();
  for (const row of rows) {
    const dateKey = parseItemKey(row.key);
    if (dateKey === null) {
      stats.skippedBadKey++;
      continue;
    }
    const existing = latest.get(dateKey);
    if (!existing || (row.stime ?? 0) >= (existing.stime ?? 0)) latest.set(dateKey, row);
  }

  for (const [dateKey, row] of latest) {
    const stored = row.bgcolor ?? '';
    const rgb = bgrToRgb(stored);
    if (rgb === null) stats.badColors++;
    const color = rgb ?? '';
    const { text, fontTags } = decodeContent(row.content ?? '');
    stats.fontTags += fontTags;
    if (text === '' && color === '') {
      stats.skippedEmpty++;
      continue;
    }
    if (color !== '') {
      const entry = colorCounts.get(stored);
      if (entry) entry.count++;
      else colorCounts.set(stored, { stored, rgb: color, count: 1 });
    }
    const editedAt = row.stime === null ? 0 : row.stime * 1000;
    days.set(dateKey, { dateKey, value: { text, color }, editedAt });
  }

  stats.converted = days.size;
  stats.colors = [...colorCounts.values()].sort((a, b) => b.count - a.count);
  return { days, stats };
}
