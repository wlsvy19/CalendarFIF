import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { splitDateKey } from '../core/dates';
import type { DayValue } from '../core/types';
import { convertRows, type ConvertedDay } from './convert';
import { createFollower } from './follow';
import type { LiteMonthStore } from './liteStore';
import { checkDeletes, planEdits, type DeleteCheck } from './plan';
import { dayReport, previewReport, verifyReport } from './report';
import { SourceBusyError, SourceCorruptError, SourceMissingError, defaultDbPath, readSourceRows } from './source';
import { ImportStateCorruptError, defaultStatePath, loadState, saveState } from './stateFile';
import { uploadEdits, verifyAgainstCloud } from './upload';

export class UsageError extends Error {}

export type CliOptions = { mode: 'preview' | 'upload' | 'follow'; dbPath: string; statePath: string; show: string[]; yes: boolean; allowDeletes: boolean };

export const USAGE = [
  '사용법: npm run import -- [--preview | --upload | --follow] [--db <경로>] [--state <경로>] [--show <YYYY-MM-DD>]... [--yes] [--allow-deletes]',
  '  --preview   읽고 변환한 결과만 보여 준다(기본). 클라우드에 접속하지 않는다.',
  '  --upload    바뀐 날짜를 클라우드에 올리고 대조한다.',
  '  --follow    올린 뒤 DesktopCal 파일을 지켜보며 바뀔 때마다 올린다.',
  '  --db        DesktopCal 데이터 파일 경로',
  '  --state     가져오기 상태 파일 경로',
  '  --show      그 날짜의 변환 결과를 화면에 보여 준다. 여러 번 줄 수 있다.',
  '  --yes       올리기 전에 묻지 않는다.',
  '  --allow-deletes  DesktopCal에서 사라진 날짜가 많아도 지운다(--upload와만 쓴다).',
].join('\n');

export function parseArgs(argv: string[], env: Record<string, string | undefined>): CliOptions {
  const modes: CliOptions['mode'][] = [];
  let dbPath: string | undefined;
  let statePath: string | undefined;
  const show: string[] = [];
  let yes = false;
  let allowDeletes = false;

  const value = (i: number, flag: string): string => {
    const v = argv[i];
    if (v === undefined || v.startsWith('--')) throw new UsageError(`${flag} 뒤에 값이 없습니다.`);
    return v;
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--preview':
      case '--upload':
      case '--follow':
        modes.push(arg.slice(2) as CliOptions['mode']);
        break;
      case '--db':
        dbPath = value(++i, arg);
        break;
      case '--state':
        statePath = value(++i, arg);
        break;
      case '--show': {
        const dateKey = value(++i, arg);
        if (!splitDateKey(dateKey)) throw new UsageError(`--show의 날짜가 잘못됐습니다: ${dateKey}`);
        show.push(dateKey);
        break;
      }
      case '--yes':
        yes = true;
        break;
      case '--allow-deletes':
        allowDeletes = true;
        break;
      default:
        throw new UsageError(`모르는 인자입니다: ${arg}`);
    }
  }
  if (modes.length > 1) throw new UsageError('--preview, --upload, --follow 중 하나만 줄 수 있습니다.');
  if (allowDeletes && modes[0] !== 'upload') throw new UsageError('--allow-deletes는 --upload와만 쓸 수 있습니다.');

  try {
    dbPath ??= defaultDbPath(env);
    statePath ??= defaultStatePath(env);
  } catch (e) {
    throw new UsageError(`${e instanceof Error ? e.message : String(e)} --db와 --state로 경로를 주세요.`);
  }
  return { mode: modes[0] ?? 'preview', dbPath, statePath, show, yes, allowDeletes };
}

export type CliDeps = {
  out(line: string): void;
  connect(): Promise<{ projectId: string; uid: string; store: LiteMonthStore }>;
  confirm(question: string): Promise<boolean>;
  now(): number;
};

type Connection = Awaited<ReturnType<CliDeps['connect']>>;

function friendlyMessage(e: unknown, dbPath: string): string {
  if (e instanceof SourceMissingError) return `DesktopCal 데이터 파일을 찾지 못했습니다: ${dbPath}`;
  if (e instanceof SourceBusyError) return 'DesktopCal이 파일을 쓰는 중입니다. 잠시 뒤 다시 실행해 주세요.';
  if (e instanceof SourceCorruptError) return '복사한 파일을 읽을 수 없습니다. 다시 실행해 주세요.';
  if (e instanceof ImportStateCorruptError) return e.message;
  return `오류: ${e instanceof Error ? e.message : String(e)}`;
}

async function readDays(dbPath: string) {
  return convertRows(await readSourceRows(dbPath));
}

/**
 * 바뀐 날짜를 올리고, 달이 끝날 때마다 상태 파일을 저장한다. 올린 날짜 수를 돌려준다.
 * 지운 날짜가 너무 많으면(막아야 하면) 아무것도 올리거나 저장하지 않고 검사 결과를 돌려준다.
 */
async function uploadChanges(
  opts: CliOptions,
  conn: Connection,
  days: Map<string, ConvertedDay>,
  now: number,
): Promise<{ uploaded: number } | { blocked: DeleteCheck }> {
  const state = loadState(opts.statePath, conn.projectId, conn.uid);
  const edits = planEdits(days, state, now);
  const check = checkDeletes(edits, state);
  if (check.blocked && !opts.allowDeletes) return { blocked: check };
  const working: Record<string, DayValue> = { ...(state ?? {}) };
  const result = await uploadEdits(conn.store, edits, (_monthId, done) => {
    for (const edit of done) {
      const dateKey = `${edit.monthId}-${edit.day}`;
      if (edit.next.text === '' && edit.next.color === '') delete working[dateKey];
      else working[dateKey] = { text: edit.next.text, color: edit.next.color };
    }
    saveState(opts.statePath, { projectId: conn.projectId, uid: conn.uid, days: working });
  });
  return { uploaded: result.days };
}

