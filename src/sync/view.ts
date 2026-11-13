import { resolveEdits } from '../core/merge';
import type { DayValue, MonthDoc, PendingEdit } from '../core/types';

/** Overlays pending edits for one month on the server's values, for display. */
export function applyPending(
  monthId: string,
  server: MonthDoc | null,
  pending: PendingEdit[],
  editedBy: string,
): Record<string, DayValue> {
  const days = server?.days ?? {};
  const result: Record<string, DayValue> = {};
  for (const [day, r] of Object.entries(days)) result[day] = { text: r.text, color: r.color };
  const changes = resolveEdits(
    pending.filter((e) => e.monthId === monthId),
    days,
    editedBy,
  );
  for (const [day, change] of Object.entries(changes)) {
    if (change === 'delete') delete result[day];
    else result[day] = { text: change.text, color: change.color };
  }
  return result;
}
