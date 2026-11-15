import { parseEventMap, type EventMap, type EventRecord } from '../core/events';

// 알림과 카운트다운 문서(users/{uid}/data/events)의 순수 도우미. Firebase를 모른다.

export type EventChange = EventRecord | 'delete';

/**
 * 보낼 변경 하나. editedAt은 고친 때(저장은 그 기록의 editedAt과 같다).
 * wasNew는 이 기기에서 새로 만들어 서버에 없던 항목의 저장인가. 서버에 있던 항목을 고친 저장과 삭제는 false.
 */
export type PendingChange = { change: EventChange; editedAt: number; wasNew: boolean };
/** 트랜잭션이 쓴 항목과, 서버의 값이 이기거나 할 일이 없어서 쓰지 않은 항목. */
export type EventsWriteResult = { written: string[]; dropped: string[] };

export function parseEventsDoc(data: unknown): EventMap {
  if (typeof data !== 'object' || data === null) return {};
  return parseEventMap((data as { items?: unknown }).items);
}

/**
 * 트랜잭션 안에서 서버의 지금 항목들을 보고 보낼 변경 가운데 무엇을 쓸지 정한다.
 * - 서버의 그 항목이 변경보다 새것이면(editedAt이 크면) 쓰지 않는다: 다른 기기의 새 편집이 이긴다.
 * - 서버에 있던 항목을 고친 저장(wasNew false)인데 서버에 그 항목이 없으면 쓰지 않는다: 다른 곳의 삭제가 이긴다.
 * - 서버에 같은 때의 저장이 이미 있거나(앞의 보내기가 닿았다) 이미 없는 항목을 지우는 것은 할 일이 없다.
 */
export function decideEventsWrite(
  server: EventMap,
  pending: Record<string, PendingChange>,
): { changes: Record<string, EventChange>; result: EventsWriteResult } {
  const changes: Record<string, EventChange> = {};
  const result: EventsWriteResult = { written: [], dropped: [] };
  for (const [id, p] of Object.entries(pending)) {
    const s = server[id];
    const lose = p.change === 'delete'
      ? s === undefined || s.editedAt > p.editedAt
      : s === undefined ? !p.wasNew : s.editedAt >= p.editedAt;
    if (lose) {
      result.dropped.push(id);
      continue;
    }
    changes[id] = p.change;
    result.written.push(id);
  }
  return { changes, result };
}

/**
 * 바뀐 항목마다 mergeFields 경로 하나를 만든다. 항목 하나를 통째로 바꾸므로 지운 칸(반복 끝 같은 것)이 남지 않는다.
 * 삭제는 deleteField. 바꿀 것이 없으면 null.
 */
export function buildEventsWrite(
  changes: Record<string, EventChange>,
  sentinels: { deleteField(): unknown; serverTimestamp(): unknown },
): { data: { items: Record<string, unknown>; updatedAt: unknown }; fields: string[][] } | null {
  const ids = Object.keys(changes);
  if (ids.length === 0) return null;
  const items: Record<string, unknown> = {};
  const fields: string[][] = [];
  for (const id of ids) {
    const c = changes[id];
    items[id] = c === 'delete' ? sentinels.deleteField() : stripUndefined(c);
    fields.push(['items', id]);
  }
  fields.push(['updatedAt']);
  return { data: { items, updatedAt: sentinels.serverTimestamp() }, fields };
}

/** undefined 칸을 뺀다(Firestore가 거절한다). 안쪽 객체와 배열도 같다. */
function stripUndefined(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripUndefined);
  if (typeof v === 'object' && v !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) if (x !== undefined) out[k] = stripUndefined(x);
    return out;
  }
  return v;
}
