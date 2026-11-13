import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { UsageError, main, parseArgs, type CliDeps } from './cli';
import { makeSourceDb } from './testing';

const env = { APPDATA: 'C:\\A', LOCALAPPDATA: 'C:\\L' };

it('인자를 읽는다', () => {
  expect(parseArgs([], env)).toEqual({ mode: 'preview', dbPath: 'C:\\A\\CalendarTask\\Db\\calendar.db', statePath: 'C:\\L\\CalendarFIF\\import-state.json', show: [], yes: false });
  expect(parseArgs(['--upload', '--yes', '--db', 'D:\\x.db', '--state', 'D:\\s.json'], env)).toMatchObject({ mode: 'upload', yes: true, dbPath: 'D:\\x.db', statePath: 'D:\\s.json' });
  expect(parseArgs(['--follow'], env).mode).toBe('follow');
  expect(parseArgs(['--show', '2026-11-13', '--show', '2026-11-14'], env).show).toEqual(['2026-11-13', '2026-11-14']);
});
it('잘못된 인자는 사용법 오류다', () => {
  for (const argv of [['--upload', '--follow'], ['--what'], ['--show', '2026-02-30'], ['--db']]) {
    expect(() => parseArgs(argv, env)).toThrow(UsageError);
  }
});

function deps(overrides: Partial<CliDeps> = {}) {
  const lines: string[] = [];
  const connect = vi.fn();
  const d: CliDeps = { out: (line) => lines.push(line), connect, confirm: async () => true, now: () => 1, ...overrides };
  return { d, lines, connect };
}

it('미리보기는 로그인 없이 보고서를 출력한다', async () => {
  const db = makeSourceDb(mkdtempSync(join(tmpdir(), 'calfif-cli-')), [{ key: 'dkcal_mdays_20261113', content: 'a', bgcolor: '2424F1', stime: 100 }]);
  const { d, lines, connect } = deps();
  expect(await main(['--preview', '--db', db, '--show', '2026-11-13'], env, d)).toBe(0);
  expect(connect).not.toHaveBeenCalled();
  expect(lines.join('\n')).toContain('옮길 날짜: 1');
  expect(lines.join('\n')).toContain('2026-11-13  배경색 F12424');
});
it('파일이 없으면 알리고 1로 끝난다', async () => {
  const { d, lines } = deps();
  expect(await main(['--db', 'C:\\nope\\calendar.db'], env, d)).toBe(1);
  expect(lines.join('\n')).toContain('DesktopCal 데이터 파일을 찾지 못했습니다: C:\\nope\\calendar.db');
});
it('올리기를 거절하면 로그인하지 않는다', async () => {
  const db = makeSourceDb(mkdtempSync(join(tmpdir(), 'calfif-cli-')), [{ key: 'dkcal_mdays_20261113', content: 'a', bgcolor: '', stime: 100 }]);
  const { d, connect } = deps({ confirm: async () => false });
  expect(await main(['--upload', '--db', db], env, d)).toBe(0);
  expect(connect).not.toHaveBeenCalled();
});
