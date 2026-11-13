import { expect, it, vi } from 'vitest';
import { mountSettings } from './settings';

function mount(overrides: Partial<Parameters<typeof mountSettings>[1]> = {}) {
  const root = document.createElement('div');
  const onSignOut = vi.fn();
  mountSettings(root, { email: 'me@example.com', pending: 0, storageOk: true, corruptFound: false, onSignOut, onClose: vi.fn(), ...overrides });
  const button = (label: string) => [...root.querySelectorAll('button')].find((b) => b.textContent === label)!;
  return { root, button, onSignOut };
}

it('계정과 대기 건수를 보여 주고 로그아웃한다', () => {
  const { root, button, onSignOut } = mount();
  expect(root.textContent).toContain('me@example.com');
  expect(root.textContent).toContain('대기 중인 편집 0건');
  button('로그아웃').click();
  expect(onSignOut).toHaveBeenCalledTimes(1);
});
it('올리지 못한 편집이 있으면 한 번 더 묻는다', () => {
  const { root, button, onSignOut } = mount({ pending: 2 });
  button('로그아웃').click();
  expect(onSignOut).not.toHaveBeenCalled();
  expect(root.textContent).toContain('아직 올리지 못한 편집이 2건 있습니다.');
  button('그래도 로그아웃').click();
  expect(onSignOut).toHaveBeenCalledTimes(1);
});
it('저장소 문제를 알린다', () => {
  expect(mount({ storageOk: false }).root.textContent).toContain('이 브라우저에서는 대기 중인 편집을 저장할 수 없습니다.');
  expect(mount({ corruptFound: true }).root.textContent).toContain('대기 중이던 편집 기록이 깨져 있어 따로 보관했습니다.');
  const hidden = (root: HTMLElement, selector: string) => root.querySelector<HTMLElement>(selector)!.hidden;
  const fine = mount().root;
  expect(hidden(fine, '.settings-storage')).toBe(true);
  expect(hidden(fine, '.settings-corrupt')).toBe(true);
  const storage = mount({ storageOk: false }).root;
  expect(hidden(storage, '.settings-storage')).toBe(false);
  expect(hidden(storage, '.settings-corrupt')).toBe(true);
  const corrupt = mount({ corruptFound: true }).root;
  expect(hidden(corrupt, '.settings-storage')).toBe(true);
  expect(hidden(corrupt, '.settings-corrupt')).toBe(false);
});
