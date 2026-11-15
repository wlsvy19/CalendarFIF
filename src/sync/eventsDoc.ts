import { parseEventMap, type EventMap, type EventRecord } from '../core/events';

// 알림과 카운트다운 문서(users/{uid}/data/events)의 순수 도우미. Firebase를 모른다.

export type EventChange = EventRecord | 'delete';

export function parseEventsDoc(data: unknown): EventMap {
  if (typeof data !== 'object' || data === null) return {};
  return parseEventMap((data as { items?: unknown }).items);
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
    items[id] = c === 'delete' ? sentinels.deleteField() : c;
    fields.push(['items', id]);
  }
  fields.push(['updatedAt']);
  return { data: { items, updatedAt: sentinels.serverTimestamp() }, fields };
}
