import { expect, it, vi } from 'vitest';
import { mountBlocked } from './blocked';

const NONE = '이 계정은 사용 허가를 받지 않았습니다. 관리자에게 문의하세요.';
const BLOCKED = '관리자가 이 계정의 사용을 중지했습니다.';

function mount(kind: 'none' | 'blocked') {
  const root = document.createElement('div');
  const onSignOut = vi.fn();
  const handle = mountBlocked(root, { kind, email: 'me@example.com', onSignOut });
  return { root, handle, onSignOut, text: () => root.querySelector('.blocked-text')!.textContent };
}

it('이메일과 종류별 문구를 보인다', () => {
  const none = mount('none');
  expect(none.root.querySelector('h1')!.textContent).toBe('달력 메모');
  expect(none.root.querySelector('.blocked-email')!.textContent).toBe('me@example.com');
  expect(none.text()).toBe(NONE);
  expect(none.root.querySelector('.blocked-text')!.getAttribute('role')).toBe('alert');
  expect(mount('blocked').text()).toBe(BLOCKED);
});
it('setKind로 문구를 바꾼다', () => {
  const { handle, text } = mount('none');
  handle.setKind('blocked');
  expect(text()).toBe(BLOCKED);
  handle.setKind('none');
  expect(text()).toBe(NONE);
});
it('로그아웃 단추가 onSignOut을 부른다', () => {
  const { root, onSignOut } = mount('none');
  const button = root.querySelector<HTMLButtonElement>('button')!;
  expect(button.textContent).toBe('로그아웃');
  expect(button.classList.contains('primary')).toBe(true);
  button.click();
  expect(onSignOut).toHaveBeenCalledTimes(1);
});
it('destroy는 화면을 없앤다', () => {
  const { root, handle } = mount('none');
  handle.destroy();
  expect(root.children).toHaveLength(0);
});
