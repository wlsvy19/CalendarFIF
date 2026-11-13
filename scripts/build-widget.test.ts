import { describe, expect, it } from 'vitest';
import { FAKE_HOST_MARKER } from '../src/widget/fakeHost';
import { bundleProblems, finishBundle, versionText } from './build-widget';

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
    expect(lines.at(-2)).toBe('await CalendarFIFWidget.run({ Keychain, Request, Alert, DrawContext, ListWidget, FileManager, Script, config, args, Device, Color, Font, Size, Rect, Point, Path }, { projectId: "__PROJECT_ID__", apiKey: "__API_KEY__", appUrl: "__APP_URL__", version: "0.4.0 (2026-11-14)" });');
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
