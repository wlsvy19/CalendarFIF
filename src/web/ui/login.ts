export function loginErrorMessage(code: string): string {
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/invalid-email':
      return '이메일 또는 비밀번호가 맞지 않습니다.';
    case 'auth/network-request-failed':
      return '네트워크에 연결할 수 없습니다.';
    case 'auth/too-many-requests':
      return '시도가 너무 많습니다. 잠시 뒤 다시 해 주세요.';
    default:
      return `로그인하지 못했습니다. (${code})`;
  }
}

export function mountLogin(
  root: HTMLElement,
  props: { signIn(email: string, password: string): Promise<void>; resetPassword?(email: string): Promise<void> },
): { destroy(): void } {
  const wrap = document.createElement('div');
  wrap.className = 'login';
  wrap.innerHTML = `
    <form class="login-card" novalidate>
      <h1>달력 메모</h1>
      <label>이메일<input type="email" name="email" autocomplete="username" required></label>
      <label>비밀번호<input type="password" name="password" autocomplete="current-password" required></label>
      <p class="login-error" role="alert"></p>
      <button type="submit" class="primary">로그인</button>
      ${props.resetPassword ? '<button type="button" class="textbtn login-forgot">비밀번호를 잊었습니다</button>' : ''}
    </form>`;
  const form = wrap.querySelector('form')!;
  const email = wrap.querySelector<HTMLInputElement>('input[type="email"]')!;
  const password = wrap.querySelector<HTMLInputElement>('input[type="password"]')!;
  const alertEl = wrap.querySelector<HTMLElement>('[role="alert"]')!;
  const button = wrap.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  let alive = true;

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    alertEl.textContent = '';
    alertEl.classList.remove('ok');
    button.disabled = true;
    props.signIn(email.value.trim(), password.value).then(
      () => {
        if (alive) button.disabled = false;
      },
      (error: unknown) => {
        if (!alive) return;
        const code = (error as { code?: string } | null)?.code ?? 'unknown';
        alertEl.textContent = loginErrorMessage(code);
        button.disabled = false;
      },
    );
  });

  const forgot = wrap.querySelector<HTMLButtonElement>('.login-forgot');
  if (forgot && props.resetPassword) {
    const reset = props.resetPassword;
    forgot.addEventListener('click', () => {
      alertEl.classList.remove('ok');
      const address = email.value.trim();
      if (!address.includes('@')) {
        alertEl.textContent = '이메일을 먼저 적으세요.';
        return;
      }
      alertEl.textContent = '';
      forgot.disabled = true;
      reset(address).then(
        () => {
          if (!alive) return;
          alertEl.classList.add('ok');
          alertEl.textContent = '재설정 메일을 보냈습니다. 메일함을 확인하세요.';
          forgot.disabled = false;
        },
        (error: unknown) => {
          if (!alive) return;
          const code = (error as { code?: string } | null)?.code ?? 'unknown';
          alertEl.textContent = `메일을 보내지 못했습니다. (${code})`;
          forgot.disabled = false;
        },
      );
    });
  }

  root.appendChild(wrap);
  return {
    destroy() {
      alive = false;
      wrap.remove();
    },
  };
}
