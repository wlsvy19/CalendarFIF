import { expect, it, vi } from 'vitest';
import { createApp, type Session } from './app';

it('로그인 상태에 따라 로그인 화면과 본 화면을 바꾼다', () => {
  const root = document.createElement('div');
  let emit!: (session: Session | null) => void;
  const destroyMain = vi.fn();
  const mountMain = vi.fn((el: HTMLElement) => { el.textContent = 'main'; return { destroy: destroyMain }; });
  createApp({ root, onAuthChange: (listener) => { emit = listener; return () => {}; }, signIn: vi.fn(), signOut: vi.fn(), mountMain });

  emit(null);
  expect(root.querySelector('form')).not.toBeNull();
  emit({ uid: 'u1', email: 'me@example.com' });
  expect(mountMain).toHaveBeenCalledTimes(1);
  expect(root.querySelector('form')).toBeNull();
  emit(null);
  expect(destroyMain).toHaveBeenCalledTimes(1);
  expect(root.querySelector('form')).not.toBeNull();
});
