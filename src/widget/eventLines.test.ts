import { describe, expect, it } from 'vitest';
import type { EventMap } from '../core/events';
import { parseEventMap } from '../core/events';
import { ALARM_MARK, COUNTDOWN_MARK, withEventLines } from './eventLines';
import type { MonthData } from './scene';
import { memoLines } from './text';

/** 알림 하나. 모양은 core/events가 읽는 그대로다(parseEventMap을 거쳐 틀리면 시험이 알려 준다). */
const alarm = (date: string, time: string, text: string, more: Record<string, unknown> = {}) => ({
  type: 'alarm', date, time, text, repeat: { freq: 'none' }, advance: [0], done: false, editedAt: 1, editedBy: 'web', ...more,
});
const countdown = (date: string, text: string, more: Record<string, unknown> = {}) => ({
  type: 'countdown', date, text, kind: 'basic', repeat: { freq: 'none' }, done: false, editedAt: 1, editedBy: 'web', ...more,
});
const items = (raw: Record<string, unknown>): EventMap => {
  const parsed = parseEventMap(raw);
  expect(Object.keys(parsed).sort()).toEqual(Object.keys(raw).sort());
  return parsed;
};
const month = (days: MonthData['days'] = {}): MonthData => ({ monthId: '2026-11', days });

describe('withEventLines', () => {
  it('종과 모래시계는 그림 글자다', () => {
    expect([ALARM_MARK, COUNTDOWN_MARK]).toEqual(['🔔', '⏳']);
  });

  it('그날의 알림을 "종 시각 글"로 메모 앞줄에 끼워 넣는다. 메모와 색은 그대로다', () => {
    const before = month({ '18': { text: '장보기\n[+]세탁', color: 'F12424' } });
    const after = withEventLines(before, items({ evaaaaaaaaaaaaaaaa: alarm('2026-11-18', '08:45', '약 먹기') }));
    expect(after.days['18']).toEqual({ text: '🔔 08:45 약 먹기\n장보기\n[+]세탁', color: 'F12424' });
    // 위젯이 그리는 줄로 읽으면 알림이 맨 앞이다.
    expect(memoLines(after.days['18'].text)).toEqual([{ text: '🔔 08:45 약 먹기', done: false }, { text: '장보기', done: false }, { text: '세탁', done: true }]);
    // 받은 달은 바꾸지 않는다.
    expect(before.days['18'].text).toBe('장보기\n[+]세탁');
  });

  it('메모가 없던 날에도 생긴다(색 없는 날). 알림은 시각 차례, 그다음 카운트다운(모래시계)', () => {
    const after = withEventLines(month(), items({
      evaaaaaaaaaaaaaaaa: alarm('2026-11-20', '17:00', '본부 회의'),
      evbbbbbbbbbbbbbbbb: alarm('2026-11-20', '09:00', '출근'),
      evcccccccccccccccc: countdown('2026-11-20', '시험'),
    }));
    expect(after.days['20']).toEqual({ text: '🔔 09:00 출근\n🔔 17:00 본부 회의\n⏳ 시험', color: '' });
    expect(Object.keys(after.days)).toEqual(['20']);
  });

  it('끝낸 것은 완료 줄로, 줄바꿈은 빈칸으로 적는다', () => {
    const after = withEventLines(month(), items({
      evaaaaaaaaaaaaaaaa: alarm('2026-11-05', '07:00', '운동', { done: true }),
      evcccccccccccccccc: alarm('2026-11-05', '09:00', '첫 줄\n둘째 줄'),
    }));
    expect(memoLines(after.days['05'].text)).toEqual([
      { text: '🔔 07:00 운동', done: true },
      { text: '🔔 09:00 첫 줄 둘째 줄', done: false },
    ]);
  });

  it('끝내지 않은 카운트다운의 글이 완료 표시로 시작해도 완료 줄로 읽히지 않는다', () => {
    const after = withEventLines(month(), items({ evaaaaaaaaaaaaaaaa: countdown('2026-11-07', '[+]표시로 시작하는 글') }));
    expect(memoLines(after.days['07'].text).map((l) => l.done)).toEqual([false]);
  });

  it('반복하는 알림은 그 달에 걸리는 날마다 나온다. 다른 달의 것은 나오지 않는다', () => {
    const after = withEventLines(month(), items({
      evaaaaaaaaaaaaaaaa: alarm('2026-11-02', '10:00', '주간 회의', { repeat: { freq: 'weekly' } }),
      evbbbbbbbbbbbbbbbb: alarm('2026-12-01', '10:00', '다음 달'),
      evcccccccccccccccc: alarm('2026-10-31', '10:00', '지난달'),
    }));
    expect(Object.keys(after.days).sort()).toEqual(['02', '09', '16', '23', '30']);
    expect(after.days['30'].text).toBe('🔔 10:00 주간 회의');
  });

  it('넣을 것이 없으면 받은 달을 그대로 돌려준다. 달의 번호가 이상해도 던지지 않는다', () => {
    const before = month({ '18': { text: '장보기', color: '' } });
    expect(withEventLines(before, {})).toBe(before);
    expect(withEventLines(before, items({ evaaaaaaaaaaaaaaaa: alarm('2027-01-01', '10:00', '내년') }))).toBe(before);
    const odd: MonthData = { monthId: '이상한 달', days: {} };
    expect(withEventLines(odd, items({ evaaaaaaaaaaaaaaaa: alarm('2026-11-18', '10:00', '글') }))).toBe(odd);
  });
});
