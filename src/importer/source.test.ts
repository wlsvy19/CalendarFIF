import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, it } from 'vitest';
import { SourceBusyError, SourceCorruptError, SourceMissingError, defaultDbPath, readSourceRows } from './source';
import { makeSourceDb } from './testing';

const ROWS = [{ key: 'dkcal_mdays_20261113', content: 'a\r\nb', bgcolor: '2424F1', stime: 100 }];
const fresh = () => mkdtempSync(join(tmpdir(), 'calfif-src-'));
const quick = { retries: 2, retryDelayMs: 10 };

it('기본 위치는 APPDATA 아래다', () => {
  expect(defaultDbPath({ APPDATA: 'C:\\Users\\me\\AppData\\Roaming' })).toBe('C:\\Users\\me\\AppData\\Roaming\\CalendarTask\\Db\\calendar.db');
});
it('복사본에서 읽고 원본과 그 폴더는 그대로 둔다', async () => {
  const db = makeSourceDb(fresh(), ROWS);
  const before = { bytes: readFileSync(db), mtime: statSync(db).mtimeMs, files: readdirSync(dirname(db)) };
  expect(await readSourceRows(db, quick)).toEqual(ROWS);
  expect(readFileSync(db).equals(before.bytes)).toBe(true);
  expect(statSync(db).mtimeMs).toBe(before.mtime);
  expect(readdirSync(dirname(db))).toEqual(before.files);
});
it('쓰는 중이면 기다리고, 끝나지 않으면 그만둔다', async () => {
  const db = makeSourceDb(fresh(), ROWS);
  writeFileSync(`${db}-journal`, 'x');
  setTimeout(() => rmSync(`${db}-journal`), 15);
  expect(await readSourceRows(db, { retries: 5, retryDelayMs: 10 })).toEqual(ROWS);
  writeFileSync(`${db}-journal`, 'x');
  await expect(readSourceRows(db, quick)).rejects.toBeInstanceOf(SourceBusyError);
});
it('없는 파일과 깨진 파일을 구분해 알린다', async () => {
  const dir = fresh();
  await expect(readSourceRows(join(dir, 'calendar.db'), quick)).rejects.toBeInstanceOf(SourceMissingError);
  writeFileSync(join(dir, 'calendar.db'), 'this is not a database');
  await expect(readSourceRows(join(dir, 'calendar.db'), quick)).rejects.toBeInstanceOf(SourceCorruptError);
  expect(existsSync(join(dir, 'calendar.db'))).toBe(true);
});
