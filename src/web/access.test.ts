import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  parseAccess,
  screenFor,
  usersRoute,
  watchAccess,
  type AccessDoc,
  type AccessSnapshot,
  type AccessSource,
  type AccessState,
  type AccessTriggers,
  type AccessWatch,
} from './access';

const doc = (extra: Partial<AccessDoc> = {}): AccessDoc => ({ email: 'a@example.com', role: 'user', disabled: false, createdAt: 1, ...extra });
const server = (d: AccessDoc | null): AccessSnapshot => ({ doc: d, fromCache: false, hasPendingWrites: false });

// 시험마다 시작한 지켜보기는 끝날 때 멈춘다(남은 타이머가 다음 시험에 닿지 않게).
const started: AccessWatch[] = [];
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  for (const w of started.splice(0)) w.stop();
  vi.useRealTimers();
});

function setup(claim: () => Promise<void> = () => Promise.resolve(), triggers?: AccessTriggers) {
  let emit: (s: AccessSnapshot) => void = () => {};
  let fail: (code: string) => void = () => {};
  let unwatched = 0;
  let subscribed = 0;
  const claims: string[] = [];
  const source: AccessSource = {
    watch(_uid, onSnap, onError) {
      subscribed += 1;
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
  const watch = watchAccess(source, { uid: 'u1', email: 'a@example.com' }, (s) => states.push(s), triggers);
  started.push(watch);
  return {
    states,
    claims,
    watch,
    stop: () => watch.stop(),
    emit: (s: AccessSnapshot) => emit(s),
    fail: (c: string) => fail(c),
    unwatched: () => unwatched,
    subscribed: () => subscribed,
  };
}
// 거부된 만들기의 결과(약속)가 처리되게 한다.
const flush = () => vi.advanceTimersByTimeAsync(0);
const denied = () => Promise.reject({ code: 'permission-denied' });

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
    const t = setup(denied);
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
    const t = setup(denied);
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

describe('watchAccess: 지켜보기 오류', () => {
  it('어떤 오류도 상태를 바꾸지 않고, 2초 뒤에 다시 지켜본다. 그 뒤의 좋은 스냅샷을 따른다', async () => {
    const t = setup();
    t.fail('permission-denied');
    t.fail('unavailable');
    expect(t.states).toEqual(['checking']);
    await vi.advanceTimersByTimeAsync(1999);
    expect(t.subscribed()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.subscribed()).toBe(2);
    t.emit(server(doc({ role: 'admin' })));
    expect(t.states).toEqual(['checking', 'admin']);
  });
  it('이미 정해진 상태도 오류로는 바뀌지 않는다', () => {
    const t = setup();
    t.emit(server(doc()));
    t.fail('permission-denied');
    expect(t.states).toEqual(['checking', 'user']);
  });
  it('다시 지켜보는 간격은 2, 4, 8 ... 60초까지 늘고, 스냅샷이 오면 2초로 돌아간다', async () => {
    const t = setup();
    const waits: number[] = [];
    for (let i = 0; i < 7; i += 1) {
      const before = t.subscribed();
      t.fail('unavailable');
      let waited = 0;
      while (t.subscribed() === before) {
        await vi.advanceTimersByTimeAsync(1000);
        waited += 1000;
      }
      waits.push(waited);
    }
    expect(waits).toEqual([2000, 4000, 8000, 16000, 32000, 60000, 60000]);
    t.emit({ doc: null, fromCache: true, hasPendingWrites: false });
    t.fail('unavailable');
    await vi.advanceTimersByTimeAsync(2000);
    expect(t.subscribed()).toBe(9);
    expect(t.states).toEqual(['checking']);
  });
  it('이전 지켜보기에서 늦게 온 알림은 무시한다', () => {
    let first: { snap?: (s: AccessSnapshot) => void } = {};
    let calls = 0;
    const states: AccessState[] = [];
    const source: AccessSource = {
      watch(_uid, onSnap) {
        calls += 1;
        if (calls === 1) first = { snap: onSnap };
        return () => {};
      },
      claimAdmin: () => Promise.resolve(),
    };
    const w = watchAccess(source, { uid: 'u1', email: 'a@example.com' }, (s) => states.push(s));
    started.push(w);
    w.recheck();
    first.snap!(server(doc({ role: 'admin' })));
    expect(states).toEqual(['checking']);
  });
});

describe('watchAccess: 거부된 만들기는 끝이 아니다', () => {
  it('none이 된 뒤 30초가 지나면 다시 지켜보고 한 번 더 만들어 본다. 성공하면 admin', async () => {
    let allowed = false;
    const t = setup(() => (allowed ? Promise.resolve() : Promise.reject({ code: 'permission-denied' })));
    t.emit(server(null));
    await flush();
    expect(t.states).toEqual(['checking', 'none']);
    allowed = true;
    await vi.advanceTimersByTimeAsync(29999);
    expect([t.subscribed(), t.claims.length]).toEqual([1, 1]);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.subscribed()).toBe(2);
    t.emit({ doc: null, fromCache: true, hasPendingWrites: false });
    expect(t.claims).toHaveLength(1); // 캐시의 "문서 없음"으로는 만들지 않는다
    t.emit(server(null));
    expect(t.claims).toHaveLength(2);
    await flush();
    t.emit({ doc: doc({ role: 'admin' }), fromCache: false, hasPendingWrites: true });
    expect(t.states).toEqual(['checking', 'none']);
    t.emit(server(doc({ role: 'admin' })));
    expect(t.states).toEqual(['checking', 'none', 'admin']);
  });
  it('none인 동안 30초, 60초, 120초, 그 뒤로는 5분마다 다시 확인한다', async () => {
    const t = setup(denied);
    t.emit(server(null));
    await flush();
    const at: number[] = [];
    let elapsed = 0;
    while (at.length < 6) {
      const before = t.subscribed();
      await vi.advanceTimersByTimeAsync(1000);
      elapsed += 1000;
      if (t.subscribed() > before) {
        at.push(elapsed / 1000);
        t.emit(server(null)); // 서버는 여전히 문서가 없다고 답하고, 만들기도 거부된다
        await flush();
      }
    }
    expect(at).toEqual([30, 90, 210, 510, 810, 1110]);
    expect(t.claims).toHaveLength(7);
    expect(t.states).toEqual(['checking', 'none']);
  });
  it('none이 아니게 되면 다시 확인을 멈춘다', async () => {
    const t = setup(denied);
    t.emit(server(null));
    await flush();
    t.emit(server(doc()));
    await vi.advanceTimersByTimeAsync(600000);
    expect([t.subscribed(), t.claims.length, vi.getTimerCount()]).toEqual([1, 1, 0]);
    expect(t.states).toEqual(['checking', 'none', 'user']);
  });
  it('none인 동안 화면이 다시 보이거나 연결이 돌아오면 바로 다시 확인한다', async () => {
    const target = new EventTarget();
    const page = { visibilityState: 'visible' };
    const t = setup(denied, { target, doc: page });
    target.dispatchEvent(new Event('online'));
    target.dispatchEvent(new Event('visibilitychange'));
    expect(t.subscribed()).toBe(1); // 아직 none이 아니면 아무것도 하지 않는다

    t.emit(server(null));
    await flush();
    expect(t.states.at(-1)).toBe('none');
    page.visibilityState = 'hidden';
    target.dispatchEvent(new Event('visibilitychange'));
    expect(t.subscribed()).toBe(1);
    page.visibilityState = 'visible';
    target.dispatchEvent(new Event('visibilitychange'));
    expect(t.subscribed()).toBe(2);
    t.emit(server(null));
    await flush();
    expect(t.claims).toHaveLength(2);

    target.dispatchEvent(new Event('online'));
    expect(t.subscribed()).toBe(3);
    t.emit(server(null));
    await flush();
    expect(t.claims).toHaveLength(3);
    expect(t.states).toEqual(['checking', 'none']);

    t.stop();
    target.dispatchEvent(new Event('online'));
    target.dispatchEvent(new Event('visibilitychange'));
    expect(t.subscribed()).toBe(3);
  });
  it('recheck()는 바로 다시 지켜보고 한 번 더 만들어 보며, 답이 오면 done을 부른다', async () => {
    const t = setup(denied);
    t.emit(server(null));
    await flush();
    const done = vi.fn();
    t.watch.recheck(done);
    expect(t.subscribed()).toBe(2);
    expect(done).not.toHaveBeenCalled();
    t.emit({ doc: null, fromCache: true, hasPendingWrites: false });
    expect(done).not.toHaveBeenCalled();
    t.emit(server(null));
    expect(t.claims).toHaveLength(2);
    expect(done).not.toHaveBeenCalled(); // 만들기의 답을 기다린다
    await flush();
    expect(done).toHaveBeenCalledTimes(1);
    expect(t.states).toEqual(['checking', 'none']);
  });
  it('recheck()의 done은 문서가 오거나, 지켜보기가 실패하거나, 10초가 지나면 부른다', async () => {
    const t = setup(denied);
    const a = vi.fn();
    t.watch.recheck(a);
    t.emit(server(doc()));
    expect(a).toHaveBeenCalledTimes(1);

    const b = vi.fn();
    t.watch.recheck(b);
    t.fail('unavailable');
    expect(b).toHaveBeenCalledTimes(1);

    const c = vi.fn();
    t.watch.recheck(c);
    await vi.advanceTimersByTimeAsync(9999);
    expect(c).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(c).toHaveBeenCalledTimes(1);
    t.emit(server(doc()));
    expect([a, b, c].map((f) => f.mock.calls.length)).toEqual([1, 1, 1]);
  });
  it('예전에 굳던 순서(지켜보기 거부, 만들기 거부)도 새 규칙이 퍼지면 admin으로 끝난다', async () => {
    // 규칙 배포 직후처럼 요청마다 예전 규칙과 새 규칙 중 하나로 답하는 가짜.
    const rules = { watch: 'old', claim: 'old' };
    let stored: AccessDoc | null = null;
    let listener: { snap(s: AccessSnapshot): void } | null = null;
    let subscribed = 0;
    const states: AccessState[] = [];
    const source: AccessSource = {
      watch(_uid, onSnap, onError) {
        subscribed += 1;
        const mine = { snap: onSnap };
        listener = mine;
        setTimeout(() => {
          if (listener !== mine) return;
          if (rules.watch === 'old') {
            listener = null;
            onError('permission-denied');
          } else {
            onSnap(server(stored));
          }
        }, 50);
        return () => {
          if (listener === mine) listener = null;
        };
      },
      claimAdmin(_uid, email) {
        if (rules.claim === 'old') return Promise.reject({ code: 'permission-denied' });
        stored = doc({ email, role: 'admin' });
        const l = listener;
        setTimeout(() => l?.snap(server(stored)), 50);
        return Promise.resolve();
      },
    };
    const w = watchAccess(source, { uid: 'owner', email: 'boss@example.com' }, (s) => states.push(s));
    started.push(w);

    await vi.advanceTimersByTimeAsync(100); // 지켜보기가 예전 규칙에 거부된다
    expect(states).toEqual(['checking']);
    rules.watch = 'new'; // 읽기는 새 규칙으로 답하지만 쓰기는 아직 예전 규칙이다
    await vi.advanceTimersByTimeAsync(2000);
    expect(subscribed).toBe(2);
    expect(states).toEqual(['checking', 'none']);
    rules.claim = 'new';
    await vi.advanceTimersByTimeAsync(30000);
    await vi.advanceTimersByTimeAsync(200);
    expect(states).toEqual(['checking', 'none', 'admin']);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('stop은 다시 지켜보기와 다시 확인의 타이머를 모두 치운다', async () => {
    const a = setup(denied);
    a.fail('unavailable'); // 다시 지켜보기를 기다린다
    const b = setup(denied);
    b.emit(server(null));
    await flush(); // none: 다시 확인을 기다린다
    const c = setup(denied);
    c.watch.recheck(() => {}); // 10초 제한을 기다린다
    expect(vi.getTimerCount()).toBe(3);
    a.stop();
    b.stop();
    c.stop();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(600000);
    expect([a.subscribed(), b.subscribed(), c.subscribed()]).toEqual([1, 1, 2]);
    expect([a.unwatched(), b.unwatched(), c.unwatched()]).toEqual([1, 1, 2]);
  });
});

describe('watchAccess: 지워진 사용자', () => {
  it('거부된 뒤 서버에 문서가 없으면 다시 만들지 않고 바로 none이다', async () => {
    const t = setup(denied);
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
    const t = setup(denied);
    t.emit(server(null));
    await flush();
    t.emit(server(doc()));
    t.emit({ doc: null, fromCache: true, hasPendingWrites: false });
    t.emit({ doc: null, fromCache: false, hasPendingWrites: true });
    expect(t.states.at(-1)).toBe('user');
  });
  it('만들기가 진행되는 사이 문서가 오면 늦게 거부돼도 none으로 바꾸지 않는다', async () => {
    let reject: (e: unknown) => void = () => {};
    const t = setup(() => new Promise<void>((_, r) => { reject = r; }));
    t.emit(server(null));
    t.emit(server(doc()));
    reject({ code: 'permission-denied' });
    await flush();
    expect(t.states).toEqual(['checking', 'user']);
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

describe('screenFor', () => {
  it('허가 없음과 중지는 안내, 관리자와 사용자는 달력, 확인 중에는 보이던 것을 그대로 둔다', () => {
    expect(screenFor('none', 'calendar')).toBe('none');
    expect(screenFor('blocked', 'calendar')).toBe('blocked');
    expect(screenFor('none', 'blocked')).toBe('none');
    expect(screenFor('admin', 'blocked')).toBe('calendar');
    expect(screenFor('user', 'none')).toBe('calendar');
    expect(screenFor('checking', 'calendar')).toBe('calendar');
    expect(screenFor('checking', 'blocked')).toBe('blocked');
  });
});

describe('usersRoute', () => {
  it('#users는 관리자면 열고, 사용자면 달력으로 돌아가고, 그 밖에는 기다린다', () => {
    expect(usersRoute('admin')).toBe('open');
    expect(usersRoute('user')).toBe('leave');
    for (const s of ['checking', 'none', 'blocked'] as const) expect(usersRoute(s)).toBe('wait');
  });
});
