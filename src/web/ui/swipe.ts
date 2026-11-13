// 달 넘기기의 손가락 계산. DOM을 모르는 순수 함수만 둔다.
// 살짝만 밀어도 넘어가게 한다: 24px을 넘게 끌었거나(좁은 곳에서는 폭의 20%), 8px 이상을 가볍게 튕겼으면 넘긴다.
export const SWIPE = { slopPx: 8, commitPx: 24, commitRatio: 0.2, flickPxPerMs: 0.15, windowMs: 100, durationMs: 200 } as const;

export type Sample = { x: number; t: number };

export function lockAxis(dx: number, dy: number): 'x' | 'y' | null {
  if (Math.abs(dx) <= SWIPE.slopPx && Math.abs(dy) <= SWIPE.slopPx) return null;
  return Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
}

// 마지막 표본과, 그보다 windowMs 안쪽의 가장 오래된 표본 사이의 px/ms.
export function velocity(samples: Sample[]): number {
  const last = samples[samples.length - 1];
  if (!last) return 0;
  const first = samples.find((s) => s.t >= last.t - SWIPE.windowMs)!;
  const dt = last.t - first.t;
  return dt > 0 ? (last.x - first.x) / dt : 0;
}

// 1 = 다음 달(왼쪽으로 끌었다), -1 = 이전 달, 0 = 제자리.
export function swipeOutcome(dx: number, width: number, vx: number): -1 | 0 | 1 {
  const dir = dx < 0 ? 1 : -1;
  if (Math.abs(dx) > Math.min(SWIPE.commitPx, width * SWIPE.commitRatio)) return dir;
  if (Math.abs(dx) >= SWIPE.slopPx && Math.abs(vx) >= SWIPE.flickPxPerMs && Math.sign(vx) === Math.sign(dx)) return dir;
  return 0;
}

export function dragOffset(dx: number, width: number): number {
  return Math.max(-width, Math.min(width, dx));
}
