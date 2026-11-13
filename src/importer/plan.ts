import { splitDateKey } from '../core/dates';
import type { DayValue, PendingEdit } from '../core/types';
import type { ConvertedDay } from './convert';

/** hasBase: 지난번 가져오기의 상태 파일에 그 날짜가 있었는지. */
export type ImportEdit = PendingEdit & { hasBase: boolean };

const sameValue = (a: DayValue, b: DayValue): boolean => a.text === b.text && a.color === b.color;

/**
 * 지금 DesktopCal의 값(current)과 지난번에 가져온 값(state)을 비교해 올릴 편집을 만든다.
 * 달라진 날짜만 편집이 된다. 지난번에는 있었는데 지금 없는 날짜는 지우는 편집이 된다.
 */
export function planEdits(current: Map<string, ConvertedDay>, state: Record<string, DayValue> | null, now: number): ImportEdit[] {
  const previous = new Map<string, DayValue>(state ? Object.entries(state) : []);
  const edits: ImportEdit[] = [];

  for (const [dateKey, converted] of current) {
    const parts = splitDateKey(dateKey);
    if (!parts) continue;
    const prev = previous.get(dateKey);
    if (prev && sameValue(prev, converted.value)) continue;
    edits.push({
      monthId: parts.monthId,
      day: parts.day,
      base: { text: prev?.text ?? '', color: prev?.color ?? '' },
      next: { text: converted.value.text, color: converted.value.color },
      editedAt: converted.editedAt,
      hasBase: prev !== undefined,
    });
  }

  for (const [dateKey, prev] of previous) {
    if (current.has(dateKey)) continue;
    const parts = splitDateKey(dateKey);
    if (!parts || (prev.text === '' && prev.color === '')) continue;
    edits.push({
      monthId: parts.monthId,
      day: parts.day,
      base: { text: prev.text, color: prev.color },
      next: { text: '', color: '' },
      editedAt: now,
      hasBase: true,
    });
  }

  return edits;
}

export type DeleteCheck = { deletes: number; stateDays: number; blocked: boolean };

/** 지난번에 가져온 날짜가 한꺼번에 사라지면(파일이 비었거나 바뀌었을 수 있다) 올리지 않도록 막을지 가린다. */
export function checkDeletes(edits: ImportEdit[], state: Record<string, DayValue> | null): DeleteCheck {
  const deletes = edits.filter((e) => e.hasBase && e.next.text === '' && e.next.color === '').length;
  const stateDays = state ? Object.keys(state).length : 0;
  const blocked = (deletes >= 10 && deletes * 10 > stateDays) || (stateDays >= 3 && deletes === stateDays);
  return { deletes, stateDays, blocked };
}
