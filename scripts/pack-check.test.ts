import { expect, it } from 'vitest';
import { bundleProblem, guardDecision, hasTopLevelKoffiRequire, runningInside } from './pack-check';

it('실제 프로젝트용 꾸리기에 에뮬레이터 프로젝트 ID가 있거나 에뮬레이터용에 없으면 문제를 알린다', () => {
  expect(bundleProblem(false, 'const id = "my-project"')).toBeNull();
  expect(bundleProblem(false, 'const id = "demo-calfif"')).toContain('demo-calfif');
  expect(bundleProblem(true, 'const id = "demo-calfif"')).toBeNull();
  expect(bundleProblem(true, 'const id = "my-project"')).toContain('demo-calfif');
});

it('메인 묶음 맨 위의 koffi require만 잡는다', () => {
  expect(hasTopLevelKoffiRequire('let koffi = require("koffi");\nkoffi = __toESM(koffi, 1);')).toBe(true);
  expect(hasTopLevelKoffiRequire('function loadUser32() {\n\tconst koffi = require("koffi");\n}')).toBe(false);
});

it('실행 중인 앱이 그 폴더 안에 있을 때만 알린다', () => {
  const dir = 'C:\\sw\\CalendarFIF\\release\\0.4.0';
  const exe = (folder: string) => `C:\\sw\\CalendarFIF\\release\\${folder}\\CalendarFIF-win32-x64\\CalendarFIF.exe`;
  expect(runningInside([exe('0.4.0')], dir)).toBe(true);
  expect(runningInside(['c:\\SW\\calendarfif\\RELEASE\\0.4.0\\CalendarFIF-win32-x64\\CalendarFIF.exe'], dir)).toBe(true);
  expect(runningInside([exe('0.4.0')], `${dir}\\`)).toBe(true);
  expect(runningInside([exe('0.4.00')], dir)).toBe(false);
  expect(runningInside([exe('0.4.0-old')], dir)).toBe(false);
  expect(runningInside(['C:\\sw\\CalendarFIF\\release\\CalendarFIF-win32-x64\\CalendarFIF.exe'], dir)).toBe(false);
  expect(runningInside([], dir)).toBe(false);
});

const DIR = 'C:\\sw\\CalendarFIF\\release\\0.4.0';
const EXE_IN = `${DIR}\\CalendarFIF-win32-x64\\CalendarFIF.exe`;
const EXE_OLD = 'C:\\sw\\CalendarFIF\\release\\CalendarFIF-win32-x64\\CalendarFIF.exe';

it('꾸리기 전 확인: 실행 중인 앱을 확인하지 못하면 멈춘다', () => {
  const stop = { ok: false, message: '실행 중인 앱을 확인하지 못했습니다. 꾸리기를 멈춥니다.' };
  expect(guardDecision({ error: new Error('spawn powershell ENOENT'), status: null, stdout: null }, DIR)).toEqual(stop);
  expect(guardDecision({ status: 1, stdout: '' }, DIR)).toEqual(stop);
  expect(guardDecision({ status: null, stdout: '' }, DIR)).toEqual(stop);
  expect(guardDecision({ status: 0, stdout: null }, DIR)).toEqual(stop);
});
it('꾸리기 전 확인: 그 폴더의 앱이 실행 중이면 멈추고, 다른 곳의 앱이나 없는 경우는 통과한다', () => {
  expect(guardDecision({ status: 0, stdout: `${EXE_IN}\r\n` }, DIR)).toEqual({ ok: false, message: `그 폴더의 앱이 실행 중입니다. 앱을 끄고 다시 실행하세요: ${DIR}` });
  expect(guardDecision({ status: 0, stdout: `${EXE_OLD}\r\n${EXE_OLD}\r\n` }, DIR)).toEqual({ ok: true });
  expect(guardDecision({ status: 0, stdout: '' }, DIR)).toEqual({ ok: true });
});
it('꾸리기 전 확인: 위치를 읽지 못한 CalendarFIF가 있으면 멈춘다', () => {
  expect(guardDecision({ status: 0, stdout: `${EXE_OLD}\r\n?\r\n` }, DIR)).toEqual({ ok: false, message: '실행 중인 CalendarFIF의 위치를 알 수 없습니다. 앱을 끄고 다시 실행하세요.' });
});
