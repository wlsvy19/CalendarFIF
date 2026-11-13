import type { DragKind, Point } from './api';

export function parseBool(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null;
}

const LIMIT = 100000;
const coord = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= LIMIT;

export function parsePoint(v: unknown): Point | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const { x, y } = v as Record<string, unknown>;
  return coord(x) && coord(y) ? { x, y } : null;
}

const DRAG_KINDS: readonly string[] = ['move', 'n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

export function parseDrag(kind: unknown, dx: unknown, dy: unknown): { kind: DragKind; dx: number; dy: number } | null {
  if (typeof kind !== 'string' || !DRAG_KINDS.includes(kind) || !coord(dx) || !coord(dy)) return null;
  return { kind: kind as DragKind, dx, dy };
}
