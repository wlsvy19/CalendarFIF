// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { FakeBridge } from './fakeBridge';
import { mountMoveDrag } from './moveDrag';

const pointer = (type: string, x: number, y: number, extra: PointerEventInit = {}) =>
  new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, button: 0, screenX: x, screenY: y, ...extra });

describe('PC 앱: 달력을 끌어 옮기기', () => {
  afterEach(() => document.body.replaceChildren());
  function setup(can = true) {
    const root = document.createElement('div');
    root.innerHTML = '<div class="calendar"><button class="cell">13</button><div class="app-nav"><button class="pill">오늘</button></div></div>';
    document.body.append(root);
    const bridge = new FakeBridge();
    const handle = mountMoveDrag(root, bridge, () => can);
    const names = () => bridge.calls.map((c) => c[0]);
    return { root, bridge, handle, names, cell: root.querySelector<HTMLElement>('.cell')!, pill: root.querySelector<HTMLElement>('.pill')! };
  }

  it('4px보다 적게 움직이면 끌지 않고 누르기가 그대로 간다', () => {
    const { cell, names } = setup();
    let clicks = 0;
    cell.addEventListener('click', () => (clicks += 1));
    cell.dispatchEvent(pointer('pointerdown', 100, 100));
    cell.dispatchEvent(pointer('pointermove', 102, 101));
    cell.dispatchEvent(pointer('pointerup', 102, 101));
    cell.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect([names(), clicks]).toEqual([[], 1]);
  });

  it('넘게 움직이면 끌기를 시작해 누른 자리에서 움직인 만큼 보내고, 놓으면 끝을 알리고 뒤따르는 누르기는 버린다', () => {
    const { cell, bridge } = setup();
    let opened = 0;
    cell.addEventListener('dblclick', () => (opened += 1));
    cell.dispatchEvent(pointer('pointerdown', 100, 100));
    cell.dispatchEvent(pointer('pointermove', 110, 95));
    cell.dispatchEvent(pointer('pointermove', 140, 80));
    cell.dispatchEvent(pointer('pointerup', 140, 80));
    cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(bridge.calls).toEqual([['dragStart'], ['drag', 'move', 10, -5], ['drag', 'move', 40, -20], ['dragEnd']]);
    expect(opened).toBe(0);
  });

  it('단추 위나 끌 수 없는 때, 오른쪽 단추는 시작하지 않는다', () => {
    const a = setup();
    a.pill.dispatchEvent(pointer('pointerdown', 0, 0));
    a.pill.dispatchEvent(pointer('pointermove', 50, 0));
    a.cell.dispatchEvent(pointer('pointerdown', 0, 0, { button: 2 }));
    a.cell.dispatchEvent(pointer('pointermove', 50, 0));
    const b = setup(false);
    b.cell.dispatchEvent(pointer('pointerdown', 0, 0));
    b.cell.dispatchEvent(pointer('pointermove', 50, 0));
    expect([a.names(), b.names()]).toEqual([[], []]);
  });

  it('끄는 중에 내리면 끝을 알린다', () => {
    const { cell, handle, names } = setup();
    cell.dispatchEvent(pointer('pointerdown', 0, 0));
    cell.dispatchEvent(pointer('pointermove', 20, 0));
    handle.destroy();
    expect(names()).toEqual(['dragStart', 'drag', 'dragEnd']);
  });
});
