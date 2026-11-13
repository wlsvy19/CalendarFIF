import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { UserRow } from '../users';
import { mountUsers, type UsersProps } from './users';

const admin: UserRow = { uid: 'a1', email: 'boss@example.com', role: 'admin', disabled: false, createdAt: 1 };
const alice: UserRow = { uid: 'u1', email: 'alice@example.com', role: 'user', disabled: false, createdAt: 2 };
const bob: UserRow = { uid: 'u2', email: 'bob@example.com', role: 'user', disabled: true, createdAt: 3 };

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
  document.documentElement.className = '';
});

function setup(over: Partial<UsersProps> = {}) {
  const root = document.createElement('div');
  document.body.append(root);
  let emit: (rows: UserRow[]) => void = () => {};
  let fail: (code: string) => void = () => {};
  const stop = vi.fn();
  const props: UsersProps = {
    watch: (onRows, onError) => {
      emit = onRows;
      fail = onError;
      return stop;
    },
    onAdd: vi.fn().mockResolvedValue({ ok: true, message: '추가했습니다.' }),
    onSetDisabled: vi.fn().mockResolvedValue(undefined),
    onRemove: vi.fn().mockResolvedValue(undefined),
    onReset: vi.fn().mockResolvedValue(undefined),
    onClose: vi.fn(),
    ...over,
  };
  const handle = mountUsers(root, props);
  const row = (uid: string) => root.querySelector<HTMLElement>(`li[data-uid="${uid}"]`)!;
  const btn = (uid: string, label: string) => [...row(uid).querySelectorAll('button')].find((b) => b.textContent === label)!;
  const status = () => root.querySelector('.users-status')!.textContent;
  const email = () => root.querySelector<HTMLInputElement>('input[name="email"]')!;
  const password = () => root.querySelector<HTMLInputElement>('input[name="password"]')!;
  const submit = () => root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  return { root, props, handle, emit: (rows: UserRow[]) => emit(rows), fail: (c: string) => fail(c), stop, row, btn, status, email, password, submit };
}

it('시트의 구조와 접근성 속성을 갖는다', () => {
  const { root } = setup();
  const sheet = root.querySelector('.sheet.users')!;
  expect(sheet.getAttribute('role')).toBe('dialog');
  expect(sheet.getAttribute('aria-modal')).toBe('true');
  expect(root.querySelector('#usersTitle')!.textContent).toBe('사용자 관리');
  expect(sheet.getAttribute('aria-labelledby')).toBe('usersTitle');
  expect(document.documentElement.classList.contains('sheet-open')).toBe(true);
  expect(document.activeElement).toBe(sheet);
  expect(root.querySelector('.users-status')!.getAttribute('role')).toBe('status');
});

it('첫 목록 전에는 불러오는 중을 보인다', () => {
  const { root, emit } = setup();
  expect(root.textContent).toContain('불러오는 중');
  expect(root.querySelector('.users-list')).toBeNull();
  emit([admin]);
  expect(root.textContent).not.toContain('불러오는 중');
});

it('관리자, 사용 중인 사용자, 중지된 사용자의 행과 배지', () => {
  const { root, emit, row, btn } = setup();
  emit([admin, alice, bob]);
  expect([...root.querySelectorAll('li')].map((li) => li.dataset.uid)).toEqual(['a1', 'u1', 'u2']);
  expect(row('a1').querySelector('.user-email')!.textContent).toBe('boss@example.com');
  expect(row('a1').querySelector('.user-badge')!.textContent).toBe('관리자');
  expect(row('a1').querySelector('button')).toBeNull();
  expect(row('u1').querySelector('.user-badge')!.textContent).toBe('사용 중');
  expect(row('u1').querySelector('.user-badge')!.classList.contains('off')).toBe(false);
  expect([...row('u1').querySelectorAll('button')].map((b) => b.textContent)).toEqual(['사용 중지', '재설정 메일', '지우기']);
  expect(row('u2').querySelector('.user-badge')!.textContent).toBe('중지됨');
  expect(row('u2').querySelector('.user-badge')!.classList.contains('off')).toBe(true);
  expect(btn('u2', '다시 허용')).toBeTruthy();
  expect(root.textContent).not.toContain('추가한 사용자가 없습니다.');
});

