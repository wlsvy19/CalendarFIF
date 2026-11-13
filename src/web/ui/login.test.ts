import { expect, it, vi } from 'vitest';
import { loginErrorMessage, mountLogin } from './login';

const fill = (root: HTMLElement, email: string, password: string) => {
  root.querySelector<HTMLInputElement>('input[type="email"]')!.value = email;
  root.querySelector<HTMLInputElement>('input[type="password"]')!.value = password;
  root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
};

it('오류 코드를 한국어 문구로 바꾼다', () => {
  expect(loginErrorMessage('auth/invalid-credential')).toBe('이메일 또는 비밀번호가 맞지 않습니다.');
  expect(loginErrorMessage('auth/network-request-failed')).toBe('네트워크에 연결할 수 없습니다.');
  expect(loginErrorMessage('auth/too-many-requests')).toBe('시도가 너무 많습니다. 잠시 뒤 다시 해 주세요.');
  expect(loginErrorMessage('auth/other')).toBe('로그인하지 못했습니다. (auth/other)');
});
it('입력한 값으로 로그인을 부르고, 실패하면 문구를 보여 준다', async () => {
  const root = document.createElement('div');
  const signIn = vi.fn().mockRejectedValue({ code: 'auth/invalid-credential' });
  mountLogin(root, { signIn });
  fill(root, 'me@example.com', 'pw');
  expect(signIn).toHaveBeenCalledWith('me@example.com', 'pw');
  expect(root.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  await vi.waitFor(() => expect(root.querySelector('[role="alert"]')!.textContent).toBe('이메일 또는 비밀번호가 맞지 않습니다.'));
  expect(root.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
});
