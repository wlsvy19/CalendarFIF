import { expect, it, vi } from 'vitest';
import { createApp, type Session } from './app';

it('로그인 상태에 따라 로그인 화면과 본 화면을 바꾼다', () => {
  const root = document.createElement('div');
  let emit!: (session: Session | null) => void;
  const destroyMain = vi.fn();
  const mountMain = vi.fn((el: HTMLElement) => { el.textContent = 'main'; return { destroy: destroyMain }; });
  createApp({ root, onAuthChange: (listener) => { emit = listener; return () => {}; }, signIn: vi.fn(), signOut: vi.fn(), resetPassword: vi.fn(), mountMain });

  emit(null);
  expect(root.querySelector('form')).not.toBeNull();
  emit({ uid: 'u1', email: 'me@example.com' });
  expect(mountMain).toHaveBeenCalledTimes(1);
  expect(root.querySelector('form')).toBeNull();
  emit(null);
  expect(destroyMain).toHaveBeenCalledTimes(1);
  expect(root.querySelector('form')).not.toBeNull();
});

it('로그인 화면의 "비밀번호를 잊었습니다"가 적어 둔 이메일로 resetPassword를 부른다', async () => {
  const root = document.createElement('div');
  let emit!: (session: Session | null) => void;
  const resetPassword = vi.fn(() => Promise.resolve());
  createApp({ root, onAuthChange: (listener) => { emit = listener; return () => {}; }, signIn: vi.fn(), signOut: vi.fn(), resetPassword, mountMain: vi.fn() });

  emit(null);
  root.querySelector<HTMLInputElement>('input[type="email"]')!.value = ' me@example.com ';
  root.querySelector<HTMLButtonElement>('.login-forgot')!.click();
  expect(resetPassword).toHaveBeenCalledWith('me@example.com');
  await vi.waitFor(() => expect(root.querySelector('[role="alert"]')!.textContent).toBe('재설정 메일을 보냈습니다. 메일함을 확인하세요.'));
});
