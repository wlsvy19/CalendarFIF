export type BlockedKind = 'none' | 'blocked';

const TEXT: Record<BlockedKind, string> = {
  none: '이 계정은 사용 허가를 받지 않았습니다. 관리자에게 문의하세요.',
  blocked: '관리자가 이 계정의 사용을 중지했습니다.',
};

export function mountBlocked(
  root: HTMLElement,
  props: {
    kind: BlockedKind;
    email: string;
    /** 이 기기에서 아직 올리지 못한 편집의 건수. */
    pending(): number;
    onSignOut(): void;
    /** 허가를 지금 다시 확인한다. 답이 오면 끝난다. */
    onRecheck(): Promise<void>;
  },
): { setKind(kind: BlockedKind): void; destroy(): void } {
  const wrap = document.createElement('div');
  wrap.className = 'login';
  wrap.innerHTML = `
    <div class="login-card">
      <h1>달력 메모</h1>
      <p class="blocked-email"></p>
      <p class="blocked-text" role="alert"></p>
      <p class="blocked-pending" hidden></p>
      <p class="settings-warn blocked-confirm" role="alert" hidden></p>
      <button type="button" class="settings-btn">다시 확인</button>
      <button type="button" class="primary">로그아웃</button>
      <button type="button" class="settings-btn danger" hidden>그래도 로그아웃</button>
    </div>`;
  const text = wrap.querySelector<HTMLElement>('.blocked-text')!;
  const pendingLine = wrap.querySelector<HTMLElement>('.blocked-pending')!;
  const confirmText = wrap.querySelector<HTMLElement>('.blocked-confirm')!;
  const [recheckBtn, signOutBtn, forceBtn] = wrap.querySelectorAll<HTMLButtonElement>('button');
  wrap.querySelector('.blocked-email')!.textContent = props.email;
  text.textContent = TEXT[props.kind];
  let alive = true;

  const showPending = (): number => {
    const n = props.pending();
    pendingLine.textContent = `아직 올리지 못한 편집이 ${n}건 있습니다.`;
    pendingLine.hidden = n <= 0 || !confirmText.hidden;
    return n;
  };
  showPending();

  // 설정 화면의 로그아웃과 같다: 올리지 못한 편집이 있으면 한 번 더 묻는다.
  signOutBtn.addEventListener('click', () => {
    const n = showPending();
    if (n <= 0) {
      props.onSignOut();
      return;
    }
    confirmText.textContent = `아직 올리지 못한 편집이 ${n}건 있습니다. 로그아웃하면 이 기기에 남습니다.`;
    confirmText.hidden = false;
    pendingLine.hidden = true;
    forceBtn.hidden = false;
    signOutBtn.hidden = true;
    forceBtn.focus();
  });
  forceBtn.addEventListener('click', () => props.onSignOut());

  recheckBtn.addEventListener('click', () => {
    if (recheckBtn.disabled) return;
    const hadFocus = document.activeElement === recheckBtn;
    recheckBtn.disabled = true;
    recheckBtn.textContent = '확인하는 중';
    let pending: Promise<void>;
    try {
      pending = props.onRecheck();
    } catch (e) {
      pending = Promise.reject(e);
    }
    const finish = (): void => {
      if (!alive) return;
      recheckBtn.disabled = false;
      recheckBtn.textContent = '다시 확인';
      showPending();
      // 잠긴 동안 초점이 body로 떨어졌으면 단추로 돌려준다.
      const idle = document.activeElement === document.body || document.activeElement === null;
      if (hadFocus && idle) recheckBtn.focus({ preventScroll: true });
    };
    pending.then(finish, finish);
  });

  root.appendChild(wrap);
  return {
    setKind(kind) {
      text.textContent = TEXT[kind];
      showPending();
    },
    destroy() {
      alive = false;
      wrap.remove();
    },
  };
}
