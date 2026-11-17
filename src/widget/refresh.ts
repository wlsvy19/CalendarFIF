/**
 * 위젯을 다음에 다시 그려 달라고 iOS에 청하는 때(ListWidget.refreshAfterDate).
 * 실제로 언제 그릴지는 iOS가 정하고, iOS는 위젯마다 하루에 그려 주는 횟수를 정해 둔다(40~70번쯤이라고 한다).
 *
 * 2026-11-17의 경위: 15분이던 것을 5분, 2분, (달력을 쓴 직후에는) 15초로 줄였더니 오히려 나빠졌다. 사용자의 아이폰이 적어 준 기록에서
 * 위젯은 16~22분 동안 한 번도 그려지지 않았고, Scriptable에서 스크립트가 끝날 때만 바로 그려졌다. 짧게 청해도 iOS는 그려 주지 않고,
 * 자주 청하면 하루 횟수만 일찍 쓴다고 보고 15분으로 되돌렸다. 고친 것이 바로 나오게 하는 일은 달력에서 나갈 때 스크립트를 끝내는 쪽이 맡는다
 * (main.ts의 openCalendarInApp).
 */
const DAY_MS = 15 * 60_000;
/** 새벽(01~06시)에는 드물게 청한다. */
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
