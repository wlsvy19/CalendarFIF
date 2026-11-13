import { describe, expect, it } from 'vitest';
import type { Config } from './api';
import { drawnTexts, makeFakeHost, widgetRecord, type FakeAnswer, type FakeHost, type FakeOptions, type FakeRequest } from './fakeHost';
import { run } from './main';

const cfg: Config = { projectId: 'demo-calfif', apiKey: 'demo-key', appUrl: 'https://example.test/' };
const now = () => new Date(2026, 10, 13, 9, 0, 0);
const REFRESH = 'calendarfif.refreshToken';
const UID = 'calendarfif.uid';
const CACHE = '/docs/calendarfif-cache.json';

const memoDoc = { fields: { days: { mapValue: { fields: { '13': { mapValue: { fields: { text: { stringValue: '리뷰' }, color: { stringValue: 'F9BC0B' } } } } } } } } };
const err = (status: number, message: string): FakeAnswer => ({ status, body: { error: { message } } });

type Backend = { signIn?: (req: FakeRequest) => FakeAnswer; refresh?: (req: FakeRequest) => FakeAnswer; read?: (req: FakeRequest) => FakeAnswer };
function backend(b: Backend = {}): (req: FakeRequest) => FakeAnswer {
  return (req) => {
    if (req.url.includes('accounts:signInWithPassword')) return (b.signIn ?? (() => ({ body: { idToken: 'ID', refreshToken: 'RT1', localId: 'owner-test-uid' } })))(req);
    if (req.url.includes('/v1/token')) return (b.refresh ?? (() => ({ body: { id_token: 'ID2', refresh_token: 'RT1', user_id: 'owner-test-uid' } })))(req);
    return (b.read ?? (() => ({ body: memoDoc })))(req);
  };
}
const make = (o: FakeOptions, b?: Backend): FakeHost => makeFakeHost({ handler: backend(b), ...o });
const loggedIn = { [REFRESH]: 'RT1', [UID]: 'owner-test-uid' };
const lastWidget = (h: FakeHost) => widgetRecord(h.state.setWidgets.at(-1));

