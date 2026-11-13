import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, win32 } from 'node:path';
import type { DayValue } from '../core/types';

export class ImportStateCorruptError extends Error {}

/** 지난번 가져오기에서 DesktopCal에 있던 값. 다음 가져오기에서 무엇이 바뀌었는지 가리는 기준이다. */
export type ImportStateFile = { projectId: string; uid: string; days: Record<string, DayValue> };

export function defaultStatePath(env: Record<string, string | undefined>): string {
  if (!env.LOCALAPPDATA) throw new Error('LOCALAPPDATA 환경 변수가 없어 상태 파일 위치를 알 수 없습니다.');
  return win32.join(env.LOCALAPPDATA, 'CalendarFIF', 'import-state.json');
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function parseState(path: string): ImportStateFile {
  const corrupt = () => new ImportStateCorruptError(`가져오기 상태 파일을 읽을 수 없습니다: ${path}`);
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw corrupt();
  }
  if (!isObject(data) || typeof data.projectId !== 'string' || typeof data.uid !== 'string' || !isObject(data.days)) throw corrupt();
  const days: Record<string, DayValue> = {};
  for (const [dateKey, value] of Object.entries(data.days)) {
    if (!isObject(value) || typeof value.text !== 'string' || typeof value.color !== 'string') throw corrupt();
    days[dateKey] = { text: value.text, color: value.color };
  }
  return { projectId: data.projectId, uid: data.uid, days };
}

/** 상태 파일이 없거나 다른 프로젝트·계정의 것이면 null. 읽히지 않으면 ImportStateCorruptError. */
export function loadState(path: string, projectId: string, uid: string): Record<string, DayValue> | null {
  if (!existsSync(path)) return null;
  const file = parseState(path);
  return file.projectId === projectId && file.uid === uid ? file.days : null;
}

/** 쓰다가 끊겨도 기존 파일이 깨지지 않게 임시 파일에 쓰고 이름을 바꾼다. */
export function saveState(path: string, file: ImportStateFile): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, JSON.stringify(file), 'utf8');
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(tmp, path);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (attempt < 2 && (code === 'EPERM' || code === 'EBUSY' || code === 'EACCES')) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
        continue;
      }
      rmSync(tmp, { force: true });
      throw e;
    }
  }
}
