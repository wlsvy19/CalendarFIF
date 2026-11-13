import { describe, expect, it } from 'vitest';
import { changePassword, passwordMessage, type PasswordResult } from './password';

function setup(opts: { re?: () => Promise<void>; up?: () => Promise<void> } = {}) {
  const calls: string[] = [];
  const deps = {
    reauthenticate: (c: string) => { calls.push(`re:${c}`); return (opts.re ?? (() => Promise.resolve()))(); },
    update: (n: string) => { calls.push(`up:${n}`); return (opts.up ?? (() => Promise.resolve()))(); },
  };
  return { calls, deps };
}
const rej = (code: string) => () => Promise.reject({ code });

describe('changePassword', () => {
  it('성공하면 확인 뒤 바꾼다', async () => {
    const t = setup();
    expect(await changePassword(t.deps, 'oldpassword', 'newpassword')).toEqual({ ok: true });
    expect(t.calls).toEqual(['re:oldpassword', 'up:newpassword']);
  });
  it('짧은 새 비밀번호와 같은 비밀번호는 아무 것도 부르지 않는다', async () => {
    const t = setup();
    expect(await changePassword(t.deps, 'oldpassword', 'short')).toMatchObject({ ok: false, reason: 'weak' });
    expect(await changePassword(t.deps, 'samepassword', 'samepassword')).toMatchObject({ ok: false, reason: 'same' });
    expect(t.calls).toEqual([]);
  });
  it.each([
    ['auth/invalid-credential', 'wrong-current'],
    ['auth/wrong-password', 'wrong-current'],
    ['auth/too-many-requests', 'throttled'],
    ['auth/network-request-failed', 'network'],
    ['auth/other', 'unknown'],
  ])('확인 단계의 %s -> %s, 바꾸지 않는다', async (code, reason) => {
    const t = setup({ re: rej(code) });
    expect(await changePassword(t.deps, 'oldpassword', 'newpassword')).toEqual({ ok: false, reason, code });
    expect(t.calls).toEqual(['re:oldpassword']);
  });
  it.each([
    ['auth/weak-password', 'weak'],
    ['auth/network-request-failed', 'network'],
    ['auth/too-many-requests', 'throttled'],
    ['auth/requires-recent-login', 'unknown'],
  ])('바꾸는 단계의 %s -> %s', async (code, reason) => {
    const t = setup({ up: rej(code) });
    expect(await changePassword(t.deps, 'oldpassword', 'newpassword')).toEqual({ ok: false, reason, code });
  });
});

describe('passwordMessage', () => {
  it('문구', () => {
    const f = (reason: Extract<PasswordResult, { ok: false }>['reason'], code = 'c'): PasswordResult => ({ ok: false, reason, code });
    expect(passwordMessage({ ok: true })).toBe('비밀번호를 바꿨습니다.');
    expect(passwordMessage(f('wrong-current'))).toBe('지금 비밀번호가 맞지 않습니다.');
    expect(passwordMessage(f('weak'))).toBe('새 비밀번호는 8자 이상이어야 합니다.');
    expect(passwordMessage(f('same'))).toBe('새 비밀번호가 지금 것과 같습니다.');
    expect(passwordMessage(f('network'))).toBe('네트워크에 연결할 수 없습니다.');
    expect(passwordMessage(f('throttled'))).toBe('시도가 너무 많습니다. 잠시 뒤 다시 해 주세요.');
    expect(passwordMessage(f('unknown', 'auth/x'))).toBe('바꾸지 못했습니다. (auth/x)');
  });
});
