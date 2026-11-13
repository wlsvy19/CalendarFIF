import { normalizeAccelerator } from '../core/accelerator';
import type { DragKind, Hotkey, Point, SystemPatch } from './api';

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

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function parseHotkey(v: unknown): Hotkey | null {
  if (!isObject(v)) return null;
  const { accelerator, enabled } = v;
  if (typeof accelerator !== 'string' || accelerator.length < 1 || accelerator.length > 40 || typeof enabled !== 'boolean') return null;
  const normalized = normalizeAccelerator(accelerator); // 저장하는 것은 등록에 쓰는 바른 모양이고, 등록할 수 없는 조합은 받지 않는다
  return normalized === null ? null : { accelerator: normalized, enabled };
}

// 설정 바꾸기 요청: 객체가 아니면 통째로 거절하고, 아는 칸 중 맞는 것만 남긴다.
export function parseSystemPatch(v: unknown): SystemPatch | null {
  if (!isObject(v)) return null;
  const patch: SystemPatch = {};
  const hide = parseHotkey(v.hideHotkey);
  if (hide) patch.hideHotkey = hide;
  const content = parseHotkey(v.contentHotkey);
  if (content) patch.contentHotkey = content;
  if (typeof v.startWithWindows === 'boolean') patch.startWithWindows = v.startWithWindows;
  return patch;
}
