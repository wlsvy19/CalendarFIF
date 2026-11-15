import { describe, expect, it } from 'vitest';
import type { AlarmRecord } from '../core/events';
import { classify, fieldSegment, setup, tick, writeSent, type GasHost, type GasRequest, type GasResponse } from './gas';

// 가짜 Apps Script: 시계는 sleep으로만 흐르고, 요청은 route가 답한다.
type Route = (req: GasRequest) => { code: number; body: unknown };
const P = 'demo-project';
const DOCS = `https://firestore.googleapis.com/v1/projects/${P}/databases/(default)/documents`;
const KEY = JSON.stringify({ project_id: P, client_email: 'sender@example.test', private_key: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n', token_uri: 'https://oauth2.example.test/token' });
const D1 = 'AAAAAAAAAAAAAAAAAAAA';

function rest(v: unknown): unknown {
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return { integerValue: String(v) };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(rest) } };
  if (v && typeof v === 'object') return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, rest(x)])) } };
  return { nullValue: null };
}
const fieldsOf = (o: Record<string, unknown>) => (rest(o) as { mapValue: { fields: unknown } }).mapValue.fields;

const alarm = (over: Partial<AlarmRecord> = {}): AlarmRecord => ({
  type: 'alarm', date: '2026-11-15', text: '회의', done: false, repeat: { freq: 'none' }, time: '17:48', advance: [0], editedAt: 1, editedBy: 'u', ...over,
});

function makeHost(opts: { start: Date; key?: string | null; tz?: string; events?: () => Record<string, AlarmRecord>; push?: () => Record<string, unknown> | null; fcm?: (body: unknown) => { code: number; body: unknown }; fetchAllThrows?: () => boolean }) {
  let clock = opts.start.getTime();
  const props = new Map<string, string>();
  if (opts.key !== null) props.set('SERVICE_ACCOUNT', opts.key ?? KEY);
  const cache = new Map<string, string>();
  const requests: GasRequest[] = [];
  const logs: string[] = [];
  const triggers: Array<{ getHandlerFunction(): string }> = [{ getHandlerFunction: () => 'tick' }, { getHandlerFunction: () => 'other' }];
  const created: string[] = [];
  const fcmSent: Array<{ at: number; body: unknown }> = [];
  const patches: Array<{ url: string; body: unknown }> = [];
  const route: Route = (req) => {
    if (req.url === 'https://oauth2.example.test/token') return { code: 200, body: { access_token: 'TOKEN' } };
    if (req.url.startsWith(`${DOCS}/users?`)) return { code: 200, body: { documents: [{ name: `projects/${P}/databases/(default)/documents/users/u1` }] } };
    if (req.url === `${DOCS}:batchGet`) {
      const out: unknown[] = [{ found: { name: `projects/${P}/databases/(default)/documents/users/u1/data/events`, fields: fieldsOf({ items: opts.events ? opts.events() : {} }) } }];
      const p = opts.push ? opts.push() : { devices: { [D1]: { token: 'tok1', label: '아이폰', at: 1 } } };
      out.push(p ? { found: { name: `projects/${P}/databases/(default)/documents/users/u1/data/push`, fields: fieldsOf(p), updateTime: '2026-11-15T08:00:00.123456Z' } } : { missing: 'x' });
      return { code: 200, body: out };
    }
    if (req.url.includes('fcm.googleapis.com')) {
      const body = JSON.parse(String(req.payload));
      fcmSent.push({ at: clock, body });
      return opts.fcm ? opts.fcm(body) : { code: 200, body: { name: 'm' } };
    }
    if (req.method === 'patch') {
      patches.push({ url: req.url, body: JSON.parse(String(req.payload)) });
      return { code: 200, body: {} };
    }
    return { code: 404, body: { error: 'no route' } };
  };
  const answer = (req: GasRequest): GasResponse => {
    requests.push(req);
    const r = route(req);
    return { getResponseCode: () => r.code, getContentText: () => JSON.stringify(r.body) };
  };
  const host: GasHost = {
    UrlFetchApp: {
      fetch: (url, params) => answer({ url, ...params }),
      fetchAll: (reqs) => {
        if (opts.fetchAllThrows?.()) throw new Error('Address unavailable');
        return reqs.map(answer);
      },
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props.get(k) ?? null, setProperty: (k, v) => props.set(k, v) }) },
    CacheService: { getScriptCache: () => ({ get: (k) => cache.get(k) ?? null, put: (k, v) => void cache.set(k, v), remove: (k) => void cache.delete(k) }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => undefined }) },
    Utilities: {
      computeRsaSha256Signature: () => [1, 2, 3],
      base64EncodeWebSafe: (d) => `${Buffer.from(typeof d === 'string' ? d : Uint8Array.from(d)).toString('base64url')}==`,
      sleep: (ms) => { clock += ms; },
    },
    ScriptApp: {
      getProjectTriggers: () => [...triggers],
      deleteTrigger: (t) => { triggers.splice(triggers.indexOf(t as never), 1); },
      newTrigger: (name) => ({ timeBased: () => ({ everyMinutes: () => ({ create: () => { created.push(name); return {}; } }) }) }),
    },
    Session: { getScriptTimeZone: () => opts.tz ?? 'Asia/Seoul' },
    Logger: { log: (m) => void logs.push(m) },
    now: () => clock,
  };
  return { host, props, cache, requests, logs, triggers, created, fcmSent, patches, advance: (ms: number) => { clock += ms; }, clock: () => clock };
}