describe('위젯으로 실행', () => {
  it('토큰이 없으면 요청 없이 로그인 안내 위젯', async () => {
    const host = make({});
    await run(host, cfg, now);
    expect(host.state.requests).toEqual([]);
    expect(host.state.setWidgets).toHaveLength(1);
    expect(drawnTexts(host)).toContain('로그인이 필요합니다');
    expect(lastWidget(host).props.url).toBe('https://example.test/');
  });

  it('토큰이 있으면 갱신하고, 읽고, 보관하고, 위젯을 둔다', async () => {
    const host = make({ keychain: loggedIn });
    await run(host, cfg, now);
    expect(host.state.requests.map((r) => r.method)).toEqual(['POST', 'GET']);
    expect(host.state.requests[1].url).toContain('/users/owner-test-uid/months/2026-11');
    expect(host.state.requests[1].headers.Authorization).toBe('Bearer ID2');
    expect(JSON.parse(host.state.files.get(CACHE)!)).toMatchObject({ monthId: '2026-11', days: { '13': { text: '리뷰', color: 'F9BC0B' } } });
    expect(host.state.setWidgets).toHaveLength(1);
    const texts = drawnTexts(host);
    expect(texts).toContain('리뷰');
    expect(texts).toContain('2026년 11월');
    expect(texts).not.toContain('오프라인');
  });

  it('돌려받은 새 갱신 토큰을 저장한다', async () => {
    const host = make({ keychain: loggedIn }, { refresh: () => ({ body: { id_token: 'ID2', refresh_token: 'RT-new', user_id: 'owner-test-uid' } }) });
    await run(host, cfg, now);
    expect(host.state.keychain.get(REFRESH)).toBe('RT-new');
  });

  it('연결이 안 되고 같은 달 보관본이 있으면 오프라인으로 그린다', async () => {
    const files = { [CACHE]: JSON.stringify({ monthId: '2026-11', days: { '13': { text: '보관', color: '' } }, savedAt: 1 }) };
    const host = make({ keychain: loggedIn, files }, { refresh: () => { throw new Error('offline'); } });
    await run(host, cfg, now);
    expect(drawnTexts(host)).toEqual(expect.arrayContaining(['보관', '오프라인']));
  });

  it('읽기에서 연결이 끊겨도 보관본을 쓴다', async () => {
    const files = { [CACHE]: JSON.stringify({ monthId: '2026-11', days: {}, savedAt: 1 }) };
    const host = make({ keychain: loggedIn, files }, { read: () => ({ status: 503, body: {} }) });
    await run(host, cfg, now);
    expect(drawnTexts(host)).toContain('오프라인');
  });

  it('연결이 안 되고 보관본이 없으면 불러오지 못했다는 안내', async () => {
    const host = make({ keychain: loggedIn }, { refresh: () => { throw new Error('offline'); } });
    await run(host, cfg, now);
    expect(drawnTexts(host)).toContain('불러오지 못했습니다');
  });

  it('다른 달의 보관본은 쓰지 않는다', async () => {
    const files = { [CACHE]: JSON.stringify({ monthId: '2026-10', days: { '13': { text: '지난달', color: '' } }, savedAt: 1 }) };
    const host = make({ keychain: loggedIn, files }, { refresh: () => { throw new Error('offline'); } });
    await run(host, cfg, now);
    expect(drawnTexts(host)).toContain('불러오지 못했습니다');
    expect(drawnTexts(host)).not.toContain('지난달');
  });

  it('깨진 보관본은 없는 것으로 본다', async () => {
    const host = make({ keychain: loggedIn, files: { [CACHE]: '{not json' } }, { refresh: () => { throw new Error('offline'); } });
    await run(host, cfg, now);
    expect(drawnTexts(host)).toContain('불러오지 못했습니다');
  });

  it('갱신이 거절되면 로그인 정보를 지우고 로그인 안내', async () => {
    const host = make({ keychain: loggedIn }, { refresh: () => err(400, 'TOKEN_EXPIRED') });
    await run(host, cfg, now);
    expect(host.state.keychain.size).toBe(0);
    expect(drawnTexts(host)).toContain('로그인이 필요합니다');
  });

  it('읽기가 거절되어도(401) 마찬가지', async () => {
    const host = make({ keychain: loggedIn }, { read: () => err(401, 'UNAUTHENTICATED') });
    await run(host, cfg, now);
    expect(host.state.keychain.size).toBe(0);
    expect(drawnTexts(host)).toContain('로그인이 필요합니다');
  });

  it('읽기 권한이 없으면(403) 권한 안내, 로그인 정보는 그대로', async () => {
    const host = make({ keychain: loggedIn }, { read: () => err(403, 'PERMISSION_DENIED') });
    await run(host, cfg, now);
    expect(drawnTexts(host)).toContain('권한이 없습니다');
    expect(host.state.keychain.size).toBe(2);
  });

  it('그리다가 예외가 나도 오류 위젯은 둔다', async () => {
    const host = make({ keychain: loggedIn, failDrawing: 1 });
    await run(host, cfg, now);
    expect(host.state.setWidgets).toHaveLength(1);
    expect(drawnTexts(host)).toContain('오류');
    expect(drawnTexts(host)).toContain('그리기 시험 오류');
  });

  it('오류 메시지는 28자씩 3줄까지만 쓴다', async () => {
    const host = make({ keychain: loggedIn });
    host.Keychain.get = () => { throw new Error('나'.repeat(120)); };
    await run(host, cfg, now);
    // 28자 3줄 = 84자만 남고(장면이 폭에 맞춰 다시 나눈다) 나머지는 버린다.
    const lines = drawnTexts(host).filter((t) => t.startsWith('나'));
    expect(lines.join('')).toBe('나'.repeat(84));
  });
});

describe('위젯 크기와 색', () => {
  const sizeOf = (h: FakeHost) => h.state.contexts[0].size;

  it('medium은 가로로 긴 위젯', async () => {
    const host = make({ keychain: loggedIn, widgetFamily: 'medium' });
    await run(host, cfg, now);
    expect(sizeOf(host)).toEqual({ width: 338, height: 158 });
  });

  it('small은 정사각형', async () => {
    const host = make({ keychain: loggedIn, widgetFamily: 'small' });
    await run(host, cfg, now);
    expect(sizeOf(host)).toEqual({ width: 158, height: 158 });
  });

  it('모르는 종류와 null은 large', async () => {
    for (const widgetFamily of ['extraLarge', null, 'accessoryCircular']) {
      const host = make({ keychain: loggedIn, widgetFamily });
      await run(host, cfg, now);
      expect(sizeOf(host)).toEqual({ width: 338, height: 354 });
    }
  });

  it('위젯 매개변수가 기기 설정보다 먼저다', async () => {
    const dark = make({ keychain: loggedIn, widgetParameter: ' Dark ', dark: false });
    await run(dark, cfg, now);
    expect(dark.state.contexts[0].calls[0]).toEqual(['setFillColor', { hex: '#161B22', alpha: 1 }]);
    const light = make({ keychain: loggedIn, widgetParameter: 'LIGHT', dark: true });
    await run(light, cfg, now);
    expect(light.state.contexts[0].calls[0]).toEqual(['setFillColor', { hex: '#FFFFFF', alpha: 1 }]);
  });

  it('매개변수가 없거나 이상하면 기기 설정을 따른다', async () => {
    const a = make({ keychain: loggedIn, widgetParameter: 'blue', dark: true });
    await run(a, cfg, now);
    expect(a.state.contexts[0].calls[0]).toEqual(['setFillColor', { hex: '#161B22', alpha: 1 }]);
    const b = make({ keychain: loggedIn, dark: false });
    await run(b, cfg, now);
    expect(b.state.contexts[0].calls[0]).toEqual(['setFillColor', { hex: '#FFFFFF', alpha: 1 }]);
  });
});