it('관리자만 있으면 관리자 행 뒤에 안내 줄을 둔다', () => {
  const { root, emit } = setup();
  emit([admin]);
  const note = root.querySelector('li[data-uid="a1"]')!.nextElementSibling!;
  expect(note.textContent).toBe('추가한 사용자가 없습니다.');
  expect(note.parentElement!.tagName).toBe('UL');
});

it('이메일은 글자 그대로 보인다', () => {
  const { root, emit } = setup();
  emit([{ ...alice, email: '<b>x</b>@example.com' }]);
  expect(root.querySelector('.user-email')!.textContent).toBe('<b>x</b>@example.com');
  expect(root.querySelector('.user-email b')).toBeNull();
});

it('목록 오류는 상태 줄에 코드와 함께 보인다', () => {
  const { root, fail, status } = setup();
  fail('permission-denied');
  expect(status()).toBe('목록을 읽지 못했습니다. (permission-denied)');
  expect(root.textContent).not.toContain('불러오는 중');
});

it('추가: 처리 중에는 잠기고, 성공하면 메시지를 보이고 입력을 비운다', async () => {
  let resolve!: (v: { ok: boolean; message: string }) => void;
  const onAdd = vi.fn().mockReturnValue(new Promise((r) => (resolve = r)));
  const { root, email, password, submit, status } = setup({ onAdd });
  email().value = 'new@example.com';
  password().value = 'pass1234';
  submit();
  expect(onAdd).toHaveBeenCalledWith('new@example.com', 'pass1234');
  const button = root.querySelector<HTMLButtonElement>('.users-add button')!;
  expect([button.disabled, email().disabled, password().disabled]).toEqual([true, true, true]);
  resolve({ ok: true, message: '추가했습니다.' });
  await vi.advanceTimersByTimeAsync(0);
  expect(status()).toBe('추가했습니다.');
  expect([email().value, password().value]).toEqual(['', '']);
  expect([button.disabled, email().disabled, password().disabled]).toEqual([false, false, false]);
});

it('추가: 실패 결과는 메시지를 보이되 입력을 남긴다', async () => {
  const onAdd = vi.fn().mockResolvedValue({ ok: false, message: '이메일 주소를 확인하세요.' });
  const { email, password, submit, status } = setup({ onAdd });
  email().value = 'bad';
  password().value = 'pass1234';
  submit();
  await vi.advanceTimersByTimeAsync(0);
  expect(status()).toBe('이메일 주소를 확인하세요.');
  expect([email().value, password().value]).toEqual(['bad', 'pass1234']);
  expect(email().disabled).toBe(false);
});

it('추가: 거부되면 고정 문구를 보이고 다시 풀린다', async () => {
  const onAdd = vi.fn().mockRejectedValue(new Error('x'));
  const { root, email, password, submit, status } = setup({ onAdd });
  email().value = 'a@example.com';
  password().value = 'pass1234';
  submit();
  await vi.advanceTimersByTimeAsync(0);
  expect(status()).toBe('추가하지 못했습니다.');
  expect(root.querySelector<HTMLButtonElement>('.users-add button')!.disabled).toBe(false);
  expect(password().value).toBe('pass1234');
});

it('추가 폼의 입력 속성', () => {
  const { email, password, root } = setup();
  expect(email().type).toBe('email');
  expect(password().type).toBe('text');
  for (const input of [email(), password()]) {
    expect(input.getAttribute('autocomplete')).toBe('off');
    expect(input.getAttribute('autocapitalize')).toBe('none');
    expect(input.getAttribute('spellcheck')).toBe('false');
    expect(input.required).toBe(true);
  }
  expect(root.textContent).toContain('8자 이상. 사용자에게 알려 주고, 설정에서 바꾸라고 하세요.');
});

