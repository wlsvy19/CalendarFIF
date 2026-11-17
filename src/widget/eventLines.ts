/**
 * 알림과 카운트다운을 위젯의 날짜 칸에 보이게 한다.
 * 위젯은 날마다 메모의 줄들을 그린다(tree.ts, scene.ts). 알림과 카운트다운은 달 문서가 아니라 따로 있는 문서에 있어서
 * (users/{uid}/data/events) 2026-11-17까지는 위젯에 나오지 않았다(읽기는 했다: 아이폰 알림을 예약하려고).
 * 여기서는 그날의 알림과 카운트다운을 메모의 앞줄들로 끼워 넣은 달을 만든다. 웹앱의 칸과 같은 차례다(알림이 시각 차례로, 그다음 카운트다운, 그다음 메모).
 */
import { DONE_MARK } from '../core/text';
import { eventsByDate, type EventMap } from '../core/events';
import type { MonthData } from './scene';

/** 그 달의 마지막 날('YYYY-MM-DD'). */
function lastDayOf(monthId: string): string {
  const year = Number(monthId.slice(0, 4));
  const month = Number(monthId.slice(5, 7));
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${monthId}-${String(last).padStart(2, '0')}`;
}

/** 한 줄로 만든다: 알림은 "시각 글", 카운트다운은 글. 줄바꿈은 빈칸으로 바꾼다(한 항목이 한 줄이다). 끝낸 것은 메모의 완료 표시를 붙인다. */
function lineOf(time: string, text: string, done: boolean): string {
  const flat = text.replace(/\s*\n\s*/g, ' ').trim();
  const line = time !== '' ? (flat === '' ? time : `${time} ${flat}`) : flat;
  if (line === '') return '';
  // 끝내지 않은 글이 완료 표시로 시작하면 완료 줄로 읽히지 않게 앞에 빈칸 없는 폭의 글자를 두지 않고, 표시와 떼어 놓는다.
  if (!done && line.startsWith(DONE_MARK)) return `​${line}`;
  return done ? DONE_MARK + line : line;
}

/**
 * month의 날마다 그날의 알림과 카운트다운을 메모 앞에 끼워 넣은 달을 돌려준다. month는 바꾸지 않는다.
 * 넣을 것이 없으면 month를 그대로 돌려준다. 메모가 없던 날은 색 없는 날로 생긴다.
 */
export function withEventLines(month: MonthData, items: EventMap): MonthData {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month.monthId)) return month;
  let byDate: ReturnType<typeof eventsByDate>;
  try {
    byDate = eventsByDate(items, `${month.monthId}-01`, lastDayOf(month.monthId));
  } catch {
    return month;
  }
  if (byDate.size === 0) return month;
  const days = { ...month.days };
  let changed = false;
  for (const [dateKey, lines] of byDate) {
    const texts = lines.map((l) => lineOf(l.type === 'alarm' ? l.time : '', l.text, l.done)).filter((t) => t !== '');
    if (texts.length === 0) continue;
    const day = dateKey.slice(8, 10);
    const had = days[day];
    days[day] = { text: had && had.text !== '' ? `${texts.join('\n')}\n${had.text}` : texts.join('\n'), color: had?.color ?? '' };
    changed = true;
  }
  return changed ? { monthId: month.monthId, days } : month;
}
