import { expect, it } from 'vitest';
import { clampOffset, makeDraggable, sessionMemory } from './dragSheet';

const viewport = { width: 1000, height: 800 };
const sheetSize = { width: 480, height: 400 };

it('창 안에 있는 옮김은 그대로 둔다', () => {
  expect(clampOffset({ x: 100, y: -50 }, sheetSize, viewport)).toEqual({ x: 100, y: -50 });
});
it('가장자리에서 8px 남기는 한계로 자른다(오른쪽, 아래쪽, 왼쪽, 위쪽)', () => {
  // x 한계 (1000 - 480) / 2 - 8 = 252, y 한계 (800 - 400) / 2 - 8 = 192
  expect(clampOffset({ x: 900, y: 900 }, sheetSize, viewport)).toEqual({ x: 252, y: 192 });
  expect(clampOffset({ x: -900, y: -900 }, sheetSize, viewport)).toEqual({ x: -252, y: -192 });
});
it('창보다 큰 시트는 그 방향으로 움직이지 않는다', () => {
  expect(clampOffset({ x: 50, y: 50 }, { width: 1200, height: 400 }, viewport)).toEqual({ x: 0, y: 50 });
  expect(clampOffset({ x: 50, y: 50 }, { width: 480, height: 790 }, viewport)).toEqual({ x: 50, y: 0 });
});

function setup(measured = { sheet: sheetSize, viewport }) {
  const sheet = document.createElement('div');
  const handle = document.createElement('div');
  const button = document.createElement('button');
  const label = document.createElement('h3');
  handle.append(label, button);
  sheet.append(handle);
  document.body.append(sheet);
  const memory = sessionMemory();
  const env = { measure: () => measured };
  const drag = makeDraggable(sheet, handle, memory, env);
  const offset = () => [sheet.style.getPropertyValue('--drag-x'), sheet.style.getPropertyValue('--drag-y')];
  const pointer = (target: Element, type: string, x: number, y: number, init: PointerEventInit = {}) =>
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, button: 0, clientX: x, clientY: y, ...init }));
  return { sheet, handle, button, label, memory, drag, offset, pointer, env };
}

it('제목 줄을 끌면 옮긴 거리가 --drag-x, --drag-y에 들어가고 기억된다', () => {
  const { handle, label, memory, offset, pointer } = setup();
  expect(handle.classList.contains('drag-handle')).toBe(true);
  pointer(label, 'pointerdown', 100, 100);
  pointer(handle, 'pointermove', 160, 130);
  expect(offset()).toEqual(['60px', '30px']);
  expect(memory.get()).toEqual({ x: 60, y: 30 });
  pointer(handle, 'pointerup', 160, 130);
  pointer(handle, 'pointermove', 400, 400);
  expect(offset()).toEqual(['60px', '30px']);
});
it('멀리 끌면 자른 값이 된다', () => {
  const { handle, offset, pointer } = setup();
  pointer(handle, 'pointerdown', 100, 100);
  pointer(handle, 'pointermove', 5000, -5000);
  expect(offset()).toEqual(['252px', '-192px']);
});
it('제목 줄 안의 단추를 누르면 끌기가 시작되지 않는다', () => {
  const { button, handle, offset, pointer } = setup();
  pointer(button, 'pointerdown', 100, 100);
  pointer(handle, 'pointermove', 160, 130);
  expect(offset()).toEqual(['0px', '0px']);
});
it('주 단추가 아닌 것으로 누르면 끌기가 시작되지 않는다', () => {
  const { handle, offset, pointer } = setup();
  pointer(handle, 'pointerdown', 100, 100, { button: 2 });
  pointer(handle, 'pointermove', 160, 130);
  expect(offset()).toEqual(['0px', '0px']);
});
it('자식에서 온 lostpointercapture는 끌기를 끝내지 않고 제목 줄 것은 끝낸다', () => {
  const { handle, label, offset, pointer } = setup();
  pointer(handle, 'pointerdown', 100, 100);
  pointer(label, 'lostpointercapture', 0, 0);
  pointer(handle, 'pointermove', 160, 130);
  expect(offset()).toEqual(['60px', '30px']);
  pointer(handle, 'lostpointercapture', 0, 0);
  pointer(handle, 'pointermove', 200, 200);
  expect(offset()).toEqual(['60px', '30px']);
});
it('같은 기억을 쓰는 다음 시트는 기억한 자리에서 열린다', () => {
  const first = setup();
  first.pointer(first.handle, 'pointerdown', 0, 0);
  first.pointer(first.handle, 'pointermove', 40, 20);
  first.drag.destroy();
  const second = document.createElement('div');
  makeDraggable(second, document.createElement('div'), first.memory, first.env);
  expect([second.style.getPropertyValue('--drag-x'), second.style.getPropertyValue('--drag-y')]).toEqual(['40px', '20px']);
});
it('창 크기가 바뀌어 안 맞게 된 자리는 다시 자른다', () => {
  let current = { sheet: sheetSize, viewport };
  const sheet = document.createElement('div');
  const handle = document.createElement('div');
  const memory = sessionMemory();
  memory.set({ x: 200, y: 100 });
  makeDraggable(sheet, handle, memory, { measure: () => current });
  expect(sheet.style.getPropertyValue('--drag-x')).toBe('200px');
  current = { sheet: sheetSize, viewport: { width: 600, height: 800 } }; // x 한계 52
  window.dispatchEvent(new Event('resize'));
  expect(sheet.style.getPropertyValue('--drag-x')).toBe('52px');
  expect(memory.get().x).toBe(52);
});
it('destroy하면 이벤트 처리기가 빠진다', () => {
  const { handle, drag, offset, pointer } = setup();
  drag.destroy();
  pointer(handle, 'pointerdown', 100, 100);
  pointer(handle, 'pointermove', 160, 130);
  expect(offset()).toEqual(['0px', '0px']);
});
