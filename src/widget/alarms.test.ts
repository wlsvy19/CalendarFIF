import { describe, expect, it } from 'vitest';
import type { AlarmRecord, EventMap } from '../core/events';
import { NOTIFY_PREFIX, TEST_ID, clearAlarms, pendingStatus, planNotices, reconcile, scheduleAlarms, scheduleTest } from './alarms';
import { makeFakeHost } from './fakeHost';

const URL = 'https://example.test';
const now = new Date(2026, 10, 15, 9, 0, 0);
const alarm = (over: Partial<AlarmRecord> = {}): AlarmRecord => ({
  type: 'alarm', date: '2026-11-20', text: '회의', done: false, repeat: { freq: 'none' }, time: '09:30', advance: [0], editedAt: 1, editedBy: 'u', ...over,
});

describe('planNotices', () => {
  it('앞으로 7일의 울릴 때를 가까운 순으로 48개까지', () => {
    const items: EventMap = { later: alarm({ date: '2026-11-21', text: '나중' }), soon: alarm({ date: '2026-11-16', text: '먼저', advance: [1] }), far: alarm({ date: '2026-12-30' }) };
    const plan = planNotices(items, now, URL);
    expect(plan.map((p) => p.id)).toEqual([`${NOTIFY_PREFIX}soon@2026-11-16@1`, `${NOTIFY_PREFIX}later@2026-11-21@0`]);
    expect(plan[0]).toMatchObject({ title: 'CalendarFIF 알림', body: '하루 전 · 09:30 먼저', openURL: `${URL}/#2026-11-16` });
    expect(plan[1].body).toBe('09:30 나중');
    expect(plan[1].at).toEqual(new Date(2026, 10, 21, 9, 30));
    const many: EventMap = {};
    for (let i = 0; i < 60; i += 1) many[`a${i}`] = alarm({ date: '2026-11-16', time: `10:${String(i).padStart(2, '0')}` });
    expect(planNotices(many, now, URL)).toHaveLength(48);
    expect(planNotices(many, now, URL, 5)).toHaveLength(5);
  });

  it('완료한 것과 지난 것은 없다', () => {
    const items: EventMap = { done: alarm({ done: true }), past: alarm({ date: '2026-11-14' }), todayPast: alarm({ date: '2026-11-15', time: '08:00' }) };
    expect(planNotices(items, now, URL)).toEqual([]);
  });
});

describe('reconcile', () => {
  it('reconcile은 우리 것만 지우고 없는 것만 더한다', () => {
    const mk = (id: string) => ({ id, title: 't', body: 'b', at: now, openURL: 'u' });
    const out = reconcile([mk('calfif:a'), mk('calfif:b')], ['calfif:a', 'calfif:old', 'other:x']);
    expect(out.remove).toEqual(['calfif:old']);
    expect(out.add.map((p) => p.id)).toEqual(['calfif:b']);
  });
});

