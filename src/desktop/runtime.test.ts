import { join } from 'node:path';
import { expect, it } from 'vitest';
import { resolveRuntime } from './runtime';

const base = { appPath: 'C:\\app', appData: 'C:\\Users\\u\\AppData\\Roaming' };
it('꾸린 앱은 앱 안의 화면과 %APPDATA%\\CalendarFIF를 쓰고 자동 실행을 관리한다', () => {
  expect(resolveRuntime({ ...base, env: { CALFIF_RENDERER_DIR: 'C:\\evil' }, isPackaged: true })).toEqual({
    rendererDir: join('C:\\app', 'dist-desktop'), profileDir: join(base.appData, 'CalendarFIF'), statusDir: null, smoke: null, emulator: false, manageLoginItem: true,
  });
});
it('개발 실행은 정해 준 폴더를 쓰고, 시험 실행은 따로 둔 프로필이 있어야 하며 꾸린 앱에서도 자동 실행을 건드리지 않는다', () => {
  expect(resolveRuntime({ ...base, isPackaged: false, env: { CALFIF_RENDERER_DIR: 'C:\\r', CALFIF_PROFILE_DIR: 'C:\\p\\profile', CALFIF_EMU: '1' } }))
    .toMatchObject({ rendererDir: 'C:\\r', profileDir: 'C:\\p\\profile', emulator: true, manageLoginItem: false, smoke: null });
  expect(() => resolveRuntime({ ...base, isPackaged: false, env: { CALFIF_SMOKE: 'attach' } })).toThrow('CALFIF_PROFILE_DIR');
  expect(() => resolveRuntime({ ...base, isPackaged: false, env: { CALFIF_SMOKE: 'dance', CALFIF_PROFILE_DIR: 'C:\\s\\profile' } })).toThrow('CALFIF_SMOKE');
  expect(resolveRuntime({ ...base, isPackaged: true, env: { CALFIF_SMOKE: '1', CALFIF_PROFILE_DIR: 'C:\\s\\profile' } })).toMatchObject({ smoke: 'attach', manageLoginItem: false, statusDir: 'C:\\s' });
});