const at = (h: number, m: number, s = 0) => new Date(2026, 10, 15, h, m, s);

describe('setup', () => {
  it('키가 없으면 넣는 곳을 알리고 트리거를 걸지 않는다', () => {
    const f = makeHost({ start: at(17, 0), key: null });
    const lines = setup(f.host);
    expect(lines.join('\n')).toContain('스크립트 속성 SERVICE_ACCOUNT가 없습니다');
    expect(f.created).toEqual([]);
  });

  it('시간대가 서울이 아니면 고치라고 한다', () => {
    const f = makeHost({ start: at(17, 0), tz: 'America/New_York' });
    expect(setup(f.host).join('\n')).toContain('(GMT+09:00) 서울');
    expect(f.created).toEqual([]);
  });

  it('로그인하고 읽고 FCM 권한을 본 뒤 옛 트리거를 지우고 1분 트리거를 하나 건다', () => {
    const f = makeHost({ start: at(17, 0), fcm: () => ({ code: 400, body: { error: { status: 'INVALID_ARGUMENT', message: 'The registration token is not a valid FCM registration token' } } }) });
    const lines = setup(f.host);
    expect(lines.at(-1)).toContain('설정이 끝났습니다');
    expect(lines.join('\n')).toContain('알림을 받는 기기: 1대');
    expect(f.created).toEqual(['tick']);
    expect(f.triggers.map((t) => t.getHandlerFunction())).toEqual(['other']);
    const token = f.requests.find((r) => r.url === 'https://oauth2.example.test/token')!;
    const assertion = (token.payload as { assertion: string }).assertion;
    expect(assertion.split('.')).toHaveLength(3);
    expect(assertion).not.toContain('=');
    const claims = JSON.parse(Buffer.from(assertion.split('.')[1], 'base64url').toString());
    expect(claims).toMatchObject({ iss: 'sender@example.test', aud: 'https://oauth2.example.test/token' });
    expect(claims.scope).toContain('firebase.messaging');
    expect(f.fcmSent[0].body).toMatchObject({ validate_only: true });
  });

  it('FCM이 권한 없음으로 답하면 설정하지 못했다고 한다', () => {
    const f = makeHost({ start: at(17, 0), fcm: () => ({ code: 403, body: { error: { status: 'PERMISSION_DENIED', message: 'API has not been used' } } }) });
    expect(setup(f.host).at(-1)).toContain('설정하지 못했습니다: FCM으로 보낼 수 없습니다');
    expect(f.created).toEqual([]);
  });
});

