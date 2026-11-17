import { describe, expect, it } from 'vitest';
import { FAKE_HOST_MARKER, makeFakeHost } from '../src/widget/fakeHost';
import { LIB_END } from '../src/widget/update';
import { bundleProblems, escapeProblems, finishBundle, finishLib, libProblems, startProblems, versionFile, versionText, webApiProblems } from './build-widget';

const iife = 'var CalendarFIFWidget = (function(exports) {\n\texports.run = async () => {};\n\treturn exports;\n})({});';
const VERSION = '0.4.0 (2026-11-14)';

describe('finishBundle', () => {
  const script = finishBundle(iife, VERSION);

  it('Scriptable 머리말이 맨 위에 오고, 넷째 줄에 버전과 만든 날짜가 있다', () => {
    expect(script.split('\n').slice(0, 4)).toEqual([
      '// Variables used by Scriptable.',
      '// These must be at the very top of the file. Do not edit.',
      '// icon-color: deep-blue; icon-glyph: calendar-alt;',
      '// CalendarFIF 위젯 0.4.0 (2026-11-14). 웹앱 설정의 "위젯 스크립트 복사"로 받은 것을 그대로 붙여 넣는다.',
    ]);
  });

  it('묶은 글 뒤에 시작 줄이 오고, 설정에 버전이 들어간다', () => {
    expect(script).toContain(iife);
    const lines = script.trimEnd().split('\n');
    expect(lines.at(-1)).toBe('Script.complete();');
    expect(lines.at(-2)).toBe('await CalendarFIFWidget.run({ Keychain, Request, Alert, DrawContext, ListWidget, FileManager, Script, Notification, config, args, Device, Color, Font, Size, Rect, Point, Path, Timer, importModule: typeof importModule === "function" ? importModule : undefined }, { projectId: "__PROJECT_ID__", apiKey: "__API_KEY__", appUrl: "__APP_URL__", holidayUrl: "__HOLIDAY_URL__", version: "0.4.0 (2026-11-14)" });');
  });

  it('버전은 JSON 글자열로 들어가 따옴표가 있어도 글이 깨지지 않는다', () => {
    const odd = finishBundle(iife, 'a"b\\c');
    expect(odd).toContain('version: "a\\"b\\\\c" });');
    expect(bundleProblems(odd)).toEqual([]);
  });

  it('문제가 없다', () => {
    expect(bundleProblems(script)).toEqual([]);
  });
});

describe('versionText', () => {
  it('package.json의 버전과 그 PC 시각의 날짜', () => {
    expect(versionText('0.4.0', new Date(2026, 10, 14, 23, 59))).toBe('0.4.0 (2026-11-14)');
    expect(versionText('1.2.3', new Date(2027, 0, 5, 0, 1))).toBe('1.2.3 (2027-01-05)');
  });
});

describe('bundleProblems', () => {
  const ok = finishBundle(iife, VERSION);
  const problems = (s: string) => bundleProblems(s).join('\n');

  it('import와 export 문, require 호출', () => {
    expect(problems(`import x from 'y';\n${ok}`)).toContain('import');
    expect(problems(`${ok}\nexport const a = 1;`)).toContain('export');
    expect(problems(`${ok}\nconst a = require('x');`)).toContain('require');
  });

  it('exports.run 같은 낱말은 export 문이 아니다', () => {
    expect(bundleProblems(ok)).toEqual([]);
  });

  it('자리표시자는 각각 정확히 한 번', () => {
    expect(problems(ok.replace('__API_KEY__', 'abc'))).toContain('__API_KEY__가 0번');
    expect(problems(`${ok}\n// __PROJECT_ID__`)).toContain('__PROJECT_ID__가 2번');
    expect(problems(ok.replace('__HOLIDAY_URL__', ''))).toContain('__HOLIDAY_URL__가 0번');
  });

  it('시험용 값', () => {
    expect(problems(`${ok}\n// demo-calfif`)).toContain('demo-calfif');
    expect(problems(`${ok}\n// http://127.0.0.1:9095`)).toContain('127.0.0.1');
    expect(problems(`${ok}\n// localhost`)).toContain('localhost');
  });

  it('async 함수 본문으로 읽히지 않는 글', () => {
    expect(problems(`${ok}\nconst = ;`)).toContain('async 함수 본문');
  });

  it('최상위 await가 있는 글도 읽힌다', () => {
    const withAwait = ok.replace('Script.complete();', 'await Promise.resolve(1);\nScript.complete();');
    expect(withAwait).toContain('await Promise.resolve(1);');
    expect(bundleProblems(withAwait)).toEqual([]);
  });

  it('동적 import( 호출', () => {
    expect(problems(ok + "\nconst m = await import('x');")).toContain('import(');
  });

  it('가짜 호스트의 표지', () => {
    expect(problems(`${ok}\n// ${FAKE_HOST_MARKER}`)).toContain('가짜 호스트');
  });
});

