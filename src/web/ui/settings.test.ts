import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mountSettings } from './settings';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

function mount(overrides: Partial<Parameters<typeof mountSettings>[1]> = {}) {
  const root = document.createElement('div');
  document.body.append(root);
  const onSignOut = vi.fn();
  mountSettings(root, { email: 'me@example.com', pending: 0, storageOk: true, corruptFound: false, onSignOut, onClose: vi.fn(), ...overrides });
  const button = (label: string) => [...root.querySelectorAll('button')].find((b) => b.textContent === label)!;
  return { root, button, onSignOut };
}

it('계정과 대기 건수를 보여 주고 로그아웃한다', () => {
  const { root, button, onSignOut } = mount();
  expect(root.textContent).toContain('me@example.com');
  expect(root.textContent).toContain('대기 중인 편집 0건');
  button('로그아웃').click();
  expect(onSignOut).toHaveBeenCalledTimes(1);
});
it('올리지 못한 편집이 있으면 한 번 더 묻는다', () => {
  const { root, button, onSignOut } = mount({ pending: 2 });
  button('로그아웃').click();
  expect(onSignOut).not.toHaveBeenCalled();
  expect(root.textContent).toContain('아직 올리지 못한 편집이 2건 있습니다.');
  button('그래도 로그아웃').click();
  expect(onSignOut).toHaveBeenCalledTimes(1);
});
it('저장소 문제를 알린다', () => {
  expect(mount({ storageOk: false }).root.textContent).toContain('이 브라우저에서는 대기 중인 편집을 저장할 수 없습니다.');
  expect(mount({ corruptFound: true }).root.textContent).toContain('대기 중이던 편집 기록이 깨져 있어 따로 보관했습니다.');
  const hidden = (root: HTMLElement, selector: string) => root.querySelector<HTMLElement>(selector)!.hidden;
  const fine = mount().root;
  expect(hidden(fine, '.settings-storage')).toBe(true);
  expect(hidden(fine, '.settings-corrupt')).toBe(true);
  const storage = mount({ storageOk: false }).root;
  expect(hidden(storage, '.settings-storage')).toBe(false);
  expect(hidden(storage, '.settings-corrupt')).toBe(true);
  const corrupt = mount({ corruptFound: true }).root;
  expect(hidden(corrupt, '.settings-storage')).toBe(true);
  expect(hidden(corrupt, '.settings-corrupt')).toBe(false);
});

it('새 props가 없으면 사용자 관리와 비밀번호 변경은 보이지 않는다', () => {
  const { root } = mount();
  expect(root.textContent).not.toContain('사용자 관리');
  expect(root.textContent).not.toContain('비밀번호');
});
it('사용자 관리 단추는 onManageUsers를 부른다', () => {
  const onManageUsers = vi.fn();
  const { button } = mount({ onManageUsers });
  expect(button('사용자 관리').classList.contains('settings-btn')).toBe(true);
  button('사용자 관리').click();
  expect(onManageUsers).toHaveBeenCalledTimes(1);
});
it('사용자와 비밀번호 칸은 동기화 뒤, 위젯 앞에 있다', () => {
  const { root } = mount({ onManageUsers: vi.fn(), onChangePassword: vi.fn() });
  const labels = [...root.querySelectorAll('.field-label')].map((l) => l.textContent);
  expect(labels).toEqual(['계정', '동기화', '사용자', '비밀번호', '위젯']);
});

function pwSetup(onChangePassword: (c: string, n: string) => Promise<{ ok: boolean; message: string }>) {
  const m = mount({ onChangePassword });
  const input = (name: string) => m.root.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
  const submit = () => m.root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  const note = () => m.root.querySelector('.account-pw .settings-note')!.textContent;
  return { ...m, input, submit, note };
}

