export function mountSettings(
  root: HTMLElement,
  props: {
    email: string;
    pending: number;
    storageOk: boolean;
    corruptFound: boolean;
    onSignOut(): void;
    onClose(): void;
  },
): { destroy(): void } {
  const previouslyFocused = document.activeElement as HTMLElement | null;
  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  const sheet = document.createElement('div');
  sheet.className = 'sheet settings';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-labelledby', 'settingsTitle');
  sheet.tabIndex = -1;
  sheet.innerHTML = `
    <div class="sheet-bar">
      <span></span>
      <h3 id="settingsTitle">설정</h3>
      <button type="button" class="textbtn end">닫기</button>
    </div>
    <div class="field">
      <span class="field-label">계정</span>
      <p class="settings-email"></p>
    </div>
    <div class="field">
      <span class="field-label">동기화</span>
      <p class="settings-pending"></p>
      <p class="settings-warn settings-storage" hidden>이 브라우저에서는 대기 중인 편집을 저장할 수 없습니다. 연결이 끊긴 채로 창을 닫으면 편집이 사라집니다.</p>
      <p class="settings-warn settings-corrupt" hidden>대기 중이던 편집 기록이 깨져 있어 따로 보관했습니다.</p>
    </div>
    <div class="field">
      <span class="field-label">위젯</span>
      <p class="settings-note">아이폰 위젯은 다음 단계에서 추가됩니다.</p>
    </div>
    <div class="field settings-signout">
      <p class="settings-warn settings-confirm" role="alert" hidden></p>
      <button type="button" class="settings-btn signout">로그아웃</button>
      <button type="button" class="settings-btn danger" hidden>그래도 로그아웃</button>
    </div>`;
  sheet.querySelector('.settings-email')!.textContent = props.email;
  sheet.querySelector('.settings-pending')!.textContent = `대기 중인 편집 ${props.pending}건`;
  sheet.querySelector<HTMLElement>('.settings-storage')!.hidden = props.storageOk;
  sheet.querySelector<HTMLElement>('.settings-corrupt')!.hidden = !props.corruptFound;
  const closeBtn = sheet.querySelector<HTMLButtonElement>('.textbtn.end')!;
  const signOutBtn = sheet.querySelector<HTMLButtonElement>('.signout')!;
  const forceBtn = sheet.querySelector<HTMLButtonElement>('.danger')!;
  const confirmText = sheet.querySelector<HTMLElement>('.settings-confirm')!;

  // 닫기와 로그아웃은 합쳐서 한 번만 전달한다. 화면이 닫히기 전에 같은 입력이 다시 와도 무시한다.
  let finished = false;
  const close = (): void => {
    if (finished) return;
    finished = true;
    props.onClose();
  };
  const signOut = (): void => {
    if (finished) return;
    finished = true;
    props.onSignOut();
  };
  closeBtn.addEventListener('click', close);
  scrim.addEventListener('click', close);
  signOutBtn.addEventListener('click', () => {
    if (props.pending <= 0) {
      signOut();
      return;
    }
    confirmText.textContent = `아직 올리지 못한 편집이 ${props.pending}건 있습니다. 로그아웃하면 이 기기에 남습니다.`;
    confirmText.hidden = false;
    forceBtn.hidden = false;
    signOutBtn.hidden = true;
    forceBtn.focus();
  });
  forceBtn.addEventListener('click', signOut);
  sheet.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== 'Tab') return;
    const stops = [...sheet.querySelectorAll<HTMLElement>('button')].filter((el) => !el.hidden);
    const first = stops[0];
    const last = stops[stops.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === sheet)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  root.append(scrim, sheet);
  document.documentElement.classList.add('sheet-open');
  sheet.focus();

  return {
    destroy() {
      document.documentElement.classList.remove('sheet-open');
      scrim.remove();
      sheet.remove();
      if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true });
    },
  };
}
