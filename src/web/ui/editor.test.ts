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
