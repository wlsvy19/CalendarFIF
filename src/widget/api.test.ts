import { describe, expect, it } from 'vitest';
import { parseEventsDocument, parseMonthDocument, parseMonthTimes, readEvents, readMonth, readMonthDoc, refreshSession, signIn, type ApiError, type Config } from './api';
import { makeFakeHost, type FakeAnswer, type FakeRequest } from './fakeHost';

const cfg: Config = { projectId: 'demo-calfif', apiKey: 'demo-key', appUrl: 'https://example.test/' };
const session = { idToken: 'ID', refreshToken: 'RT', uid: 'owner-test-uid' };

const hostWith = (handler: (req: FakeRequest) => FakeAnswer) => makeFakeHost({ handler });
const failure = async (p: Promise<unknown>): Promise<ApiError> => {
  try {
    await p;
  } catch (e) {
    return e as ApiError;
  }
  throw new Error('오류가 나야 한다');
};

describe('요청의 모양', () => {
  it('로그인', async () => {
    const host = hostWith(() => ({ body: { idToken: 'ID', refreshToken: 'RT', localId: 'owner-test-uid' } }));
    const s = await signIn(host, cfg, 'test@example.com', 'pw');
    expect(s).toEqual(session);
    expect(host.state.requests).toEqual([
      {
        url: 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"email":"test@example.com","password":"pw","returnSecureToken":true}',
        timeoutInterval: 10,
      },
    ]);
  });

  it('갱신', async () => {
    const host = hostWith(() => ({ body: { id_token: 'ID2', refresh_token: 'RT2', user_id: 'owner-test-uid' } }));
    const s = await refreshSession(host, cfg, 'a+b/c=');
    expect(s).toEqual({ idToken: 'ID2', refreshToken: 'RT2', uid: 'owner-test-uid' });
    expect(host.state.requests).toEqual([
      {
        url: 'https://securetoken.googleapis.com/v1/token?key=demo-key',
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=refresh_token&refresh_token=a%2Bb%2Fc%3D',
        timeoutInterval: 10,
      },
    ]);
  });

  it('읽기', async () => {
    const host = hostWith(() => ({ body: { fields: { days: { mapValue: { fields: { '13': { mapValue: { fields: { text: { stringValue: 'A' }, color: { stringValue: 'f12424' } } } } } } } } } }));
    expect(await readMonth(host, cfg, session, '2026-11')).toEqual({ '13': { text: 'A', color: 'F12424' } });
    expect(host.state.requests).toEqual([
      {
        url: 'https://firestore.googleapis.com/v1/projects/demo-calfif/databases/(default)/documents/users/owner-test-uid/months/2026-11',
        method: 'GET',
        headers: { Authorization: 'Bearer ID' },
        body: '',
        timeoutInterval: 10,
      },
    ]);
  });

  it('주소의 앞부분을 바꿀 수 있다', async () => {
    const host = hostWith(() => ({ body: { idToken: 'I', refreshToken: 'R', localId: 'u' } }));
    await signIn(host, { ...cfg, authBase: 'http://x.test/a' }, 'e', 'p');
    expect(host.state.requests[0].url).toBe('http://x.test/a/v1/accounts:signInWithPassword?key=demo-key');
  });

  it('날짜별 고친 시각도 읽는다: 정수(글)와 소수(숫자), 읽지 못한 날은 넣지 않는다', async () => {
    const day = (editedAt: unknown) => ({ mapValue: { fields: { text: { stringValue: 'A' }, color: { stringValue: '' }, ...(editedAt === undefined ? {} : { editedAt }) } } });
    const body = { fields: { days: { mapValue: { fields: {
      '13': day({ integerValue: '1763370000000' }), '14': day({ doubleValue: 1763370000001.5 }), '15': day(undefined), '16': day({ stringValue: 'x' }), '17': day({ integerValue: 'abc' }), '18': day({ integerValue: '0' }), x: day({ integerValue: '5' }),
    } } } } };
    expect(parseMonthTimes(body)).toEqual({ '13': 1763370000000, '14': 1763370000001.5 });
    expect(parseMonthTimes({})).toEqual({});
    expect(parseMonthTimes(null)).toEqual({});
    const read = await readMonthDoc(hostWith(() => ({ body })), cfg, session, '2026-11');
    expect([Object.keys(read.days).sort(), read.times]).toEqual([['13', '14', '15', '16', '17', '18'], { '13': 1763370000000, '14': 1763370000001.5 }]);
    expect(await readMonthDoc(hostWith(() => ({ status: 404, body: {} })), cfg, session, '2026-12')).toEqual({ days: {}, times: {} });
  });

  it('404는 빈 달', async () => {
    const host = hostWith(() => ({ status: 404, body: { error: { status: 'NOT_FOUND' } } }));
    expect(await readMonth(host, cfg, session, '2026-12')).toEqual({});
  });
});

