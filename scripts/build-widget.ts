// 위젯을 Scriptable에 붙여 넣을 파일 하나로 만든다: public/widget/calendarfif-widget.js
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FAKE_HOST_MARKER, makeFakeHost, widgetTexts } from '../src/widget/fakeHost';
import type { Host } from '../src/widget/host';
import { LIB_END, LIB_NAME, type Lib } from '../src/widget/update';

/** 시작 줄이 run에 넘기는 Scriptable의 전역들. Host의 키와 같아야 한다. */
const GLOBALS = ['Keychain', 'Request', 'Alert', 'DrawContext', 'ListWidget', 'FileManager', 'Script', 'Notification', 'config', 'args', 'Device', 'Color', 'Font', 'Size', 'Rect', 'Point', 'Path', 'Timer'] as const satisfies readonly (keyof Host)[];

// importModule은 받아 둔 위젯 코드를 읽을 때만 쓴다(src/widget/update.ts). 없어도 위젯은 돌아야 하므로 있는지 보고 넘긴다.
const IMPORT_MODULE = 'importModule: typeof importModule === "function" ? importModule : undefined';
/**
 * 붙여 넣은 스크립트가 받아 온 위젯 코드에 넘기는 이름들. 0.9.0에서 굳었다: 이미 붙여 넣은 스크립트는 바뀌지 않으므로,
 * 받아 쓰는 위젯 코드는 이 이름들만 받는다고 보고 만들어야 한다. 새 전역이 필요하면 받아 쓰는 코드가 globalThis에서 직접 가져온다.
 * 설정(projectId, apiKey, appUrl, holidayUrl, version)도 마찬가지로 굳었다.
 */
export const FROZEN_HOST_KEYS: readonly string[] = [...GLOBALS, 'importModule'];

// 앞의 세 줄은 Scriptable이 읽는다. 그대로 둔다.
const header = (version: string): string => `// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-blue; icon-glyph: calendar-alt;
// CalendarFIF 위젯 ${version}. 웹앱 설정의 "위젯 스크립트 복사"로 받은 것을 그대로 붙여 넣는다.
`;
// __HOLIDAY_URL__은 공휴일 자료 파일의 주소다. 웹앱이 채우며, 준비 전이면 빈 글로 채운다(위젯은 계산한 공휴일만 쓴다).
const start = (version: string): string => `
await CalendarFIFWidget.run({ ${GLOBALS.join(', ')}, ${IMPORT_MODULE} }, { projectId: "__PROJECT_ID__", apiKey: "__API_KEY__", appUrl: "__APP_URL__", holidayUrl: "__HOLIDAY_URL__", version: ${JSON.stringify(version)} });
Script.complete();
`;
const PLACEHOLDERS = ['__PROJECT_ID__', '__API_KEY__', '__APP_URL__', '__HOLIDAY_URL__'];

/** 스크립트의 버전 글: package.json의 버전과 만든 날(이 PC의 날짜). 예: '0.4.0 (2026-11-14)'. */
export function versionText(version: string, built: Date): string {
  const pad2 = (n: number): string => String(n).padStart(2, '0');
  return `${version} (${built.getFullYear()}-${pad2(built.getMonth() + 1)}-${pad2(built.getDate())})`;
}

/** 묶은 iife 글에 머리말과 시작 줄을 붙인다. version은 versionText의 글이다. */
export function finishBundle(iife: string, version: string): string {
  return `${header(version)}${iife.trimEnd()}\n${start(version)}`;
}

/**
 * 붙여 넣은 위젯 스크립트가 스스로 받아 쓰는 위젯 코드(src/widget/update.ts). 설정값은 없고(받는 쪽이 넘긴다)
 * module.exports에 버전과 run을 둔다. 마지막 줄은 받다가 끊긴 파일을 가려내는 표시다.
 */