it('사용 중지와 다시 허용은 맞는 인자로 부르고, 처리 중에는 그 행의 단추를 잠근다', async () => {
  let resolve!: () => void;
  const onSetDisabled = vi.fn().mockReturnValue(new Promise<void>((r) => (resolve = r)));
  const { emit, btn, row } = setup({ onSetDisabled });
  emit([admin, alice, bob]);
  btn('u1', '사용 중지').click();
  expect(onSetDisabled).toHaveBeenCalledWith('u1', true);
  expect([...row('u1').querySelectorAll('button')].every((b) => b.disabled)).toBe(true);
  expect([...row('u2').querySelectorAll('button')].some((b) => b.disabled)).toBe(false);
  resolve();
  await vi.advanceTimersByTimeAsync(0);
  expect([...row('u1').querySelectorAll('button')].some((b) => b.disabled)).toBe(false);
  btn('u2', '다시 허용').click();
  expect(onSetDisabled).toHaveBeenLastCalledWith('u2', false);
});

it('사용 중지가 거부되면 안내하고 다시 풀린다', async () => {
  const onSetDisabled = vi.fn().mockRejectedValue(new Error('x'));
  const { emit, btn, status, row } = setup({ onSetDisabled });
  emit([admin, alice]);
  btn('u1', '사용 중지').click();
  await vi.advanceTimersByTimeAsync(0);
  expect(status()).toBe('바꾸지 못했습니다.');
  expect(row('u1').querySelector<HTMLButtonElement>('button')!.disabled).toBe(false);
});

it('재설정 메일', async () => {
  const onReset = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('x'));
  const { emit, btn, status } = setup({ onReset });
  emit([admin, alice]);
  btn('u1', '재설정 메일').click();
  expect(onReset).toHaveBeenCalledWith('alice@example.com');
  await vi.advanceTimersByTimeAsync(0);
  expect(status()).toBe('재설정 메일을 보냈습니다: alice@example.com');
  btn('u1', '재설정 메일').click();
  await vi.advanceTimersByTimeAsync(0);
  expect(status()).toBe('메일을 보내지 못했습니다.');
});

it('지우기는 두 번 눌러야 하고, 4초 안에 안 누르면 되돌아간다', async () => {
  const { emit, btn, status, props } = setup();
  emit([admin, alice]);
  btn('u1', '지우기').click();
  expect(props.onRemove).not.toHaveBeenCalled();
  expect(btn('u1', '정말 지우기').classList.contains('danger')).toBe(true);
  await vi.advanceTimersByTimeAsync(3999);
  expect(btn('u1', '정말 지우기')).toBeTruthy();
  await vi.advanceTimersByTimeAsync(1);
  expect(btn('u1', '지우기').classList.contains('danger')).toBe(false);
  btn('u1', '지우기').click();
  btn('u1', '정말 지우기').click();
  expect(props.onRemove).toHaveBeenCalledWith('u1');
  await vi.advanceTimersByTimeAsync(0);
  expect(status()).toBe('목록에서 지웠습니다. 로그인 계정과 그 사람의 메모는 남아 있습니다.');
  await vi.advanceTimersByTimeAsync(5000);
  expect(props.onRemove).toHaveBeenCalledTimes(1);
});

it('지우기가 거부되면 안내한다', async () => {
  const onRemove = vi.fn().mockRejectedValue(new Error('x'));
  const { emit, btn, status } = setup({ onRemove });
  emit([admin, alice]);
  btn('u1', '지우기').click();
  btn('u1', '정말 지우기').click();
  await vi.advanceTimersByTimeAsync(0);
  expect(status()).toBe('지우지 못했습니다.');
  expect(btn('u1', '지우기')).toBeTruthy();
});

it('새 목록이 와도 남아 있는 행의 정말 지우기 상태는 유지되고, 사라진 행의 것은 없어진다', async () => {
  const { emit, btn, row } = setup();
  emit([admin, alice, bob]);
  btn('u1', '지우기').click();
  btn('u2', '지우기').click();
  emit([admin, { ...alice, email: 'alice2@example.com' }]);
  expect(btn('u1', '정말 지우기')).toBeTruthy();
  expect(row('u2')).toBeNull();
  emit([admin, alice, bob]);
  expect(btn('u2', '지우기')).toBeTruthy();
});

