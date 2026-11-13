import { expect, it } from 'vitest';
import { parseBool, parsePoint } from './ipc';

it('화면에서 온 값을 검사한다', () => {
  expect([parseBool(true), parseBool(false), parseBool('true')]).toEqual([true, false, null]);
  expect(parsePoint({ x: 10, y: 20.5, extra: 3 })).toEqual({ x: 10, y: 20.5 });
  expect([parsePoint({ x: Infinity, y: 0 }), parsePoint({ x: 1e6, y: 0 }), parsePoint([1, 2]), parsePoint(null)]).toEqual([null, null, null, null]);
});
