import { splitDateKey } from '../core/dates';
import { resolveEdit } from '../core/merge';
import type { DayChange, DayRecord, MonthDoc } from '../core/types';
import type { MonthStore } from '../sync/engine';
import type { ConvertedDay } from './convert';
import type { ImportEdit } from './plan';

const EDITED_BY = 'import';

/**
 * 지난번 값을 모르는 날짜: 서버에 없으면 쓰고, 서버와 다르면 DesktopCal 쪽이 더 늦게 고쳐졌을 때만 덮어쓴다.
 * 'skip'은 서버 값이 다르고 더 늦어서 그대로 둔 경우다.
 */
function decideWithoutBase(edit: ImportEdit, server: DayRecord | null): DayChange | null | 'skip' {
  const { next } = edit;
  const nextEmpty = next.text === '' && next.color === '';
  if (!server) return nextEmpty ? null : { text: next.text, color: next.color, editedAt: edit.editedAt, editedBy: EDITED_BY };
  if (server.text === next.text && server.color === next.color) return null;
  if (server.editedAt >= edit.editedAt) return 'skip';
  return nextEmpty ? 'delete' : { text: next.text, color: next.color, editedAt: edit.editedAt, editedBy: EDITED_BY };
}

/** 한 달의 편집을 서버 값에 견주어 쓸 변경과, 지난번 값 없이 건너뛰어 기록하지 말아야 할 편집을 정한다. */
function decideMonth(edits: ImportEdit[], server: MonthDoc | null): { changes: Record<string, DayChange>; skipped: Set<ImportEdit> } {
  const changes: Record<string, DayChange> = {};
  const skipped = new Set<ImportEdit>();
  for (const edit of edits) {
    const current = server?.days[edit.day] ?? null;
    const change = edit.hasBase ? resolveEdit(edit, current, EDITED_BY) : decideWithoutBase(edit, current);
    if (change === 'skip') skipped.add(edit);
    else if (change !== null) changes[edit.day] = change;
  }
  return { changes, skipped };
}

/** 한 달의 편집을 서버의 지금 값에 견주어 실제로 쓸 변경을 정한다. */
export function decideImport(edits: ImportEdit[], server: MonthDoc | null): Record<string, DayChange> {
  return decideMonth(edits, server).changes;
}

/**
 * 편집 목록에 처음 나온 순서대로 달마다 한 번씩 올린다. 실패하면 그 자리에서 오류를 던진다.
 * onMonthDone에는 그 달에서 기록해 둘 편집만 넘긴다. 지난번 값 없이 건너뛴 날짜(클라우드 값이 다르고 더 늦은 날짜)는
 * 빼서, 다음 실행에서 상태 파일을 기준으로 합치게 한다. 트랜잭션이 다시 돌면 마지막에 본 서버 값을 따른다.
 * days는 성공한 달들에 넘긴 편집 수다(실제로 쓴 수가 아니다).
 */
export async function uploadEdits(
  store: MonthStore,
  edits: ImportEdit[],
  onMonthDone: (monthId: string, done: ImportEdit[]) => void,
): Promise<{ months: number; days: number }> {
  const byMonth = new Map<string, ImportEdit[]>();
  for (const edit of edits) {
    const list = byMonth.get(edit.monthId);
    if (list) list.push(edit);
    else byMonth.set(edit.monthId, [edit]);
  }
  let months = 0;
  let days = 0;
  for (const [monthId, monthEdits] of byMonth) {
    let skipped = new Set<ImportEdit>();
    await store.transactMonth(monthId, (server) => {
      const decided = decideMonth(monthEdits, server);
      skipped = decided.skipped;
      return decided.changes;
    });
    months++;
    days += monthEdits.length;
    onMonthDone(monthId, monthEdits.filter((edit) => !skipped.has(edit)));
  }
  return { months, days };
}

/** differentDates와 missingDates는 날짜 키를 오름차순으로 담는다. */
export type VerifyResult = {
  source: number;
  same: number;
  different: number;
  missing: number;
  differentDates: string[];
  missingDates: string[];
};

/** 원본의 각 날짜가 클라우드에 같은 값으로 있는지 센다. */
export async function verifyAgainstCloud(
  store: { getMonth(monthId: string): Promise<MonthDoc | null> },
  days: Map<string, ConvertedDay>,
): Promise<VerifyResult> {
  const result: VerifyResult = { source: days.size, same: 0, different: 0, missing: 0, differentDates: [], missingDates: [] };
  const months = new Map<string, MonthDoc | null>();
  for (const [dateKey, converted] of days) {
    const parts = splitDateKey(dateKey);
    if (!parts) {
      result.missing++;
      result.missingDates.push(dateKey);
      continue;
    }
    if (!months.has(parts.monthId)) months.set(parts.monthId, await store.getMonth(parts.monthId));
    const cloud = months.get(parts.monthId)?.days[parts.day];
    if (!cloud) {
      result.missing++;
      result.missingDates.push(dateKey);
    } else if (cloud.text === converted.value.text && cloud.color === converted.value.color) {
      result.same++;
    } else {
      result.different++;
      result.differentDates.push(dateKey);
    }
  }
  result.differentDates.sort();
  result.missingDates.sort();
  return result;
}
