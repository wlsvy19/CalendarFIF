import { afterEach, expect, it, vi } from 'vitest';
import { mountPalette } from './palette';

// 시험의 onClose는 상자를 치우지 않으므로, 열어 둔 상자가 다음 시험의 누르기를 듣지 않게 끝날 때마다 치운다.
const opened: { destroy(): void }[] = [];
afterEach(() => {
  for (const p of opened.splice(0)) p.destroy();
  document.body.replaceChildren();
});

function open(current = '') {
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  const anchor = document.createElement('button');
  sheet.append(anchor);
  document.body.append(sheet);
  const onPick = vi.fn();
  const onClose = vi.fn();
  const p = mountPalette(anchor, { colors: ['', 'F12424', '009300'], current, onPick, onClose });
  opened.push(p);
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
it('바깥을 눌러 닫은 그 누르기의 click은 밑의 것에 닿지 않고, 다음 누르기는 닿는다', () => {
  const below = document.createElement('button');
  const hit = vi.fn();
  below.addEventListener('click', hit);
  document.body.append(below);
  const { p, onClose, onPick } = open('');
  onClose.mockImplementation(() => p.destroy());
  below.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  below.click();
  expect(onClose).toHaveBeenCalledWith('outside');
  expect([hit.mock.calls.length, onPick.mock.calls.length]).toEqual([0, 0]);
  below.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  below.click();
  expect(hit).toHaveBeenCalledTimes(1);
  below.remove();
});
it('닫은 누르기가 click 없이 끝나면(스크롤, 키) 다른 click은 삼키지 않는다', () => {
  const below = document.createElement('button');
  const other = document.createElement('button');
  const hit = vi.fn();
  below.addEventListener('click', hit);
  other.addEventListener('click', hit);
  document.body.append(below, other);
  const ends: (() => void)[] = [
    () => below.dispatchEvent(new Event('pointercancel', { bubbles: true })), // 스크롤이 가져갔다
    () => below.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })), // 그 뒤의 click은 키로 누른 것
    () => other.click(), // 다른 단추의 click이 먼저 왔다
  ];
  for (const end of ends) {
    const { p, onClose } = open('');
    onClose.mockImplementation(() => p.destroy());
    below.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    end();
    below.click();
  }
  expect(hit).toHaveBeenCalledTimes(4); // below 세 번, other 한 번
  expect(hit.mock.contexts.filter((c) => c === below)).toHaveLength(3);
  below.remove();
  other.remove();
});
it('Space는 뗄 때 고르고, 그 뒤 click이 와도 다시 고르지 않는다', () => {
  const { p, swatch, onPick, onClose } = open('');
  swatch('009300').dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
  expect(onPick).not.toHaveBeenCalled();
  swatch('009300').dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true }));
  expect(onPick).toHaveBeenCalledWith('009300');
  p.destroy();
  swatch('009300').click();
  expect(onPick).toHaveBeenCalledTimes(1);
  expect(onClose).toHaveBeenCalledTimes(1);
});
