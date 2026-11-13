import { expect, it, vi } from 'vitest';
import type { DayValue } from '../../core/types';
import { mountEditor } from './editor';

function mount(value: DayValue) {
  const root = document.createElement('div');
  document.body.append(root);
  const onSave = vi.fn();
  const onCancel = vi.fn();
  mountEditor(root, { dateKey: '2026-11-13', value, onSave, onCancel });
  const area = root.querySelector<HTMLTextAreaElement>('textarea')!;
  const button = (label: string) => [...root.querySelectorAll('button')].find((b) => b.textContent === label)!;
  return { root, area, button, onSave, onCancel };
}

it('날짜와 저장된 값을 보여 준다', () => {
  const { root, area } = mount({ text: 'a\n[+]b', color: 'F12424' });
  expect(root.textContent).toContain('11월 13일 금요일');
  expect(area.value).toBe('a\n[+]b');
  expect(root.querySelectorAll('[role="radio"]')).toHaveLength(23);
  expect(root.querySelector('[role="radio"][aria-checked="true"]')!.getAttribute('data-color')).toBe('F12424');
});
it('팔레트에 없는 색은 단추를 하나 더 둔다', () => {
  const { root } = mount({ text: '', color: 'FF0000' });
  expect(root.querySelectorAll('[role="radio"]')).toHaveLength(24);
  expect(root.querySelector('[role="radio"][aria-checked="true"]')!.getAttribute('data-color')).toBe('FF0000');
});
it('커서가 있는 줄의 완료 표시를 바꾼다', () => {
  const { area, button } = mount({ text: 'a\n[+]b', color: '' });
  area.setSelectionRange(0, 0);
  button('완료 표시').click();
  expect(area.value).toBe('[+]a\n[+]b');
});
it('저장하면 다듬은 글과 고른 색을 넘긴다', () => {
  const { root, area, button, onSave, onCancel } = mount({ text: '', color: '' });
  area.value = 'x  \r\n\r\n';
  root.querySelector<HTMLElement>('[role="radio"][data-color="009300"]')!.click();
  button('저장').click();
  expect(onSave).toHaveBeenCalledWith({ text: 'x', color: '009300' });
  expect(onCancel).not.toHaveBeenCalled();
});
it('취소와 Esc는 저장하지 않는다', () => {
  const first = mount({ text: 'a', color: '' });
  first.area.value = 'changed';
  first.button('취소').click();
  expect(first.onCancel).toHaveBeenCalledTimes(1);
  expect(first.onSave).not.toHaveBeenCalled();
  const second = mount({ text: 'a', color: '' });
  second.area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(second.onCancel).toHaveBeenCalledTimes(1);
});
it('저장과 취소는 한 번만 전달된다', () => {
  const saved = mount({ text: 'a', color: '' });
  saved.button('저장').click();
  saved.button('저장').click();
  saved.button('취소').click();
  expect(saved.onSave).toHaveBeenCalledTimes(1);
  expect(saved.onCancel).not.toHaveBeenCalled();
  const cancelled = mount({ text: 'a', color: '' });
  cancelled.area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  cancelled.button('취소').click();
  cancelled.button('저장').click();
  expect(cancelled.onCancel).toHaveBeenCalledTimes(1);
  expect(cancelled.onSave).not.toHaveBeenCalled();
});
it('한글 조합 중에는 Esc와 Ctrl+Enter를 무시한다', () => {
  const { area, onSave, onCancel } = mount({ text: 'a', color: '' });
  area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, isComposing: true }));
  area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, isComposing: true }));
  expect(onCancel).not.toHaveBeenCalled();
  expect(onSave).not.toHaveBeenCalled();
});
it('바깥을 누르면 고친 것이 없을 때만 닫는다', () => {
  const typed = mount({ text: 'a', color: '' });
  typed.area.value = 'a\nb';
  typed.root.querySelector<HTMLElement>('.scrim')!.click();
  expect(typed.onCancel).not.toHaveBeenCalled();
  const recoloured = mount({ text: 'a', color: '' });
  recoloured.root.querySelector<HTMLElement>('[role="radio"][data-color="009300"]')!.click();
  recoloured.root.querySelector<HTMLElement>('.scrim')!.click();
  expect(recoloured.onCancel).not.toHaveBeenCalled();
  const untouched = mount({ text: 'a', color: 'F12424' });
  untouched.root.querySelector<HTMLElement>('.scrim')!.click();
  expect(untouched.onCancel).toHaveBeenCalledTimes(1);
});
it('보이는 영역의 높이와 위치를 편집 화면에 넘긴다', () => {
  const listeners = new Map<string, Set<() => void>>();
  const viewport = {
    height: 500,
    offsetTop: 0,
    addEventListener(type: string, fn: () => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: () => void) {
      listeners.get(type)?.delete(fn);
    },
  };
  const fire = (type: string) => { for (const fn of listeners.get(type) ?? []) fn(); };
  const root = document.createElement('div');
  document.body.append(root);
  const handle = mountEditor(root, { dateKey: '2026-11-13', value: { text: '', color: '' }, onSave: vi.fn(), onCancel: vi.fn() }, { visualViewport: viewport });
  const sheet = root.querySelector<HTMLElement>('.sheet')!;
  expect(sheet.style.getPropertyValue('--vv-height')).toBe('500px');
  expect(sheet.style.getPropertyValue('--vv-top')).toBe('0px');
  viewport.height = 300;
  fire('resize');
  expect(sheet.style.getPropertyValue('--vv-height')).toBe('300px');
  viewport.offsetTop = 40;
  fire('scroll');
  expect(sheet.style.getPropertyValue('--vv-top')).toBe('40px');
  handle.destroy();
  expect([...listeners.values()].every((set) => set.size === 0)).toBe(true);
});