describe('오류의 갈래', () => {
  const err = (status: number, message: string): FakeAnswer => ({ status, body: { error: { message } } });

  it.each(['INVALID_LOGIN_CREDENTIALS', 'INVALID_PASSWORD', 'EMAIL_NOT_FOUND', 'INVALID_EMAIL', 'MISSING_PASSWORD', 'USER_DISABLED'])('로그인 %s는 credentials', async (m) => {
    const e = await failure(signIn(hostWith(() => err(400, m)), cfg, 'e', 'p'));
    expect(e).toEqual({ kind: 'credentials', code: m });
  });

  it('로그인: 서버가 덧붙인 설명이 있어도 앞부분으로 가른다', async () => {
    const e = await failure(signIn(hostWith(() => err(400, 'TOO_MANY_ATTEMPTS_TRY_LATER : Access to this account has been temporarily disabled')), cfg, 'e', 'p'));
    expect(e.kind).toBe('throttled');
  });

  it('로그인: 그 밖의 4xx는 rejected, 5xx는 network', async () => {
    expect(await failure(signIn(hostWith(() => err(400, 'API_KEY_INVALID')), cfg, 'e', 'p'))).toEqual({ kind: 'rejected', code: 'API_KEY_INVALID' });
    expect(await failure(signIn(hostWith(() => err(403, 'FORBIDDEN')), cfg, 'e', 'p'))).toMatchObject({ kind: 'rejected' });
    expect((await failure(signIn(hostWith(() => err(503, 'X')), cfg, 'e', 'p'))).kind).toBe('network');
  });

  it('갱신: 토큰이 죽었다는 답만 rejected', async () => {
    for (const m of ['TOKEN_EXPIRED', 'USER_DISABLED', 'USER_NOT_FOUND', 'INVALID_REFRESH_TOKEN', 'MISSING_REFRESH_TOKEN']) {
      for (const status of [400, 401, 403]) {
        expect(await failure(refreshSession(hostWith(() => err(status, m)), cfg, 't'))).toEqual({ kind: 'rejected', code: m });
      }
    }
  });

  it('갱신: 그 밖의 4xx(키 문제, 할당량, 모르는 것)는 failed', async () => {
    expect(await failure(refreshSession(hostWith(() => err(400, 'API key not valid. Please pass a valid API key.')), cfg, 't'))).toMatchObject({ kind: 'failed' });
    expect((await failure(refreshSession(hostWith(() => err(404, 'TOKEN_EXPIRED')), cfg, 't'))).kind).toBe('failed');
    expect((await failure(refreshSession(hostWith(() => err(400, 'SOMETHING_NEW')), cfg, 't'))).kind).toBe('failed');
  });

  it('408과 429와 5xx는 어느 요청이든 network', async () => {
    for (const status of [408, 429, 500, 503]) {
      expect((await failure(refreshSession(hostWith(() => err(status, 'X')), cfg, 't'))).kind).toBe('network');
      expect((await failure(readMonth(hostWith(() => err(status, 'X')), cfg, session, 'm'))).kind).toBe('network');
      expect((await failure(signIn(hostWith(() => err(status, 'X')), cfg, 'e', 'p'))).kind).toBe('network');
    }
  });

  it('읽기: 403 denied, 그 밖의 4xx(401 포함) failed', async () => {
    expect((await failure(readMonth(hostWith(() => err(401, 'UNAUTHENTICATED')), cfg, session, '2026-11'))).kind).toBe('failed');
    expect((await failure(readMonth(hostWith(() => err(403, 'PERMISSION_DENIED')), cfg, session, '2026-11'))).kind).toBe('denied');
    expect((await failure(readMonth(hostWith(() => err(400, 'INVALID_ARGUMENT')), cfg, session, '2026-11'))).kind).toBe('failed');
  });

  it('코드는 error.message, 없으면 error.status, 그것도 없으면 HTTP 상태', async () => {
    expect((await failure(readMonth(hostWith(() => ({ status: 403, body: { error: { status: 'PERMISSION_DENIED' } } })), cfg, session, 'm'))).code).toBe('PERMISSION_DENIED');
    expect((await failure(readMonth(hostWith(() => ({ status: 403, body: {} })), cfg, session, 'm'))).code).toBe('403');
  });

  it('연결 오류, 5xx, 읽을 수 없는 답은 network', async () => {
    const down = makeFakeHost({ handler: () => { throw new Error('offline'); } });
    expect((await failure(readMonth(down, cfg, session, 'm'))).kind).toBe('network');
    expect((await failure(readMonth(hostWith(() => ({ status: 500, body: {} })), cfg, session, 'm'))).kind).toBe('network');
    expect((await failure(readMonth(hostWith(() => ({ status: 200, body: 'not json' })), cfg, session, 'm'))).kind).toBe('network');
  });

  it('성공했는데 필요한 값이 없으면 network', async () => {
    expect((await failure(signIn(hostWith(() => ({ body: { idToken: 'I' } })), cfg, 'e', 'p'))).kind).toBe('network');
  });

  it('오류에 보낸 비밀번호나 토큰이 들어가지 않는다', async () => {
    const e = await failure(signIn(hostWith(() => err(400, 'INVALID_PASSWORD')), cfg, 'e', 'secret-pw'));
    expect(JSON.stringify(e)).not.toContain('secret-pw');
    const r = await failure(refreshSession(hostWith(() => err(400, 'TOKEN_EXPIRED')), cfg, 'secret-refresh'));
    expect(JSON.stringify(r)).not.toContain('secret-refresh');
    const d = await failure(readMonth(hostWith(() => err(403, 'PERMISSION_DENIED')), cfg, session, 'm'));
    expect(JSON.stringify(d)).not.toContain('ID');
  });
});

