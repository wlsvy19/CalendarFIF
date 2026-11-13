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

function mountWithReset(resetPassword: (email: string) => Promise<void>) {
  const root = document.createElement('div');
  mountLogin(root, { signIn: vi.fn().mockResolvedValue(undefined), resetPassword });
  const forgot = root.querySelector<HTMLButtonElement>('.login-forgot')!;
  const email = root.querySelector<HTMLInputElement>('input[type="email"]')!;
  const alertEl = root.querySelector<HTMLElement>('[role="alert"]')!;
  return { root, forgot, email, alertEl };
}

it('resetPassword가 없으면 비밀번호를 잊었습니다 단추가 없다', () => {
  const root = document.createElement('div');
  mountLogin(root, { signIn: vi.fn() });
  expect(root.querySelector('.login-forgot')).toBeNull();
});
it('비밀번호를 잊었습니다: 이메일이 비었거나 @가 없으면 먼저 적으라고 한다', () => {
  const resetPassword = vi.fn().mockResolvedValue(undefined);
  const { forgot, email, alertEl } = mountWithReset(resetPassword);
  expect(forgot.textContent).toBe('비밀번호를 잊었습니다');
  expect(forgot.type).toBe('button');
  forgot.click();
  expect(alertEl.textContent).toBe('이메일을 먼저 적으세요.');
  email.value = 'abc';
  forgot.click();
  expect(alertEl.textContent).toBe('이메일을 먼저 적으세요.');
  expect(resetPassword).not.toHaveBeenCalled();
});
it('비밀번호를 잊었습니다: 보내는 동안 잠그고, 보내면 ok 줄로 알린다', async () => {
  let resolve!: () => void;
  const resetPassword = vi.fn().mockReturnValue(new Promise<void>((r) => (resolve = r)));
  const { root, forgot, email, alertEl } = mountWithReset(resetPassword);
  email.value = ' me@example.com ';
  forgot.click();
  expect(resetPassword).toHaveBeenCalledWith('me@example.com');
  expect(forgot.disabled).toBe(true);
  resolve();
  await vi.waitFor(() => expect(alertEl.textContent).toBe('재설정 메일을 보냈습니다. 메일함을 확인하세요.'));
  expect(alertEl.classList.contains('ok')).toBe(true);
  expect(forgot.disabled).toBe(false);
  root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  expect(alertEl.classList.contains('ok')).toBe(false);
  expect(alertEl.textContent).toBe('');
});
it('비밀번호를 잊었습니다: 실패하면 코드와 함께 알린다', async () => {
  const resetPassword = vi.fn().mockRejectedValue({ code: 'auth/network-request-failed' });
  const { forgot, email, alertEl } = mountWithReset(resetPassword);
  email.value = 'me@example.com';
  forgot.click();
  await vi.waitFor(() => expect(alertEl.textContent).toBe('메일을 보내지 못했습니다. (auth/network-request-failed)'));
  expect(alertEl.classList.contains('ok')).toBe(false);
  expect(forgot.disabled).toBe(false);
});
