import { expect, it } from 'vitest';
import { bundleProblem, hasTopLevelKoffiRequire, runningInside } from './pack-check';

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