describe('시작 줄과 Host', () => {
  it('시작 줄이 넘기는 이름은 가짜 호스트의 키(state 빼고)와 같다', () => {
    const line = finishBundle(iife, VERSION).split('\n').find((l) => l.startsWith('await CalendarFIFWidget.run('))!;
    // importModule은 있는지 보고 넘기므로 '이름: 값' 꼴이다. 이름만 본다.
    const names = /^await CalendarFIFWidget\.run\(\{ ([^}]*) \}/.exec(line)![1].split(', ').map((n) => n.split(':')[0]);
    expect(names).toHaveLength(new Set(names).size);
    expect([...names].sort()).toEqual(Object.keys(makeFakeHost()).filter((k) => k !== 'state').sort());
  });
});

describe('startProblems: 묶은 파일을 가짜 Scriptable에서 한 번 실행해 본다', () => {
  // run의 몸통으로 위젯 하나를 두는 작은 묶음.
  const bundle = (body: string[]): string =>
    ['var CalendarFIFWidget = (function(exports) {', '\texports.run = async (host, cfg) => {', ...body.map((l) => `\t\t${l}`), '\t};', '\treturn exports;', '})({});'].join('\n');
  // 로그인 전의 위젯처럼 로그인 안내를 보인다.
  const good = bundle([
    'const w = new host.ListWidget();',
    'w.addText(host.Keychain.contains("calendarfif.refreshToken") ? "로그인됨" : "로그인이 필요합니다");',
    'w.addText(cfg.version);',
    'host.Script.setWidget(w);',
  ]);
  // 그림 한 장의 위젯: 그림에 그린 글이 위젯의 글이다.
  const picture = (text: string): string =>
    bundle([
      'const ctx = new host.DrawContext();',
      `ctx.drawTextInRect(${JSON.stringify(text)}, null);`,
      'const w = new host.ListWidget();',
      'w.backgroundImage = ctx.getImage();',
      'host.Script.setWidget(w);',
    ]);
  const problems = async (script: string): Promise<string> => (await startProblems(script)).join('\n');

  it('잘 만든 파일은 문제가 없다', async () => {
    expect(await startProblems(finishBundle(good, VERSION))).toEqual([]);
  });

  it('로그인 안내 대신 오류 위젯을 두면(그리기가 run 안에서 깨져 오류 위젯이 된 경우) 문제다', async () => {
    const errorOnly = bundle(['const w = new host.ListWidget();', 'w.addText("오류");', 'host.Script.setWidget(w);']);
    const out = await startProblems(finishBundle(errorOnly, VERSION));
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('로그인이 필요합니다');
    expect(out[0]).toContain('오류');
  });

  it('위젯에 둔 글만 본다: 두지 않은 위젯의 로그인 안내는 세지 않는다', async () => {
    const other = bundle([
      'new host.ListWidget().addText("로그인이 필요합니다");',
      'const w = new host.ListWidget();',
      'w.addText("오류");',
      'host.Script.setWidget(w);',
    ]);
    expect(await problems(finishBundle(other, VERSION))).toContain('로그인이 필요합니다');
  });

  it('그림 위젯은 그 그림에 그린 글을 본다', async () => {
    expect(await startProblems(finishBundle(picture('로그인이 필요합니다'), VERSION))).toEqual([]);
    expect(await problems(finishBundle(picture('오류'), VERSION))).toContain('로그인이 필요합니다');
  });

  it('시작 줄의 전역 이름이 틀리면', async () => {
    const script = finishBundle(good, VERSION).replace('ListWidget, FileManager', 'ListWidgets, FileManager');
    expect(script).toContain('{ Keychain, Request, Alert, DrawContext, ListWidgets, FileManager,');
    expect(await problems(script)).toContain('ListWidgets is not defined');
  });

  it('run이 없으면', async () => {
    const out = await problems(finishBundle(good.replace('exports.run = ', 'exports.start = '), VERSION));
    expect(out).toContain('CalendarFIFWidget.run is not a function');
    expect(out).toContain('위젯을 0번 두었다');
  });

  it('위젯을 두지 않거나 두 번 두면', async () => {
    expect(await problems(finishBundle(good.replace('host.Script.setWidget(w);', ''), VERSION))).toContain('위젯을 0번 두었다');
    expect(await problems(finishBundle(good.replace('host.Script.setWidget(w);', 'host.Script.setWidget(w); host.Script.setWidget(w);'), VERSION))).toContain('위젯을 2번 두었다');
  });

  it('Script.complete()가 없으면', async () => {
    const script = finishBundle(good, VERSION).replace('Script.complete();', '');
    expect(await problems(script)).toContain('Script.complete()');
  });

  it('run이 던지면', async () => {
    expect(await problems(finishBundle(good.replace('const w = ', 'throw new Error("시작 시험 오류"); const w = '), VERSION))).toContain('시작 시험 오류');
  });
});

