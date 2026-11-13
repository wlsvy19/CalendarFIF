import { expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_DESKTOP_SETTINGS, loadDesktopSettings, parseDesktopSettings, saveDesktopSettings } from './settings';

const tempDir = () => mkdtempSync(join(tmpdir(), 'calfif-settings-'));
it('기본값, 그리고 맞는 칸은 살리고 틀린 칸만 기본값으로', () => {
  expect(DEFAULT_DESKTOP_SETTINGS).toEqual({ version: 1, bounds: {}, contentHidden: false, alwaysOnTop: false,
    hideHotkey: { accelerator: 'Ctrl+Alt+H', enabled: false }, contentHotkey: { accelerator: 'Ctrl+Alt+F', enabled: false }, startWithWindows: null });
  expect(parseDesktopSettings({ bounds: { k: { x: 1, y: 2, width: 800, height: 600 }, bad: { x: 'a' }, huge: { x: 1e9, y: 0, width: 1, height: 1 } },
    alwaysOnTop: 'yes', contentHidden: true, hideHotkey: { accelerator: 'Ctrl+Alt+K', enabled: true }, contentHotkey: { accelerator: 5 }, startWithWindows: false, extra: 1 }))
    .toEqual({ ...DEFAULT_DESKTOP_SETTINGS, bounds: { k: { x: 1, y: 2, width: 800, height: 600 } }, contentHidden: true, hideHotkey: { accelerator: 'Ctrl+Alt+K', enabled: true }, startWithWindows: false });
});
it('없으면 기본값, 깨졌으면 옆에 보관하고 기본값, 예전 형식은 읽어 들이고, 임시 파일을 거쳐 쓴다', () => {
  const file = join(tempDir(), 'settings.json');
  expect(loadDesktopSettings(file)).toEqual({ settings: DEFAULT_DESKTOP_SETTINGS, status: 'missing' });
  writeFileSync(file, '{"version":1,"bounds":');
  expect([loadDesktopSettings(file), readFileSync(`${file}.corrupt`, 'utf8')]).toEqual([{ settings: DEFAULT_DESKTOP_SETTINGS, status: 'corrupt' }, '{"version":1,"bounds":']);
  writeFileSync(file, JSON.stringify({ alwaysOnTop: true }));
  expect(loadDesktopSettings(file)).toEqual({ settings: { ...DEFAULT_DESKTOP_SETTINGS, alwaysOnTop: true }, status: 'migrated' });
  const nested = join(tempDir(), 'nested', 'settings.json');
  saveDesktopSettings(nested, { ...DEFAULT_DESKTOP_SETTINGS, contentHidden: true });
  expect([loadDesktopSettings(nested), existsSync(`${nested}.tmp`)]).toEqual([{ settings: { ...DEFAULT_DESKTOP_SETTINGS, contentHidden: true }, status: 'ok' }, false]);
});
