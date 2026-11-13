import { expect, it, vi } from 'vitest';
import { PALETTE } from '../../core/color';
import { menuPosition, mountCellMenu } from './cellMenu';

function open() {
  const root = document.createElement('div');
  document.body.append(root);
  const props = { dateKey: '2026-11-20', at: { x: 10, y: 10 }, onEdit: vi.fn(), onColor: vi.fn(), onToday: vi.fn(), onClose: vi.fn() };
  mountCellMenu(root, props);
  return { root, props };
}
it('창 밖으로 나가지 않게 자리를 잡는다', () => {
  const view = { width: 800, height: 600 };
  expect([menuPosition({ x: 100, y: 100 }, { width: 180, height: 120 }, view), menuPosition({ x: 750, y: 560 }, { width: 180, height: 120 }, view), menuPosition({ x: 10, y: 10 }, { width: 900, height: 120 }, view)])
    .toEqual([{ x: 100, y: 100 }, { x: 616, y: 476 }, { x: 4, y: 10 }]);
});
it('편집, 배경색, 오늘로. 배경색은 없음과 22색이고, Esc와 바깥 누르기로 닫힌다', () => {
  const { root, props } = open();
  const items = [...root.querySelectorAll<HTMLElement>('.cellmenu [role="menuitem"]')];
  expect(items.map((b) => b.textContent)).toEqual(['편집', '배경색', '오늘로']);
  items[1].click();
  const swatches = [...root.querySelectorAll<HTMLElement>('.cellmenu .swatch')];
  expect(swatches.map((s) => s.dataset.color)).toEqual(['', ...PALETTE]);
  swatches[9].click();
  expect([props.onColor.mock.calls, props.onClose.mock.calls.length]).toEqual([[['F12424']], 1]);
  const esc = open();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  const outside = open();
  document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  expect([esc.props.onClose.mock.calls.length > 0, outside.props.onClose.mock.calls.length > 0]).toEqual([true, true]);
});
