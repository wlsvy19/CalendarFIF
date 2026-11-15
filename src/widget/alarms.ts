import { ADVANCE_LABELS, allAlarmTriggers, type EventMap } from '../core/events';
import type { Host, NotificationLike } from './host';

// 알림 문서의 울릴 때를 아이폰 알림으로 예약한다. iOS는 앱마다 예약을 64개까지 쥐므로 우리 것은 48개까지만 둔다.

export const NOTIFY_PREFIX = 'calfif:';
const TITLE = 'CalendarFIF 알림';
const THREAD = 'calfif-alarm';
const WINDOW_DAYS = 7;
const DEFAULT_LIMIT = 48;

export type PlannedNotice = { id: string; title: string; body: string; at: Date; openURL: string };

/** now부터 7일 안에 울릴 것을 가까운 순으로 limit개까지. */
export function planNotices(items: EventMap, now: Date, appUrl: string, limit: number = DEFAULT_LIMIT): PlannedNotice[] {
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + WINDOW_DAYS, now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
  const base = appUrl.replace(/\/+$/, '');
  return allAlarmTriggers(items, now, to).slice(0, Math.max(0, limit)).map((t) => ({
    id: `${NOTIFY_PREFIX}${t.key}`,
    title: TITLE,
    body: `${t.advance > 0 ? `${ADVANCE_LABELS[t.advance] ?? `${t.advance}일 전`} · ` : ''}${t.time} ${t.text}`,
    at: t.at,
    openURL: `${base}/#${t.occurrence}`,
  }));
}

/** 이미 예약된 이름들과 견준다. 우리 것(NOTIFY_PREFIX)만 지운다. */
export function reconcile(planned: PlannedNotice[], pendingIds: string[]): { remove: string[]; add: PlannedNotice[] } {
  const want = new Set(planned.map((p) => p.id));
  const have = new Set(pendingIds);
  return {
    remove: pendingIds.filter((id) => id.startsWith(NOTIFY_PREFIX) && !want.has(id)),
    add: planned.filter((p) => !have.has(p.id)),
  };
}

/** 예약돼 있는 것이 계획과 같은 시각과 글인가. 알 수 없는 값이면 같다고 본다(불필요한 다시 예약을 피한다). */
function sameAsPlanned(n: NotificationLike, p: PlannedNotice): boolean {
  const at = n.nextTriggerDate;
  if (at instanceof Date && at.getTime() !== p.at.getTime()) return false;
  return n.body === p.body || n.body === undefined;
}

/** 지금 아이폰에 예약돼 있는 우리 알림의 수와 가장 먼저 울릴 것. */
export type AlarmStatus = { count: number; next: { at: Date; body: string } | null };

/** 예약한 뒤 실제로 아이폰에 남았는지 다시 읽는다. 알림이 꺼져 있으면 예약이 오류 없이 사라질 수 있어서다. 읽지 못하면 null. 던지지 않는다. */
export async function pendingStatus(host: Host): Promise<AlarmStatus | null> {
  try {
    const ours = (await host.Notification.allPending()).filter((n) => n.identifier.startsWith(NOTIFY_PREFIX));
    let next: AlarmStatus['next'] = null;
    for (const n of ours) {
      const at = n.nextTriggerDate;
      if (at instanceof Date && (next === null || at.getTime() < next.at.getTime())) next = { at, body: n.body ?? '' };
    }
    return { count: ours.length, next };
  } catch {
    return null;
  }
}

/** 시험 알림의 이름. NOTIFY_PREFIX로 시작하지 않아 예약 고르기가 지우지 않는다. */
export const TEST_ID = 'calfif-test';
export const TEST_DELAY_MS = 60_000;

/** 시험 알림의 결과: 아이폰에 남았다 / 남지 않았다(또는 예약이 거절됐다) / 예약은 됐는데 남았는지 읽지 못했다. */
export type TestResult = 'ok' | 'missing' | 'unknown';

/** 1분 뒤에 울리는 시험 알림을 예약하고, 아이폰에 남았는지 확인한다. 던지지 않는다. */
export async function scheduleTest(host: Host, now: Date): Promise<TestResult> {
  try {
    const n = new host.Notification();
    n.identifier = TEST_ID;
    n.title = 'CalendarFIF 시험 알림';
    n.body = '이 알림이 보이면 아이폰 알림이 제대로 옵니다.';
    n.sound = 'alert';
    n.threadIdentifier = THREAD;
    n.setTriggerDate(new Date(now.getTime() + TEST_DELAY_MS));
    await n.schedule();
  } catch {
    return 'missing';
  }
  try {
    return (await host.Notification.allPending()).some((p) => p.identifier === TEST_ID) ? 'ok' : 'missing';
  } catch {
    return 'unknown';
  }
}

/** 우리가 예약한 알림(NOTIFY_PREFIX)을 모두 지운다. 로그아웃하거나 읽기 권한이 없어졌을 때 쓴다. 던지지 않는다. */
export async function clearAlarms(host: Host): Promise<void> {
  try {
    const pending = await host.Notification.allPending();
    const ours = pending.map((n) => n.identifier).filter((id) => id.startsWith(NOTIFY_PREFIX));
    if (ours.length > 0) await host.Notification.removePending(ours);
  } catch {
    // 못 지워도 로그아웃은 끝난다.
  }
}

/**
 * 계획에 맞춰 예약을 고른다: 계획에서 빠진 우리 예약은 지우고, 없는 것은 더한다. 시각이나 글이 바뀐 것은 같은 이름으로 다시 예약한다.
 * 돌려주는 값은 그 뒤의 우리 예약 수, 예약하지 못했으면 null(0개로 속이지 않는다). 어떤 문제가 나도 던지지 않는다(위젯 그리기를 막지 않는다).
 */
export async function scheduleAlarms(host: Host, items: EventMap, now: Date, appUrl: string): Promise<number | null> {
  try {
    const planned = planNotices(items, now, appUrl);
    const byId = new Map(planned.map((p) => [p.id, p]));
    const pending = await host.Notification.allPending();
    // 바뀐 것은 "예약돼 있지 않은 것"으로 넘겨 reconcile이 다시 더하게 한다(같은 이름의 예약은 새 것으로 바뀐다).
    const pendingIds = pending.filter((n) => {
      const p = byId.get(n.identifier);
      return !p || sameAsPlanned(n, p);
    }).map((n) => n.identifier);
    const { remove, add } = reconcile(planned, pendingIds);
    let kept = pendingIds.filter((id) => byId.has(id)).length;
    if (remove.length > 0) {
      try {
        await host.Notification.removePending(remove);
      } catch {
        // 못 지운 것은 다음 실행에서 다시 지운다.
      }
    }
    for (const p of add) {
      try {
        const n = new host.Notification();
        n.identifier = p.id;
        n.title = p.title;
        n.body = p.body;
        n.sound = 'alert';
        n.threadIdentifier = THREAD;
        n.openURL = p.openURL;
        n.setTriggerDate(p.at);
        await n.schedule();
        kept += 1;
      } catch {
        // 하나가 안 돼도 나머지는 예약한다.
      }
    }
    return add.length > 0 && kept === pendingIds.filter((id) => byId.has(id)).length ? null : kept;
  } catch {
    return null;
  }
}
