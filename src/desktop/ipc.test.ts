import { expect, it } from 'vitest';
import { parseBool, parseDrag, parsePoint } from './ipc';

it('화면에서 온 값을 검사한다', () => {
  expect([parseBool(true), parseBool(false), parseBool('true')]).toEqual([true, false, null]);
  expect(parsePoint({ x: 10, y: 20.5, extra: 3 })).toEqual({ x: 10, y: 20.5 });
  expect([parsePoint({ x: Infinity, y: 0 }), parsePoint({ x: 1e6, y: 0 }), parsePoint([1, 2]), parsePoint(null)]).toEqual([null, null, null, null]);
});
it('끌기 값을 검사한다', () => {
  expect([parseDrag('se', 10, -5), parseDrag('up', 10, 0), parseDrag('move', NaN, 0), parseDrag('move', 200000, 0)]).toEqual([{ kind: 'se', dx: 10, dy: -5 }, null, null, null]);
});
