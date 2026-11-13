import { describe, expect, it } from 'vitest';
import type { AccessDoc } from './access';
import { normalizeEmail } from './authCommon';
import { addUser, addUserMessage, type AccountMaker, type AddResult, type UsersSource } from './users';

function setup(opts: { create?: () => Promise<string>; lookup?: () => Promise<string>; put?: () => Promise<void> } = {}) {
  const calls: string[] = [];
  const puts: Array<{ uid: string; doc: AccessDoc }> = [];
  const accounts: AccountMaker = {
    create: (e, p) => { calls.push(`create:${e}:${p}`); return (opts.create ?? (() => Promise.resolve('new-uid')))(); },
    lookup: (e, p) => { calls.push(`lookup:${e}:${p}`); return (opts.lookup ?? (() => Promise.resolve('old-uid')))(); },
  };
  const users: UsersSource = {
    watchAll: () => () => {},
    put: (uid, doc) => { calls.push('put'); puts.push({ uid, doc }); return (opts.put ?? (() => Promise.resolve()))(); },
    setDisabled: () => Promise.resolve(),
    remove: () => Promise.resolve(),
  };
  return { calls, puts, run: (email: string, pw: string) => addUser({ accounts, users, now: () => 42 }, email, pw) };
}
const rej = (code: string) => () => Promise.reject({ code });

describe('normalizeEmail', () => {
  it('공백을 떼고 소문자로', () => expect(normalizeEmail('  A@Example.COM ')).toBe('a@example.com'));
});

describe('addUser', () => {
  it('잘못된 이메일이나 짧은 비밀번호는 아무 것도 부르지 않는다', async () => {
    const t = setup();
    for (const bad of ['', 'abc', 'a@b', 'a b@c.d', 'a@@c.d', '@c.d', 'a@.d']) {
      expect(await t.run(bad, 'password1')).toMatchObject({ ok: false, reason: 'invalid-email' });
    }
    expect(await t.run('a@b.c', '1234567')).toMatchObject({ ok: false, reason: 'weak-password' });
    expect(t.calls).toEqual([]);
  });
  it('새 계정: 이메일을 정리해 만들고 정확한 문서를 쓴다', async () => {
    const t = setup();
    expect(await t.run('  New@Example.com ', 'password1')).toEqual({ ok: true, uid: 'new-uid', existed: false });
    expect(t.calls).toEqual(['create:new@example.com:password1', 'put']);
    expect(t.puts).toEqual([{ uid: 'new-uid', doc: { email: 'new@example.com', role: 'user', disabled: false, createdAt: 42 } }]);
  });
  it('이미 있는 계정: lookup 뒤 다시 등록', async () => {
    const t = setup({ create: rej('auth/email-already-in-use') });
    expect(await t.run('a@b.c', 'password1')).toEqual({ ok: true, uid: 'old-uid', existed: true });
    expect(t.calls).toEqual(['create:a@b.c:password1', 'lookup:a@b.c:password1', 'put']);
  });
  it.each(['auth/invalid-credential', 'auth/wrong-password', 'auth/user-disabled'])('lookup이 %s면 exists-wrong-password', async (code) => {
    const t = setup({ create: rej('auth/email-already-in-use'), lookup: rej(code) });
    expect(await t.run('a@b.c', 'password1')).toEqual({ ok: false, reason: 'exists-wrong-password', code });
    expect(t.puts).toEqual([]);
  });
  it('lookup의 다른 실패는 매핑한다', async () => {
    const t = setup({ create: rej('auth/email-already-in-use'), lookup: rej('auth/network-request-failed') });
    expect(await t.run('a@b.c', 'password1')).toMatchObject({ ok: false, reason: 'network' });
  });
  it('lookup이 너무 많은 시도로 막히면 throttled', async () => {
    const t = setup({ create: rej('auth/email-already-in-use'), lookup: rej('auth/too-many-requests') });
    expect(await t.run('a@b.c', 'password1')).toEqual({ ok: false, reason: 'throttled', code: 'auth/too-many-requests' });
    expect(t.puts).toEqual([]);
  });
  it.each([
    ['auth/invalid-email', 'invalid-email'],
    ['auth/weak-password', 'weak-password'],
    ['auth/network-request-failed', 'network'],
    ['unavailable', 'network'],
    ['permission-denied', 'denied'],
    ['auth/admin-restricted-operation', 'denied'],
    ['auth/operation-not-allowed', 'denied'],
    ['auth/too-many-requests', 'throttled'],
    ['auth/something', 'unknown'],
  ])('create의 %s -> %s', async (code, reason) => {
    const t = setup({ create: rej(code) });
    expect(await t.run('a@b.c', 'password1')).toEqual({ ok: false, reason, code });
    expect(t.puts).toEqual([]);
  });
  it('코드가 없는 실패는 unknown', async () => {
    const t = setup({ create: () => Promise.reject(new Error('x')) });
    expect(await t.run('a@b.c', 'password1')).toEqual({ ok: false, reason: 'unknown', code: 'unknown' });
  });
  it('put이 실패하면 그 실패를 돌려주고 그 밖의 호출은 하지 않는다', async () => {
    const t = setup({ put: rej('permission-denied') });
    expect(await t.run('a@b.c', 'password1')).toEqual({ ok: false, reason: 'denied', code: 'permission-denied' });
    expect(t.calls).toEqual(['create:a@b.c:password1', 'put']);
  });
  it('비밀번호는 8자부터 받고 7자는 거부한다', async () => {
    const t = setup();
    expect(await t.run('a@b.c', '1234567')).toMatchObject({ ok: false, reason: 'weak-password' });
    expect(t.calls).toEqual([]);
    expect(await t.run('a@b.c', '12345678')).toMatchObject({ ok: true });
  });
  it('lookup 뒤 put이 실패해도 매핑한다', async () => {
    const t = setup({ create: rej('auth/email-already-in-use'), put: rej('unavailable') });
    expect(await t.run('a@b.c', 'password1')).toMatchObject({ ok: false, reason: 'network' });
  });
});

describe('addUserMessage', () => {
  it('문구', () => {
    const f = (reason: Extract<AddResult, { ok: false }>['reason'], code = 'c'): AddResult => ({ ok: false, reason, code });
    expect(addUserMessage({ ok: true, uid: 'u', existed: false })).toBe('추가했습니다.');
    expect(addUserMessage({ ok: true, uid: 'u', existed: true })).toBe('이미 있던 계정을 다시 등록했습니다.');
    expect(addUserMessage(f('invalid-email'))).toBe('이메일 주소를 확인하세요.');
    expect(addUserMessage(f('weak-password'))).toBe('비밀번호는 8자 이상이어야 합니다.');
    expect(addUserMessage(f('exists-wrong-password'))).toBe('이미 있는 이메일입니다. 그 계정의 비밀번호를 넣으면 다시 등록합니다.');
    expect(addUserMessage(f('network'))).toBe('네트워크에 연결할 수 없습니다.');
    expect(addUserMessage(f('denied'))).toBe('권한이 없어 추가하지 못했습니다.');
    expect(addUserMessage(f('throttled'))).toBe('시도가 너무 많습니다. 잠시 뒤 다시 해 주세요.');
    expect(addUserMessage(f('unknown', 'auth/x'))).toBe('추가하지 못했습니다. (auth/x)');
  });
});