it('비밀번호 변경: 폼은 단추를 누르면 열린다', () => {
  const { root, button, input } = pwSetup(vi.fn());
  expect(root.querySelector('form')).toBeNull();
  button('비밀번호 변경').click();
  expect(input('current').type).toBe('password');
  expect(input('current').getAttribute('autocomplete')).toBe('current-password');
  expect(input('current').placeholder).toBe('지금 비밀번호');
  expect(input('next').getAttribute('autocomplete')).toBe('new-password');
  expect(input('next').placeholder).toBe('새 비밀번호 (8자 이상)');
  expect([...root.querySelectorAll('button')].some((b) => b.textContent === '비밀번호 변경')).toBe(false);
  expect(root.querySelector('.account-pw .settings-note')!.getAttribute('role')).toBe('status');
});
it('비밀번호 변경: 성공하면 메시지를 보이고 1.5초 뒤 단추로 돌아간다', async () => {
  let resolve!: (v: { ok: boolean; message: string }) => void;
  const onChangePassword = vi.fn().mockReturnValue(new Promise((r) => (resolve = r)));
  const { root, button, input, submit, note } = pwSetup(onChangePassword);
  button('비밀번호 변경').click();
  input('current').value = 'old-pass';
  input('next').value = 'new-pass-1';
  submit();
  expect(onChangePassword).toHaveBeenCalledWith('old-pass', 'new-pass-1');
  expect(input('current').disabled).toBe(true);
  expect(button('바꾸기').disabled).toBe(true);
  resolve({ ok: true, message: '비밀번호를 바꿨습니다.' });
  await vi.advanceTimersByTimeAsync(0);
  expect(note()).toBe('비밀번호를 바꿨습니다.');
  expect([input('current').value, input('next').value]).toEqual(['', '']);
  expect(input('current').disabled).toBe(false);
  await vi.advanceTimersByTimeAsync(1499);
  expect(root.querySelector('form')).not.toBeNull();
  await vi.advanceTimersByTimeAsync(1);
  expect(root.querySelector('form')).toBeNull();
  expect(button('비밀번호 변경')).toBeTruthy();
});
it('비밀번호 변경: 실패하면 폼이 열린 채 입력도 남는다', async () => {
  const onChangePassword = vi.fn().mockResolvedValue({ ok: false, message: '지금 비밀번호가 맞지 않습니다.' });
  const { root, button, input, submit, note } = pwSetup(onChangePassword);
  button('비밀번호 변경').click();
  input('current').value = 'wrong';
  input('next').value = 'new-pass-1';
  submit();
  await vi.advanceTimersByTimeAsync(0);
  expect(note()).toBe('지금 비밀번호가 맞지 않습니다.');
  await vi.advanceTimersByTimeAsync(5000);
  expect(root.querySelector('form')).not.toBeNull();
  expect(input('current').value).toBe('wrong');
  expect(input('current').disabled).toBe(false);
});
it('비밀번호 변경: 거부되면 바꾸지 못했습니다를 보인다', async () => {
  const { button, input, submit, note } = pwSetup(vi.fn().mockRejectedValue(new Error('x')));
  button('비밀번호 변경').click();
  input('current').value = 'a';
  input('next').value = 'b';
  submit();
  await vi.advanceTimersByTimeAsync(0);
  expect(note()).toBe('바꾸지 못했습니다.');
  expect(button('바꾸기').disabled).toBe(false);
});
it('비밀번호 변경: 취소하면 단추로 돌아간다', () => {
  const { root, button } = pwSetup(vi.fn());
  button('비밀번호 변경').click();
  button('취소').click();
  expect(root.querySelector('form')).toBeNull();
  expect(button('비밀번호 변경')).toBeTruthy();
});
it('Tab 순서에 비밀번호 입력칸이 들어간다', () => {
  const { root, button } = pwSetup(vi.fn());
  const sheet = root.querySelector<HTMLElement>('.sheet')!;
  button('비밀번호 변경').click();
  const close = root.querySelector<HTMLElement>('.textbtn.end')!;
  const signOut = button('로그아웃');
  // 끝에서 Tab은 처음(닫기)으로, 처음에서 Shift+Tab은 끝(로그아웃)으로 돈다.
  signOut.focus();
  const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
  signOut.dispatchEvent(tab);
  expect(tab.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(close);
  sheet.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
  expect(document.activeElement).toBe(signOut);
  // 입력칸은 돌 목록에 들어 있다: 입력칸이 마지막이 되면 그곳에서 처음으로 돈다.
  signOut.hidden = true;
  const next = root.querySelector<HTMLInputElement>('input[name="next"]')!;
  const cancel = button('취소');
  const [cur] = root.querySelectorAll<HTMLInputElement>('input');
  expect(cur).toBeTruthy();
  button('바꾸기').disabled = true;
  cancel.disabled = true;
  next.focus();
  const wrap = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
  next.dispatchEvent(wrap);
  expect(wrap.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(close);
});
