import { describe, expect, it } from 'vitest';
import { parseAccess, watchAccess, type AccessDoc, type AccessSnapshot, type AccessSource, type AccessState } from './access';

const doc = (extra: Partial<AccessDoc> = {}): AccessDoc => ({ email: 'a@example.com', role: 'user', disabled: false, createdAt: 1, ...extra });
const server = (d: AccessDoc | null): AccessSnapshot => ({ doc: d, fromCache: false, hasPendingWrites: false });

function setup(claim: () => Promise<void> = () => Promise.resolve()) {
  let emit: (s: AccessSnapshot) => void = () => {};
  let fail: (code: string) => void = () => {};
  let unwatched = 0;
  const claims: string[] = [];
  const source: AccessSource = {
    watch(_uid, onSnap, onError) {
      emit = onSnap;
      fail = onError;
      return () => { unwatched += 1; };
    },
    claimAdmin(uid, email) {
      claims.push(`${uid}:${email}`);
      return claim();
    },
  };
  const states: AccessState[] = [];
  const stop = watchAccess(source, { uid: 'u1', email: 'a@example.com' }, (s) => states.push(s));
  return { states, claims, stop, emit: (s: AccessSnapshot) => emit(s), fail: (c: string) => fail(c), unwatched: () => unwatched };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('parseAccess', () => {
  it('모양이 맞으면 돌려주고 아니면 null', () => {
    expect(parseAccess(doc())).toEqual(doc());
    expect(parseAccess({ ...doc(), extra: 1 })).toEqual(doc());
    expect(parseAccess(null)).toBeNull();
    expect(parseAccess('x')).toBeNull();
    expect(parseAccess({ ...doc(), email: '' })).toBeNull();
    expect(parseAccess({ ...doc(), role: 'owner' })).toBeNull();
    expect(parseAccess({ ...doc(), disabled: 'no' })).toBeNull();
    expect(parseAccess({ ...doc(), createdAt: '1' })).toBeNull();
  });
});

describe('watchAccess', () => {
  it('처음은 checking이고 바뀔 때만 알린다', () => {
    const t = setup();
    expect(t.states).toEqual(['checking']);
    t.emit(server(doc()));
    t.emit(server(doc()));
    expect(t.states).toEqual(['checking', 'user']);
  });
  it('문서가 있으면 역할을 따른다', () => {
    const t = setup();
    t.emit(server(doc({ role: 'admin' })));
    expect(t.states.at(-1)).toBe('admin');
  });
  it('쓰기 대기 중인 스냅샷은 무시한다', () => {
    const t = setup();
    t.emit({ doc: doc({ role: 'admin' }), fromCache: true, hasPendingWrites: true });
    expect(t.states).toEqual(['checking']);
    t.emit(server(doc()));
    expect(t.states).toEqual(['checking', 'user']);
  });
  it('일반 계정이 관리자 문서를 대기 중으로 써도 admin이 되지 않는다', async () => {
    const t = setup(() => Promise.reject({ code: 'permission-denied' }));
    t.emit(server(null));
    t.emit({ doc: doc({ role: 'admin' }), fromCache: true, hasPendingWrites: true });
    await flush();
    expect(t.states).not.toContain('admin');
    expect(t.states.at(-1)).toBe('none');
  });
  it('캐시에서 온 문서도 인정한다', () => {
    const t = setup();
    t.emit({ doc: doc(), fromCache: true, hasPendingWrites: false });
    expect(t.states.at(-1)).toBe('user');
  });
  it('문서가 없고 캐시면 그대로 두고 만들기를 시도하지 않는다', () => {
    const t = setup();
    t.emit({ doc: null, fromCache: true, hasPendingWrites: false });
    expect(t.states).toEqual(['checking']);
    expect(t.claims).toEqual([]);
  });
  it('서버에서 문서가 없으면 한 번 만들기를 시도하고, 거부되면 none', async () => {
    const t = setup(() => Promise.reject({ code: 'permission-denied' }));
    t.emit(server(null));
    expect(t.claims).toEqual(['u1:a@example.com']);
    await flush();
    expect(t.states).toEqual(['checking', 'none']);
    t.emit(server(null));
    expect(t.claims).toHaveLength(1);
  });
  it('만들기가 성공하면 문서가 보이는 스냅샷을 기다려 admin이 된다', async () => {
    const t = setup();
    t.emit(server(null));
    await flush();
    expect(t.states).toEqual(['checking']);
    t.emit({ doc: doc({ role: 'admin' }), fromCache: true, hasPendingWrites: true });
    expect(t.states).toEqual(['checking']);
    t.emit(server(doc({ role: 'admin' })));
    expect(t.states).toEqual(['checking', 'admin']);
  });
  it('만들기가 진행 중이면 다시 시도하지 않는다', () => {
    const t = setup(() => new Promise(() => {}));
    t.emit(server(null));
    t.emit(server(null));
    expect(t.claims).toHaveLength(1);
  });
  it('다른 이유로 실패하면 checking을 유지하고 한 번만 더 시도한다', async () => {
    const t = setup(() => Promise.reject({ code: 'unavailable' }));
    t.emit(server(null));
    await flush();
    expect(t.states).toEqual(['checking']);
    t.emit(server(null));
    await flush();
    expect(t.claims).toHaveLength(2);
    t.emit(server(null));
    expect(t.claims).toHaveLength(2);
    expect(t.states).toEqual(['checking']);
  });
  it('막힌 문서 -> blocked, 다시 허용되면 user', () => {
    const t = setup();
    t.emit(server(doc({ disabled: true })));
    expect(t.states.at(-1)).toBe('blocked');
    t.emit(server(doc()));
    expect(t.states).toEqual(['checking', 'blocked', 'user']);
  });
  it('permission-denied 오류는 none, 다른 오류는 그대로', () => {
    const t = setup();
    t.fail('unavailable');
    expect(t.states).toEqual(['checking']);
    t.fail('permission-denied');
    expect(t.states).toEqual(['checking', 'none']);
  });
  it('끊은 뒤에는 아무것도 알리지 않고, 늦게 끝난 만들기도 영향이 없다', async () => {
    let reject: (e: unknown) => void = () => {};
    const t = setup(() => new Promise<void>((_, r) => { reject = r; }));
    t.emit(server(null));
    t.stop();
    expect(t.unwatched()).toBe(1);
    reject({ code: 'permission-denied' });
    await flush();
    t.emit(server(doc()));
    t.fail('permission-denied');
    expect(t.states).toEqual(['checking']);
  });
});

describe('watchAccess: 지워진 사용자', () => {
  it('거부된 뒤 서버에 문서가 없으면 다시 만들지 않고 바로 none이다', async () => {
    const t = setup(() => Promise.reject({ code: 'permission-denied' }));
    t.emit(server(doc()));
    expect(t.states.at(-1)).toBe('user');
    t.emit(server(null));
    await flush();
    expect(t.states.at(-1)).toBe('none');
    t.emit(server(doc()));
    expect(t.states.at(-1)).toBe('user');
    t.emit(server(null));
    expect(t.states.at(-1)).toBe('none');
    expect(t.states).toEqual(['checking', 'user', 'none', 'user', 'none']);
    expect(t.claims).toHaveLength(1);
  });
  it('캐시나 쓰기 대기 중의 빈 스냅샷은 none으로 보지 않는다', async () => {
    const t = setup(() => Promise.reject({ code: 'permission-denied' }));
    t.emit(server(null));
    await flush();
    t.emit(server(doc()));
    t.emit({ doc: null, fromCache: true, hasPendingWrites: false });
    t.emit({ doc: null, fromCache: false, hasPendingWrites: true });
    expect(t.states.at(-1)).toBe('user');
  });
  it('만들기가 성공한 뒤 관리자 문서가 사라지면 한 번 더 만들어 본다', async () => {
    const t = setup();
    t.emit(server(null));
    await flush();
    t.emit(server(doc({ role: 'admin' })));
    t.emit(server(null));
    expect(t.claims).toHaveLength(2);
  });
});
