import { expect, it } from 'vitest';
import { parseBool, parseDrag, parsePoint, parseSystemPatch } from './ipc';

it('화면에서 온 값을 검사한다', () => {
  expect([parseBool(true), parseBool(false), parseBool('true')]).toEqual([true, false, null]);
  expect(parsePoint({ x: 10, y: 20.5, extra: 3 })).toEqual({ x: 10, y: 20.5 });
  expect([parsePoint({ x: Infinity, y: 0 }), parsePoint({ x: 1e6, y: 0 }), parsePoint([1, 2]), parsePoint(null)]).toEqual([null, null, null, null]);
});
it('끌기 값을 검사한다', () => {
  expect([parseDrag('se', 10, -5), parseDrag('up', 10, 0), parseDrag('move', NaN, 0), parseDrag('move', 200000, 0)]).toEqual([{ kind: 'se', dx: 10, dy: -5 }, null, null, null]);
});
it('설정 바꾸기 요청은 아는 칸만 받는다', () => {
  expect(parseSystemPatch({ hideHotkey: { accelerator: 'Ctrl+Alt+K', enabled: true } })).toEqual({ hideHotkey: { accelerator: 'Ctrl+Alt+K', enabled: true } });
  expect(parseSystemPatch({ startWithWindows: true, other: 1 })).toEqual({ startWithWindows: true });
  expect([{ hideHotkey: { accelerator: 'x'.repeat(41), enabled: true } }, { startWithWindows: 'yes' }].map(parseSystemPatch)).toEqual([{}, {}]);
  expect([null, [], 'x'].map(parseSystemPatch)).toEqual([null, null, null]);
});
