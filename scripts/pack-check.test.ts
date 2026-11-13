import { expect, it } from 'vitest';
import { bundleProblem, hasTopLevelKoffiRequire } from './pack-check';

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
