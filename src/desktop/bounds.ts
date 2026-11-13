import type { DragKind } from './api';

export type Rect = { x: number; y: number; width: number; height: number };
export type DisplayInfo = { bounds: Rect; workArea: Rect; primary: boolean };
export const MIN_SIZE = { width: 360, height: 240 };
export const KEEP_VISIBLE = 80;

const byPosition = (a: DisplayInfo, b: DisplayInfo) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y;

// 모니터 구성을 알아보는 문자열. 설정의 bounds는 이 키로 구성마다 따로 저장한다.
export function layoutKey(displays: DisplayInfo[]): string {
  return [...displays].sort(byPosition).map((d) => `${d.bounds.x},${d.bounds.y},${d.bounds.width}x${d.bounds.height}`).join('|');
}

// 처음 보는 구성의 자리: 주 모니터가 아닌 모니터(없으면 주 모니터) 작업 영역의 오른쪽.
// 모니터가 하나도 없으면(잠금, 원격 연결 끊김 등으로 잠시 그렇게 보고될 수 있다) 자리를 정하지 않고 null을 돌려준다.
export function defaultBounds(displays: DisplayInfo[]): Rect | null {
  if (displays.length === 0) return null;
  const sorted = [...displays].sort(byPosition);
  const target = sorted.find((d) => !d.primary) ?? sorted.find((d) => d.primary) ?? sorted[0];
  const wa = target.workArea;
  const width = Math.round(wa.width * 0.65);
  const height = Math.round(wa.height * 0.96);
  const m = Math.floor((wa.height - height) / 2);
  return { x: wa.x + wa.width - width - m, y: wa.y + m, width, height };
}

const overlap = (a: Rect, b: Rect): number =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

// 겹치는 넓이가 가장 큰 작업 영역, 어디와도 겹치지 않으면 중심이 가장 가까운 작업 영역.
function targetWorkArea(r: Rect, workAreas: Rect[]): Rect {
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  const distance = (wa: Rect) => (wa.x + wa.width / 2 - cx) ** 2 + (wa.y + wa.height / 2 - cy) ** 2;
  return workAreas.reduce((best, wa) => {
    const o = overlap(r, wa);
    const bo = overlap(r, best);
    return o > bo || (o === bo && o === 0 && distance(wa) < distance(best)) ? wa : best;
  }, workAreas[0]);
}

const between = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

// 크기를 최소 크기와 작업 영역 사이로 자르고, 화면 안에 80px 이상 남게 한다(위쪽은 넘지 않는다).
// 작업 영역이 없으면 자를 기준이 없으므로 그대로 돌려준다.
export function clampBounds(r: Rect, workAreas: Rect[]): Rect {
  if (workAreas.length === 0) return r;
  const wa = targetWorkArea(r, workAreas);
  const width = between(r.width, MIN_SIZE.width, Math.max(MIN_SIZE.width, wa.width));
  const height = between(r.height, MIN_SIZE.height, Math.max(MIN_SIZE.height, wa.height));
  return {
    x: between(r.x, wa.x - width + KEEP_VISIBLE, wa.x + wa.width - KEEP_VISIBLE),
    y: between(r.y, wa.y, wa.y + wa.height - KEEP_VISIBLE),
    width,
    height,
  };
}

export function resolveBounds(saved: Record<string, Rect>, displays: DisplayInfo[]): Rect | null {
  if (displays.length === 0) return null;
  const key = layoutKey(displays);
  const own = Object.hasOwn(saved, key) ? saved[key] : undefined;
  return own ? clampBounds(own, displays.map((d) => d.workArea)) : defaultBounds(displays);
}

export function applyDrag(base: Rect, kind: DragKind, dx: number, dy: number, workAreas: Rect[]): Rect {
  if (kind === 'move') return clampBounds({ ...base, x: base.x + dx, y: base.y + dy }, workAreas);
  let { x, y, width, height } = base;
  const right = base.x + base.width;
  const bottom = base.y + base.height;
  if (kind.includes('e')) width = Math.max(MIN_SIZE.width, base.width + dx);
  if (kind.includes('w')) {
    width = Math.max(MIN_SIZE.width, base.width - dx);
    x = right - width;
  }
  if (kind.includes('s')) height = Math.max(MIN_SIZE.height, base.height + dy);
  if (kind.includes('n')) {
    height = Math.max(MIN_SIZE.height, base.height - dy);
    y = bottom - height;
  }
  return clampBounds({ x, y, width, height }, workAreas);
}
