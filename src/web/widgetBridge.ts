/**
 * 위젯에서 연 화면(Scriptable 안의 웹 화면)이 아직 서버에 올리지 못한 편집을 위젯 스크립트에 알려 주는 글.
 * 이 화면은 그 글을 window.__calfifPending에 적어 두기만 한다. 달력을 띄운 스크립트가 0.3초마다 읽어 위젯의 보관 파일에 적고,
 * 위젯은 서버에서 읽은 달 위에 그것을 얹어 그린다(src/widget/pending.ts, main.ts의 watchPending).
 * 고치고 바로 홈 화면으로 나와도, 위젯이 새로 그려질 때 서버에 아직 닿지 않은 것까지 보이게 하려는 것이다.
 */
import type { DayValue, PendingEdit } from '../core/types';

/** src/widget/pending.ts의 PENDING_GLOBAL과 같아야 한다. */
export const PENDING_GLOBAL = '__calfifPending';

/**
 * 올리지 못한 편집이 있는 날마다 이 화면이 보여 주는 값(valueOf)과 그날을 마지막으로 고친 시각을 적은 글(JSON).
 * 올릴 것이 없으면 빈 목록이다(스크립트가 앞에 적어 둔 것을 지운다).
 * valueOf가 null을 주면(그 달을 아직 서버에서 읽지 못했다) 대기열의 마지막 값을 그대로 적는다. 읽지 못한 달에 맞춰 합친 값은
 * 틀릴 수 있다(한 줄을 더한 편집이 그 한 줄만 남는다).
 */
export function pendingForWidget(uid: string, pending: PendingEdit[], valueOf: (monthId: string, day: string) => DayValue | null, n = 0): string {
  const latest = new Map<string, { monthId: string; day: string; editedAt: number; next: DayValue }>();
  for (const e of pending) {
    const key = `${e.monthId}-${e.day}`;
    const seen = latest.get(key);
    // 대기열은 고친 차례대로다. 시각이 같으면 뒤의 것이 마지막이다.
    if (!seen || e.editedAt >= seen.editedAt) latest.set(key, { monthId: e.monthId, day: e.day, editedAt: e.editedAt, next: e.next });
  }
  const edits = [...latest.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, e]) => {
      const value = valueOf(e.monthId, e.day) ?? e.next;
      return { monthId: e.monthId, day: e.day, text: value.text, color: value.color, editedAt: e.editedAt };
    });
  return JSON.stringify({ v: 1, uid, n, edits });
}

/**
 * 적을 글을 만드는 함수를 준다. 올리지 못한 편집의 목록(날짜와 고친 시각)이 앞의 것과 달라질 때마다 n이 하나씩 는다: 저장하면 +1, 서버에 올라가면 +1.
 * 스크립트는 0.3초마다 읽는데, 저장하고 서버에 올라가기까지가 그보다 짧으면 목록이 "없음 → 하나 → 없음"으로 바뀐 것을 보지 못한다.
 * n이 있으면 그 사이에 저장이 있었음을 안다(스크립트는 그때 위젯을 새로 그리게 한다. src/widget/pending.ts의 savedBetween).
 * 보여 주는 값만 달라진 것(다른 기기가 고친 것과 합쳐졌다)은 세지 않는다: 저장이 아니다.
 */
export function pendingTeller(uid: string): (pending: PendingEdit[], valueOf: (monthId: string, day: string) => DayValue | null) => string {
  let n = 0;
  let last: string | null = null;
  return (pending, valueOf) => {
    const text = pendingForWidget(uid, pending, valueOf);
    const keys = (JSON.parse(text) as { edits: { monthId: string; day: string; editedAt: number }[] }).edits.map((e) => `${e.monthId}-${e.day}@${e.editedAt}`).join(',');
    if (keys !== last) {
      last = keys;
      n += 1;
    }
    return pendingForWidget(uid, pending, valueOf, n);
  };
}