describe('tick', () => {
  it('1분 안에 울릴 알림은 그 시각까지 기다렸다 보내고, 다음 실행은 같은 것을 다시 보내지 않는다', () => {
    const f = makeHost({ start: at(17, 47, 30), events: () => ({ a: alarm() }) });
    const r = tick(f.host);
    expect(r.sent).toBe(1);
    expect(f.fcmSent).toHaveLength(1);
    expect(f.fcmSent[0].at).toBe(at(17, 48).getTime());
    expect(f.fcmSent[0].body).toEqual({ message: { token: 'tok1', webpush: { headers: { Urgency: 'high', TTL: '1800' }, data: { title: '회의', body: '17:48 알림', url: '/#2026-11-15', tag: 'calfif:a@2026-11-15@0' } } } });
    // 상태를 적는다(처음이라).
    expect(f.patches).toHaveLength(1);
    expect(f.patches[0].url).toContain('updateMask.fieldPaths=sender');
    expect(f.patches[0].url).toContain('currentDocument.exists=true');
    f.advance(30_000);
    tick(f.host);
    expect(f.fcmSent).toHaveLength(1);
    // 토큰은 캐시에서 쓴다.
    expect(f.requests.filter((q) => q.url === 'https://oauth2.example.test/token')).toHaveLength(1);
  });

  it('울릴 시각 바로 앞에 만든 알림도 다음 실행이 곧바로 보낸다', () => {
    let items: Record<string, AlarmRecord> = {};
    const f = makeHost({ start: at(17, 47, 5), events: () => items });
    tick(f.host);
    expect(f.fcmSent).toHaveLength(0);
    items = { late: alarm() }; // 17:47:20에 17:48 알림을 만들었다
    f.advance(60_000); // 17:48:05
    tick(f.host);
    expect(f.fcmSent).toHaveLength(1);
    expect(f.fcmSent[0].at).toBe(at(17, 48, 5).getTime());
  });

  it('시각을 고친 알림은 새 시각에 다시 보낸다', () => {
    let items: Record<string, AlarmRecord> = { a: alarm() };
    const f = makeHost({ start: at(17, 47, 30), events: () => items });
    tick(f.host);
    items = { a: alarm({ time: '17:50' }) };
    f.advance(90_000); // 17:49:30
    tick(f.host);
    expect(f.fcmSent.map((s) => s.at)).toEqual([at(17, 48).getTime(), at(17, 50).getTime()]);
  });

  it('쓸 수 없게 된 토큰의 기기는 읽은 뒤 문서가 바뀌지 않았을 때만 지우고, 그다음 상태를 적는다', () => {
    const f = makeHost({ start: at(17, 47, 59), events: () => ({ a: alarm() }), fcm: () => ({ code: 404, body: { error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } } }) });
    tick(f.host);
    expect(f.patches[0].url).toContain(`updateMask.fieldPaths=devices.${D1}`);
    expect(f.patches[0].url).toContain(`currentDocument.updateTime=${encodeURIComponent('2026-11-15T08:00:00.123456Z')}`);
    expect(f.patches[0].body).toEqual({ fields: {} });
    expect(f.patches[1].url).toContain('updateMask.fieldPaths=sender');
  });

  it('숫자로 시작하는 기기 이름은 필드 경로에서 백틱으로 감싼다', () => {
    const digit = '9AAAAAAAAAAAAAAAAAAA';
    const f = makeHost({ start: at(17, 47, 59), events: () => ({ a: alarm() }), push: () => ({ devices: { [digit]: { token: 'tok1', label: '', at: 1 } } }), fcm: () => ({ code: 404, body: {} }) });
    tick(f.host);
    expect(f.patches[0].url).toContain(`updateMask.fieldPaths=${encodeURIComponent('devices.`9AAAAAAAAAAAAAAAAAAA`')}`);
    expect(fieldSegment('abc_1')).toBe('abc_1');
    expect(fieldSegment('9a')).toBe('`9a`');
  });

  it('30초보다 뒤에 울릴 것은 다음 실행에 맡긴다(기다리는 시간을 줄인다)', () => {
    const f = makeHost({ start: at(17, 47, 10), events: () => ({ a: alarm() }) });
    tick(f.host);
    expect(f.fcmSent).toHaveLength(0);
    expect(f.clock()).toBe(at(17, 47, 10).getTime()); // 기다리지 않았다
    f.advance(30_000); // 17:47:40
    tick(f.host);
    expect(f.fcmSent.map((s) => s.at)).toEqual([at(17, 48).getTime()]);
  });

  it('보내다 던지면(연결 끊김) 문제를 적고 풀어서 다음 실행이 다시 보낸다', () => {
    let fail = true;
    const f = makeHost({ start: at(17, 47, 59), events: () => ({ a: alarm() }), fetchAllThrows: () => fail });
    tick(f.host);
    expect(f.fcmSent).toHaveLength(0);
    expect(JSON.stringify(f.patches.at(-1)!.body)).toContain('Address unavailable');
    fail = false;
    f.advance(60_000);
    tick(f.host);
    expect(f.fcmSent).toHaveLength(1);
  });

  it('실행이 도중에 죽어 맡음으로 남은 것은 3분 뒤에 다시 보낸다', () => {
    const f = makeHost({ start: at(17, 48, 30), events: () => ({ a: alarm() }) });
    // 1분 전에 맡고 끝내지 못한 기록(울릴 때 17:48)
    const key = `u1|${D1.slice(0, 8)}|calfif:a@2026-11-15@0|${Math.round(at(17, 48).getTime() / 1000).toString(36)}`;
    f.props.set('sent', JSON.stringify({ [key]: { a: at(17, 48).getTime(), c: at(17, 47, 30).getTime(), d: 0 } }));
    tick(f.host);
    expect(f.fcmSent).toHaveLength(0); // 아직 다른 실행이 맡고 있을 수 있다
    f.advance(150_000); // 17:51:00, 맡은 지 3분 30초
    tick(f.host);
    expect(f.fcmSent).toHaveLength(1);
    expect(JSON.parse(f.props.get('sent')!)[key]).toMatchObject({ d: 1 });
  });

  it('토큰이 거절되면(401) 캐시에서 지운다', () => {
    const f = makeHost({ start: at(17, 47, 59), events: () => ({ a: alarm() }), fcm: () => ({ code: 401, body: { error: { status: 'UNAUTHENTICATED' } } }) });
    tick(f.host);
    expect(f.cache.has('calfif.token')).toBe(false);
  });

  it('보내지 못하면 문제를 적고 다음 실행이 다시 보낸다', () => {
    let fail = true;
    const f = makeHost({ start: at(17, 47, 59), events: () => ({ a: alarm() }), fcm: () => (fail ? { code: 500, body: { error: { status: 'INTERNAL' } } } : { code: 200, body: {} }) });
    tick(f.host);
    expect(JSON.stringify(f.patches[0].body)).toContain('FCM 500');
    fail = false;
    f.advance(60_000);
    tick(f.host);
    expect(f.fcmSent).toHaveLength(2);
    expect(JSON.stringify(f.patches.at(-1)!.body)).toContain('"error":{"stringValue":""}');
  });

  it('시험 요청을 보내고 처리한 때를 적는다', () => {
    const now = at(18, 0).getTime();
    const f = makeHost({ start: at(18, 0), push: () => ({ devices: { [D1]: { token: 'tok1', label: '', at: 1 } }, testAt: now - 3_000 }) });
    tick(f.host);
    expect(f.fcmSent).toHaveLength(1);
    expect(JSON.stringify(f.fcmSent[0].body)).toContain('CalendarFIF 시험 알림');
    expect(JSON.stringify(f.patches[0].body)).toContain(`"testAt":{"integerValue":"${now - 3_000}"}`);
  });

  it('푸시 문서가 없거나 기기가 없으면 보내지도 적지도 않는다', () => {
    const f = makeHost({ start: at(17, 47, 59), events: () => ({ a: alarm() }), push: () => null });
    tick(f.host);
    expect(f.fcmSent).toEqual([]);
    expect(f.patches).toEqual([]);
  });

  it('최근에 확인을 적었고 바뀐 것이 없으면 다시 적지 않는다', () => {
    const now = at(18, 0).getTime();
    const f = makeHost({ start: at(18, 0), push: () => ({ devices: { [D1]: { token: 'tok1', label: '', at: 1 } }, sender: { at: now - 60_000, testAt: 0, error: '' } }) });
    tick(f.host);
    expect(f.patches).toEqual([]);
  });

  it('시간대가 틀리면 보내지 않고 던진다', () => {
    const f = makeHost({ start: at(17, 47, 59), tz: 'UTC', events: () => ({ a: alarm() }) });
    expect(() => tick(f.host)).toThrow('(GMT+09:00) 서울');
    expect(f.fcmSent).toEqual([]);
  });
});

