import { beforeAll, describe, expect, it } from 'vitest';
import { readEvents, readMonth, refreshSession, signIn, type ApiError, type Config } from '../../src/widget/api';
import { drawnTexts, makeFakeHost, nativeTexts, type FakeHost } from '../../src/widget/fakeHost';
import { run } from '../../src/widget/main';
import { OWNER } from './env';

// 에뮬레이터 주소: Firebase CLI가 정한 환경 변수, 없으면 기본 포트.
const FIRESTORE = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8085';
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9095';
const cfg: Config = {
  projectId: 'demo-calfif',
  apiKey: 'demo-key',
  appUrl: 'https://example.test/',
  authBase: `http://${AUTH}/identitytoolkit.googleapis.com`,
  tokenBase: `http://${AUTH}/securetoken.googleapis.com`,
  firestoreBase: `http://${FIRESTORE}`,
};
const account = { localId: OWNER, email: 'test@example.com', password: 'test-password' };
const owner = { 'content-type': 'application/json', authorization: 'Bearer owner' };

const now = new Date();
const monthId = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
const emptyMonthId = '2031-01';

beforeAll(async () => {
  const created = await fetch(`${cfg.authBase}/v1/projects/demo-calfif/accounts`, { method: 'POST', headers: owner, body: JSON.stringify(account) });
  if (!created.ok) {
    const body = (await created.json().catch(() => ({}))) as { error?: { message?: string } };
    if (!/EMAIL_EXISTS|DUPLICATE_LOCAL_ID/.test(body.error?.message ?? '')) throw new Error(`계정을 만들지 못했다: ${created.status}`);
  }
  const fields = {
    days: { mapValue: { fields: {
      '13': { mapValue: { fields: { text: { stringValue: '리뷰' }, color: { stringValue: 'F9BC0B' }, editedAt: { integerValue: '1' }, editedBy: { stringValue: 'import' } } } },
      '14': { mapValue: { fields: { text: { stringValue: '장보기' }, color: { stringValue: '' }, editedAt: { integerValue: '1' }, editedBy: { stringValue: 'import' } } } },
    } } },
  };
  const events = { items: { mapValue: { fields: { abc123: { mapValue: { fields: {
    type: { stringValue: 'alarm' }, date: { stringValue: '2031-02-03' }, text: { stringValue: '시험 알림' }, time: { stringValue: '09:30' },
    advance: { arrayValue: { values: [{ integerValue: '0' }] } }, done: { booleanValue: false },
  } } } } } } };
  const putEvents = await fetch(`${cfg.firestoreBase}/v1/projects/demo-calfif/databases/(default)/documents/users/${OWNER}/data/events`, { method: 'PATCH', headers: owner, body: JSON.stringify({ fields: events }) });
  if (!putEvents.ok) throw new Error(`알림을 쓰지 못했다: ${putEvents.status}`);
  const put = await fetch(`${cfg.firestoreBase}/v1/projects/demo-calfif/databases/(default)/documents/users/${OWNER}/months/${monthId}`, { method: 'PATCH', headers: owner, body: JSON.stringify({ fields }) });
  if (!put.ok) throw new Error(`메모를 쓰지 못했다: ${put.status}`);
});

const failure = async (p: Promise<unknown>): Promise<ApiError> => {
  try {
    await p;
  } catch (e) {
    return e as ApiError;
  }
  throw new Error('오류가 나야 한다');
};

describe('위젯의 REST 호출 (에뮬레이터)', () => {
  const host = makeFakeHost();

  it('로그인하면 시험 계정의 uid를 받는다', async () => {
    const s = await signIn(host, cfg, account.email, account.password);
    expect(s.uid).toBe(OWNER);
    expect(s.idToken).not.toBe('');
  });

  it('갱신 토큰으로 새 세션을 받고, 그 달을 읽는다', async () => {
    const first = await signIn(host, cfg, account.email, account.password);
    const s = await refreshSession(host, cfg, first.refreshToken);
    expect(s.uid).toBe(OWNER);
    expect(await readMonth(host, cfg, s, monthId)).toEqual({ '13': { text: '리뷰', color: 'F9BC0B' }, '14': { text: '장보기', color: '' } });
  });

  it('문서가 없는 달은 빈 객체', async () => {
    const s = await signIn(host, cfg, account.email, account.password);
    expect(await readMonth(host, cfg, s, emptyMonthId)).toEqual({});
  });

  it('알림 문서를 읽는다', async () => {
    const s = await signIn(host, cfg, account.email, account.password);
    const items = await readEvents(host, cfg, s);
    expect(items.abc123).toMatchObject({ type: 'alarm', date: '2031-02-03', text: '시험 알림', time: '09:30', advance: [0] });
  });

  it('틀린 비밀번호는 credentials', async () => {
    expect((await failure(signIn(host, cfg, account.email, 'wrong-password'))).kind).toBe('credentials');
  });

  it('엉터리 갱신 토큰은 rejected', async () => {
    expect((await failure(refreshSession(host, cfg, 'junk-token'))).kind).toBe('rejected');
  });
});

