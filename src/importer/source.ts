import { copyFileSync, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, win32 } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as sleep } from 'node:timers/promises';
import type { SourceRow } from './convert';

export class SourceMissingError extends Error {}
export class SourceBusyError extends Error {}
export class SourceCorruptError extends Error {}

export function defaultDbPath(env: Record<string, string | undefined>): string {
  if (!env.APPDATA) throw new SourceMissingError('APPDATA 환경 변수가 없어 DesktopCal 데이터 위치를 알 수 없습니다.');
  return win32.join(env.APPDATA, 'CalendarTask', 'Db', 'calendar.db');
}

/**
 * DesktopCal의 calendar.db를 읽는다. 원본은 열지 않는다. 임시 폴더로 복사한 복사본만 읽기 전용으로 열고,
 * 끝나면(실패해도) 복사본을 지운다.
 */
export async function readSourceRows(dbPath: string, opts?: { retries?: number; retryDelayMs?: number }): Promise<SourceRow[]> {
  const retries = opts?.retries ?? 5;
  const retryDelayMs = opts?.retryDelayMs ?? 1000;
  let last: 'busy' | 'corrupt' = 'busy';

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(retryDelayMs);
    if (!existsSync(dbPath)) throw new SourceMissingError(`DesktopCal 데이터 파일이 없습니다: ${dbPath}`);
    if (isBeingWritten(dbPath)) {
      last = 'busy';
      continue;
    }
    const result = readFromCopy(dbPath);
    if (Array.isArray(result)) return result;
    last = result;
  }

  if (last === 'busy') throw new SourceBusyError(`DesktopCal이 데이터 파일을 쓰는 중입니다. 잠시 뒤 다시 해 보세요: ${dbPath}`);
  throw new SourceCorruptError(`DesktopCal 데이터 파일을 읽을 수 없습니다: ${dbPath}`);
}

function isBeingWritten(dbPath: string): boolean {
  return existsSync(`${dbPath}-journal`);
}

function readFromCopy(dbPath: string): SourceRow[] | 'busy' | 'corrupt' {
  const dir = mkdtempSync(join(tmpdir(), 'calfif-import-'));
  try {
    const copy = join(dir, 'calendar.db');
    try {
      const before = statSync(dbPath);
      copyFileSync(dbPath, copy);
      const after = statSync(dbPath);
      // 복사하는 사이에 원본이 바뀌었으면 복사본이 중간 상태일 수 있다.
      if (isBeingWritten(dbPath) || before.mtimeMs !== after.mtimeMs || before.size !== after.size) return 'busy';
    } catch {
      return 'busy';
    }
    return queryCopy(copy) ?? 'corrupt';
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

function queryCopy(copyPath: string): SourceRow[] | null {
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(copyPath, { readOnly: true });
    const check = db.prepare('PRAGMA quick_check').all();
    if (check.length !== 1 || check[0].quick_check !== 'ok') return null;
    const rows = db.prepare('select it_unique_id, it_content, it_bgcolor, it_stime from item_table').all();
    return rows.map((r) => ({
      key: asText(r.it_unique_id) ?? '',
      content: asText(r.it_content),
      bgcolor: asText(r.it_bgcolor),
      stime: asNumber(r.it_stime),
    }));
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

function asText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  if (v instanceof Uint8Array) return new TextDecoder().decode(v);
  return String(v);
}

function asNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}