describe('scheduleAlarms', () => {
  it('scheduleAlarms는 가짜 Notification으로 지우고 예약한다', async () => {
    const items: EventMap = { x: alarm({ date: '2026-11-16' }), y: alarm({ date: '2026-11-17', text: '둘째' }) };
    const host = makeFakeHost({ pending: [{ identifier: `${NOTIFY_PREFIX}gone@2026-11-16@0` }, { identifier: 'other:keep' }] });
    expect(await scheduleAlarms(host, items, now, URL)).toBe(2);
    expect(host.state.removed).toEqual([`${NOTIFY_PREFIX}gone@2026-11-16@0`]);
    expect(host.state.scheduled.map((n) => n.identifier)).toEqual([`${NOTIFY_PREFIX}x@2026-11-16@0`, `${NOTIFY_PREFIX}y@2026-11-17@0`]);
    expect(host.state.scheduled[0]).toMatchObject({ title: 'CalendarFIF 알림', sound: 'alert', threadIdentifier: 'calfif-alarm', openURL: `${URL}/#2026-11-16`, at: new Date(2026, 10, 16, 9, 30) });
    // 다시 부르면 그대로라 더 하지 않는다.
    expect(await scheduleAlarms(host, items, now, URL)).toBe(2);
    expect(host.state.scheduled).toHaveLength(2);
    expect(host.state.pending.map((n) => n.identifier)).toContain('other:keep');
  });

  it('시각이나 글이 바뀐 것은 같은 이름으로 다시 예약한다', async () => {
    const items: EventMap = { x: alarm({ date: '2026-11-16', time: '10:00' }) };
    const host = makeFakeHost({ pending: [{ identifier: `${NOTIFY_PREFIX}x@2026-11-16@0`, body: '09:30 회의', at: new Date(2026, 10, 16, 9, 30) }] });
    expect(await scheduleAlarms(host, items, now, URL)).toBe(1);
    expect(host.state.scheduled).toHaveLength(1);
    expect(host.state.scheduled[0].at).toEqual(new Date(2026, 10, 16, 10, 0));
  });

  it('예약이 던져도 던지지 않는다', async () => {
    const host = makeFakeHost({ failNotifications: true });
    await expect(scheduleAlarms(host, { x: alarm({ date: '2026-11-16' }) }, now, URL)).resolves.toBeNull();
  });
});

describe('clearAlarms', () => {
  it('우리 예약만 모두 지우고 던지지 않는다', async () => {
    const host = makeFakeHost({ pending: [{ identifier: `${NOTIFY_PREFIX}a@2026-11-16@0` }, { identifier: `${NOTIFY_PREFIX}b@2026-11-17@1` }, { identifier: 'other:keep' }] });
    await clearAlarms(host);
    expect(host.state.pending.map((n) => n.identifier)).toEqual(['other:keep']);
    await expect(clearAlarms(makeFakeHost({ failNotifications: true }))).resolves.toBeUndefined();
  });
});

describe('pendingStatus', () => {
  it('우리 예약의 수와 가장 먼저 울릴 것을 돌려주고, 다른 것과 시험 알림은 세지 않는다', async () => {
    const host = makeFakeHost({ pending: [
      { identifier: `${NOTIFY_PREFIX}b@2026-11-17@0`, body: '09:30 나중', at: new Date(2026, 10, 17, 9, 30) },
      { identifier: `${NOTIFY_PREFIX}a@2026-11-16@0`, body: '08:00 먼저', at: new Date(2026, 10, 16, 8, 0) },
      { identifier: 'other:keep', body: '남의 것', at: new Date(2026, 10, 15, 10, 0) },
      { identifier: TEST_ID, body: '시험', at: new Date(2026, 10, 15, 9, 1) },
    ] });
    await expect(pendingStatus(host)).resolves.toEqual({ count: 2, next: { at: new Date(2026, 10, 16, 8, 0), body: '08:00 먼저' } });
  });

  it('없으면 0개, 읽지 못하면 null', async () => {
    await expect(pendingStatus(makeFakeHost())).resolves.toEqual({ count: 0, next: null });
    await expect(pendingStatus(makeFakeHost({ failNotifications: true }))).resolves.toBeNull();
  });
});

describe('scheduleTest', () => {
  it('1분 뒤의 시험 알림을 예약하고 남았는지 본다', async () => {
    const host = makeFakeHost();
    await expect(scheduleTest(host, now)).resolves.toBe('ok');
    expect(host.state.pending.map((n) => [n.identifier, n.at])).toEqual([[TEST_ID, new Date(now.getTime() + 60_000)]]);
    await expect(scheduleTest(makeFakeHost({ silentNotifications: true }), now)).resolves.toBe('missing');
    await expect(scheduleTest(makeFakeHost({ failNotifications: true }), now)).resolves.toBe('missing');
    // 예약은 됐는데 다시 읽지 못했다: 못 했다고 하지 않는다.
    const unread = makeFakeHost();
    unread.Notification.allPending = async () => { throw new Error('시험 오류'); };
    await expect(scheduleTest(unread, now)).resolves.toBe('unknown');
    expect(unread.state.pending.map((n) => n.identifier)).toEqual([TEST_ID]);
  });
});