describe('받아 쓰는 위젯 코드(자동 업데이트)', () => {
  const bundle = (body: string[]): string =>
    ['var CalendarFIFWidget = (function(exports) {', '\texports.run = async (host, cfg) => {', ...body.map((l) => `\t\t${l}`), '\t};', '\treturn exports;', '})({});'].join('\n');
  const good = bundle(['const w = new host.ListWidget();', 'w.addText("로그인이 필요합니다");', 'host.Script.setWidget(w);']);
  const problems = async (lib: string): Promise<string> => (await libProblems(lib, VERSION)).join('\n');

  it('머리말, 묶은 글, module.exports, 끝 줄의 차례다. 설정값의 자리표시자와 시작 줄은 없다', () => {
    const lib = finishLib(good, VERSION);
    const lines = lib.trimEnd().split('\n');
    expect(lines[0]).toBe('// CalendarFIF widget code 0.4.0 (2026-11-14). The pasted widget script downloads this file by itself. Do not paste it into Scriptable.');
    expect(lines.slice(-2)).toEqual(['module.exports = { version: "0.4.0 (2026-11-14)", run: CalendarFIFWidget.run };', LIB_END]);
    // 한글은 \uXXXX로 적혀 ASCII 글자만 남는다. 그래서 글자 수와 바이트 수가 같다.
    expect(lib).toContain(good.replace('로그인이 필요합니다', '\\ub85c\\uadf8\\uc778\\uc774 \\ud544\\uc694\\ud569\\ub2c8\\ub2e4'));
    expect([/[^\x00-\x7f]/.test(lib), Buffer.byteLength(lib, 'utf8') === lib.length, LIB_END]).toEqual([false, true, '// CalendarFIF widget code end']);
    expect([lib.includes('__APP_URL__'), lib.includes('Script.complete()'), lib.includes('await CalendarFIFWidget.run(')]).toEqual([false, false, false]);
  });

  it('버전 파일에는 버전과 위젯 코드의 글자 수가 있다', () => {
    const lib = finishLib(good, VERSION);
    expect(JSON.parse(versionFile(lib, VERSION))).toEqual({ version: VERSION, chars: lib.length });
  });

  it('잘 만든 파일은 문제가 없다', async () => {
    expect(await libProblems(finishLib(good, VERSION), VERSION)).toEqual([]);
  });

  it('자리표시자, 시험용 값, 끊긴 파일, 읽히지 않는 글, 다른 버전을 가려낸다', async () => {
    expect(await problems(finishLib(good.replace('"로그인이 필요합니다"', '"로그인이 필요합니다" + "__API_KEY__"'), VERSION))).toContain('자리표시자 __API_KEY__가 들어 있다');
    expect(await problems(finishLib(`${good}\n// demo-calfif`, VERSION))).toContain('시험용 값 demo-calfif이 들어 있다');
    expect(await problems(finishLib(good, VERSION).replace(LIB_END, ''))).toContain('끝 줄이 없다');
    expect(await problems(finishLib('var CalendarFIFWidget = (', VERSION))).toContain('읽다가 오류가 났다');
    expect(await problems(finishLib(good, '0.4.1 (2026-11-15)'))).toContain('module.exports에 그 버전과 run이 없다');
  });

  it('ASCII로 바꾸면 뜻이 달라지는 글을 가려낸다: 역슬래시 뒤의 한글, 줄 나눔 글자, String.raw', () => {
    expect(escapeProblems(good)).toEqual([]);
    expect(escapeProblems('const a = "\\가";')).toEqual(['역슬래시 바로 뒤에 ASCII가 아닌 글자가 있다']);
    expect(escapeProblems('// 주석\u2028b')).toEqual(['줄 나눔 글자 U+2028이나 U+2029가 있다']);
    expect(escapeProblems('const b = String.raw`가`;')).toEqual(['String.raw를 쓴다']);
  });

  it('ASCII가 아닌 글자나 CR이 든 파일, Script.complete()를 부르는 코드는 문제다', async () => {
    expect(await problems(`${finishLib(good, VERSION)}// 한글\n${LIB_END}\n`)).toContain('ASCII가 아닌 글자가 있다');
    expect(await problems(finishLib(good, VERSION).replace(/\n/g, '\r\n'))).toContain('CR 글자가 있다');
    expect(await problems(finishLib(good.replace('host.Script.setWidget(w);', 'host.Script.setWidget(w); host.Script.complete();'), VERSION))).toContain('넘겨받은 실행이 Script.complete()를 불렀다');
  });

  it('넘겨받아 돌 때 위젯을 두지 않거나, 로그인 안내가 없거나, 네트워크를 쓰면 문제다', async () => {
    expect(await problems(finishLib(good.replace('host.Script.setWidget(w);', ''), VERSION))).toContain('위젯을 0번 두었다');
    expect(await problems(finishLib(good.replace('로그인이 필요합니다', '오류'), VERSION))).toContain('"로그인이 필요합니다"가 없다');
    const fetching = bundle(['try { await new host.Request("https://example.invalid/x").loadString(); } catch {}', 'const w = new host.ListWidget();', 'w.addText("로그인이 필요합니다");', 'host.Script.setWidget(w);']);
    expect(await problems(finishLib(fetching, VERSION))).toContain('넘겨받은 실행이 네트워크를 썼다');
  });
});

describe('Scriptable에 없는 기능', () => {
  it('브라우저와 Node에만 있는 기능을 쓰면 문제다', () => {
    expect(webApiProblems('const u = new URL(a); u.searchParams.set("t", 1);')).toEqual(['Scriptable에 없는 기능을 쓴다: new URL(']);
    expect(webApiProblems('new URLSearchParams(q); setTimeout(f, 1); setInterval(f, 1); fetch(u); new TextEncoder(); new TextDecoder(); atob(s); btoa(s); new AbortController(); structuredClone(o); queueMicrotask(f);')).toHaveLength(11);
  });

  it('host의 것(host.Timer 등)과 이름이 비슷한 것, 웹 화면에서 돌릴 식은 문제가 아니다', () => {
    expect(webApiProblems('host.Timer.schedule(1, false, f); req.fetch(u); obj.setTimeout(f); mySetTimeout(f); const prefetch = 1; prefetch(u); const js = "String(window.__calfifPending || \"\")"; const baseURL = "x";')).toEqual([]);
  });
});