describe('앱에서 실행', () => {
  it('잘못된 비밀번호 알림 뒤 다시 물어 로그인하고 큰 위젯을 보여 준다', async () => {
    let attempts = 0;
    const host = make(
      {
        runsInApp: true,
        alerts: [
          { button: 0, fields: ['test@example.com', 'wrong'] },
          { button: 0 }, // 실패 알림의 확인
          { button: 0, fields: ['test@example.com', 'right'] },
        ],
      },
      { signIn: () => (++attempts === 1 ? err(400, 'INVALID_PASSWORD') : { body: { idToken: 'ID', refreshToken: 'RT1', localId: 'owner-test-uid' } }) },
    );
    await run(host, cfg, now);
    expect(host.state.alerts[0]).toMatchObject({
      title: '로그인',
      message: 'CalendarFIF에 쓰는 이메일과 비밀번호를 넣으세요. 비밀번호는 저장하지 않습니다.',
      fields: [{ kind: 'text', placeholder: '이메일', text: '' }, { kind: 'secure', placeholder: '비밀번호', text: '' }],
      actions: ['로그인'],
      cancel: '취소',
    });
    expect(host.state.alerts[1]).toMatchObject({ message: '이메일 또는 비밀번호가 맞지 않습니다.', actions: ['확인'] });
    expect(host.state.alerts[2].fields[0].text).toBe('test@example.com');
    expect(host.state.keychain.get(REFRESH)).toBe('RT1');
    expect(host.state.keychain.get(UID)).toBe('owner-test-uid');
    expect(host.state.widgets.at(-1)!.presented).toBe('large');
    expect(drawnTexts(host)).toContain('리뷰');
    expect(host.state.requests.filter((r) => r.body.startsWith('{')).map((r) => (JSON.parse(r.body) as { password: string }).password)).toEqual(['wrong', 'right']);
    expect(JSON.stringify([...host.state.keychain, ...host.state.files])).not.toContain('right');
  });

  it('로그인을 취소하면 아무것도 하지 않는다', async () => {
    const host = make({ runsInApp: true, alerts: [{ button: -1 }] });
    await run(host, cfg, now);
    expect(host.state.requests).toEqual([]);
    expect(host.state.widgets).toEqual([]);
    expect(host.state.keychain.size).toBe(0);
  });

  it.each([
    ['throttled', err(400, 'TOO_MANY_ATTEMPTS_TRY_LATER'), '시도가 너무 많습니다. 잠시 뒤 다시 해 주세요.'],
    ['rejected', err(400, 'API_KEY_INVALID'), '로그인하지 못했습니다. (API_KEY_INVALID)'],
    ['network', { status: 503, body: {} }, '네트워크에 연결할 수 없습니다.'],
  ])('로그인 실패 %s의 문구', async (_name, answer, text) => {
    const host = make({ runsInApp: true, alerts: [{ button: 0, fields: ['a@example.com', 'p'] }, { button: 0 }, { button: -1 }] }, { signIn: () => answer });
    await run(host, cfg, now);
    expect(host.state.alerts[1].message).toBe(text);
  });

  it('토큰이 있으면 메뉴를 보이고 미리 보기는 큰 위젯', async () => {
    const host = make({ runsInApp: true, keychain: loggedIn, alerts: [{ button: 0 }], widgetFamily: 'small' });
    await run(host, cfg, now);
    expect(host.state.alerts[0]).toMatchObject({ title: 'CalendarFIF 위젯', actions: ['미리 보기', '로그아웃'], cancel: '닫기' });
    expect(host.state.widgets.at(-1)!.presented).toBe('large');
    expect(host.state.contexts[0].size).toEqual({ width: 338, height: 354 });
  });

  it('닫기는 아무것도 하지 않는다', async () => {
    const host = make({ runsInApp: true, keychain: loggedIn, alerts: [{ button: -1 }] });
    await run(host, cfg, now);
    expect(host.state.requests).toEqual([]);
    expect(host.state.keychain.size).toBe(2);
  });

  it('로그아웃은 키체인과 보관 파일을 지운다', async () => {
    const host = make({ runsInApp: true, keychain: loggedIn, files: { [CACHE]: '{}' }, alerts: [{ button: 1 }, { button: 0 }] });
    await run(host, cfg, now);
    expect(host.state.keychain.size).toBe(0);
    expect(host.state.files.has(CACHE)).toBe(false);
    expect(host.state.alerts[1].message).toBe('로그아웃했습니다.');
    expect(host.state.requests).toEqual([]);
  });

  it('앱에서 그리다 예외가 나도 오류 화면을 보여 준다', async () => {
    const host = make({ runsInApp: true, keychain: loggedIn, alerts: [{ button: 0 }], failDrawing: 1 });
    await run(host, cfg, now);
    expect(host.state.widgets.at(-1)!.presented).toBe('large');
    expect(drawnTexts(host)).toContain('오류');
  });
});
