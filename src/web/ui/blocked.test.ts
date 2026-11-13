import { afterEach, expect, it, vi } from 'vitest';
import { mountBlocked } from './blocked';

const NONE = '이 계정은 사용 허가를 받지 않았습니다. 관리자에게 문의하세요.';
const BLOCKED = '관리자가 이 계정의 사용을 중지했습니다.';

afterEach(() => {
  document.body.replaceChildren();
});

function mount(kind: 'none' | 'blocked', opts: { pending?: number; recheck?: () => Promise<void> } = {}) {
  const root = document.createElement('div');
  document.body.append(root);
  const onSignOut = vi.fn();
  const counts = { pending: opts.pending ?? 0 };
  const onRecheck = vi.fn(opts.recheck ?? (() => Promise.resolve()));
  const handle = mountBlocked(root, { kind, email: 'me@example.com', pending: () => counts.pending, onSignOut, onRecheck });
  const button = (label: string) => [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === label);
  const pendingLine = () => root.querySelector<HTMLElement>('.blocked-pending')!;
  const confirm = () => root.querySelector<HTMLElement>('.blocked-confirm')!;
  return { root, handle, onSignOut, onRecheck, counts, button, pendingLine, confirm, text: () => root.querySelector('.blocked-text')!.textContent };
}

it('이메일과 종류별 문구를 보인다', () => {
  const none = mount('none');
  expect(none.root.querySelector('h1')!.textContent).toBe('달력 메모');
  expect(none.root.querySelector('.blocked-email')!.textContent).toBe('me@example.com');
  expect(none.text()).toBe(NONE);
  expect(none.root.querySelector('.blocked-text')!.getAttribute('role')).toBe('alert');
  expect(mount('blocked').text()).toBe(BLOCKED);
});
it('setKind로 문구를 바꾼다', () => {
  const { handle, text } = mount('none');
  handle.setKind('blocked');
  expect(text()).toBe(BLOCKED);
  handle.setKind('none');
  expect(text()).toBe(NONE);
});
it('대기 중인 편집이 없으면 로그아웃 단추가 바로 onSignOut을 부른다', () => {
  const { onSignOut, button, pendingLine } = mount('none');
  expect(pendingLine().hidden).toBe(true);
  const signOut = button('로그아웃')!;
  expect(signOut.classList.contains('primary')).toBe(true);
  signOut.click();
  expect(onSignOut).toHaveBeenCalledTimes(1);
});
it('대기 중인 편집이 있으면 건수를 보이고, 로그아웃은 설정 화면과 같은 문구로 한 번 더 묻는다', () => {
  const { onSignOut, button, pendingLine, confirm } = mount('blocked', { pending: 2 });
  expect([pendingLine().hidden, pendingLine().textContent]).toEqual([false, '아직 올리지 못한 편집이 2건 있습니다.']);
  expect([confirm().hidden, button('그래도 로그아웃')!.hidden]).toEqual([true, true]);

  button('로그아웃')!.click();
  expect(onSignOut).not.toHaveBeenCalled();
  expect(confirm().getAttribute('role')).toBe('alert');
  expect([confirm().hidden, confirm().textContent]).toEqual([false, '아직 올리지 못한 편집이 2건 있습니다. 로그아웃하면 이 기기에 남습니다.']);
  expect([pendingLine().hidden, button('로그아웃')!.hidden]).toEqual([true, true]);
  const force = button('그래도 로그아웃')!;
  expect([force.hidden, force.className, document.activeElement === force]).toEqual([false, 'settings-btn danger', true]);
  force.click();
  expect(onSignOut).toHaveBeenCalledTimes(1);
});
it('로그아웃을 누를 때와 setKind 때 대기 건수를 다시 읽는다', () => {
  const { handle, onSignOut, counts, button, pendingLine, confirm } = mount('none', { pending: 1 });
  counts.pending = 3;
  handle.setKind('blocked');
  expect(pendingLine().textContent).toBe('아직 올리지 못한 편집이 3건 있습니다.');
  counts.pending = 0; // 다른 창에서 올렸다
  button('로그아웃')!.click();
  expect([onSignOut.mock.calls.length, confirm().hidden]).toEqual([1, true]);
});
it('다시 확인은 로그아웃 위에 있고, 누르면 확인하는 동안 "확인하는 중"으로 잠긴다', async () => {
  let finish: () => void = () => {};
  const { root, onRecheck, button } = mount('none', { recheck: () => new Promise<void>((r) => { finish = r; }) });
  const recheck = button('다시 확인')!;
  const buttons = [...root.querySelectorAll('button')];
  expect(recheck.className).toBe('settings-btn');
  expect(buttons.indexOf(recheck)).toBeLessThan(buttons.indexOf(button('로그아웃')!));

  recheck.focus();
  recheck.click();
  recheck.click();
  expect(onRecheck).toHaveBeenCalledTimes(1);
  expect([recheck.textContent, recheck.disabled]).toEqual(['확인하는 중', true]);
  finish();
  await vi.waitFor(() => expect([recheck.textContent, recheck.disabled]).toEqual(['다시 확인', false]));
  expect(document.activeElement).toBe(recheck);
  recheck.click();
  expect(onRecheck).toHaveBeenCalledTimes(2);
});
it('다시 확인이 실패해도 단추가 풀리고, 내려간 뒤의 늦은 결과는 아무것도 바꾸지 않는다', async () => {
  let fail: () => void = () => {};
  const t = mount('none', { recheck: () => new Promise<void>((_, r) => { fail = () => r(new Error('x')); }) });
  t.button('다시 확인')!.click();
  fail();
  await vi.waitFor(() => expect(t.button('다시 확인')!.disabled).toBe(false));

  let finish: () => void = () => {};
  t.onRecheck.mockImplementation(() => new Promise<void>((r) => { finish = r; }));
  const recheck = t.button('다시 확인')!;
  recheck.click();
  t.handle.destroy();
  finish();
  await new Promise((r) => setTimeout(r, 0));
  expect(recheck.textContent).toBe('확인하는 중');
});
it('destroy는 화면을 없앤다', () => {
  const { root, handle } = mount('none');
  handle.destroy();
  expect(root.children).toHaveLength(0);
});
