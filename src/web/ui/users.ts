import type { UserRow } from '../users';
import { openSheet } from './sheet';

export type UsersProps = {
  /** 목록을 지켜본다. 끊는 함수를 돌려준다. */
  watch(onRows: (rows: UserRow[]) => void, onError: (code: string) => void): () => void;
  onAdd(email: string, password: string): Promise<{ ok: boolean; message: string }>;
  onSetDisabled(uid: string, disabled: boolean): Promise<void>;
  onRemove(uid: string): Promise<void>;
  onReset(email: string): Promise<void>;
  onClose(): void;
  /** PC 앱에서만 준다: 시트를 제목 줄로 끌어 옮기게 한다(편집 화면과 같은 모양). */
  attachDrag?: (sheet: HTMLElement, handle: HTMLElement) => { destroy(): void };
};

const CONFIRM_MS = 4000;

export function mountUsers(root: HTMLElement, props: UsersProps): { destroy(): void } {
  const opened = openSheet(root, { className: 'users', titleId: 'usersTitle', title: '사용자 관리', onClose: props.onClose });
  const sheet = opened.sheet;
  sheet.insertAdjacentHTML(
    'beforeend',
    `
    <p class="users-status" role="status"></p>
    <div class="users-body"></div>
    <form class="users-add" novalidate>
      <label>이메일<input type="email" name="email" autocomplete="off" autocapitalize="none" spellcheck="false" required></label>
      <label>처음 비밀번호<input type="text" name="password" autocomplete="off" autocapitalize="none" spellcheck="false" required></label>
      <p class="users-hint">8자 이상. 사용자에게 알려 주고, 설정에서 바꾸라고 하세요.</p>
      <button type="submit" class="primary">추가</button>
    </form>`,
  );
  const statusEl = sheet.querySelector<HTMLElement>('.users-status')!;
  const body = sheet.querySelector<HTMLElement>('.users-body')!;
  const form = sheet.querySelector<HTMLFormElement>('.users-add')!;
  const emailInput = form.querySelector<HTMLInputElement>('input[name="email"]')!;
  const passwordInput = form.querySelector<HTMLInputElement>('input[name="password"]')!;
  const addButton = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;

  let alive = true;
  let rows: UserRow[] | null = null;
  let failed = false;
  let listError = false; // 상태 줄이 목록 오류를 보이는 중
  const busy = new Set<string>(); // 처리 중인 행
  const armed = new Map<string, ReturnType<typeof setTimeout>>(); // "정말 지우기"를 기다리는 행

  const status = (text: string): void => {
    statusEl.textContent = text;
  };

  function render(): void {
    const focused = document.activeElement as HTMLElement | null;
    const focusKey = focused && body.contains(focused) ? `${focused.closest('li')?.dataset.uid}|${focused.dataset.act}` : null;
    body.replaceChildren();
    if (rows === null) {
      if (!failed) {
        const p = document.createElement('p');
        p.className = 'users-note';
        p.textContent = '불러오는 중';
        body.append(p);
      }
      return;
    }
    const list = document.createElement('ul');
    list.className = 'users-list';
    for (const row of rows) list.append(renderRow(row));
    body.append(list);
    if (!rows.some((r) => r.role !== 'admin')) {
      const note = document.createElement('li');
      note.className = 'users-note';
      note.textContent = '추가한 사용자가 없습니다.';
      // 관리자 행 바로 뒤에 둔다.
      const lastAdmin = list.querySelectorAll('.user-row').length;
      if (lastAdmin > 0) list.children[lastAdmin - 1].after(note);
      else list.append(note);
    }
    if (focusKey) {
      const [uid, act] = focusKey.split('|');
      for (const li of body.querySelectorAll<HTMLElement>('li')) {
        if (li.dataset.uid === uid) li.querySelector<HTMLElement>(`[data-act="${act}"]`)?.focus({ preventScroll: true });
      }
    }
  }

  function renderRow(row: UserRow): HTMLElement {
    const li = document.createElement('li');
    li.className = 'user-row';
    li.dataset.uid = row.uid;
    const email = document.createElement('span');
    email.className = 'user-email';
    email.textContent = row.email;
    const badge = document.createElement('span');
    badge.className = 'user-badge';
    badge.textContent = row.role === 'admin' ? '관리자' : row.disabled ? '중지됨' : '사용 중';
    if (row.role !== 'admin' && row.disabled) badge.classList.add('off');
    const line = document.createElement('div');
    line.className = 'user-line';
    line.append(badge);
    li.append(email, line);
    if (row.role === 'admin') return li;

    const pending = busy.has(row.uid);
    const button = (act: string, text: string, onClick: () => void): HTMLButtonElement => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'donebtn';
      b.dataset.act = act;
      b.textContent = text;
      b.disabled = pending;
      b.addEventListener('click', onClick);
      line.append(b);
      return b;
    };
    button('toggle', row.disabled ? '다시 허용' : '사용 중지', () => void run(row.uid, 'toggle', '바꾸지 못했습니다.', () => props.onSetDisabled(row.uid, !row.disabled)));
    button('reset', '재설정 메일', () => void run(row.uid, 'reset', '메일을 보내지 못했습니다.', () => props.onReset(row.email), `재설정 메일을 보냈습니다: ${row.email}`));
    const del = button('remove', armed.has(row.uid) ? '정말 지우기' : '지우기', () => {
      if (!armed.has(row.uid)) {
        armed.set(row.uid, setTimeout(() => {
          armed.delete(row.uid);
          if (alive) render();
        }, CONFIRM_MS));
        render();
        return;
      }
      clearTimeout(armed.get(row.uid));
      armed.delete(row.uid);
      void run(row.uid, 'remove', '지우지 못했습니다.', () => props.onRemove(row.uid), '목록에서 지웠습니다. 로그인 계정과 그 사람의 메모는 남아 있습니다.');
    });
    if (armed.has(row.uid)) del.classList.add('danger');
    return li;
  }

  // 처리 중에는 초점이 시트에 있어야 Escape와 Tab 가두기가 계속 듣는다. 눌린 단추가 잠기면 초점이 body로 떨어진다.
  const focusIdle = (): boolean => document.activeElement === sheet || document.activeElement === document.body || document.activeElement === null;
  const holdFocus = (inside: HTMLElement): boolean => {
    const had = inside.contains(document.activeElement);
    if (had) sheet.focus({ preventScroll: true });
    return had;
  };
  const giveFocusBack = (target: HTMLElement | null | undefined): void => {
    if (!focusIdle()) return;
    if (target?.isConnected && !(target as HTMLButtonElement).disabled) target.focus({ preventScroll: true });
    else sheet.focus({ preventScroll: true });
  };

  async function run(uid: string, act: string, failText: string, action: () => Promise<void>, okText?: string): Promise<void> {
    if (busy.has(uid)) return;
    busy.add(uid);
    const hadFocus = holdFocus(body);
    render();
    try {
      await action();
      if (alive && okText) status(okText);
    } catch {
      if (alive) status(failText);
    } finally {
      busy.delete(uid);
      if (alive) {
        render();
        if (hadFocus) {
          const li = [...body.querySelectorAll<HTMLElement>('li')].find((el) => el.dataset.uid === uid);
          giveFocusBack(li?.querySelector<HTMLElement>(`[data-act="${act}"]`));
        }
      }
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (addButton.disabled) return;
    const origin = document.activeElement as HTMLElement | null;
    const hadFocus = holdFocus(form);
    const setPending = (on: boolean): void => {
      addButton.disabled = on;
      emailInput.disabled = on;
      passwordInput.disabled = on;
    };
    const finish = (ok: boolean): void => {
      setPending(false);
      if (hadFocus) giveFocusBack(ok ? emailInput : origin && form.contains(origin) ? origin : emailInput);
    };
    setPending(true);
    let pending: Promise<{ ok: boolean; message: string }>;
    try {
      pending = props.onAdd(emailInput.value, passwordInput.value);
    } catch (e) {
      pending = Promise.reject(e);
    }
    pending.then(
      (result) => {
        if (!alive) return;
        status(result.message);
        listError = false;
        if (result.ok) {
          emailInput.value = '';
          passwordInput.value = '';
        }
        finish(result.ok);
      },
      () => {
        if (!alive) return;
        status('추가하지 못했습니다.');
        listError = false;
        finish(false);
      },
    );
  });

  const unwatch = props.watch(
    (next) => {
      if (!alive) return;
      rows = next;
      failed = false;
      if (listError) status('');
      listError = false;
      for (const uid of [...armed.keys()]) {
        if (!next.some((r) => r.uid === uid)) {
          clearTimeout(armed.get(uid));
          armed.delete(uid);
        }
      }
      render();
    },
    (code) => {
      if (!alive) return;
      failed = true;
      listError = true;
      status(`목록을 읽지 못했습니다. (${code})`);
      render();
    },
  );
  render();
  const drag = props.attachDrag?.(sheet, sheet.querySelector<HTMLElement>('.sheet-bar')!);

  return {
    destroy() {
      if (!alive) return;
      alive = false;
      drag?.destroy();
      unwatch();
      for (const t of armed.values()) clearTimeout(t);
      armed.clear();
      opened.destroy();
    },
  };
}
