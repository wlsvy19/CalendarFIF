/**
 * 위젯을 다음에 다시 그려 달라고 iOS에 청하는 때(ListWidget.refreshAfterDate).
 * 실제로 언제 그릴지는 iOS가 정한다. 스크립트가 바로 그리게 할 수는 없다. 이 시각은 "이보다 먼저는 그리지 말라"는 뜻이라,
 * 짧게 잡아야 iOS가 그릴 수 있을 때 바로 그린다.
 * 2026-11-17: 15분이던 것을 5분으로, 같은 날 다시 2분으로 줄였다(위젯에서 달력을 고치고 나와도 위젯이 그대로라는 사용자의 말).
 */
const DAY_MS = 2 * 60_000;
/** 새벽(01~06시)에는 드물게 청한다. iOS가 하루에 그려 주는 횟수를 낮에 쓰게 아낀다. */
const NIGHT_MS = 30 * 60_000;
const NIGHT_FROM = 1;
const NIGHT_TO = 6;
/** 자정이 지나면 오늘 표시가 바뀌어야 하므로 자정 바로 뒤에는 꼭 청한다. */
const AFTER_MIDNIGHT_MS = 5_000;
/**
 * 방금까지 위젯에서 연 달력을 쓰고 있었으면(activeAt에서 3분 안) 15초 뒤를 청한다. 고친 것이 곧 위젯에 나와야 하는 때다.
 * 짧은 동안만 이렇게 해서 하루 횟수를 많이 쓰지 않는다.
 */
const HOT_MS = 15_000;
export const HOT_FOR_MS = 3 * 60_000;

/** activeAt: 위젯에서 연 달력이 마지막으로 화면에 떠 있던 때(ms). 모르면 0. */
export function refreshAt(now: Date, activeAt = 0): Date {
  const t = now.getTime();
  const hot = activeAt > 0 && Math.abs(t - activeAt) < HOT_FOR_MS;
  const hour = now.getHours();
  const step = hot ? HOT_MS : hour >= NIGHT_FROM && hour < NIGHT_TO ? NIGHT_MS : DAY_MS;
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() + AFTER_MIDNIGHT_MS;
  return new Date(Math.min(t + step, midnight));
}