function clock(ms: number): string {
  const d = new Date(ms);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
}

function blockedFollowLine(now: number, check: DeleteCheck): string {
  return `${clock(now)} 사라진 날짜가 ${check.deletes}일이라 올리지 않았습니다. 확인한 뒤 --upload --allow-deletes로 한 번 실행해 주세요.`;
}

export async function main(argv: string[], env: Record<string, string | undefined>, deps: CliDeps): Promise<number> {
  let opts: CliOptions;
  try {
    opts = parseArgs(argv, env);
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    deps.out(e.message);
    deps.out(USAGE);
    return 2;
  }

  try {
    const { days, stats } = await readDays(opts.dbPath);
    deps.out(previewReport(stats, days));
    for (const dateKey of opts.show) deps.out(dayReport(dateKey, days.get(dateKey)));
    if (opts.mode === 'preview') return 0;

    if (!opts.yes && !(await deps.confirm('클라우드에 올릴까요?'))) {
      deps.out('올리지 않았습니다.');
      return 0;
    }
    const conn = await deps.connect();
    const first = await uploadChanges(opts, conn, days, deps.now());
    if ('blocked' in first) {
      if (opts.mode === 'upload') {
        deps.out(
          `DesktopCal에서 사라진 날짜가 ${first.blocked.deletes}일입니다(지난번에 가져온 ${first.blocked.stateDays}일 중). 파일이 바뀌었거나 다른 파일일 수 있어 올리지 않았습니다. 맞다면 --allow-deletes를 붙여 다시 실행해 주세요.`,
        );
        return 1;
      }
      deps.out(blockedFollowLine(deps.now(), first.blocked));
    } else {
      deps.out(`바뀐 날짜 ${first.uploaded}일을 올렸습니다.`);
      deps.out(verifyReport(await verifyAgainstCloud(conn.store, days)));
    }
    if (opts.mode === 'upload') return 0;

    deps.out('DesktopCal 파일을 지켜봅니다. 끝내려면 Ctrl+C를 누르세요.');
    const follower = createFollower({
      dbPath: opts.dbPath,
      log: deps.out,
      runOnce: async () => {
        try {
          const latest = await readDays(opts.dbPath);
          const round = await uploadChanges(opts, conn, latest.days, deps.now());
          if ('blocked' in round) deps.out(blockedFollowLine(deps.now(), round.blocked));
          else deps.out(`${clock(deps.now())} 바뀐 날짜 ${round.uploaded}일을 올렸습니다.`);
        } catch (e) {
          throw new Error(`${clock(deps.now())} ${friendlyMessage(e, opts.dbPath)}`);
        }
      },
    });
    follower.start();
    await new Promise<void>((done) => process.once('SIGINT', done));
    follower.stop();
    return 0;
  } catch (e) {
    deps.out(friendlyMessage(e, opts.dbPath));
    return 1;
  }
}

// ---- 실제로 실행할 때만 쓰는 부분 ----

function readEnvLocal(path: string): Record<string, string> {
  if (!existsSync(path)) throw new Error(`${path}이 없습니다. .env.example을 보고 Firebase 설정을 적어 주세요.`);
  const values: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) values[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return values;
}

async function askLine(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

/** 입력한 글자를 화면에 보이지 않게 한 줄을 읽는다. */
function askHidden(question: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) return askLine(question);
  process.stdout.write(question);
  return new Promise((resolveAnswer) => {
    let answer = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          stdin.off('data', onData);
          stdin.setRawMode(false);
          stdin.pause();
          process.stdout.write('\n');
          resolveAnswer(answer);
          return;
        }
        if (ch === '\u0003') {
          stdin.setRawMode(false);
          process.stdout.write('\n');
          process.exit(130);
        }
        if (ch === '\u007f' || ch === '\b') answer = answer.slice(0, -1);
        else answer += ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function connectFromEnvLocal(env: Record<string, string | undefined>): Promise<Connection> {
  const { initializeApp } = await import('firebase/app');
  const { getAuth, signInWithEmailAndPassword } = await import('firebase/auth');
  const { getFirestore } = await import('firebase/firestore/lite');
  const { LiteMonthStore } = await import('./liteStore');

  const cfg = readEnvLocal('.env.local');
  const projectId = cfg.VITE_FIREBASE_PROJECT_ID;
  if (!cfg.VITE_FIREBASE_API_KEY || !projectId) throw new Error('.env.local에 VITE_FIREBASE_API_KEY와 VITE_FIREBASE_PROJECT_ID가 있어야 합니다.');
  const app = initializeApp({
    apiKey: cfg.VITE_FIREBASE_API_KEY,
    authDomain: cfg.VITE_FIREBASE_AUTH_DOMAIN,
    projectId,
    appId: cfg.VITE_FIREBASE_APP_ID,
  });
  const email = env.CALFIF_EMAIL || (await askLine('이메일: '));
  const password = env.CALFIF_PASSWORD || (await askHidden('비밀번호: '));
  const { user } = await signInWithEmailAndPassword(getAuth(app), email, password);
  return { projectId, uid: user.uid, store: new LiteMonthStore(getFirestore(app), user.uid) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const env = process.env;
  main(process.argv.slice(2), env, {
    out: (line) => console.log(line),
    connect: () => connectFromEnvLocal(env),
    confirm: async (question) => /^(y|yes|예|네|ㅇ)$/i.test(await askLine(`${question} (y/N) `)),
    now: () => Date.now(),
  }).then(
    (code) => process.exit(code),
    (e) => {
      console.error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    },
  );
}
