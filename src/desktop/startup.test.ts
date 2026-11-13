import { expect, it } from 'vitest';
import { startupAction, tryLoginItem } from './startup';

it('자동 실행: 첫 실행에서 켜고 저장하며, 켜 둔 앱이 시스템에 이 실행 파일로 걸려 있지 않으면 다시 건다', () => {
  expect([
    startupAction({ manage: true, saved: null, system: false }),
    startupAction({ manage: true, saved: null, system: true }),
    startupAction({ manage: true, saved: true, system: false }), // 폴더를 옮겼거나 다시 꾸렸다
    startupAction({ manage: true, saved: true, system: true }),
    startupAction({ manage: true, saved: false, system: false }),
    startupAction({ manage: true, saved: false, system: true }),
  ]).toEqual([
    { register: true, save: true }, { register: true, save: true }, { register: true, save: null },
    { register: null, save: null }, { register: null, save: null }, { register: null, save: null },
  ]);
});
it('개발, 에뮬레이터, 시험 실행(관리하지 않음)에서는 어떤 경우에도 건드리지 않는다', () => {
  const none = { register: null, save: null };
  for (const saved of [null, true, false]) for (const system of [null, true, false]) expect(startupAction({ manage: false, saved, system })).toEqual(none);
});
it('시작 항목을 거는 함수가 던져도 막히지 않고 적용하지 못했다고 돌려준다', () => {
  const calls: boolean[] = [];
  expect(tryLoginItem((v) => calls.push(v), true)).toBe(true);
  expect(tryLoginItem(() => { throw new Error('레지스트리 거절'); }, false)).toBe(false);
  expect(calls).toEqual([true]);
});
