import { expect, it } from 'vitest';
import { acceleratorFromKey, normalizeAccelerator } from './accelerator';

it('단축키를 한 가지 모양으로 적고, 쓸 수 없는 조합은 거른다', () => {
  expect(['ctrl+alt+h', ' Shift + Ctrl + f9 ', 'Alt+Ctrl+5'].map(normalizeAccelerator)).toEqual(['Ctrl+Alt+H', 'Ctrl+Shift+F9', 'Ctrl+Alt+5']);
  expect(['H', 'Shift+A', 'Ctrl+Alt', 'Ctrl+Alt+H+J', 'Alt+F4', 'Super+D', 'Ctrl+Ctrl+H', 'Ctrl+Alt+Delete'].map(normalizeAccelerator)).toEqual(Array(8).fill(null));
});
it('누른 키에서 단축키를 만든다', () => {
  const key = (code: string, m: { ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean; metaKey?: boolean } = {}) => acceleratorFromKey({ ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, code, ...m });
  expect([key('KeyH', { ctrlKey: true, altKey: true }), key('Digit7', { ctrlKey: true, shiftKey: true }), key('F9', { altKey: true })]).toEqual(['Ctrl+Alt+H', 'Ctrl+Shift+7', 'Alt+F9']);
  expect([key('ControlLeft', { ctrlKey: true }), key('KeyH', { ctrlKey: true, metaKey: true }), key('KeyH')]).toEqual([null, null, null]);
});
