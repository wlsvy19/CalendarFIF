import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { swipeDown } from './fakeSwipe';
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
  const handle = mountSettings(root, { email: 'me@example.com', pending: 0, storageOk: true, corruptFound: false, onSignOut, onClose: vi.fn(), ...overrides });
  const button = (label: string) => [...root.querySelectorAll('button')].find((b) => b.textContent === label)!;
  return { root, button, onSignOut, handle };
}

it('폰 화면에서 목록이 맨 위일 때 아래로 끌면 닫고, 스크롤이 내려가 있으면 닫지 않는다', () => {
  const onClose = vi.fn();
  const { root } = mount({ onClose });
  const sheet = root.querySelector<HTMLElement>('.sheet')!;
  sheet.scrollTop = 120;
  swipeDown(root.querySelector('.settings-email')!);
  expect(onClose).not.toHaveBeenCalled();
  sheet.scrollTop = 0;
  swipeDown(root.querySelector('.sheet-bar h3')!);
  expect(onClose).toHaveBeenCalledTimes(1);
});
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
const widget = { load: () => new Promise<string>(() => {}), config: { projectId: 'demo-calfif', apiKey: 'k', appUrl: 'https://example.test' }, copy: async () => {} };
it('사용자와 비밀번호 칸은 동기화 뒤, 위젯 앞에 있다', () => {
  const { root } = mount({ onManageUsers: vi.fn(), onChangePassword: vi.fn(), widget });
  const labels = [...root.querySelectorAll('.field-label')].map((l) => l.textContent);
  expect(labels).toEqual(['계정', '동기화', '사용자', '비밀번호', '위젯']);
});

it('widget을 주지 않으면 위젯 칸이 없다', () => {
  const { root } = mount();
  expect(root.textContent).not.toContain('위젯');
});
it('widget을 주면 위젯 칸이 로그아웃 앞에 있다', () => {
  const { root } = mount({ widget });
  const fields = [...root.querySelectorAll('.sheet > .field, .sheet > div > .field')];
  const labels = fields.map((f) => f.querySelector('.field-label')?.textContent);
  expect(labels.at(-2)).toBe('위젯');
});

