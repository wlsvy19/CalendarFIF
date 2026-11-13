import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { ImportStateCorruptError, defaultStatePath, loadState, saveState } from './stateFile';

const path = () => join(mkdtempSync(join(tmpdir(), 'calfif-state-')), 'sub', 'import-state.json');

it('저장한 상태를 같은 프로젝트와 계정으로만 읽는다', () => {
  const p = path();
  expect(loadState(p, 'proj', 'u1')).toBeNull();
  saveState(p, { projectId: 'proj', uid: 'u1', days: { '2026-11-13': { text: 'A', color: '' } } });
  expect(loadState(p, 'proj', 'u1')).toEqual({ '2026-11-13': { text: 'A', color: '' } });
  expect(loadState(p, 'proj', 'other')).toBeNull();
  expect(loadState(p, 'other-proj', 'u1')).toBeNull();
});
it('깨진 상태 파일은 오류로 알린다', () => {
  const p = join(mkdtempSync(join(tmpdir(), 'calfif-state-')), 'import-state.json');
  writeFileSync(p, '{oops');
  expect(() => loadState(p, 'proj', 'u1')).toThrow(ImportStateCorruptError);
});
it('기본 위치는 LOCALAPPDATA 아래다', () => {
  expect(defaultStatePath({ LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' })).toBe('C:\\Users\\me\\AppData\\Local\\CalendarFIF\\import-state.json');
});
