// 푸시 알림에 쓰는 두 파일을 만든다(둘 다 git에 없다).
// - public/push/calendarfif-push.js: 사용자가 Google Apps Script에 붙여 넣는 알림 보내는 스크립트.
// - public/push-sw.js: 웹앱의 서비스 워커가 importScripts로 읽는 푸시 처리.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { versionText } from './build-widget';

const GAS_HOST = ['UrlFetchApp', 'PropertiesService', 'CacheService', 'LockService', 'Utilities', 'ScriptApp', 'Session', 'Logger'] as const;

const gasHeader = (version: string): string => `// CalendarFIF 알림 보내기 ${version}
// Google Apps Script(script.google.com)에 이 내용을 그대로 붙여 넣는다. 설치 방법은 CalendarFIF 저장소 README의 "아이폰 푸시 알림"에 있다.
// 처음 한 번 setup을 실행하면 1분마다 tick이 돌며 시각이 된 알림을 아이폰으로 보낸다.
// 필요한 것: 프로젝트 설정의 시간대 (GMT+09:00) 서울, 스크립트 속성 SERVICE_ACCOUNT(Firebase 서비스 계정 키).
`;
const gasTail = `
function calendarFifHost_() {
  return { ${GAS_HOST.map((n) => `${n}: ${n}`).join(', ')}, now: function () { return Date.now(); } };
}
/** 처음 한 번 실행한다: 설정을 확인하고 1분마다 도는 트리거를 건다. */
function setup() {
  CalendarFIFPush.setup(calendarFifHost_());
}
/** 1분마다 트리거가 부른다. */
function tick() {
  CalendarFIFPush.tick(calendarFifHost_());
}
`;

/** 묶은 iife 글에 머리말과 Apps Script가 부를 함수들을 붙인다. */
export function finishGas(iife: string, version: string): string {
  return `${gasHeader(version)}${iife.trimEnd()}\n${gasTail}`;
}

/** Apps Script 묶음의 문제. 가짜 Apps Script에서 setup을 돌려 본다(네트워크 없이, 키가 없다는 안내가 나와야 한다). */
export function gasProblems(script: string): string[] {
  const problems: string[] = [];
  if (/^\s*(import|export)\s/m.test(script)) problems.push('import 또는 export 문이 있다');
  if (/\brequire\s*\(|\bimport\s*\(/.test(script)) problems.push('require나 동적 import가 있다');
  for (const bad of ['demo-calfif', '127.0.0.1', 'localhost']) if (script.includes(bad)) problems.push(`시험용 값 ${bad}이 들어 있다`);
  const logs: string[] = [];
  const fake: Record<string, unknown> = {
    UrlFetchApp: { fetch: () => { throw new Error('시작 확인은 네트워크를 쓰지 않는다'); }, fetchAll: () => { throw new Error('네트워크 없음'); } },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => undefined }) },
    CacheService: { getScriptCache: () => ({ get: () => null, put: () => undefined, remove: () => undefined }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => undefined }) },
    Utilities: { computeRsaSha256Signature: () => [], base64EncodeWebSafe: () => '', sleep: () => undefined },
    ScriptApp: { getProjectTriggers: () => [], deleteTrigger: () => undefined, newTrigger: () => { throw new Error('트리거를 걸면 안 된다'); } },
    Session: { getScriptTimeZone: () => 'Asia/Seoul' },
    Logger: { log: (m: string) => logs.push(m) },
  };
  try {
    // Apps Script처럼 전역 함수로 읽은 뒤 setup을 부른다.
    new Function(...GAS_HOST, `${script}\nsetup();`)(...GAS_HOST.map((n) => fake[n]));
  } catch (e) {
    problems.push(`실행하다 오류가 났다: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!logs.some((l) => l.includes('SERVICE_ACCOUNT'))) problems.push(`키가 없다는 안내가 로그에 없다: ${logs.join(' | ') || '(없음)'}`);
  return problems;
}

/** 서비스 워커 묶음의 문제. 가짜 self에서 읽어 push와 notificationclick이 붙는지 본다. */
export function swProblems(script: string): string[] {
  const problems: string[] = [];
  if (/^\s*(import|export)\s/m.test(script)) problems.push('import 또는 export 문이 있다');
  const types: string[] = [];
  const self = { addEventListener: (t: string) => types.push(t), location: { origin: 'https://example.test' } };
  try {
    new Function('self', script)(self);
  } catch (e) {
    problems.push(`실행하다 오류가 났다: ${e instanceof Error ? e.message : String(e)}`);
  }
  for (const t of ['push', 'notificationclick']) if (!types.includes(t)) problems.push(`${t} 처리가 붙지 않았다`);
  return problems;
}

async function bundle(entry: string, name: string, outDir: string, target: string): Promise<string> {
  await build({
    configFile: false,
    publicDir: false,
    logLevel: 'warn',
    build: {
      lib: { entry, formats: ['iife'], name, fileName: () => 'out.js' },
      outDir,
      emptyOutDir: true,
      target,
      minify: false,
    },
  });
  return readFileSync(resolve(outDir, 'out.js'), 'utf8');
}

async function main(): Promise<void> {
  const { version } = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { version: string };
  // Apps Script(V8)는 최신 문법을 대부분 읽지만 묶음은 넓게 읽히도록 낮춘다.
  const gas = finishGas(await bundle('src/push/gasEntry.ts', 'CalendarFIFPush', 'build/push-gas', 'es2017'), versionText(version, new Date()));
  const sw = await bundle('src/push/swEntry.ts', 'CalendarFIFPushSw', 'build/push-sw', 'es2020');
  const problems = [...gasProblems(gas).map((p) => `알림 보내는 스크립트: ${p}`), ...swProblems(sw).map((p) => `서비스 워커: ${p}`)];
  if (problems.length > 0) {
    console.error('푸시 묶음에 문제가 있다:');
    for (const p of problems) console.error(`- ${p}`);
    process.exit(1);
  }
  mkdirSync(resolve('public/push'), { recursive: true });
  writeFileSync(resolve('public/push/calendarfif-push.js'), gas, 'utf8');
  writeFileSync(resolve('public/push-sw.js'), sw, 'utf8');
  console.log(`푸시 파일을 만들었다: public/push/calendarfif-push.js (${Buffer.byteLength(gas)} 바이트), public/push-sw.js (${Buffer.byteLength(sw)} 바이트), 시작 확인 통과`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
