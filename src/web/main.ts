import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import './styles.css';
import { createApp, type Session } from './app';
import { initFirebase } from './firebase';

const { auth } = initFirebase(import.meta.env);

function mountPlaceholderMain(root: HTMLElement, session: Session): { destroy(): void } {
  const el = document.createElement('div');
  el.className = 'app main-placeholder';
  const who = document.createElement('p');
  who.className = 'who';
  who.textContent = session.email;
  const out = document.createElement('button');
  out.type = 'button';
  out.textContent = '로그아웃';
  out.addEventListener('click', () => void signOut(auth));
  el.append(who, out);
  root.appendChild(el);
  return { destroy: () => el.remove() };
}

createApp({
  root: document.getElementById('app')!,
  onAuthChange: (listener) =>
    onAuthStateChanged(auth, (user) => {
      listener(user ? { uid: user.uid, email: user.email ?? '' } : null);
    }),
  signIn: async (email, password) => {
    await signInWithEmailAndPassword(auth, email, password);
  },
  signOut: () => signOut(auth),
  mountMain: mountPlaceholderMain,
});

// 화면 확인용 자동 로그인. 에뮬레이터 모드에서만 동작하며, 그 밖에는 주소 인자를 무시한다.
if (import.meta.env.VITE_USE_EMULATOR === '1' && new URLSearchParams(location.search).get('autologin') === '1') {
  void signInWithEmailAndPassword(auth, 'test@example.com', 'test-password');
}
