import { expect, it } from 'vitest';
import { Interactivity } from './interactive';

it('편집, 설정, 로그인 중 하나라도 열린 동안만 창이 입력을 받는다', () => {
  const sent: boolean[] = [];
  const i = new Interactivity((on) => sent.push(on));
  i.begin('editor'); i.begin('settings'); i.end('editor');
  expect([sent, i.active()]).toEqual([[true], true]);
  i.end('settings'); i.end('settings');
  expect([sent, i.active()]).toEqual([[true, false], false]);
});
