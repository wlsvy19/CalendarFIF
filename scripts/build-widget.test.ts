import { describe, expect, it } from 'vitest';
import { FAKE_HOST_MARKER } from '../src/widget/fakeHost';
import { bundleProblems, finishBundle } from './build-widget';

const iife = 'var CalendarFIFWidget = (function(exports) {\n\texports.run = async () => {};\n\treturn exports;\n})({});';

describe('finishBundle', () => {
  const script = finishBundle(iife);

  it('Scriptable 머리말이 맨 위에 온다', () => {
    expect(script.split('\n').slice(0, 3)).toEqual([
      '// Variables used by Scriptable.',
      '// These must be at the very top of the file. Do not edit.',
      '// icon-color: deep-blue; icon-glyph: calendar-alt;',
    ]);
  });

  it('묶은 글 뒤에 시작 줄이 온다', () => {
    expect(script).toContain(iife);
    const lines = script.trimEnd().split('\n');
    expect(lines.at(-1)).toBe('Script.complete();');
    expect(lines.at(-2)).toContain('await CalendarFIFWidget.run({ Keychain, Request, Alert, DrawContext, ListWidget, FileManager, Script, config, args, Device, Color, Font, Size, Rect, Point, Path }, { projectId: "__PROJECT_ID__", apiKey: "__API_KEY__", appUrl: "__APP_URL__" });');
  });

  it('문제가 없다', () => {
    expect(bundleProblems(script)).toEqual([]);
  });
});

describe('bundleProblems', () => {
  const ok = finishBundle(iife);
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

  it('최상위 await는 읽힌다', () => {
    expect(bundleProblems(ok)).toEqual([]);
  });

  it('가짜 호스트의 표지', () => {
    expect(problems(`${ok}\n// ${FAKE_HOST_MARKER}`)).toContain('가짜 호스트');
  });
});
