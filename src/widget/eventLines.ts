/**
 * 알림과 카운트다운을 위젯의 날짜 칸에 보이게 한다.
 * 위젯은 날마다 메모의 줄들을 그린다(tree.ts, scene.ts). 알림과 카운트다운은 달 문서가 아니라 따로 있는 문서에 있어서
 * (users/{uid}/data/events) 2026-11-17까지는 위젯에 나오지 않았다(읽기는 했다: 아이폰 알림을 예약하려고).
 * 여기서는 그날의 알림과 카운트다운을 메모의 앞줄들로 끼워 넣은 달을 만든다. 웹앱의 칸과 같은 차례다(알림이 시각 차례로, 그다음 카운트다운, 그다음 메모).
 * 웹앱의 칸처럼 알림 앞에는 종을, 카운트다운 앞에는 모래시계를 붙인다(2026-11-18 사용자: "위젯에서 알람 종모양 이 안보여").
 * 위젯의 줄은 글자뿐이라 그림 글자를 쓴다.
 */
import { DONE_MARK } from '../core/text';
import { eventsByDate, type EventMap } from '../core/events';
import type { DayValue } from '../core/types';
import type { MonthData } from './scene';

/** 알림 줄 앞의 종과 카운트다운 줄 앞의 모래시계. */
export const ALARM_MARK = '\u{1F514}';
export const COUNTDOWN_MARK = '⏳';

/** 그 달의 마지막 날('YYYY-MM-DD'). */
function lastDayOf(monthId: string): string {
  const year = Number(monthId.slice(0, 4));
  const month = Number(monthId.slice(5, 7));
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${monthId}-${String(last).padStart(2, '0')}`;
}

/**
 * 한 줄로 만든다: 알림은 "종 시각 글", 카운트다운은 "모래시계 글". 줄바꿈은 빈칸으로 바꾼다(한 항목이 한 줄이다).
 * 끝낸 것은 메모의 완료 표시를 붙인다. 줄이 그림으로 시작하므로, 글이 완료 표시로 시작해도 완료 줄로 읽히지 않는다.
 */
function lineOf(mark: string, time: string, text: string, done: boolean): string {
  const flat = text.replace(/\s*\n\s*/g, ' ').trim();
  const body = time !== '' ? (flat === '' ? time : `${time} ${flat}`) : flat;
  if (body === '') return '';
  const line = `${mark} ${body}`;
  return done ? DONE_MARK + line : line;
}

/**
 * month의 날마다 그날의 알림과 카운트다운을 메모 앞에 끼워 넣은 달을 돌려준다. month는 바꾸지 않는다.
 * 넣을 것이 없으면 month를 그대로 돌려준다. 메모가 없던 날은 색 없는 날로 생긴다.
 */
export function withEventLines(month: MonthData, items: EventMap): MonthData {
  const days = daysWithEvents(month.monthId, month.days, items);
  let others = month.others;
  // 위젯에 칸이 보이는 다른 달(앞뒤 며칠)에도 끼워 넣는다: 웹앱의 칸이 그 날짜에도 알림을 보인다.
  if (others) {
    let otherChanged = false;
    const next: Record<string, Record<string, DayValue>> = {};
    for (const [monthId, d] of Object.entries(others)) {
      next[monthId] = daysWithEvents(monthId, d, items);
      if (next[monthId] !== d) otherChanged = true;
    }
    if (otherChanged) others = next;
  }
  if (days === month.days && others === month.others) return month;
  return others ? { monthId: month.monthId, days, others } : { monthId: month.monthId, days };
}

/** 그 달의 days에 알림과 카운트다운 줄을 끼워 넣은 것. 넣을 것이 없으면 받은 것 그대로다. */
function daysWithEvents(monthId: string, source: Record<string, DayValue>, items: EventMap): Record<string, DayValue> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthId)) return source;
  let byDate: ReturnType<typeof eventsByDate>;
  try {
    byDate = eventsByDate(items, `${monthId}-01`, lastDayOf(monthId));
  } catch {
    return source;
  }
  if (byDate.size === 0) return source;
  const days = { ...source };
  let changed = false;
  for (const [dateKey, lines] of byDate) {
    const texts = lines
      .map((l) => (l.type === 'alarm' ? lineOf(ALARM_MARK, l.time, l.text, l.done) : lineOf(COUNTDOWN_MARK, '', l.text, l.done)))
      .filter((t) => t !== '');
    if (texts.length === 0) continue;
    const day = dateKey.slice(8, 10);
    const had = days[day];
    days[day] = { text: had && had.text !== '' ? `${texts.join('\n')}\n${had.text}` : texts.join('\n'), color: had?.color ?? '' };
    changed = true;
  }
  return changed ? days : source;
}
