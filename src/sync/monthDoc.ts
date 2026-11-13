import type { DayChange, DayRecord, MonthDoc } from '../core/types';

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Reads whatever is stored for a month. Malformed days are dropped and missing fields are filled. */
export function parseMonthDoc(data: unknown): MonthDoc {
  const days: Record<string, DayRecord> = {};
  const raw = isObject(data) && isObject(data.days) ? data.days : {};
  for (const [day, value] of Object.entries(raw)) {
    if (!/^\d{2}$/.test(day) || !isObject(value)) continue;
    days[day] = {
      text: typeof value.text === 'string' ? value.text : '',
      color: typeof value.color === 'string' ? value.color : '',
      editedAt: typeof value.editedAt === 'number' && Number.isFinite(value.editedAt) ? value.editedAt : 0,
      editedBy: typeof value.editedBy === 'string' ? value.editedBy : '',
    };
  }
  return { days };
}

/** Builds the content to merge into a month document, or null when there is nothing to change. */
export function buildMonthPatch(
  changes: Record<string, DayChange>,
  sentinels: { deleteField(): unknown; serverTimestamp(): unknown },
): { days: Record<string, unknown>; updatedAt: unknown } | null {
  const days: Record<string, unknown> = {};
  for (const [day, change] of Object.entries(changes)) {
    days[day] = change === 'delete' ? sentinels.deleteField() : change;
  }
  if (Object.keys(days).length === 0) return null;
  return { days, updatedAt: sentinels.serverTimestamp() };
}
