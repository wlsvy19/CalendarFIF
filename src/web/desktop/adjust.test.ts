import { expect, it } from 'vitest';
import { mountAdjust } from './adjust';
import { FakeBridge } from './fakeBridge';

it('끈 거리를 처음 자리 기준으로 보내고, 적용과 취소를 알린다', () => {
  const root = document.createElement('div');
  const bridge = new FakeBridge();
  mountAdjust(root, bridge);
  const ev = (type: string, el: Element, x: number, y: number) => el.dispatchEvent(new PointerEvent(type, { screenX: x, screenY: y, pointerId: 1, bubbles: true }));
  const body = root.querySelector('.adjust-move')!, se = root.querySelector('.adjust-handle[data-kind="se"]')!;
  ev('pointerdown', body, 100, 100); ev('pointermove', body, 130, 90); ev('pointermove', body, 160, 95); ev('pointerup', body, 160, 95);
  ev('pointerdown', se, 500, 400); ev('pointermove', se, 520, 380);
  expect(bridge.calls).toEqual([['dragStart'], ['drag', 'move', 30, -10], ['drag', 'move', 60, -5], ['dragStart'], ['drag', 'se', 20, -20]]);
  expect([root.textContent!.includes('끌어서 옮기고, 가장자리를 끌어 크기를 바꿉니다.'), root.querySelectorAll('.adjust-handle').length]).toEqual([true, 8]);
  for (const label of ['적용', '취소']) [...root.querySelectorAll('button')].find((b) => b.textContent === label)!.click();
  expect(bridge.calls.slice(-2)).toEqual([['adjustDone', true], ['adjustDone', false]]);
});

it('Esc는 취소하고, 다른 포인터의 움직임과 포인터를 잃은 뒤의 움직임은 무시한다', () => {
  const root = document.createElement('div');
  const bridge = new FakeBridge();
  const handle = mountAdjust(root, bridge);
  const ev = (type: string, el: Element, id: number, x: number) => el.dispatchEvent(new PointerEvent(type, { screenX: x, screenY: 0, pointerId: id, bubbles: true }));
  const body = root.querySelector('.adjust-move')!;
  ev('pointerdown', body, 1, 10); ev('pointermove', body, 2, 50); ev('pointermove', body, 1, 20);
  ev('lostpointercapture', body, 1, 20); ev('pointermove', body, 1, 30);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  expect(bridge.calls).toEqual([['dragStart'], ['drag', 'move', 10, 0], ['adjustDone', false]]);
  handle.destroy();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  expect(bridge.calls.length).toBe(3);
});
