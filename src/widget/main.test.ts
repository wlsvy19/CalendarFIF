import { describe, expect, it } from 'vitest';
import type { Config } from './api';
import { drawnTexts, makeFakeHost, nativeTexts, widgetRecord, type FakeAnswer, type FakeNode, type FakeHost, type FakeOptions, type FakeRequest, type FakeWidgetRecord } from './fakeHost';
import { readCache, run } from './main';
import { PALETTES } from './theme';

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
// 기본 부품 위젯이 기본이다. 이 파일의 앞쪽 시험은 그림 위젯을 보므로 매개변수 image를 기본으로 준다.
const make = (o: FakeOptions, b?: Backend): FakeHost => makeFakeHost({ handler: backend(b), widgetParameter: 'image', ...o });
const makeNative = (o: FakeOptions, b?: Backend): FakeHost => makeFakeHost({ handler: backend(b), ...o });
const loggedIn = { [REFRESH]: 'RT1', [UID]: 'owner-test-uid' };
const lastWidget = (h: FakeHost) => widgetRecord(h.state.setWidgets.at(-1));
/** 위젯 하나에 놓인 글자(상자 안까지, 놓은 차례대로). */
const textsOf = (rec: FakeWidgetRecord): string[] => {
  const walk = (nodes: FakeNode[]): string[] => nodes.flatMap((n) => (n.kind === 'text' ? [n.text] : n.kind === 'stack' ? walk(n.children) : []));
  return walk(rec.children);
};
const shownInApp = (h: FakeHost): FakeWidgetRecord => h.state.widgets.find((w) => w.presented !== null)!;
/** 앱에서 보여 준 위젯의 크기들. 한 번만 보여 줘야 한다. */
const presented = (h: FakeHost) => h.state.widgets.filter((w) => w.presented !== null).map((w) => w.presented);

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

  it('오류 메시지는 28자씩 5줄까지만 쓴다', async () => {
    const host = make({ keychain: loggedIn });
    host.Keychain.get = () => { throw new Error('나'.repeat(200)); };
    await run(host, cfg, now);
    // 28자 5줄 = 140자만 남고(장면이 폭에 맞춰 다시 나눈다) 나머지는 버린다.
    const lines = drawnTexts(host).filter((t) => t.startsWith('나'));
    expect(lines.join('')).toBe('나'.repeat(140));
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
    const dark = make({ keychain: loggedIn, widgetParameter: ' image  Dark ', dark: false });
    await run(dark, cfg, now);
    expect(dark.state.contexts[0].calls[0]).toEqual(['setFillColor', { hex: '#161B22', alpha: 1 }]);
    const light = make({ keychain: loggedIn, widgetParameter: 'IMAGE,LIGHT', dark: true });
    await run(light, cfg, now);
    expect(light.state.contexts[0].calls[0]).toEqual(['setFillColor', { hex: '#FFFFFF', alpha: 1 }]);
  });

  it('매개변수가 없거나 이상하면 기기 설정을 따른다', async () => {
    const a = make({ keychain: loggedIn, widgetParameter: 'image blue', dark: true });
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
      fields: [{ kind: 'text', placeholder: '이메일', text: '', keyboard: 'email' }, { kind: 'secure', placeholder: '비밀번호', text: '' }],
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

  it('버전을 알면 메뉴 제목에 버전과 만든 날짜가 있다', async () => {
    const host = make({ runsInApp: true, keychain: loggedIn, alerts: [{ button: -1 }] });
    await run(host, { ...cfg, version: '0.4.0 (2026-11-14)' }, now);
    expect(host.state.alerts[0].title).toBe('CalendarFIF 위젯 0.4.0 (2026-11-14)');
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

describe('앱에서 미리 보기 중에 저장된 로그인이 거절되면', () => {
  const MENU = { button: 0 };
  const LOGIN = { button: 0, fields: ['test@example.com', 'pw'] };
  /** 처음 n번의 갱신은 거절하고 그 뒤는 받아 준다. */
  const rejectFirst = (n: number): Backend => {
    let calls = 0;
    return { refresh: () => (++calls <= n ? err(400, 'TOKEN_EXPIRED') : { body: { id_token: 'ID2', refresh_token: 'RT1', user_id: 'owner-test-uid' } }) };
  };

  it('안내 대신 바로 로그인을 묻고, 로그인하면 미리 보기를 보여 준다', async () => {
    const host = makeNative({ runsInApp: true, keychain: loggedIn, alerts: [MENU, LOGIN] }, rejectFirst(1));
    await run(host, cfg, now);
    expect(host.state.alerts.map((a) => a.title)).toEqual(['CalendarFIF 위젯', '로그인']);
    expect(host.state.keychain.get(REFRESH)).toBe('RT1');
    expect(presented(host)).toEqual(['large']);
    expect(textsOf(shownInApp(host))).toEqual(expect.arrayContaining(['2026년 11월', '리뷰']));
    expect(nativeTexts(host)).not.toContain('로그인이 필요합니다');
  });

  it('로그인을 취소하면 조용히 끝난다', async () => {
    const host = makeNative({ runsInApp: true, keychain: loggedIn, alerts: [MENU, { button: -1 }] }, rejectFirst(1));
    await expect(run(host, cfg, now)).resolves.toBeUndefined();
    expect(host.state.alerts).toHaveLength(2);
    expect(host.state.widgets).toEqual([]);
    expect(host.state.keychain.size).toBe(0);
  });

  it('다시 묻는 것은 한 번뿐이다: 새 로그인도 거절되면 안내를 보여 준다', async () => {
    const host = makeNative({ runsInApp: true, keychain: loggedIn, alerts: [MENU, LOGIN] }, rejectFirst(99));
    await run(host, cfg, now);
    expect(host.state.alerts.map((a) => a.title)).toEqual(['CalendarFIF 위젯', '로그인']);
    expect(presented(host)).toEqual(['large']);
    expect(textsOf(shownInApp(host))[0]).toBe('로그인이 필요합니다');
  });

  it('처음 로그인 뒤의 미리 보기가 거절돼도 한 번만 다시 묻는다', async () => {
    const host = makeNative({ runsInApp: true, alerts: [LOGIN, LOGIN] }, rejectFirst(99));
    await run(host, cfg, now);
    expect(host.state.alerts.map((a) => a.title)).toEqual(['로그인', '로그인']);
    expect(textsOf(shownInApp(host))[0]).toBe('로그인이 필요합니다');
  });

  it('위젯으로 실행할 때는 그대로 로그인 안내', async () => {
    const host = makeNative({ keychain: loggedIn }, rejectFirst(1));
    await run(host, cfg, now);
    expect(host.state.alerts).toEqual([]);
    expect(textsOf(lastWidget(host))[0]).toBe('로그인이 필요합니다');
  });
});

describe('로그인의 이메일 칸', () => {
  const LOGIN = { button: 0, fields: ['test@example.com', 'pw'] };

  it('이메일 키보드를 쓴다', async () => {
    const host = makeNative({ runsInApp: true, alerts: [LOGIN] });
    await run(host, cfg, now);
    expect(host.state.alerts[0].fields[0]).toMatchObject({ placeholder: '이메일', keyboard: 'email' });
  });

  it('오래된 Scriptable이 칸을 돌려주지 않거나 키보드 바꾸기가 던져도 로그인한다', async () => {
    for (const field of [undefined, {}, { setEmailAddressKeyboard: () => { throw new Error('키보드 시험 오류'); } }]) {
      const host = makeNative({ runsInApp: true, alerts: [LOGIN] });
      const Base = host.Alert;
      host.Alert = class extends Base {
        addTextField(placeholder: string, text?: string) {
          super.addTextField(placeholder, text);
          return field;
        }
      };
      await run(host, cfg, now);
      expect(host.state.keychain.get(REFRESH)).toBe('RT1');
      expect(presented(host)).toEqual(['large']);
      expect(textsOf(shownInApp(host))).toContain('리뷰');
    }
  });
});

describe('일시적인 거절은 로그아웃시키지 않는다', () => {
  it.each([408, 429])('갱신이 %i이면 network로 보고 로그인 정보는 그대로', async (status) => {
    const host = make({ keychain: loggedIn }, { refresh: () => err(status, 'X') });
    await run(host, cfg, now);
    expect(host.state.keychain.size).toBe(2);
    expect(drawnTexts(host)).toContain('불러오지 못했습니다');
  });

  it.each([408, 429])('읽기가 %i이면 보관본을 오프라인으로 그린다', async (status) => {
    const files = { [CACHE]: JSON.stringify({ monthId: '2026-11', days: {}, savedAt: 1 }) };
    const host = make({ keychain: loggedIn, files }, { read: () => err(status, 'X') });
    await run(host, cfg, now);
    expect(host.state.keychain.size).toBe(2);
    expect(drawnTexts(host)).toContain('오프라인');
  });

  it('갱신이 API 키 문제로 400이면 failed: 로그인 정보는 그대로, 보관본이 있으면 그것을 보인다', async () => {
    const files = { [CACHE]: JSON.stringify({ monthId: '2026-11', days: { '13': { text: '보관', color: '' } }, savedAt: 1 }) };
    const host = make({ keychain: loggedIn, files }, { refresh: () => err(400, 'API key not valid. Please pass a valid API key.') });
    await run(host, cfg, now);
    expect(host.state.keychain.size).toBe(2);
    expect(drawnTexts(host)).toEqual(expect.arrayContaining(['보관', '오프라인']));
  });

  it('보관본이 없으면 다시 시도한다는 안내와 40자까지의 코드', async () => {
    const host = make({ keychain: loggedIn }, { refresh: () => err(400, 'KEY_PROBLEM_' + 'X'.repeat(48)) });
    await run(host, cfg, now);
    expect(host.state.keychain.size).toBe(2);
    const texts = drawnTexts(host);
    expect(texts).toContain('불러오지 못했습니다');
    expect(texts).toContain('잠시 뒤 다시 시도합니다.');
    expect(texts.join('')).toContain('(KEY_PROBLEM_' + 'X'.repeat(28) + ')');
    expect(texts.join('')).not.toContain('X'.repeat(29));
  });

  it('읽기가 401이면 failed: 로그인 정보는 그대로', async () => {
    const host = make({ keychain: loggedIn }, { read: () => err(401, 'UNAUTHENTICATED') });
    await run(host, cfg, now);
    expect(host.state.keychain.size).toBe(2);
    expect(drawnTexts(host)).toContain('잠시 뒤 다시 시도합니다.');
  });
});

describe('마지막 수단', () => {
  it('그림 오류 위젯도 그리지 못하면 기본 부품으로 오류 내용을 보이고 던지지 않는다', async () => {
    const host = make({ keychain: loggedIn, failDrawing: 99 });
    await expect(run(host, cfg, now)).resolves.toBeUndefined();
    expect(host.state.setWidgets).toHaveLength(1);
    expect(host.state.contexts).toEqual([]);
    expect(textsOf(lastWidget(host))).toEqual(['오류', '그리기 시험 오류']);
    expect(widgetRecord(host.state.setWidgets[0]).props.url).toBe('https://example.test/');
  });

  it('앱에서도 기본 부품으로 오류 내용을 보여 준다', async () => {
    const host = make({ runsInApp: true, keychain: loggedIn, alerts: [{ button: 0 }], failDrawing: 99 });
    await expect(run(host, cfg, now)).resolves.toBeUndefined();
    expect(presented(host)).toEqual(['large']);
    expect(host.state.setWidgets).toEqual([]);
    expect(nativeTexts(host)).toEqual(['오류', '그리기 시험 오류']);
  });

  it('그림도 기본 부품도 안 되면 글자만 있는 위젯에 오류와 메시지', async () => {
    const host = make({ keychain: loggedIn, failDrawing: 99, failTexts: 1 });
    await expect(run(host, cfg, now)).resolves.toBeUndefined();
    expect(host.state.setWidgets).toHaveLength(1);
    expect(textsOf(lastWidget(host))).toEqual(['오류', '그리기 시험 오류']);
  });
});

describe('보관 파일', () => {
  it('읽을 때 01~31 말고는 버린다', () => {
    const days = { '01': { text: 'a', color: '' }, '31': { text: 'b', color: '' }, '00': { text: 'c', color: '' }, '32': { text: 'd', color: '' }, '1': { text: 'e', color: '' }, x: { text: 'f', color: '' } };
    const host = make({ files: { [CACHE]: JSON.stringify({ monthId: '2026-11', days, savedAt: 1 }) } });
    expect(readCache(host, '2026-11')).toEqual({ monthId: '2026-11', days: { '01': { text: 'a', color: '' }, '31': { text: 'b', color: '' } } });
  });

  it('로그인에 성공하면 이전 보관 파일은 지워지고 새로 읽은 것으로 바뀐다', async () => {
    const old = JSON.stringify({ monthId: '2026-11', days: { '14': { text: '다른계정', color: '' } }, savedAt: 1 });
    const host = make({ runsInApp: true, files: { [CACHE]: old }, alerts: [{ button: 0, fields: ['a@example.com', 'pw'] }] });
    await run(host, cfg, now);
    expect(host.state.files.get(CACHE)).not.toContain('다른계정');
    expect(host.state.files.get(CACHE)).toContain('리뷰');
  });
});

describe('비밀이 새지 않는다', () => {
  const secret: Backend = {
    signIn: () => ({ body: { idToken: 'tok-id-xyz', refreshToken: 'tok-refresh-xyz', localId: 'owner-test-uid' } }),
    refresh: () => ({ body: { id_token: 'tok-id-xyz', refresh_token: 'tok-refresh-xyz', user_id: 'owner-test-uid' } }),
  };
  const tokens = ['tok-id-xyz', 'tok-refresh-xyz', 'pw-secret'];

  it('보관 파일에 토큰이 없다', async () => {
    const host = make({ keychain: { [REFRESH]: 'tok-refresh-xyz', [UID]: 'owner-test-uid' } }, secret);
    await run(host, cfg, now);
    const cache = host.state.files.get(CACHE)!;
    expect(cache).toContain('리뷰');
    for (const t of tokens) expect(cache).not.toContain(t);
  });

  it('로그인 뒤에 난 오류 위젯의 글에 토큰도 비밀번호도 없다', async () => {
    const host = make({ runsInApp: true, alerts: [{ button: 0, fields: ['a@example.com', 'pw-secret'] }], failDrawing: 1 }, secret);
    await run(host, cfg, now);
    const texts = drawnTexts(host);
    expect(texts).toContain('오류');
    for (const t of tokens) expect(texts.join('\n')).not.toContain(t);
    for (const t of ['pw-secret']) expect(JSON.stringify([...host.state.files])).not.toContain(t);
  });
});

describe('기본 부품 위젯(기본)', () => {
  const kinds = (nodes: FakeNode[]): string[] => nodes.flatMap((n) => (n.kind === 'stack' ? ['stack', ...kinds(n.children)] : [n.kind]));

  it('매개변수가 없으면 기본 부품으로 만들고 그림은 쓰지 않는다', async () => {
    const host = makeNative({ keychain: loggedIn });
    await run(host, cfg, now);
    expect(host.state.contexts).toEqual([]);
    expect(host.state.setWidgets).toHaveLength(1);
    const rec = lastWidget(host);
    expect(rec.props.backgroundImage).toBeNull();
    expect(rec.props.url).toBe('https://example.test/');
    expect(kinds(rec.children)).toEqual(expect.arrayContaining(['stack', 'text', 'spacer']));
    expect(nativeTexts(host)).toEqual(expect.arrayContaining(['2026년 11월', '리뷰']));
    expect(nativeTexts(host)).not.toContain('오프라인');
  });

  it('light나 dark를 적으면 그쪽 색으로 고정하고, 없으면 색이 화면 밝기를 스스로 따른다', async () => {
    const plain = makeNative({ keychain: loggedIn });
    await run(plain, cfg, now);
    const hex = (h: string) => ({ hex: h, alpha: 1 });
    expect(lastWidget(plain).props.backgroundColor).toEqual({ dynamic: { light: hex(PALETTES.light.surface), dark: hex(PALETTES.dark.surface) } });
    for (const [parameter, theme] of [['dark', 'dark'], ['light', 'light'], ['Dark, light', 'dark'], [' LIGHT ', 'light']] as const) {
      // 기기는 반대 밝기여도 매개변수가 먼저다.
      const host = makeNative({ keychain: loggedIn, widgetParameter: parameter, dark: theme === 'light' });
      await run(host, cfg, now);
      const rec = lastWidget(host);
      expect(rec.props.backgroundColor).toEqual(hex(PALETTES[theme].surface));
      expect(JSON.stringify(rec)).not.toContain('dynamic');
      expect(host.state.contexts).toEqual([]);
      expect(textsOf(rec)).toEqual(textsOf(lastWidget(plain)));
    }
  });

  it('작은 위젯은 오늘 하나만 보여 준다', async () => {
    const small = makeNative({ keychain: loggedIn, widgetFamily: 'small' });
    await run(small, cfg, now);
    expect(nativeTexts(small)).toEqual(expect.arrayContaining(['13', '11월', '금요일', '리뷰']));
  });

  it('보관본으로 그리면 오프라인 글자가 있다', async () => {
    const files = { [CACHE]: JSON.stringify({ monthId: '2026-11', days: { '13': { text: '보관', color: '' } }, savedAt: 1 }) };
    const host = makeNative({ keychain: loggedIn, files }, { refresh: () => { throw new Error('offline'); } });
    await run(host, cfg, now);
    expect(nativeTexts(host)).toEqual(expect.arrayContaining(['보관', '오프라인']));
  });

  it('메시지 위젯: 로그인 안내와 권한 안내', async () => {
    const hint = makeNative({});
    await run(hint, cfg, now);
    expect(nativeTexts(hint)).toEqual(['로그인이 필요합니다', 'Scriptable 앱에서', '이 스크립트를 한 번 실행해', '로그인하세요.']);
    const denied = makeNative({ keychain: loggedIn }, { read: () => err(403, 'PERMISSION_DENIED') });
    await run(denied, cfg, now);
    expect(nativeTexts(denied)).toContain('권한이 없습니다');
  });

  it('오류가 나면 오류 위젯, 메시지는 28자씩 5줄까지', async () => {
    const host = makeNative({ keychain: loggedIn });
    host.Keychain.get = () => { throw new Error('나'.repeat(200)); };
    await run(host, cfg, now);
    const texts = nativeTexts(host);
    expect(texts[0]).toBe('오류');
    expect(texts.slice(1)).toHaveLength(5);
    expect(texts.slice(1).join('')).toBe('나'.repeat(140));
  });

  it('앱에서의 미리 보기도 기본 부품 위젯', async () => {
    const host = makeNative({ runsInApp: true, keychain: loggedIn, alerts: [{ button: 0 }], widgetFamily: 'small' });
    await run(host, cfg, now);
    expect(host.state.widgets.at(-1)!.presented).toBe('large');
    expect(host.state.contexts).toEqual([]);
    expect(nativeTexts(host)).toEqual(expect.arrayContaining(['2026년 11월', '리뷰']));
  });

  it('로그인 뒤 보관 파일을 지우다 던져도 로그인은 저장되고 위젯을 보여 준다', async () => {
    const old = JSON.stringify({ monthId: '2026-11', days: {}, savedAt: 1 });
    const host = makeNative({ runsInApp: true, files: { [CACHE]: old }, alerts: [{ button: 0, fields: ['a@example.com', 'pw'] }] });
    const local = host.FileManager.local();
    host.FileManager.local = () => ({ ...local, remove: () => { throw new Error('지우기 시험 오류'); } });
    await run(host, cfg, now);
    expect(host.state.alerts).toHaveLength(1); // 오류 알림이 없다
    expect(host.state.keychain.get(REFRESH)).toBe('RT1');
    expect(host.state.widgets.at(-1)!.presented).toBe('large');
    expect(nativeTexts(host)).not.toContain('오류');
    expect(nativeTexts(host)).toContain('리뷰');
  });
});

describe('그림 위젯(매개변수 image)', () => {
  const firstFill = (h: FakeHost) => h.state.contexts[0].calls[0];

  it.each([
    ['image dark', '#161B22'],
    ['Image,Light', '#FFFFFF'],
    ['그림 dark', '#161B22'],
    [' IMAGE   LIGHT ', '#FFFFFF'],
  ])('%s: 그림으로 그리고 밝기를 정한다', async (parameter, hex) => {
    // 기기가 반대 밝기여도 매개변수가 먼저다.
    const host = makeNative({ keychain: loggedIn, widgetParameter: parameter, dark: !parameter.toLowerCase().includes('dark') });
    await run(host, cfg, now);
    expect(firstFill(host)).toEqual(['setFillColor', { hex, alpha: 1 }]);
    expect(lastWidget(host).props.backgroundImage).not.toBeNull();
    expect(lastWidget(host).children).toEqual([]);
  });

  it('image만 있으면 기기의 밝기를 따르고, 그 질문이 던져도 밝게 그린다', async () => {
    const dark = makeNative({ keychain: loggedIn, widgetParameter: 'image', dark: true });
    await run(dark, cfg, now);
    expect(firstFill(dark)).toEqual(['setFillColor', { hex: '#161B22', alpha: 1 }]);
    const throwing = makeNative({ keychain: loggedIn, widgetParameter: 'image' });
    throwing.Device.isUsingDarkAppearance = () => { throw new Error('위젯에서는 지원하지 않는다'); };
    await run(throwing, cfg, now);
    expect(firstFill(throwing)).toEqual(['setFillColor', { hex: '#FFFFFF', alpha: 1 }]);
    expect(drawnTexts(throwing)).toContain('리뷰');
  });

  it('메시지 위젯도 그림', async () => {
    const host = makeNative({ widgetParameter: 'image' });
    await run(host, cfg, now);
    expect(drawnTexts(host)).toContain('로그인이 필요합니다');
    expect(nativeTexts(host)).toEqual([]);
  });
});

describe('마지막 수단(기본 부품)', () => {
  it('기본 부품 오류 위젯을 못 만들면 그림 오류 위젯을 둔다', async () => {
    const host = makeNative({ keychain: loggedIn, failWidgets: 2 });
    await expect(run(host, cfg, now)).resolves.toBeUndefined();
    expect(host.state.setWidgets).toHaveLength(1);
    expect(lastWidget(host).props.backgroundImage).not.toBeNull();
    expect(drawnTexts(host)).toEqual(['오류', '위젯 시험 오류']);
  });

  it('그림 오류 위젯도 못 만들면 빈 위젯에 오류 글자와 메시지를 둔다', async () => {
    const host = makeNative({ keychain: loggedIn, failWidgets: 3 });
    await expect(run(host, cfg, now)).resolves.toBeUndefined();
    expect(host.state.setWidgets).toHaveLength(1);
    expect(nativeTexts(host)).toEqual(['오류', '위젯 시험 오류']);
    expect(lastWidget(host).props.url).toBe('https://example.test/');
  });

  it('글자도 안 들어가면 주소만 있는 빈 위젯, 아무것도 못 만들면 아무것도 두지 않는다', async () => {
    const noText = makeNative({ keychain: loggedIn, failWidgets: 3 });
    const Base = noText.ListWidget;
    noText.ListWidget = class extends Base {
      constructor() {
        super();
        this.addText = () => { throw new Error('글자 시험 오류'); };
      }
    };
    await run(noText, cfg, now);
    expect(noText.state.setWidgets).toHaveLength(1);
    expect(nativeTexts(noText)).toEqual([]);
    expect(lastWidget(noText).props.url).toBe('https://example.test/');
    const none = makeNative({ keychain: loggedIn, failWidgets: 99 });
    await expect(run(none, cfg, now)).resolves.toBeUndefined();
    expect(none.state.setWidgets).toEqual([]);
  });

  it('앱에서도 오류 글자 위젯을 보여 준다', async () => {
    const host = makeNative({ runsInApp: true, keychain: loggedIn, alerts: [{ button: 0 }], failWidgets: 3 });
    await expect(run(host, cfg, now)).resolves.toBeUndefined();
    expect(presented(host)).toEqual(['large']);
    expect(nativeTexts(host)).toEqual(['오류', '위젯 시험 오류']);
  });
});

describe('기본 부품 그리기가 깨지면(오류 내용은 끝까지 보인다)', () => {
  // failTexts: 2 = 달 위젯의 첫 글자와 기본 부품 오류 위젯의 첫 글자가 실패한다.
  it('위젯: 그림으로 오류 위젯을 두고, 그 글에 오류 내용이 있다', async () => {
    const host = makeNative({ keychain: loggedIn, failTexts: 2 });
    await expect(run(host, cfg, now)).resolves.toBeUndefined();
    expect(host.state.setWidgets).toHaveLength(1);
    expect(lastWidget(host).props.backgroundImage).not.toBeNull();
    expect(lastWidget(host).props.url).toBe('https://example.test/');
    expect(drawnTexts(host)).toEqual(['오류', '글자 시험 오류']);
  });

  it('앱: 그림 오류 위젯을 한 번 보여 준다', async () => {
    const host = makeNative({ runsInApp: true, keychain: loggedIn, alerts: [{ button: 0 }], failTexts: 2 });
    await expect(run(host, cfg, now)).resolves.toBeUndefined();
    expect(presented(host)).toEqual(['large']);
    expect(host.state.setWidgets).toEqual([]);
    expect(drawnTexts(host)).toEqual(['오류', '글자 시험 오류']);
  });

  it('그림의 밝기는 매개변수의 light나 dark, 없으면 기기 설정', async () => {
    const firstFill = (h: FakeHost) => h.state.contexts[0].calls[0];
    for (const [options, hex] of [
      [{ widgetParameter: 'dark', dark: false }, '#161B22'],
      [{ widgetParameter: 'light', dark: true }, '#FFFFFF'],
      [{ dark: true }, '#161B22'],
      [{ dark: false }, '#FFFFFF'],
    ] as const) {
      const host = makeNative({ keychain: loggedIn, failTexts: 2, ...options });
      await run(host, cfg, now);
      expect(firstFill(host)).toEqual(['setFillColor', { hex, alpha: 1 }]);
    }
  });

  it('그림도 그리지 못하면 글자만 있는 위젯에 오류와 메시지 줄', async () => {
    const host = makeNative({ keychain: loggedIn, failTexts: 2, failDrawing: 99 });
    await expect(run(host, cfg, now)).resolves.toBeUndefined();
    expect(host.state.setWidgets).toHaveLength(1);
    expect(textsOf(lastWidget(host))).toEqual(['오류', '글자 시험 오류']);
    expect(lastWidget(host).props.url).toBe('https://example.test/');
  });

  it('앱에서도 글자만 있는 위젯을 한 번 보여 준다', async () => {
    const host = makeNative({ runsInApp: true, keychain: loggedIn, alerts: [{ button: 0 }], failTexts: 2, failDrawing: 99 });
    await expect(run(host, cfg, now)).resolves.toBeUndefined();
    expect(presented(host)).toEqual(['large']);
    expect(textsOf(shownInApp(host))).toEqual(['오류', '글자 시험 오류']);
  });

  it('크기를 알 수 없어도(환경을 못 만들면) 글자만 있는 위젯에 오류 내용', async () => {
    const host = makeNative({ keychain: loggedIn });
    host.Device.screenSize = () => { throw new Error('화면 크기 시험 오류'); };
    await expect(run(host, cfg, now)).resolves.toBeUndefined();
    expect(host.state.setWidgets).toHaveLength(1);
    expect(textsOf(lastWidget(host))).toEqual(['오류', '화면 크기 시험 오류']);
  });

  it('버전을 알면 오류 줄의 마지막에 (버전)을 적는다', async () => {
    const host = makeNative({ keychain: loggedIn });
    host.Keychain.get = () => { throw new Error('깨짐'); };
    await run(host, { ...cfg, version: '0.4.0 (2026-11-14)' }, now);
    expect(textsOf(lastWidget(host))).toEqual(['오류', '깨짐', '(0.4.0 (2026-11-14))']);
    const bare = makeNative({ keychain: loggedIn, failTexts: 2, failDrawing: 99 });
    await run(bare, { ...cfg, version: '0.4.0 (2026-11-14)' }, now);
    expect(textsOf(lastWidget(bare))).toEqual(['오류', '글자 시험 오류', '(0.4.0 (2026-11-14))']);
  });
});
