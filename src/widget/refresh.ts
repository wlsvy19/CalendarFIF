/**
 * 위젯을 다음에 다시 그려 달라고 iOS에 청하는 때(ListWidget.refreshAfterDate).
 * 실제로 언제 그릴지는 iOS가 정한다. 이 시각은 "이보다 먼저는 그리지 말라"는 뜻이라, 짧게 잡아야 iOS가 그릴 수 있을 때 바로 그린다.
 * 15분이던 것을 5분으로 줄였다(2026-11-17: 앱에서 고친 것이 위젯에 늦게 나온다는 사용자의 말).
 */
const DAY_MS = 5 * 60_000;
/** 새벽(01~06시)에는 드물게 청한다. iOS가 하루에 그려 주는 횟수를 낮에 쓰게 아낀다. */
const NIGHT_MS = 30 * 60_000;
const NIGHT_FROM = 1;
const NIGHT_TO = 6;
/** 자정이 지나면 오늘 표시가 바뀌어야 하므로 자정 바로 뒤에는 꼭 청한다. */
const AFTER_MIDNIGHT_MS = 5_000;

export function refreshAt(now: Date): Date {
  const hour = now.getHours();
  const step = hour >= NIGHT_FROM && hour < NIGHT_TO ? NIGHT_MS : DAY_MS;
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() + AFTER_MIDNIGHT_MS;
  return new Date(Math.min(now.getTime() + step, midnight));
}
