import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { UsageError, main, parseArgs, type CliDeps } from './cli';
import { FakeMonthStore, rec } from '../sync/testing';
import type { LiteMonthStore } from './liteStore';
import { loadState, saveState } from './stateFile';
import { makeSourceDb } from './testing';

const env = { APPDATA: 'C:\\A', LOCALAPPDATA: 'C:\\L' };

it('인자를 읽는다', () => {
  expect(parseArgs([], env)).toEqual({ mode: 'preview', dbPath: 'C:\\A\\CalendarTask\\Db\\calendar.db', statePath: 'C:\\L\\CalendarFIF\\import-state.json', show: [], yes: false, allowDeletes: false });
  expect(parseArgs(['--upload', '--allow-deletes'], env).allowDeletes).toBe(true);
  expect(parseArgs(['--upload', '--yes', '--db', 'D:\\x.db', '--state', 'D:\\s.json'], env)).toMatchObject({ mode: 'upload', yes: true, dbPath: 'D:\\x.db', statePath: 'D:\\s.json' });
  expect(parseArgs(['--follow'], env).mode).toBe('follow');
  expect(parseArgs(['--show', '2026-11-13', '--show', '2026-11-14'], env).show).toEqual(['2026-11-13', '2026-11-14']);
});
it('잘못된 인자는 사용법 오류다', () => {
  for (const argv of [['--upload', '--follow'], ['--what'], ['--show', '2026-02-30'], ['--db'], ['--follow', '--allow-deletes'], ['--allow-deletes']]) {
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
it('사라진 날짜가 많으면 올리지 않고 막는다. --allow-deletes를 주면 지운다', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'calfif-cli-'));
  const db = makeSourceDb(dir, []);
  const statePath = join(dir, 'state.json');
  const threeDays = { '2026-11-13': { text: 'a', color: '' }, '2026-11-14': { text: 'b', color: '' }, '2026-11-15': { text: 'c', color: '' } };
  saveState(statePath, { projectId: 'p', uid: 'u', days: threeDays });
  const store = new FakeMonthStore({ '2026-11': { days: { '13': rec('a'), '14': rec('b'), '15': rec('c') } } });
  const lite = Object.assign(store, { getMonth: async (monthId: string) => store.docs.get(monthId) ?? null }) as unknown as LiteMonthStore;
  const connect = async () => ({ projectId: 'p', uid: 'u', store: lite });

  const blocked = deps({ connect });
  expect(await main(['--upload', '--yes', '--db', db, '--state', statePath], env, blocked.d)).toBe(1);
  expect(blocked.lines.join('\n')).toContain('사라진 날짜가 3일입니다');
  expect(Object.keys(store.docs.get('2026-11')!.days)).toEqual(['13', '14', '15']);

  const allowed = deps({ connect });
  expect(await main(['--upload', '--yes', '--allow-deletes', '--db', db, '--state', statePath], env, allowed.d)).toBe(0);
  expect(Object.keys(store.docs.get('2026-11')!.days)).toEqual([]);
});
it('올리기를 거절하면 로그인하지 않는다', async () => {
  const db = makeSourceDb(mkdtempSync(join(tmpdir(), 'calfif-cli-')), [{ key: 'dkcal_mdays_20261113', content: 'a', bgcolor: '', stime: 100 }]);
  const { d, connect } = deps({ confirm: async () => false });
  expect(await main(['--upload', '--db', db], env, d)).toBe(0);
  expect(connect).not.toHaveBeenCalled();
});

function fakeConnect(store: FakeMonthStore) {
  const lite = Object.assign(store, { getMonth: async (monthId: string) => store.docs.get(monthId) ?? null }) as unknown as LiteMonthStore;
  return async () => ({ projectId: 'p', uid: 'u', store: lite });
}

it('처음 올리면 상태 파일을 만들고, 다시 돌리면 아무것도 올리지 않는다', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'calfif-cli-'));
  const db = makeSourceDb(dir, [
    { key: 'dkcal_mdays_20261113', content: 'a', bgcolor: '2424F1', stime: 100 },
    { key: 'dkcal_mdays_20261201', content: 'b', bgcolor: '', stime: 200 },
  ]);
  const statePath = join(dir, 'state.json');
  const store = new FakeMonthStore();
  const argv = ['--upload', '--yes', '--db', db, '--state', statePath];

  const first = deps({ connect: fakeConnect(store) });
  expect(await main(argv, env, first.d)).toBe(0);
  expect(store.docs.get('2026-11')!.days['13']).toMatchObject({ text: 'a', color: 'F12424' });
  expect(store.docs.get('2026-12')!.days['01']).toMatchObject({ text: 'b', color: '' });
  expect(loadState(statePath, 'p', 'u')).toEqual({ '2026-11-13': { text: 'a', color: 'F12424' }, '2026-12-01': { text: 'b', color: '' } });
  expect(first.lines.join('\n')).toContain('원본 날짜 2 / 클라우드와 같음 2 / 다름 0 / 클라우드에 없음 0');

  const calls = store.calls.length;
  const second = deps({ connect: fakeConnect(store) });
  expect(await main(argv, env, second.d)).toBe(0);
  expect(store.calls).toHaveLength(calls);
});
it('휴대폰에서만 적은 날짜에 DesktopCal 글이 생기면 합쳐서 올린다', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'calfif-cli-'));
  const db = makeSourceDb(dir, [
    { key: 'dkcal_mdays_20261113', content: 'a', bgcolor: '', stime: 100 },
    { key: 'dkcal_mdays_20261114', content: 'DC', bgcolor: '', stime: 300 },
  ]);
  const statePath = join(dir, 'state.json');
  saveState(statePath, { projectId: 'p', uid: 'u', days: { '2026-11-13': { text: 'a', color: '' } } });
  const store = new FakeMonthStore({ '2026-11': { days: { '13': rec('a'), '14': rec('PHONE', 'F12424', 200, 'iphone') } } });

  const run = deps({ connect: fakeConnect(store) });
  expect(await main(['--upload', '--yes', '--db', db, '--state', statePath], env, run.d)).toBe(0);
  expect(store.docs.get('2026-11')!.days['14']).toMatchObject({ text: 'PHONE\nDC', color: 'F12424' });
});
