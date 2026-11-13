export type BlockedKind = 'none' | 'blocked';

const TEXT: Record<BlockedKind, string> = {
  none: '이 계정은 사용 허가를 받지 않았습니다. 관리자에게 문의하세요.',
  blocked: '관리자가 이 계정의 사용을 중지했습니다.',
};

export function mountBlocked(
  root: HTMLElement,
  props: { kind: BlockedKind; email: string; onSignOut(): void },
): { setKind(kind: BlockedKind): void; destroy(): void } {
  const wrap = document.createElement('div');
  wrap.className = 'login';
  wrap.innerHTML = `
    <div class="login-card">
      <h1>달력 메모</h1>
      <p class="blocked-email"></p>
      <p class="blocked-text" role="alert"></p>
      <button type="button" class="primary">로그아웃</button>
    </div>`;
  const text = wrap.querySelector<HTMLElement>('.blocked-text')!;
  wrap.querySelector('.blocked-email')!.textContent = props.email;
  text.textContent = TEXT[props.kind];
  wrap.querySelector('button')!.addEventListener('click', () => props.onSignOut());
  root.appendChild(wrap);
  return {
    setKind(kind) {
      text.textContent = TEXT[kind];
    },
    destroy() {
      wrap.remove();
    },
  };
}
