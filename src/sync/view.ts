import { resolveEdit } from '../core/merge';
import type { DayValue, MonthDoc, PendingEdit } from '../core/types';

/** Overlays pending edits for one month on the server's values, for display. */
export function applyPending(
  monthId: string,
  server: MonthDoc | null,
  pending: PendingEdit[],
  editedBy: string,
): Record<string, DayValue> {
  const result: Record<string, DayValue> = {};
  for (const [day, r] of Object.entries(server?.days ?? {})) result[day] = { text: r.text, color: r.color };
  for (const edit of pending) {
    if (edit.monthId !== monthId) continue;
    const change = resolveEdit(edit, server?.days[edit.day] ?? null, editedBy);
    if (change === null) continue;
    if (change === 'delete') delete result[edit.day];
    else result[edit.day] = { text: change.text, color: change.color };
  }
  return result;
}