describe('사용 허가와 위젯 (에뮬레이터, 실제 규칙)', () => {
  // 지어낸 계정 둘: 관리자가 추가한 사용자, 사용 허가 문서가 없는 사용자.
  const member = { localId: 'widget-member-uid', email: 'widget-member@example.com', password: 'member-password' };
  const stranger = { localId: 'widget-stranger-uid', email: 'widget-stranger@example.com', password: 'stranger-password' };
  const docs = `${cfg.firestoreBase}/v1/projects/demo-calfif/databases/(default)/documents`;
  const REFRESH = 'calendarfif.refreshToken';

  /** 관리자 우회(Bearer owner)로 사용 허가 문서를 쓴다. */
  const setAccess = async (acc: typeof member, disabled: boolean): Promise<void> => {
    const fields = { email: { stringValue: acc.email }, role: { stringValue: 'user' }, disabled: { booleanValue: disabled }, createdAt: { integerValue: '1700000000000' } };
    const res = await fetch(`${docs}/access/${acc.localId}`, { method: 'PATCH', headers: owner, body: JSON.stringify({ fields }) });
    if (!res.ok) throw new Error(`사용 허가를 쓰지 못했다: ${res.status}`);
  };
  const loginInApp = async (acc: typeof member): Promise<FakeHost> => {
    const app = makeFakeHost({ runsInApp: true, alerts: [{ button: 0, fields: [acc.email, acc.password] }] });
    await run(app, cfg, () => now);
    return app;
  };
  const shown = (h: FakeHost): string[] => {
    const rec = h.state.widgets.find((w) => w.presented !== null);
    expect(rec).toBeDefined();
    return nativeTexts(h);
  };

  beforeAll(async () => {
    for (const acc of [member, stranger]) {
      const created = await fetch(`${cfg.authBase}/v1/projects/demo-calfif/accounts`, { method: 'POST', headers: owner, body: JSON.stringify(acc) });
      if (!created.ok) {
        const body = (await created.json().catch(() => ({}))) as { error?: { message?: string } };
        if (!/EMAIL_EXISTS|DUPLICATE_LOCAL_ID/.test(body.error?.message ?? '')) throw new Error(`계정을 만들지 못했다: ${created.status}`);
      }
    }
    const days = { mapValue: { fields: { '20': { mapValue: { fields: { text: { stringValue: '회원 메모' }, color: { stringValue: '' }, editedAt: { integerValue: '1' }, editedBy: { stringValue: 'web' } } } } } } };
    const put = await fetch(`${docs}/users/${member.localId}/months/${monthId}`, { method: 'PATCH', headers: owner, body: JSON.stringify({ fields: { days } }) });
    if (!put.ok) throw new Error(`메모를 쓰지 못했다: ${put.status}`);
    await setAccess(member, false);
    const gone = await fetch(`${docs}/access/${stranger.localId}`, { method: 'DELETE', headers: owner });
    if (!gone.ok) throw new Error(`사용 허가를 지우지 못했다: ${gone.status}`);
  });

  it('관리자가 추가한 계정은 위젯으로 로그인해 자기 달을 보고, 사용 중지되면 권한 안내(로그인은 남는다)', async () => {
    const app = await loginInApp(member);
    expect(app.state.keychain.get('calendarfif.uid')).toBe(member.localId);
    expect(shown(app)).toContain('회원 메모');
    expect(shown(app)).not.toContain('리뷰'); // 관리자의 메모가 아니다

    await setAccess(member, true);
    try {
      const widget = makeFakeHost({ keychain: Object.fromEntries(app.state.keychain), files: Object.fromEntries(app.state.files) });
      await run(widget, cfg, () => now);
      expect(widget.state.setWidgets).toHaveLength(1);
      expect(nativeTexts(widget)).toEqual(['권한이 없습니다', '관리자에게 문의하세요.']);
      expect(widget.state.keychain.has(REFRESH)).toBe(true);
    } finally {
      await setAccess(member, false);
    }
  });

  it('사용 허가 문서가 없는 계정도 로그인은 되고 권한 안내를 본다(로그인은 남는다)', async () => {
    const app = await loginInApp(stranger);
    expect(shown(app)).toEqual(['권한이 없습니다', '관리자에게 문의하세요.']);
    expect(app.state.keychain.has(REFRESH)).toBe(true);

    const widget = makeFakeHost({ keychain: Object.fromEntries(app.state.keychain) });
    await run(widget, cfg, () => now);
    expect(nativeTexts(widget)).toEqual(['권한이 없습니다', '관리자에게 문의하세요.']);
    expect(widget.state.keychain.has(REFRESH)).toBe(true);
  });
});

describe.each([['기본 부품 위젯', null], ['그림 위젯(매개변수 image)', 'image']])('run 전체 (에뮬레이터), %s', (_name, widgetParameter) => {
  const drawn = (h: FakeHost): string[] => (widgetParameter === null ? nativeTexts(h) : drawnTexts(h));
  it('앱에서 로그인하고, 위젯으로 읽고, 연결이 끊기면 보관본을 오프라인으로 그린다', async () => {
    const app = makeFakeHost({ widgetParameter, runsInApp: true, alerts: [{ button: 0, fields: [account.email, account.password] }] });
    await run(app, cfg, () => now);
    expect(app.state.widgets.at(-1)!.presented).toBe('large');
    expect(drawn(app)).toContain('리뷰');

    const carry = (h: FakeHost) => ({ keychain: Object.fromEntries(h.state.keychain), files: Object.fromEntries(h.state.files) });
    const widget = makeFakeHost({ widgetParameter, ...carry(app) });
    await run(widget, cfg, () => now);
    expect(widget.state.alerts).toEqual([]);
    expect(widget.state.setWidgets).toHaveLength(1);
    expect(drawn(widget)).toContain('리뷰');
    expect(drawn(widget)).not.toContain('오프라인');

    const offline = makeFakeHost({ widgetParameter, ...carry(widget) });
    await run(offline, { ...cfg, firestoreBase: 'http://127.0.0.1:1' }, () => now);
    expect(drawn(offline)).toEqual(expect.arrayContaining(['리뷰', '오프라인']));
  });
});
