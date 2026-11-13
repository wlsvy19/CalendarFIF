import type { Point } from './api';

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
