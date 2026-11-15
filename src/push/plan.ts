import { ADVANCE_LABELS, allAlarmTriggers, type EventMap } from '../core/events';
import type { PushDoc } from './doc';

// 보낼 푸시를 고른다. Apps Script도 웹앱도 아닌 순수한 계산이라 시험으로 확인한다.

export type UserData = { uid: string; events: EventMap; push: PushDoc };
export type Outgoing = {
  uid: string;
  deviceId: string;
  token: string;
  title: string;
  body: string;
  /** 알림을 누르면 열 주소(웹앱 안의 경로, 예: /#2026-11-16). 서비스 워커가 웹앱의 주소에 붙인다. */
  url: string;
  /** 같은 알림이 두 번 와도 하나로 보이게 하는 이름. */
  tag: string;
  /** 울릴 때(밀리초). 시험 알림은 요청한 때(지금보다 늦으면 지금). */
  at: number;
};

export const TEST_TITLE = 'CalendarFIF 시험 알림';
export const TEST_BODY = '이 알림이 보이면 아이폰 알림이 제대로 옵니다.';
/** 시험 요청이 이보다 오래됐으면 보내지 않는다(보내는 쪽을 늦게 설치했을 때 옛 요청으로 울리지 않게). */
export const TEST_FRESH_MS = 10 * 60_000;

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

/** 알림의 글: 제목은 적은 글, 본문은 시각(과 미리 알림이면 그 날짜). */
export function alarmText(t: { text: string; time: string; advance: number; occurrence: string }): { title: string; body: string } {
  if (t.advance <= 0) return { title: t.text, body: `${t.time} 알림` };
  const [y, m, d] = t.occurrence.split('-').map(Number);
  const day = `${m}월 ${d}일 (${WEEKDAYS[new Date(y, m - 1, d).getDay()]})`;
  return { title: t.text, body: `${ADVANCE_LABELS[t.advance] ?? `${t.advance}일 전`} 알림 · ${day} ${t.time}` };
}

/**
 * [from, to)에 울릴 알림과 아직 처리하지 않은 시험 요청을 기기마다의 보낼 것으로 만든다. 기기가 없는 사람은 건너뛴다.
 * tests에는 시험 요청을 처리한 사람과 그 요청의 때를 돌려준다(보낸 뒤 sender.testAt에 적는다).
 */
export function planSends(users: UserData[], from: Date, to: Date, now: number): { sends: Outgoing[]; tests: Array<{ uid: string; testAt: number }> } {
  const sends: Outgoing[] = [];
  const tests: Array<{ uid: string; testAt: number }> = [];
  for (const u of users) {
    const devices = Object.entries(u.push.devices);
    if (devices.length === 0) continue;
    for (const t of allAlarmTriggers(u.events, from, to)) {
      const { title, body } = alarmText(t);
      for (const [deviceId, d] of devices) {
        sends.push({ uid: u.uid, deviceId, token: d.token, title, body, url: `/#${t.occurrence}`, tag: `calfif:${t.key}`, at: t.at.getTime() });
      }
    }
    const handled = u.push.sender?.testAt ?? 0;
    if (u.push.testAt > handled && now - u.push.testAt < TEST_FRESH_MS && u.push.testAt <= now + 60_000) {
      tests.push({ uid: u.uid, testAt: u.push.testAt });
      for (const [deviceId, d] of devices) {
        sends.push({ uid: u.uid, deviceId, token: d.token, title: TEST_TITLE, body: TEST_BODY, url: '/', tag: `calfif-test:${u.push.testAt}`, at: Math.min(u.push.testAt, now) });
      }
    }
  }
  sends.sort((a, b) => a.at - b.at);
  return { sends, tests };
}

/** FCM HTTP v1로 보낼 메시지. 알림은 웹앱의 서비스 워커가 data를 읽어 띄운다(아이폰은 받은 푸시마다 알림을 보여야 한다). */
export function fcmMessage(o: Outgoing): unknown {
  return {
    message: {
      token: o.token,
      webpush: {
        headers: { Urgency: 'high', TTL: '1800' },
        data: { title: o.title, body: o.body, url: o.url, tag: o.tag },
      },
    },
  };
}
