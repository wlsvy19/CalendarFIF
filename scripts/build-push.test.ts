import { expect, it } from 'vitest';
import { finishGas, gasProblems, swProblems } from './build-push';

// 묶음 대신 같은 모양의 작은 글로 확인한다(실제 묶음은 빌드가 같은 검사를 한다).
const fakeIife = `var CalendarFIFPush = (function (exports) {
  exports.setup = function (host) { host.Logger.log('스크립트 속성 SERVICE_ACCOUNT가 없습니다.'); };
  exports.tick = function () {};
  return exports;
})({});`;

it('Apps Script 묶음: 머리말과 setup, tick을 붙이고 가짜 Apps Script에서 키 안내가 나온다', () => {
  const script = finishGas(fakeIife, '0.8.0 (2026-11-15)');
  expect(script.startsWith('// CalendarFIF 알림 보내기 0.8.0 (2026-11-15)')).toBe(true);
  expect(script).toContain('function setup()');
  expect(script).toContain('function tick()');
  expect(gasProblems(script)).toEqual([]);
});

it('Apps Script 묶음의 문제를 찾는다', () => {
  expect(gasProblems(finishGas(`import x from 'y';\n${fakeIife}`, '0'))).toContain('import 또는 export 문이 있다');
  expect(gasProblems(finishGas(fakeIife.replace('SERVICE_ACCOUNT', 'KEY'), '0')).join()).toContain('키가 없다는 안내');
  expect(gasProblems(finishGas(`${fakeIife}\n// demo-calfif`, '0'))).toContain('시험용 값 demo-calfif이 들어 있다');
});

it('서비스 워커 묶음은 push와 notificationclick을 붙여야 한다', () => {
  expect(swProblems("self.addEventListener('push', function () {}); self.addEventListener('notificationclick', function () {});")).toEqual([]);
  expect(swProblems("self.addEventListener('push', function () {});")).toEqual(['notificationclick 처리가 붙지 않았다']);
});
