import { expect, it } from 'vitest';
import { startupAction, tryLoginItem } from './startup';

it('자동 실행은 꾸린 앱의 첫 실행에서만 켜고, 개발과 시험 실행에서는 건드리지 않는다', () => {
  expect([startupAction({ manage: false, saved: null }), startupAction({ manage: true, saved: null }), startupAction({ manage: true, saved: false }), startupAction({ manage: true, saved: true })])
    .toEqual([{ register: null, save: null }, { register: true, save: true }, { register: null, save: null }, { register: null, save: null }]);
});
it('시작 항목을 거는 함수가 던져도 막히지 않고 적용하지 못했다고 돌려준다', () => {
  const calls: boolean[] = [];
  expect(tryLoginItem((v) => calls.push(v), true)).toBe(true);
  expect(tryLoginItem(() => { throw new Error('레지스트리 거절'); }, false)).toBe(false);
  expect(calls).toEqual([true]);
});