export function finishLib(iife: string, version: string): string {
  const text = `// CalendarFIF widget code ${version}. The pasted widget script downloads this file by itself. Do not paste it into Scriptable.\n${iife.trimEnd()}\nmodule.exports = { version: ${JSON.stringify(version)}, run: CalendarFIFWidget.run };\n${LIB_END}\n`;
  // ASCII 글자만 남긴다: 한글은 \uXXXX로 적는다(글자열, 템플릿, 정규식, 주석 어디서든 같은 뜻이다).
  // 받는 쪽이 글자 수로 온전한지 보는데, 이렇게 하면 글자 수와 바이트 수가 같아 받는 쪽의 글자 풀이와 상관이 없다.
  return text.replace(/[^\x00-\x7f]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/**
 * finishLib는 ASCII가 아닌 글자를 어디에 있든 \uXXXX로 바꾼다. 그렇게 바꾸면 뜻이 달라지는 글이 묶음에 있는지 본다:
 * 역슬래시 바로 뒤의 글자(\가 → \\uac00이 되어 다른 글이 된다), 줄 나눔 글자 U+2028/U+2029(주석 안이면 주석이 끊기지 않게 된다),
 * 날 글자열을 읽는 String.raw. 문제가 없으면 빈 배열.
 */
export function escapeProblems(iife: string): string[] {
  const problems: string[] = [];
  if (/\\[^\x00-\x7f]/.test(iife)) problems.push('역슬래시 바로 뒤에 ASCII가 아닌 글자가 있다');
  if (/[\u2028\u2029]/.test(iife)) problems.push('줄 나눔 글자 U+2028이나 U+2029가 있다');
  if (/String\.raw/.test(iife)) problems.push('String.raw를 쓴다');
  return problems;
}

/** 버전 파일(version.json)의 글. chars는 위젯 코드의 글자 수(JS 문자열의 길이)다. */
export function versionFile(lib: string, version: string): string {
  return `${JSON.stringify({ version, chars: lib.length })}\n`;
}

const count = (text: string, part: string): number => text.split(part).length - 1;

type AsyncFunctionCtor = new (...paramsAndBody: string[]) => (...args: unknown[]) => Promise<unknown>;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as AsyncFunctionCtor;

/** 묶음 파일의 문제들. 문제가 없으면 빈 배열. */
export function bundleProblems(script: string): string[] {
  const problems: string[] = [];
  if (/^\s*(import|export)\s/m.test(script)) problems.push('import 또는 export 문이 있다');
  if (/\brequire\s*\(/.test(script)) problems.push('require( 호출이 있다');
  if (/\bimport\s*\(/.test(script)) problems.push('동적 import( 호출이 있다');
  for (const p of PLACEHOLDERS) {
    const n = count(script, p);
    if (n !== 1) problems.push(`자리표시자 ${p}가 ${n}번 나온다(한 번이어야 한다)`);
  }
  for (const bad of ['demo-calfif', '127.0.0.1', 'localhost']) {
    if (script.includes(bad)) problems.push(`시험용 값 ${bad}이 들어 있다`);
  }
  if (script.includes(FAKE_HOST_MARKER)) problems.push('시험용 가짜 호스트의 코드가 들어 있다');
  try {
    new AsyncFunction(script);
  } catch (e) {
    problems.push(`async 함수 본문으로 읽히지 않는다: ${e instanceof Error ? e.message : String(e)}`);
  }
  return problems;
}

/** 로그인 전의 위젯이 보여야 하는 글. 그리기가 run 안에서 깨지면 오류 위젯이 대신 놓이므로 이것으로 가른다. */
const LOGIN_HINT = '로그인이 필요합니다';

/**
 * 묶음 파일을 Scriptable처럼 한 번 실행해 본다: 시작 줄이 넘기는 이름들을 매개변수로 하는 async 함수의 본문으로,
 * 가짜 Scriptable(로그인 전, 위젯으로 실행)의 것들을 넘긴다. 네트워크는 쓰지 않는다.
 * 위젯 하나를 두고, 그 위젯이 로그인 안내를 보이고, Script.complete()를 한 번 불러야 한다. 문제가 없으면 빈 배열.
 */
export async function startProblems(script: string): Promise<string[]> {
  const host = makeFakeHost({ handler: () => { throw new Error('시작 확인은 네트워크를 쓰지 않는다'); } });
  const problems: string[] = [];
  try {
    await new AsyncFunction(...GLOBALS, script)(...GLOBALS.map((name) => host[name]));
  } catch (e) {
    problems.push(`실행하다 오류가 났다: ${e instanceof Error ? e.message : String(e)}`);
  }
  const set = host.state.setWidgets.length;
  if (set !== 1) problems.push(`위젯을 ${set}번 두었다(한 번이어야 한다)`);
  else {
    const texts = widgetTexts(host, host.state.setWidgets[0]);
    if (!texts.includes(LOGIN_HINT)) problems.push(`둔 위젯에 "${LOGIN_HINT}"가 없다. 위젯의 글: ${texts.length > 0 ? texts.join(' | ') : '(없음)'}`);
  }
  if (host.state.completed !== 1) problems.push(`Script.complete()가 ${host.state.completed}번 불렸다(한 번이어야 한다)`);
  return problems;
}

/**
 * 받아 쓰는 위젯 코드의 문제들. 설정값의 자리표시자가 없어야 하고, module을 받는 함수로 돌리면 exports에 그 버전과 run이 있어야 하며,
 * 넘겨받은 것처럼 돌리면(로그인 전, 위젯으로 실행) 로그인 안내 위젯 하나를 둬야 한다. 문제가 없으면 빈 배열.
 */
export async function libProblems(lib: string, version: string): Promise<string[]> {
  const problems: string[] = [];
  if (/^\s*(import|export)\s/m.test(lib)) problems.push('import 또는 export 문이 있다');
  for (const p of PLACEHOLDERS) if (lib.includes(p)) problems.push(`자리표시자 ${p}가 들어 있다`);
  for (const bad of ['demo-calfif', '127.0.0.1', 'localhost']) if (lib.includes(bad)) problems.push(`시험용 값 ${bad}이 들어 있다`);
  if (lib.includes(FAKE_HOST_MARKER)) problems.push('시험용 가짜 호스트의 코드가 들어 있다');
  if (!lib.trimEnd().endsWith(LIB_END)) problems.push('끝 줄이 없다');
  if (/[^\x00-\x7f]/.test(lib)) problems.push('ASCII가 아닌 글자가 있다');
  if (lib.includes('\r')) problems.push('CR 글자가 있다');
  let exported: unknown;
  try {
    const module: { exports: unknown } = { exports: {} };
    new Function('module', lib)(module);
    exported = module.exports;
  } catch (e) {
    return [...problems, `읽다가 오류가 났다: ${e instanceof Error ? e.message : String(e)}`];
  }
  const good = (x: unknown): x is Lib => typeof x === 'object' && x !== null && (x as Lib).version === version && typeof (x as Lib).run === 'function';
  if (!good(exported)) return [...problems, 'module.exports에 그 버전과 run이 없다'];
  const host = makeFakeHost({ handler: () => { throw new Error('시작 확인은 네트워크를 쓰지 않는다'); } });
  // 이미 붙여 넣은 스크립트가 넘기는 이름만 남긴다. 그 밖의 것을 host에서 찾는 코드는 여기서 걸린다.
  for (const key of Object.keys(host)) if (key !== 'state' && !FROZEN_HOST_KEYS.includes(key)) delete (host as Record<string, unknown>)[key];
  try {
    await exported.run(host, { projectId: 'p', apiKey: 'k', appUrl: 'https://example.invalid', version, handedOver: true });
  } catch (e) {
    problems.push(`실행하다 오류가 났다: ${e instanceof Error ? e.message : String(e)}`);
  }
  const set = host.state.setWidgets.length;
  if (set !== 1) problems.push(`위젯을 ${set}번 두었다(한 번이어야 한다)`);
  else if (!widgetTexts(host, host.state.setWidgets[0]).includes(LOGIN_HINT)) problems.push(`둔 위젯에 "${LOGIN_HINT}"가 없다`);
  if (host.state.requests.length > 0) problems.push('넘겨받은 실행이 네트워크를 썼다(업데이트 확인은 붙여 넣은 스크립트가 한다)');
  if (host.state.completed !== 0) problems.push('넘겨받은 실행이 Script.complete()를 불렀다(붙여 넣은 스크립트가 부른다)');
  return problems;
}

async function main(): Promise<void> {
  const built = spawnSync(process.execPath, [resolve('node_modules/vite/bin/vite.js'), 'build', '-c', 'vite.widget.config.ts'], { stdio: 'inherit' });
  if (built.status !== 0) process.exit(built.status ?? 1);
  const { version } = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { version: string };
  const iife = readFileSync(resolve('build/widget/widget.js'), 'utf8');
  const text = versionText(version, new Date());
  const script = finishBundle(iife, text);
  const lib = finishLib(iife, text);
  const problems = bundleProblems(script);
  if (problems.length === 0) problems.push(...(await startProblems(script)));
  problems.push(...[...escapeProblems(iife), ...(await libProblems(lib, text))].map((p) => `받아 쓰는 위젯 코드: ${p}`));
  if (problems.length > 0) {
    console.error('위젯 묶음에 문제가 있다:');
    for (const p of problems) console.error(`- ${p}`);
    process.exit(1);
  }
  const out = resolve('public/widget/calendarfif-widget.js');
  mkdirSync(resolve('public/widget'), { recursive: true });
  writeFileSync(out, script, 'utf8');
  // 붙여 넣은 스크립트가 스스로 받아 가는 것들(src/widget/update.ts).
  writeFileSync(resolve(`public/widget/${LIB_NAME}.js`), lib, 'utf8');
  writeFileSync(resolve('public/widget/version.json'), versionFile(lib, text), 'utf8');
  console.log(`위젯 스크립트를 만들었다: public/widget/calendarfif-widget.js (${Buffer.byteLength(script)} 바이트, 시작 확인 통과)`);
  console.log(`받아 쓰는 위젯 코드를 만들었다: public/widget/${LIB_NAME}.js, public/widget/version.json (${text})`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
