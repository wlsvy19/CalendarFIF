import { expect, it } from 'vitest';
import { startupAction } from './startup';

it('자동 실행은 꾸린 앱의 첫 실행에서만 켜고, 개발과 시험 실행에서는 건드리지 않는다', () => {
  expect([startupAction({ manage: false, saved: null }), startupAction({ manage: true, saved: null }), startupAction({ manage: true, saved: false }), startupAction({ manage: true, saved: true })])
    .toEqual([{ register: null, save: null }, { register: true, save: true }, { register: null, save: null }, { register: null, save: null }]);
});
