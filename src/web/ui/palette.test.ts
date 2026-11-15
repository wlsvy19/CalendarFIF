import { expect, it, vi } from 'vitest';
import { mountPalette } from './palette';

function open(current = '') {
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  const anchor = document.createElement('button');
  sheet.append(anchor);
  document.body.append(sheet);
  const onPick = vi.fn();
  const onClose = vi.fn();
  const p = mountPalette(anchor, { colors: ['', 'F12424', '009300'], current, onPick, onClose });
  const swatch = (c: string) => p.el.querySelector<HTMLElement>(`[role="radio"][data-color="${c}"]`)!;
  return { sheet, anchor, p, onPick, onClose, swatch };
}

it('지금 색이 표시되고 누르면 고른 뒤 닫힌다', () => {
  const { p, swatch, onPick, onClose } = open('F12424');
  expect(p.el.getAttribute('role')).toBe('radiogroup');
  expect(p.el.querySelectorAll('[role="radio"]')).toHaveLength(3);
  expect(swatch('F12424').getAttribute('aria-checked')).toBe('true');
  expect(swatch('009300').getAttribute('aria-checked')).toBe('false');
  swatch('009300').click();
  expect(onPick).toHaveBeenCalledWith('009300');
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onPick.mock.invocationCallOrder[0]).toBeLessThan(onClose.mock.invocationCallOrder[0]);
});
it('방향키와 Enter로 고른다', () => {
  const { p, swatch, onPick, onClose } = open('');
  swatch('').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  expect(document.activeElement).toBe(swatch('F12424'));
  expect(onPick).not.toHaveBeenCalled();
  swatch('F12424').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  expect(onPick).toHaveBeenCalledWith('F12424');
  expect(onClose).toHaveBeenCalledTimes(1);
  p.destroy();
});
it('바깥을 누르거나 Esc면 닫기만', () => {
  const a = open('');
  document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  expect(a.onClose).toHaveBeenCalledTimes(1);
  expect(a.onPick).not.toHaveBeenCalled();
  a.p.destroy();
  const b = open('');
  b.swatch('').dispatchEvent(new Event('pointerdown', { bubbles: true }));
  expect(b.onClose).not.toHaveBeenCalled();
  b.swatch('').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(b.onClose).toHaveBeenCalledTimes(1);
  expect(b.onPick).not.toHaveBeenCalled();
});