describe('parseMonthDocument', () => {
  const day = (text: unknown, color?: unknown) => ({ mapValue: { fields: { text, ...(color === undefined ? {} : { color }) } } });
  const doc = (days: unknown) => ({ fields: { days: { mapValue: { fields: days } } } });

  it('완전한 문서', () => {
    const out = parseMonthDocument(doc({
      '01': day({ stringValue: 'A\nB' }, { stringValue: 'f9bc0b' }),
      '31': day({ stringValue: 'C' }, { stringValue: '#282828' }),
    }));
    expect(out).toEqual({ '01': { text: 'A\nB', color: 'F9BC0B' }, '31': { text: 'C', color: '282828' } });
  });

  it('days가 없으면 빈 객체', () => {
    expect(parseMonthDocument({ fields: {} })).toEqual({});
    expect(parseMonthDocument({ fields: { days: { mapValue: {} } } })).toEqual({});
  });

  it('color가 없거나 이상하면 빈 색', () => {
    const out = parseMonthDocument(doc({ '02': day({ stringValue: 'x' }), '03': day({ stringValue: 'y' }, { stringValue: 'zzz' }), '04': day({ stringValue: 'z' }, { integerValue: '5' }) }));
    expect(out).toEqual({ '02': { text: 'x', color: '' }, '03': { text: 'y', color: '' }, '04': { text: 'z', color: '' } });
  });

  it('text가 문자열이 아니면 그 날짜를 건너뛴다', () => {
    const out = parseMonthDocument(doc({ '05': day({ integerValue: '1' }), '06': day({ stringValue: 'ok' }), '07': { mapValue: {} } }));
    expect(out).toEqual({ '06': { text: 'ok', color: '' } });
  });

  it('날짜처럼 보이지 않는 키는 건너뛴다', () => {
    const out = parseMonthDocument(doc({ '00': day({ stringValue: 'a' }), '32': day({ stringValue: 'b' }), '1': day({ stringValue: 'c' }), x: day({ stringValue: 'd' }) }));
    expect(out).toEqual({});
  });

  it.each([null, undefined, 5, 'x', [], { fields: 3 }, { fields: { days: 7 } }])('쓰레기(%j)는 빈 객체', (junk) => {
    expect(parseMonthDocument(junk)).toEqual({});
  });
});

describe('알림 문서', () => {
  const rest = {
    fields: {
      items: { mapValue: { fields: {
        abc123: { mapValue: { fields: {
          type: { stringValue: 'alarm' }, date: { stringValue: '2026-11-20' }, text: { stringValue: '회의' }, done: { booleanValue: false },
          time: { stringValue: '09:30' }, advance: { arrayValue: { values: [{ integerValue: '0' }, { integerValue: '1' }] } },
          repeat: { mapValue: { fields: { freq: { stringValue: 'weekly' }, count: { integerValue: '3' } } } },
          editedAt: { integerValue: '5' }, editedBy: { nullValue: null },
        } } },
        bad: { mapValue: { fields: { type: { stringValue: 'alarm' }, text: { stringValue: '날짜 없음' } } } },
      } } },
      updatedAt: { timestampValue: '2026-11-15T00:00:00Z' },
    },
  };

  it('parseEventsDocument가 REST 값을 풀고 틀린 항목을 버린다', () => {
    const map = parseEventsDocument(rest);
    expect(Object.keys(map)).toEqual(['abc123']);
    expect(map.abc123).toMatchObject({ type: 'alarm', text: '회의', time: '09:30', advance: [0, 1], repeat: { freq: 'weekly', count: 3 }, editedAt: 5 });
    expect(parseEventsDocument(null)).toEqual({});
    expect(parseEventsDocument({ fields: {} })).toEqual({});
  });

  it('readEvents의 404는 빈 것', async () => {
    const host = hostWith(() => ({ status: 404, body: { error: { status: 'NOT_FOUND' } } }));
    expect(await readEvents(host, cfg, session)).toEqual({});
    expect(host.state.requests[0].url).toBe('https://firestore.googleapis.com/v1/projects/demo-calfif/databases/(default)/documents/users/owner-test-uid/data/events');
    expect(host.state.requests[0].headers).toEqual({ Authorization: 'Bearer ID' });
    const ok = hostWith(() => ({ body: rest }));
    expect(Object.keys(await readEvents(ok, cfg, session))).toEqual(['abc123']);
  });
});
