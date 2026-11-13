import { beforeAll, describe, expect, it } from 'vitest';
import { readMonth, refreshSession, signIn, type ApiError, type Config } from '../../src/widget/api';
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

  it('틀린 비밀번호는 credentials', async () => {
    expect((await failure(signIn(host, cfg, account.email, 'wrong-password'))).kind).toBe('credentials');
  });

  it('엉터리 갱신 토큰은 rejected', async () => {
    expect((await failure(refreshSession(host, cfg, 'junk-token'))).kind).toBe('rejected');
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