it('Escape, 가림막, 닫기는 각각 onClose를 한 번 부른다', () => {
  for (const how of ['escape', 'scrim', 'button'] as const) {
    const { root, props } = setup();
    if (how === 'escape') root.querySelector('.sheet')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    if (how === 'scrim') root.querySelector<HTMLElement>('.scrim')!.click();
    if (how === 'button') root.querySelector<HTMLElement>('.textbtn.end')!.click();
    root.querySelector<HTMLElement>('.textbtn.end')!.click();
    expect(props.onClose).toHaveBeenCalledTimes(1);
    document.body.replaceChildren();
  }
});

it('Tab은 시트 안에서만 돈다', () => {
  const { root } = setup();
  const sheet = root.querySelector<HTMLElement>('.sheet')!;
  const close = root.querySelector<HTMLElement>('.textbtn.end')!;
  const add = root.querySelector<HTMLElement>('.users-add button')!;
  add.focus();
  const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
  add.dispatchEvent(tab);
  expect(tab.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(close);
  const back = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
  sheet.dispatchEvent(back);
  expect(document.activeElement).toBe(add);
});

it('destroy는 지켜보기를 멈추고, 타이머를 치우고, 늦은 결과를 무시한다', async () => {
  let resolve!: (v: { ok: boolean; message: string }) => void;
  const onAdd = vi.fn().mockReturnValue(new Promise((r) => (resolve = r)));
  const opener = document.createElement('button');
  document.body.append(opener);
  opener.focus();
  const { root, handle, stop, emit, btn, email, password, submit } = setup({ onAdd });
  const statusEl = root.querySelector('.users-status')!;
  emit([admin, alice]);
  btn('u1', '지우기').click();
  email().value = 'a@example.com';
  password().value = 'pass1234';
  submit();
  expect(vi.getTimerCount()).toBe(1);
  handle.destroy();
  expect(stop).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
  expect(root.querySelector('.sheet')).toBeNull();
  expect(document.documentElement.classList.contains('sheet-open')).toBe(false);
  expect(document.activeElement).toBe(opener);
  resolve({ ok: true, message: '추가했습니다.' });
  await vi.advanceTimersByTimeAsync(0);
  expect(statusEl.textContent).toBe('');
  handle.destroy();
  expect(stop).toHaveBeenCalledTimes(1);
});

const escape = () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

it('추가: 보내는 동안 초점은 시트에 있어 Escape가 닫고, 성공하면 이메일 칸으로 돌아온다', async () => {
  let resolve!: (v: { ok: boolean; message: string }) => void;
  const onAdd = vi.fn().mockReturnValue(new Promise((r) => (resolve = r)));
  const { root, props, email, submit } = setup({ onAdd });
  const sheet = root.querySelector<HTMLElement>('.sheet')!;
  root.querySelector<HTMLElement>('.users-add button')!.focus();
  submit();
  expect(document.activeElement).toBe(sheet);
  escape();
  expect(props.onClose).toHaveBeenCalledTimes(1);
  resolve({ ok: true, message: '추가했습니다.' });
  await vi.advanceTimersByTimeAsync(0);
  expect(document.activeElement).toBe(email());
});
it('추가: 실패하면 시작한 단추로 초점이 돌아온다', async () => {
  const onAdd = vi.fn().mockResolvedValue({ ok: false, message: '이메일 주소를 확인하세요.' });
  const { root, submit } = setup({ onAdd });
  const send = root.querySelector<HTMLElement>('.users-add button')!;
  send.focus();
  submit();
  await vi.advanceTimersByTimeAsync(0);
  expect(document.activeElement).toBe(send);
});
it('행 단추: 처리 중에는 초점이 시트에 있고, 끝나면 같은 단추로 돌아온다', async () => {
  let resolve!: () => void;
  const onSetDisabled = vi.fn().mockReturnValue(new Promise<void>((r) => (resolve = r)));
  const { root, emit, btn } = setup({ onSetDisabled });
  emit([admin, alice]);
  btn('u1', '사용 중지').focus();
  btn('u1', '사용 중지').click();
  expect(document.activeElement).toBe(root.querySelector('.sheet'));
  resolve();
  await vi.advanceTimersByTimeAsync(0);
  expect(document.activeElement).toBe(btn('u1', '사용 중지'));
});
it('재설정 메일은 처리 중 그 행의 단추를 잠그고 두 번 눌러도 한 통만 보낸다', async () => {
  let resolve!: () => void;
  const onReset = vi.fn().mockReturnValue(new Promise<void>((r) => (resolve = r)));
  const { emit, btn, row } = setup({ onReset });
  emit([admin, alice]);
  const mail = btn('u1', '재설정 메일');
  mail.click();
  mail.click();
  btn('u1', '재설정 메일').click();
  expect(onReset).toHaveBeenCalledTimes(1);
  expect([...row('u1').querySelectorAll('button')].every((b) => b.disabled)).toBe(true);
  resolve();
  await vi.advanceTimersByTimeAsync(0);
  expect([...row('u1').querySelectorAll('button')].some((b) => b.disabled)).toBe(false);
});
it('목록 오류 문구는 나중에 목록이 오면 지워지지만 다른 문구는 남는다', async () => {
  const { emit, fail, status, btn } = setup();
  fail('unavailable');
  expect(status()).toBe('목록을 읽지 못했습니다. (unavailable)');
  emit([admin, alice]);
  expect(status()).toBe('');
  btn('u1', '재설정 메일').click();
  await vi.advanceTimersByTimeAsync(0);
  emit([admin, alice]);
  expect(status()).toBe('재설정 메일을 보냈습니다: alice@example.com');
});
it('던지는 콜백도 거부처럼 다루고 잠긴 것을 푼다', async () => {
  const boom = () => {
    throw new Error('x');
  };
  const { root, emit, btn, row, email, password, submit, status } = setup({ onAdd: boom, onSetDisabled: boom });
  email().value = 'a@example.com';
  password().value = 'pass1234';
  submit();
  await vi.advanceTimersByTimeAsync(0);
  expect(status()).toBe('추가하지 못했습니다.');
  expect([root.querySelector<HTMLButtonElement>('.users-add button')!.disabled, email().disabled]).toEqual([false, false]);
  emit([admin, alice]);
  btn('u1', '사용 중지').click();
  await vi.advanceTimersByTimeAsync(0);
  expect(status()).toBe('바꾸지 못했습니다.');
  expect([...row('u1').querySelectorAll('button')].some((b) => b.disabled)).toBe(false);
});
it('destroy 뒤에 행 동작과 재설정의 늦은 결과는 아무것도 바꾸지 않는다', async () => {
  let done!: () => void;
  let mailed!: () => void;
  const onSetDisabled = vi.fn().mockReturnValue(new Promise<void>((r) => (done = r)));
  const onReset = vi.fn().mockReturnValue(new Promise<void>((r) => (mailed = r)));
  const { root, handle, emit, btn } = setup({ onSetDisabled, onReset });
  const statusEl = root.querySelector('.users-status')!;
  emit([admin, alice, bob]);
  btn('u1', '사용 중지').click();
  btn('u2', '재설정 메일').click();
  handle.destroy();
  done();
  mailed();
  await vi.advanceTimersByTimeAsync(0);
  expect(statusEl.textContent).toBe('');
  expect(root.querySelector('.sheet')).toBeNull();
});

it('끌기 연결 함수를 받았을 때만(PC 앱) 시트와 제목 줄을 넘겨 부르고, destroy에서 끝낸다', () => {
  const { root, handle } = setup();
  expect(root.querySelector('.sheet-bar')!.classList.contains('drag-handle')).toBe(false);
  handle.destroy();
  const end = vi.fn();
  const attachDrag = vi.fn(() => ({ destroy: end }));
  const pc = setup({ attachDrag });
  expect(attachDrag).toHaveBeenCalledTimes(1);
  expect(attachDrag).toHaveBeenCalledWith(pc.root.querySelector('.sheet.users'), pc.root.querySelector('.sheet.users .sheet-bar'));
  expect(end).not.toHaveBeenCalled();
  pc.handle.destroy();
  pc.handle.destroy();
  expect(end).toHaveBeenCalledTimes(1);
});
