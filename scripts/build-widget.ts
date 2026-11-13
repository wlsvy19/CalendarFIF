// 위젯을 Scriptable에 붙여 넣을 파일 하나로 만든다: public/widget/calendarfif-widget.js
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FAKE_HOST_MARKER } from '../src/widget/fakeHost';

// 앞의 세 줄은 Scriptable이 읽는다. 그대로 둔다.
const header = (version: string): string => `// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-blue; icon-glyph: calendar-alt;
// CalendarFIF 위젯 ${version}. 웹앱 설정의 "위젯 스크립트 복사"로 받은 것을 그대로 붙여 넣는다.
`;
const start = (version: string): string => `
await CalendarFIFWidget.run({ Keychain, Request, Alert, DrawContext, ListWidget, FileManager, Script, config, args, Device, Color, Font, Size, Rect, Point, Path }, { projectId: "__PROJECT_ID__", apiKey: "__API_KEY__", appUrl: "__APP_URL__", version: ${JSON.stringify(version)} });
Script.complete();
`;
const PLACEHOLDERS = ['__PROJECT_ID__', '__API_KEY__', '__APP_URL__'];

/** 스크립트의 버전 글: package.json의 버전과 만든 날(이 PC의 날짜). 예: '0.4.0 (2026-11-14)'. */
export function versionText(version: string, built: Date): string {
  const pad2 = (n: number): string => String(n).padStart(2, '0');
  return `${version} (${built.getFullYear()}-${pad2(built.getMonth() + 1)}-${pad2(built.getDate())})`;
}

/** 묶은 iife 글에 머리말과 시작 줄을 붙인다. version은 versionText의 글이다. */
export function finishBundle(iife: string, version: string): string {
  return `${header(version)}${iife.trimEnd()}\n${start(version)}`;
}

const count = (text: string, part: string): number => text.split(part).length - 1;

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
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (body: string) => unknown;
    new AsyncFunction(script);
  } catch (e) {
    problems.push(`async 함수 본문으로 읽히지 않는다: ${e instanceof Error ? e.message : String(e)}`);
  }
  return problems;
}

function main(): void {
  const built = spawnSync(process.execPath, [resolve('node_modules/vite/bin/vite.js'), 'build', '-c', 'vite.widget.config.ts'], { stdio: 'inherit' });
  if (built.status !== 0) process.exit(built.status ?? 1);
  const { version } = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { version: string };
  const script = finishBundle(readFileSync(resolve('build/widget/widget.js'), 'utf8'), versionText(version, new Date()));
  const problems = bundleProblems(script);
  if (problems.length > 0) {
    console.error('위젯 묶음에 문제가 있다:');
    for (const p of problems) console.error(`- ${p}`);
    process.exit(1);
  }
  const out = resolve('public/widget/calendarfif-widget.js');
  mkdirSync(resolve('public/widget'), { recursive: true });
  writeFileSync(out, script, 'utf8');
  console.log(`위젯 스크립트를 만들었다: public/widget/calendarfif-widget.js (${Buffer.byteLength(script)} 바이트)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
