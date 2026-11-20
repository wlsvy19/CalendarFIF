/**
 * 바탕화면 아이콘 자리를 달력 창에 뚫는 계산(2026-11-20 사용자: "파일같은것도 위에 냅둘 수 있께 해. 즉 ppt로", "따지면 맨 뒤로 보내기 같은 거지").
 *
 * 달력 창은 바탕화면 아이콘 위에 있다(Progman 바로 위). DesktopCal은 창을 마우스가 통과하게 두고 탐색기 안에서 클릭을 가로채는데,
 * 이 앱은 탐색기에 끼워 넣지 않는다(설계 4절). 그래서 아이콘이 있는 자리만 달력을 투명하게 뚫고(화면의 clip-path), 마우스가 그 위에
 * 있는 동안만 창이 마우스를 바탕화면으로 보낸다(setIgnoreMouseEvents). 사용자가 2026-11-20에 이 방식을 골랐다.
 *
 * 아이콘 자리는 iconWorker가 셸의 IFolderView로 읽는다: 바탕화면 목록 창(SysListView32)의 왼쪽 위(origin)와 아이콘 칸 크기(spacing),
 * 아이콘마다 그 목록 창 안의 왼쪽 위(points). 모두 실제 픽셀이다.
 */
import type { HoleRect } from './api';
import type { Rect } from './bounds';

export type IconGrid = { origin: [number, number]; spacing: [number, number]; points: [number, number][] };

/** 아이콘 칸 가장자리에서 안으로 줄이는 폭(실제 픽셀). 이웃한 아이콘 칸 사이에 달력이 조금 남게 한다. */
const INSET = 2;

/** 아이콘마다 화면 위의 네모(실제 픽셀). */
export function iconScreenRects(grid: IconGrid): Rect[] {
  const [ox, oy] = grid.origin;
  const [w, h] = grid.spacing;
  if (!(w > 2 * INSET && h > 2 * INSET)) return [];
  return grid.points.map(([x, y]) => ({ x: ox + x + INSET, y: oy + y + INSET, width: w - 2 * INSET, height: h - 2 * INSET }));
}

/** 창(win, 화면 좌표)과 겹치는 아이콘 네모를 창 안의 좌표로. 겹치는 부분만 남기고 반올림한다. */
export function holesIn(icons: Rect[], win: Rect): HoleRect[] {
  const out: HoleRect[] = [];
  for (const r of icons) {
    const left = Math.max(r.x, win.x);
    const top = Math.max(r.y, win.y);
    const right = Math.min(r.x + r.width, win.x + win.width);
    const bottom = Math.min(r.y + r.height, win.y + win.height);
    if (right - left < 1 || bottom - top < 1) continue;
    const x = Math.round(left - win.x);
    const y = Math.round(top - win.y);
    out.push({ x, y, width: Math.round(right - win.x) - x, height: Math.round(bottom - win.y) - y });
  }
  return out.sort((a, b) => a.y - b.y || a.x - b.x);
}

export const sameHoles = (a: HoleRect[], b: HoleRect[]): boolean =>
  a.length === b.length && a.every((r, i) => r.x === b[i].x && r.y === b[i].y && r.width === b[i].width && r.height === b[i].height);

/** iconWorker가 보낸 것을 믿기 전에 모양을 본다. 틀리면 null. */
export function parseIconGrid(v: unknown): IconGrid | null {
  const num = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e6;
  const pair = (p: unknown): p is [number, number] => Array.isArray(p) && p.length === 2 && num(p[0]) && num(p[1]);
  if (typeof v !== 'object' || v === null) return null;
  const { origin, spacing, points } = v as Record<string, unknown>;
  if (!pair(origin) || !pair(spacing) || !Array.isArray(points) || points.length > 2000 || !points.every(pair)) return null;
  return { origin, spacing, points };
}
