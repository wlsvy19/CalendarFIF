import { describe, expect, it } from 'vitest';
import type { AlarmRecord, EventMap } from '../core/events';
import { newDeviceId, parsePushDoc, senderAlive, type PushDoc } from './doc';
import { TEST_BODY, TEST_TITLE, alarmText, fcmMessage, planSends, type UserData } from './plan';

const alarm = (over: Partial<AlarmRecord> = {}): AlarmRecord => ({
  type: 'alarm', date: '2026-11-15', text: '회의', done: false, repeat: { freq: 'none' }, time: '17:48', advance: [0], editedAt: 1, editedBy: 'u', ...over,
});
const D1 = 'AAAAAAAAAAAAAAAAAAAA';
const D2 = 'BBBBBBBBBBBBBBBBBBBB';
const push = (over: Partial<PushDoc> = {}): PushDoc => ({ devices: { [D1]: { token: 't1', label: '아이폰', at: 1 } }, testAt: 0, sender: null, ...over });
const user = (events: EventMap, p: PushDoc = push()): UserData => ({ uid: 'u1', events, push: p });
const at = (h: number, m: number, s = 0) => new Date(2026, 10, 15, h, m, s);

describe('parsePushDoc', () => {
  it('맞는 기기만 남기고 모르는 값은 기본으로', () => {
    expect(parsePushDoc({
      devices: { [D1]: { token: 't', label: '아이폰', at: 5 }, short: { token: 't' }, [D2]: { token: '' } },
      testAt: 7,
      sender: { at: 9, testAt: 7, error: 'x' },
    })).toEqual({ devices: { [D1]: { token: 't', label: '아이폰', at: 5 } }, testAt: 7, sender: { at: 9, testAt: 7, error: 'x' } });
    expect(parsePushDoc(null)).toEqual({ devices: {}, testAt: 0, sender: null });
  });

  it('기기 이름은 영문과 숫자 20자', () => {
    const id = newDeviceId();
    expect(id).toMatch(/^[A-Za-z0-9]{20}$/);
  });

  it('보내는 쪽이 15분 안에 확인했고 문제가 없으면 살아 있다', () => {
    const now = at(18, 0).getTime();
    expect(senderAlive(push({ sender: { at: now - 60_000, testAt: 0, error: '' } }), now)).toBe(true);
    expect(senderAlive(push({ sender: { at: now - 16 * 60_000, testAt: 0, error: '' } }), now)).toBe(false);
    expect(senderAlive(push({ sender: { at: now - 60_000, testAt: 0, error: 'FCM 403' } }), now)).toBe(false);
    expect(senderAlive(push(), now)).toBe(false);
    expect(senderAlive(null, now)).toBe(false);
  });
});

describe('planSends', () => {
  it('구간 안에 울릴 알림을 기기마다 하나씩', () => {
    const u = user({ a: alarm(), b: alarm({ time: '18:30', text: '나중' }) }, push({ devices: { [D1]: { token: 't1', label: '', at: 1 }, [D2]: { token: 't2', label: '', at: 1 } } }));
    const { sends, tests } = planSends([u], at(17, 47, 30), at(17, 48, 30), at(17, 47, 30).getTime());
    expect(tests).toEqual([]);
    expect(sends.map((s) => [s.deviceId, s.token, s.title, s.body, s.url, s.tag, s.at])).toEqual([
      [D1, 't1', '회의', '17:48 알림', '/#2026-11-15', 'calfif:a@2026-11-15@0', at(17, 48).getTime()],
      [D2, 't2', '회의', '17:48 알림', '/#2026-11-15', 'calfif:a@2026-11-15@0', at(17, 48).getTime()],
    ]);
  });

  it('기기가 없거나 완료한 알림은 보내지 않는다', () => {
    expect(planSends([user({ a: alarm() }, push({ devices: {} }))], at(17, 0), at(18, 0), at(17, 0).getTime()).sends).toEqual([]);
    expect(planSends([user({ a: alarm({ done: true }) })], at(17, 0), at(18, 0), at(17, 0).getTime()).sends).toEqual([]);
  });

  it('미리 알림은 그 날짜를 본문에 적는다', () => {
    const { sends } = planSends([user({ a: alarm({ date: '2026-11-16', advance: [1] }) })], at(17, 0), at(18, 0), at(17, 0).getTime());
    expect(sends.map((s) => [s.title, s.body, s.url])).toEqual([['회의', '하루 전 알림 · 11월 16일 (월) 17:48', '/#2026-11-16']]);
  });

  it('처리하지 않은 시험 요청은 모든 기기로 보내고, 처리했거나 오래된 것은 보내지 않는다', () => {
    const now = at(18, 0).getTime();
    const fresh = planSends([user({}, push({ testAt: now - 5_000 }))], at(17, 59), at(18, 1), now);
    expect(fresh.tests).toEqual([{ uid: 'u1', testAt: now - 5_000 }]);
    expect(fresh.sends.map((s) => [s.title, s.body, s.url, s.at])).toEqual([[TEST_TITLE, TEST_BODY, '/', now - 5_000]]);
    expect(planSends([user({}, push({ testAt: now - 5_000, sender: { at: now, testAt: now - 5_000, error: '' } }))], at(17, 59), at(18, 1), now).sends).toEqual([]);
    expect(planSends([user({}, push({ testAt: now - 11 * 60_000 }))], at(17, 59), at(18, 1), now).sends).toEqual([]);
  });

  it('FCM 메시지는 data만 담고 서두르라고 한다', () => {
    const [s] = planSends([user({ a: alarm() })], at(17, 0), at(18, 0), at(17, 0).getTime()).sends;
    expect(fcmMessage(s)).toEqual({
      message: { token: 't1', webpush: { headers: { Urgency: 'high', TTL: '1800' }, data: { title: '회의', body: '17:48 알림', url: '/#2026-11-15', tag: 'calfif:a@2026-11-15@0' } } },
    });
  });

  it('alarmText', () => {
    expect(alarmText({ text: '약', time: '09:00', advance: 0, occurrence: '2026-11-20' })).toEqual({ title: '약', body: '09:00 알림' });
    expect(alarmText({ text: '약', time: '09:00', advance: 7, occurrence: '2026-11-20' })).toEqual({ title: '약', body: '일주일 전 알림 · 11월 20일 (금) 09:00' });
  });
});
