import { dismiss } from './sheetMotion';

export type AccountProps = {
  email: string;
  pending: number;
  storageOk: boolean;
  corruptFound: boolean;
  onSignOut(): void;
  /** 주면 "비밀번호 변경"을 보인다. 결과 문구를 돌려준다. */
  onChangePassword?(current: string, next: string): Promise<{ ok: boolean; message: string }>;
  /** 주면 "사용자 관리" 단추를 보인다(관리자). */
  onManageUsers?(): void;
};

const PASSWORD_DONE_MS = 1500;

// "비밀번호" 칸. 단추를 누르면 그 자리가 폼으로 바뀐다.
function passwordField(onChange: NonNullable<AccountProps['onChangePassword']>): HTMLElement {
  const field = document.createElement('div');
  field.className = 'field';
  field.innerHTML = `
    <span class="field-label">비밀번호</span>
    <div class="account-pw"></div>`;
  const slot = field.querySelector<HTMLElement>('.account-pw')!;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const showButton = (): void => {
    clearTimeout(timer);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'settings-btn';
    b.textContent = '비밀번호 변경';
    b.addEventListener('click', showForm);
    slot.replaceChildren(b);
  };
  const showForm = (): void => {
    const form = document.createElement('form');
    form.className = 'account-pw-form';
    form.noValidate = true;
    form.innerHTML = `
      <input type="password" name="current" autocomplete="current-password" placeholder="지금 비밀번호">
      <input type="password" name="next" autocomplete="new-password" placeholder="새 비밀번호 (8자 이상)">
      <div class="account-pw-actions">
        <button type="submit" class="donebtn">바꾸기</button>
        <button type="button" class="donebtn cancel">취소</button>
      </div>
      <p class="settings-note" role="status"></p>`;
    const current = form.querySelector<HTMLInputElement>('input[name="current"]')!;
    const next = form.querySelector<HTMLInputElement>('input[name="next"]')!;
    const note = form.querySelector<HTMLElement>('.settings-note')!;
    const controls = form.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, button');
    const setBusy = (on: boolean): void => controls.forEach((c) => (c.disabled = on));
    form.querySelector('.cancel')!.addEventListener('click', showButton);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (current.disabled) return;
      setBusy(true);
      onChange(current.value, next.value).then(
        (result) => {
          if (!form.isConnected) return;
          note.textContent = result.message;
          if (result.ok) {
            current.value = '';
            next.value = '';
            timer = setTimeout(showButton, PASSWORD_DONE_MS);
          }
          setBusy(false);
        },
        () => {
          if (!form.isConnected) return;
          note.textContent = '바꾸지 못했습니다.';
          setBusy(false);
        },
      );
    });
    slot.replaceChildren(form);
    current.focus();
  };
  showButton();
  return field;
}

function usersField(onManage: () => void): HTMLElement {
  const field = document.createElement('div');
  field.className = 'field';
  field.innerHTML = `
    <span class="field-label">사용자</span>
    <button type="button" class="settings-btn">사용자 관리</button>`;
  field.querySelector('button')!.addEventListener('click', onManage);
  return field;
}

// 계정, 동기화, (extra), 로그아웃. 웹앱 설정 화면과 PC 앱 설정의 계정 쪽이 함께 쓴다.
// 감싸는 요소는 상자를 만들지 않아서(display: contents) 자식들이 시트의 세로 배치에 그대로 놓인다.
export function accountSection(props: AccountProps, extra?: HTMLElement): HTMLElement {
  const el = document.createElement('div');
  el.style.display = 'contents';
  el.innerHTML = `
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
    <div class="field settings-signout">
      <p class="settings-warn settings-confirm" role="alert" hidden></p>
      <button type="button" class="settings-btn signout">로그아웃</button>
      <button type="button" class="settings-btn danger" hidden>그래도 로그아웃</button>
    </div>`;
  el.querySelector('.settings-email')!.textContent = props.email;
  el.querySelector('.settings-pending')!.textContent = `대기 중인 편집 ${props.pending}건`;
  el.querySelector<HTMLElement>('.settings-storage')!.hidden = props.storageOk;
  el.querySelector<HTMLElement>('.settings-corrupt')!.hidden = !props.corruptFound;
  const signOutField = el.querySelector('.settings-signout')!;
  if (props.onManageUsers) signOutField.before(usersField(props.onManageUsers));
  if (props.onChangePassword) signOutField.before(passwordField(props.onChangePassword));
  if (extra) signOutField.before(extra);
  const signOutBtn = el.querySelector<HTMLButtonElement>('.signout')!;
  const forceBtn = el.querySelector<HTMLButtonElement>('.danger')!;
  const confirmText = el.querySelector<HTMLElement>('.settings-confirm')!;
  signOutBtn.addEventListener('click', () => {
    if (props.pending <= 0) {
      props.onSignOut();
      return;
    }
    confirmText.textContent = `아직 올리지 못한 편집이 ${props.pending}건 있습니다. 로그아웃하면 이 기기에 남습니다.`;
    confirmText.hidden = false;
    forceBtn.hidden = false;
    signOutBtn.hidden = true;
    forceBtn.focus();
  });
  forceBtn.addEventListener('click', () => props.onSignOut());
  return el;
}

function widgetNote(): HTMLElement {
  const field = document.createElement('div');
  field.className = 'field';
  field.innerHTML = `
      <span class="field-label">위젯</span>
      <p class="settings-note">아이폰 위젯은 다음 단계에서 추가됩니다.</p>`;
  return field;
}

export function mountSettings(
  root: HTMLElement,
  props: {
    email: string;
    pending: number;
    storageOk: boolean;
    corruptFound: boolean;
    onSignOut(): void;
    onClose(): void;
    onChangePassword?: AccountProps['onChangePassword'];
    onManageUsers?: AccountProps['onManageUsers'];
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
    </div>`;
  const closeBtn = sheet.querySelector<HTMLButtonElement>('.textbtn.end')!;

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
  sheet.append(accountSection({ ...props, onSignOut: signOut }, widgetNote()));
  sheet.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== 'Tab') return;
    const stops = [...sheet.querySelectorAll<HTMLElement>('button, input')].filter(
      (el) => !el.hidden && !(el as HTMLButtonElement).disabled && !el.closest('[hidden]'),
    );
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
      dismiss(scrim, sheet);
      if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true });
    },
  };
}
