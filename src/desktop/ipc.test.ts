import { expect, it } from 'vitest';
import { handleAlarm, parseBool, parseDrag, parsePoint, parseSystemPatch } from './ipc';

it('화면에서 온 값을 검사한다', () => {
  expect([parseBool(true), parseBool(false), parseBool('true')]).toEqual([true, false, null]);
  expect(parsePoint({ x: 10, y: 20.5, extra: 3 })).toEqual({ x: 10, y: 20.5 });
  expect([parsePoint({ x: Infinity, y: 0 }), parsePoint({ x: 1e6, y: 0 }), parsePoint([1, 2]), parsePoint(null)]).toEqual([null, null, null, null]);
});
it('끌기 값을 검사한다', () => {
  expect([parseDrag('se', 10, -5), parseDrag('up', 10, 0), parseDrag('move', NaN, 0), parseDrag('move', 200000, 0)]).toEqual([{ kind: 'se', dx: 10, dy: -5 }, null, null, null]);
});
it('단축키는 바른 모양으로 고쳐 받고, 등록할 수 없는 조합은 받지 않는다', () => {
  expect(parseSystemPatch({ contentHotkey: { accelerator: 'shift + ctrl + k', enabled: false } })).toEqual({ contentHotkey: { accelerator: 'Ctrl+Shift+K', enabled: false } });
  expect(['Win+K', 'Ctrl', 'K', 'Alt+F4', 'Ctrl+Alt+K+L'].map((accelerator) => parseSystemPatch({ hideHotkey: { accelerator, enabled: true } }))).toEqual([{}, {}, {}, {}, {}]);
});
it('설정 바꾸기 요청은 아는 칸만 받는다', () => {
  expect(parseSystemPatch({ hideHotkey: { accelerator: 'Ctrl+Alt+K', enabled: true } })).toEqual({ hideHotkey: { accelerator: 'Ctrl+Alt+K', enabled: true } });
  expect(parseSystemPatch({ startWithWindows: true, other: 1 })).toEqual({ startWithWindows: true });
  expect([{ hideHotkey: { accelerator: 'x'.repeat(41), enabled: true } }, { startWithWindows: 'yes' }].map(parseSystemPatch)).toEqual([{}, {}]);
  expect([null, [], 'x'].map(parseSystemPatch)).toEqual([null, null, null]);
});
it('alarm 채널을 받으면 거른 항목으로 창을 부른다', () => {
  const good = { time: '09:30', text: '약 먹기', date: '2026-11-20', advance: 0 };
  const calls: unknown[][] = [];
  const show = (items: unknown, tone: unknown) => calls.push([items, tone]);
  handleAlarm(true, [good, { ...good, time: 'x' }], 'chime', show);
  handleAlarm(true, [{ time: 'x' }], 'chime', show); // 걸러 남는 것이 없으면 부르지 않는다
  handleAlarm(false, [good], 'chime', show); // 앱의 화면이 보낸 것이 아니면 부르지 않는다
  handleAlarm(true, [good], 'loud', show); // 모르는 소리는 none
  expect(calls).toEqual([[[good], 'chime'], [[good], 'none']]);
});