function widgetMount(copy: () => Promise<void>) {
  const m = mount({ widget: { load: async () => '"__PROJECT_ID__" "__API_KEY__" "__APP_URL__"', config: widget.config, copy } });
  const sheet = m.root.querySelector<HTMLElement>('.sheet')!;
  const close = m.root.querySelector<HTMLElement>('.textbtn.end')!;
  m.button('로그아웃').hidden = true; // 위젯 칸의 것이 맨 끝이 되게 한다
  const tab = (from: HTMLElement) => {
    from.focus();
    const e = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    from.dispatchEvent(e);
    return e;
  };
  return { ...m, sheet, close, tab };
}
it('Tab 순서에 "설치 방법"이 들어간다: 그것이 끝이면 거기서 처음으로 돈다', async () => {
  vi.useRealTimers();
  const { root, close, tab } = widgetMount(async () => {});
  await new Promise((r) => setTimeout(r, 0));
  const summary = root.querySelector<HTMLElement>('summary')!;
  summary.setAttribute('tabindex', '0'); // jsdom은 summary에 초점을 주지 않는다
  root.querySelector<HTMLDetailsElement>('details')!.open = true;
  const e = tab(summary);
  expect(e.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(close);
});
it('Tab 순서에 복사 실패 때 나오는 글 상자가 들어간다: 그것이 끝이면 거기서 처음으로 돈다', async () => {
  vi.useRealTimers();
  const { root, button, close, tab } = widgetMount(() => Promise.reject(new Error('denied')));
  await new Promise((r) => setTimeout(r, 0));
  button('위젯 스크립트 복사').click();
  await new Promise((r) => setTimeout(r, 0));
  const area = root.querySelector<HTMLTextAreaElement>('textarea')!;
  expect(area.hidden).toBe(false);
  const e = tab(area);
  expect(e.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(close);
});
it('열린 뒤에 관리자로 확인되면 사용자 관리 단추가 제자리에 생기고, 적던 비밀번호는 그대로다', () => {
  const { root, button, handle } = mount({ onChangePassword: vi.fn(), widget });
  expect(button('사용자 관리')).toBeUndefined();
  button('비밀번호 변경').click();
  const current = root.querySelector<HTMLInputElement>('input[name="current"]')!;
  current.value = '적던 비밀번호';
  current.focus();
  const onManage = vi.fn();
  handle.setManageUsers(onManage);
  handle.setManageUsers(onManage);
  expect([...root.querySelectorAll('.field-label')].map((l) => l.textContent)).toEqual(['계정', '동기화', '사용자', '비밀번호', '위젯']);
  expect([root.querySelector('input[name="current"]') === current, current.value, document.activeElement === current]).toEqual([true, '적던 비밀번호', true]);
  button('사용자 관리').click();
  expect(onManage).toHaveBeenCalledTimes(1);
  handle.setManageUsers(undefined);
  expect(button('사용자 관리')).toBeUndefined();
  expect(root.querySelector('input[name="current"]')).toBe(current);
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
  // 결과를 보여 주는 1.5초 동안은 폼이 잠겨 있어 다시 보낼 수 없다.
  expect(input('current').disabled).toBe(true);
  submit();
  expect(onChangePassword).toHaveBeenCalledTimes(1);
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
it('비밀번호 변경: 적은 글이 있거나 바꾸는 중이면 onPasswordBusy(true), 비거나 끝나면 false를 바뀔 때만 알린다', async () => {
  let resolve!: (v: { ok: boolean; message: string }) => void;
  const onPasswordBusy = vi.fn();
  const m = mount({ onChangePassword: vi.fn().mockReturnValue(new Promise((r) => (resolve = r))), onPasswordBusy });
  const input = (name: string) => m.root.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
  const type = (name: string, value: string) => {
    input(name).value = value;
    input(name).dispatchEvent(new Event('input', { bubbles: true }));
  };
  const calls = () => onPasswordBusy.mock.calls.map((c) => c[0]);

  m.button('비밀번호 변경').click();
  expect(calls()).toEqual([]); // 빈 폼은 아니다
  type('current', 'o');
  type('current', 'old-pass');
  expect(calls()).toEqual([true]);
  type('current', '');
  expect(calls()).toEqual([true, false]);
  type('next', 'new-pass-1');
  type('current', 'old-pass');
  expect(calls()).toEqual([true, false, true]);

  m.root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  resolve({ ok: true, message: '비밀번호를 바꿨습니다.' });
  await vi.advanceTimersByTimeAsync(0);
  expect(calls()).toEqual([true, false, true]); // 칸은 비었지만 결과를 보이는 동안은 잠겨 있다
  await vi.advanceTimersByTimeAsync(1500);
  expect(calls()).toEqual([true, false, true, false]);

  m.button('비밀번호 변경').click();
  type('next', 'x');
  m.button('취소').click();
  expect(calls()).toEqual([true, false, true, false, true, false]);
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

it('비밀번호 변경: 보내는 동안 초점은 시트에 있고, 실패로 끝나면 시작한 단추로 돌아온다', async () => {
  let resolve!: (v: { ok: boolean; message: string }) => void;
  const onChangePassword = vi.fn().mockReturnValue(new Promise((r) => (resolve = r)));
  const { root, button, submit } = pwSetup(onChangePassword);
  const sheet = root.querySelector<HTMLElement>('.sheet')!;
  button('비밀번호 변경').click();
  const send = button('바꾸기');
  send.focus();
  submit();
  expect(document.activeElement).toBe(sheet);
  resolve({ ok: false, message: '지금 비밀번호가 맞지 않습니다.' });
  await vi.advanceTimersByTimeAsync(0);
  expect(document.activeElement).toBe(send);
});
it('비밀번호 변경: 보내는 동안에도 Escape가 onClose를 부른다', () => {
  const onClose = vi.fn();
  const m = mount({ onChangePassword: () => new Promise(() => {}), onClose });
  m.button('비밀번호 변경').click();
  m.button('바꾸기').focus();
  m.root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(onClose).toHaveBeenCalledTimes(1);
});
it('비밀번호 변경: 성공하면 1.5초 뒤 단추로 돌아가며 초점도 그 단추로 간다', async () => {
  const { button, submit } = pwSetup(vi.fn().mockResolvedValue({ ok: true, message: '바꿨습니다.' }));
  button('비밀번호 변경').click();
  button('바꾸기').focus();
  submit();
  await vi.advanceTimersByTimeAsync(1500);
  expect(document.activeElement).toBe(button('비밀번호 변경'));
});
it('비밀번호 변경: 1.5초 안에 닫으면 남는 타이머가 없다', async () => {
  const { button, input, submit, handle } = pwSetup(vi.fn().mockResolvedValue({ ok: true, message: '바꿨습니다.' }));
  button('비밀번호 변경').click();
  input('current').value = 'a';
  submit();
  await vi.advanceTimersByTimeAsync(100);
  expect(vi.getTimerCount()).toBe(1);
  handle.destroy();
  expect(vi.getTimerCount()).toBe(0);
});
it('비밀번호 변경: 던지는 콜백도 거부처럼 다루고 폼을 푼다', async () => {
  const { button, input, submit, note } = pwSetup(() => {
    throw new Error('x');
  });
  button('비밀번호 변경').click();
  submit();
  await vi.advanceTimersByTimeAsync(0);
  expect(note()).toBe('바꾸지 못했습니다.');
  expect(input('current').disabled).toBe(false);
});

it('prefs를 주면 맨 위에 화면·달력·메모 칸을 두고, 고른 것을 바로 알린다. 안 주면 그 칸이 없다', async () => {
  const { DEFAULT_PREFS } = await import('../prefs');
  const onChange = vi.fn();
  const { root } = mount({ prefs: { value: { ...DEFAULT_PREFS, theme: 'dark' }, onChange } });
  expect([...root.querySelectorAll('.field-label')].map((l) => l.textContent)).toEqual(['화면', '달력', '메모', '계정', '동기화']);
  expect(root.querySelector('[aria-labelledby="prefTheme"] [aria-checked="true"]')!.textContent).toBe('어둡게');
  root.querySelector<HTMLInputElement>('label.pref-row input')!.click(); // 음력
  expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_PREFS, theme: 'dark', lunar: false });
  expect(mount().root.querySelector('.prefs')).toBeNull();
});