describe('writeSent', () => {
  it('한도를 넘으면 끝낸 것 가운데 이른 것부터 버린다', () => {
    const f = makeHost({ start: at(17, 0) });
    const sent = new Map<string, { a: number; c: number; d: 0 | 1 }>();
    for (let i = 0; i < 200; i += 1) sent.set(`key-${String(i).padStart(4, '0')}-${'x'.repeat(40)}`, { a: i, c: i, d: i % 2 === 0 ? 1 : 0 });
    writeSent(f.host, sent);
    const kept = JSON.parse(f.props.get('sent')!) as Record<string, { a: number; d: number }>;
    expect(JSON.stringify(kept).length).toBeLessThanOrEqual(8_500);
    expect(Object.values(kept).filter((v) => v.d === 0)).toHaveLength(100); // 맡은 것은 남긴다
    expect(Math.min(...Object.values(kept).filter((v) => v.d === 1).map((v) => v.a))).toBeGreaterThan(0);
  });
});

describe('classify', () => {
  it('FCM 답을 가른다', () => {
    expect(classify(200, '{}')).toBe('ok');
    expect(classify(404, '{"error":{"status":"NOT_FOUND"}}')).toBe('dead');
    expect(classify(400, 'The registration token is not a valid FCM registration token')).toBe('dead');
    expect(classify(403, 'SENDER_ID_MISMATCH')).toBe('dead');
    expect(classify(403, 'PERMISSION_DENIED')).toBe('auth');
    expect(classify(401, 'UNAUTHENTICATED')).toBe('auth');
    expect(classify(500, 'INTERNAL')).toBe('error');
  });
});
