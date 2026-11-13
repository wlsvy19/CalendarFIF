import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, win32 } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as sleep } from 'node:timers/promises';
import type { SourceRow } from './convert';

export class SourceMissingError extends Error {}
/** code: 마지막 시도에서 복사가 실패했으면 그 오류 코드(예: EBUSY). */
export class SourceBusyError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}
export class SourceCorruptError extends Error {}

type Failure = { failed: 'busy' | 'corrupt'; code?: string };

const errorCode = (e: unknown): string | undefined => (e as NodeJS.ErrnoException | undefined)?.code;

export function defaultDbPath(env: Record<string, string | undefined>): string {
  if (!env.APPDATA) throw new SourceMissingError('APPDATA 환경 변수가 없어 DesktopCal 데이터 위치를 알 수 없습니다.');
  return win32.join(env.APPDATA, 'CalendarTask', 'Db', 'calendar.db');
}

/**
 * DesktopCal의 calendar.db를 읽는다. 원본은 읽기로만 열어 내용을 메모리로 읽고, 임시 폴더에 쓴 복사본만
 * 읽기 전용 데이터베이스로 연다. 끝나면(실패해도) 복사본을 지운다.
 */
export async function readSourceRows(dbPath: string, opts?: { retries?: number; retryDelayMs?: number }): Promise<SourceRow[]> {
  const retries = opts?.retries ?? 5;
  const retryDelayMs = opts?.retryDelayMs ?? 1000;
  let last: Failure = { failed: 'busy' };

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(retryDelayMs);
    if (!existsSync(dbPath)) throw missing(dbPath);
    if (isBeingWritten(dbPath)) {
      last = { failed: 'busy' };
      continue;
    }
    const result = readFromCopy(dbPath);
    if (Array.isArray(result)) return result;
    last = result;
  }

  if (last.failed === 'busy') {
    const suffix = last.code ? ` (${last.code})` : '';
    throw new SourceBusyError(`DesktopCal이 데이터 파일을 쓰는 중입니다. 잠시 뒤 다시 해 보세요: ${dbPath}${suffix}`, last.code);
  }
  throw new SourceCorruptError(`DesktopCal 데이터 파일을 읽을 수 없습니다: ${dbPath}`);
}

function missing(dbPath: string): SourceMissingError {
  return new SourceMissingError(`DesktopCal 데이터 파일이 없습니다: ${dbPath}`);
}

function isBeingWritten(dbPath: string): boolean {
  return existsSync(`${dbPath}-journal`);
}

function readFromCopy(dbPath: string): SourceRow[] | Failure {
  const dir = mkdtempSync(join(tmpdir(), 'calfif-import-'));
  try {
    const copy = join(dir, 'calendar.db');
    let bytes: Buffer;
    try {
      const before = statSync(dbPath);
      // copyFileSync는 원본을 다른 프로그램이 쓰지 못하게 열 수 있어서, 읽기로만 열어 메모리로 읽는다.
      bytes = readFileSync(dbPath);
      const after = statSync(dbPath);
      // 읽는 사이에 원본이 바뀌었으면 읽은 내용이 중간 상태일 수 있다.
      if (isBeingWritten(dbPath) || before.mtimeMs !== after.mtimeMs || before.size !== after.size) return { failed: 'busy' };
    } catch (e) {
      if (errorCode(e) === 'ENOENT') throw missing(dbPath);
      return { failed: 'busy', code: errorCode(e) };
    }
    try {
      writeFileSync(copy, bytes);
    } catch (e) {
      return { failed: 'busy', code: errorCode(e) };
    }
    return queryCopy(copy) ?? { failed: 'corrupt' };
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      // 임시 복사본 정리는 최선만 한다. 실패해도 읽은 결과나 원래 오류를 바꾸지 않는다.
    }
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
