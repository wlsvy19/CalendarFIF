import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Hotkey } from './api';
import type { Rect } from './bounds';

export type DesktopSettings = {
  version: 1;
  bounds: Record<string, Rect>;
  contentHidden: boolean;
  alwaysOnTop: boolean;
  hideHotkey: Hotkey;
  contentHotkey: Hotkey;
  startWithWindows: boolean | null;
};

export const DEFAULT_DESKTOP_SETTINGS: DesktopSettings = {
  version: 1,
  bounds: {},
  contentHidden: false,
  alwaysOnTop: false,
  hideHotkey: { accelerator: 'Ctrl+Alt+H', enabled: false },
  contentHotkey: { accelerator: 'Ctrl+Alt+F', enabled: false },
  startWithWindows: null,
};

const LIMIT = 100000;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const int = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

function parseRect(v: unknown): Rect | null {
  if (!isObject(v)) return null;
  const { x, y, width, height } = v;
  if (!int(x) || !int(y) || !int(width) || !int(height)) return null;
  if (Math.abs(x) > LIMIT || Math.abs(y) > LIMIT || width < 1 || height < 1) return null;
  return { x, y, width, height };
}

// 단축키의 뜻(등록할 수 있는 조합인지)은 등록할 때 본다.
function parseHotkey(v: unknown, fallback: Hotkey): Hotkey {
  if (!isObject(v)) return { ...fallback };
  const { accelerator, enabled } = v;
  if (typeof accelerator !== 'string' || accelerator.length < 1 || accelerator.length > 40 || typeof enabled !== 'boolean') return { ...fallback };
  return { accelerator, enabled };
}

export function parseDesktopSettings(raw: unknown): DesktopSettings {
  const d = DEFAULT_DESKTOP_SETTINGS;
  const src = isObject(raw) ? raw : {};
  const bounds: Record<string, Rect> = {};
  if (isObject(src.bounds)) {
    for (const [key, value] of Object.entries(src.bounds)) {
      const rect = parseRect(value);
      if (rect && key !== '__proto__') bounds[key] = rect;
    }
  }
  return {
    version: 1,
    bounds,
    contentHidden: typeof src.contentHidden === 'boolean' ? src.contentHidden : d.contentHidden,
    alwaysOnTop: typeof src.alwaysOnTop === 'boolean' ? src.alwaysOnTop : d.alwaysOnTop,
    hideHotkey: parseHotkey(src.hideHotkey, d.hideHotkey),
    contentHotkey: parseHotkey(src.contentHotkey, d.contentHotkey),
    startWithWindows: src.startWithWindows === true || src.startWithWindows === false ? src.startWithWindows : null,
  };
}

export function loadDesktopSettings(file: string): { settings: DesktopSettings; status: 'ok' | 'missing' | 'corrupt' | 'migrated' } {
  if (!existsSync(file)) return { settings: parseDesktopSettings(null), status: 'missing' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    parsed = undefined;
  }
  if (!isObject(parsed)) {
    try {
      renameSync(file, `${file}.corrupt`);
    } catch {
      // 옮기지 못해도 기본값으로 뜬다.
    }
    return { settings: parseDesktopSettings(null), status: 'corrupt' };
  }
  return { settings: parseDesktopSettings(parsed), status: parsed.version === 1 ? 'ok' : 'migrated' };
}

export function saveDesktopSettings(file: string, s: DesktopSettings): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(s, null, 2));
  renameSync(`${file}.tmp`, file);
}
