import { afterEach, describe, expect, it, vi } from 'vitest';
import { setOfficialHolidays } from '../core/holidays';
import type { Config } from './api';
import { drawnTexts, makeFakeHost, nativeTexts, widgetRecord, type FakeAnswer, type FakeNode, type FakeHost, type FakeOptions, type FakeRequest, type FakeWidgetRecord } from './fakeHost';
import { alarmReport, readCache, run } from './main';
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
    expect(host.state.requests.map((r) => r.method)).toEqual(['POST', 'GET', 'GET', 'GET']); // 갱신, 달, 알림 문서, 푸시 문서
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
    expect(host.state.alerts[0]).toMatchObject({ title: 'CalendarFIF 위젯 · 알림 0개 예약됨', actions: ['미리 보기', '시험 알림 (1분 뒤)', '로그아웃'], cancel: '닫기', message: '앞으로 7일 안에 울릴 알림이 없습니다.' });
    expect(host.state.widgets.at(-1)!.presented).toBe('large');
    expect(host.state.contexts[0].size).toEqual({ width: 338, height: 354 });
  });

  it('버전을 알면 메뉴 제목에 버전과 만든 날짜가 있다', async () => {
    const host = make({ runsInApp: true, keychain: loggedIn, alerts: [{ button: -1 }] });
    await run(host, { ...cfg, version: '0.4.0 (2026-11-14)' }, now);
    expect(host.state.alerts[0].title).toBe('CalendarFIF 위젯 0.4.0 (2026-11-14) · 알림 0개 예약됨');
  });

  it('닫기는 아무것도 하지 않는다', async () => {
    const host = make({ runsInApp: true, keychain: loggedIn, alerts: [{ button: -1 }] });
    await run(host, cfg, now);
    expect(host.state.requests.some((r) => r.url.includes('/months/'))).toBe(false); // 알림 예약만 하고 달은 읽지 않는다
    expect(host.state.widgets).toEqual([]);
    expect(host.state.keychain.size).toBe(2);
  });

  it('로그아웃은 키체인과 보관 파일을 지운다', async () => {
    const host = make({ runsInApp: true, keychain: loggedIn, files: { [CACHE]: '{}' }, alerts: [{ button: 2 }, { button: 0 }] });
    await run(host, cfg, now);
    expect(host.state.keychain.size).toBe(0);
    expect(host.state.files.has(CACHE)).toBe(false);
    expect(host.state.alerts[1].message).toBe('로그아웃했습니다.');
    expect(host.state.requests.some((r) => r.url.includes('/months/'))).toBe(false);
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
    const host = makeNative({ runsInApp: true, keychain: loggedIn, alerts: [MENU, LOGIN] }, rejectFirst(2)); // 메뉴 앞의 알림 예약이 첫 갱신을 쓴다
    await run(host, cfg, now);
    expect(host.state.alerts.map((a) => a.title)).toEqual(['CalendarFIF 위젯 · 알림 0개 예약됨', '로그인']);
    expect(host.state.keychain.get(REFRESH)).toBe('RT1');
    expect(presented(host)).toEqual(['large']);
    expect(textsOf(shownInApp(host))).toEqual(expect.arrayContaining(['2026년 11월', '리뷰']));
    expect(nativeTexts(host)).not.toContain('로그인이 필요합니다');
  });

  it('로그인을 취소하면 조용히 끝난다', async () => {
    const host = makeNative({ runsInApp: true, keychain: loggedIn, alerts: [MENU, { button: -1 }] }, rejectFirst(2));
    await expect(run(host, cfg, now)).resolves.toBeUndefined();
    expect(host.state.alerts).toHaveLength(2);
    expect(host.state.widgets).toEqual([]);
    expect(host.state.keychain.size).toBe(0);
  });

  it('다시 묻는 것은 한 번뿐이다: 새 로그인도 거절되면 안내를 보여 준다', async () => {
    const host = makeNative({ runsInApp: true, keychain: loggedIn, alerts: [MENU, LOGIN] }, rejectFirst(99));
    await run(host, cfg, now);
    expect(host.state.alerts.map((a) => a.title)).toEqual(['CalendarFIF 위젯 · 알림 0개 예약됨', '로그인']);
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

  it('음력을 적는 것이 기본이고, 매개변수에 nolunar나 음력끔이 있으면 적지 않는다(그림 방식도 같다)', async () => {
    const plain = makeNative({ keychain: loggedIn });
    await run(plain, cfg, now);
    expect(nativeTexts(plain)).toEqual(expect.arrayContaining(['10.5', '10.22'])); // 11월 13일과 30일의 음력
    for (const parameter of ['nolunar', 'dark NoLunar', '음력끔']) {
      const host = makeNative({ keychain: loggedIn, widgetParameter: parameter });
      await run(host, cfg, now);
      expect(nativeTexts(host)).toContain('2026년 11월');
      expect(nativeTexts(host).filter((t) => /^윤?\d+\.\d+$/.test(t))).toEqual([]);
    }
    // 그림 방식: 그린 글자 가운데 음력 꼴의 글이 있고, nolunar면 없다.
    const drawn = (h: FakeHost): string[] => h.state.contexts[0].calls.filter((c) => c[0] === 'drawTextInRect').map((c) => String(c[1]));
    const picture = make({ keychain: loggedIn });
    await run(picture, cfg, now);
    expect(drawn(picture)).toContain('10.5');
    const off = make({ keychain: loggedIn, widgetParameter: 'image nolunar' });
    await run(off, cfg, now);
    expect(drawn(off).filter((t) => /^윤?\d+\.\d+$/.test(t))).toEqual([]);
    expect(drawn(off)).toContain('2026년 11월');
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

describe('공휴일 자료', () => {
  // 지어낸 주소와 자료. 2026-11-20(금)을 임시공휴일로 알린다.
  const HOLIDAY_URL = 'https://example.com/holidays.json';
  const HOLIDAYS = '/docs/calendarfif-holidays.json';
  const withUrl: Config = { ...cfg, holidayUrl: HOLIDAY_URL };
  const file = (name = '임시공휴일', date = '2026-11-20') => ({ version: 1, updatedAt: '2026-11-12T18:23:05.000Z', years: { 2026: { days: [{ date, name }] } } });
  const at = now().getTime();
  const HOUR = 3_600_000;
  const saved = (fetchedAt: number, data: unknown = file(), attemptedAt = fetchedAt) => ({ [HOLIDAYS]: JSON.stringify({ fetchedAt, attemptedAt, data }) });
  /** 공휴일 자료 주소에는 answer로, 그 밖은 보통 서버처럼 답한다. */
  const host = (o: FakeOptions, answer: () => FakeAnswer = () => ({ body: file() })): FakeHost => {
    const rest = backend();
    return makeFakeHost({ handler: (req) => (req.url === HOLIDAY_URL ? answer() : rest(req)), keychain: loggedIn, ...o });
  };
  const holidayRequests = (h: FakeHost) => h.state.requests.filter((r) => r.url === HOLIDAY_URL);
  const savedFile = (h: FakeHost) => JSON.parse(h.state.files.get(HOLIDAYS)!) as { fetchedAt: number; attemptedAt: number; data: unknown };
  afterEach(() => setOfficialHolidays(null));

  it('받아 둔 것이 없으면 받아서 보관하고, 그 공휴일을 그린다', async () => {
    const h = host({});
    await run(h, withUrl, now);
    expect(holidayRequests(h)).toEqual([expect.objectContaining({ method: 'GET', headers: {} })]);
    expect(savedFile(h)).toEqual({ fetchedAt: at, attemptedAt: at, data: { version: 1, years: file().years } });
    expect(nativeTexts(h)).toContain('임시공휴일');
    expect(nativeTexts(h)).toContain('리뷰');
  });

  it('그림 위젯에도 나온다', async () => {
    const h = host({ widgetParameter: 'image' });
    await run(h, withUrl, now);
    expect(drawnTexts(h)).toContain('임시공휴일');
  });

  it('24시간 안에 받은 것은 묻지 않고 쓴다', async () => {
    const h = host({ files: saved(at - 23 * HOUR) });
    await run(h, withUrl, now);
    expect(holidayRequests(h)).toEqual([]);
    expect(nativeTexts(h)).toContain('임시공휴일');
  });

  it('주소가 없어도 받아 둔 것은 쓰고, 묻지는 않는다', async () => {
    for (const config of [cfg, { ...cfg, holidayUrl: '' }, { ...cfg, holidayUrl: '__HOLIDAY_URL__' }]) {
      setOfficialHolidays(null);
      const h = host({ files: saved(at - 48 * HOUR) });
      await run(h, config, now);
      expect(holidayRequests(h)).toEqual([]);
      expect(h.state.requests.filter((r) => !r.url.includes('googleapis'))).toEqual([]);
      expect(nativeTexts(h)).toContain('임시공휴일');
    }
  });

  it('24시간이 지났으면 새로 받는다', async () => {
    const h = host({ files: saved(at - 25 * HOUR) }, () => ({ body: file('대통령선거일', '2026-11-25') }));
    await run(h, withUrl, now);
    expect(holidayRequests(h)).toHaveLength(1);
    expect(nativeTexts(h)).toContain('대통령선거일');
    expect(nativeTexts(h)).not.toContain('임시공휴일');
    expect(savedFile(h).fetchedAt).toBe(at);
  });

  it('받지 못하면 받아 둔 것으로 그리고, 시도한 때를 적어 6시간 동안은 다시 묻지 않는다', async () => {
    const failing = () => {
      throw new Error('연결 안 됨');
    };
    const h = host({ files: saved(at - 25 * HOUR) }, failing);
    await run(h, withUrl, now);
    expect(holidayRequests(h)).toHaveLength(1);
    expect(nativeTexts(h)).toContain('임시공휴일');
    expect(nativeTexts(h)).toContain('리뷰');
    expect(savedFile(h)).toMatchObject({ fetchedAt: at - 25 * HOUR, attemptedAt: at, data: { version: 1, years: file().years } });

    // 5시간 뒤: 묻지 않는다. 7시간 뒤: 다시 묻는다.
    const files = Object.fromEntries(h.state.files);
    const later = host({ files }, failing);
    await run(later, withUrl, () => new Date(at + 5 * HOUR));
    expect(holidayRequests(later)).toEqual([]);
    const after = host({ files }, failing);
    await run(after, withUrl, () => new Date(at + 7 * HOUR));
    expect(holidayRequests(after)).toHaveLength(1);
  });

  it('잘못된 파일이나 HTTP 오류는 받지 못한 것과 같다(위젯은 지금처럼 그린다)', async () => {
    const answers: (() => FakeAnswer)[] = [
      () => ({ body: { version: 2, years: {} } }),
      () => ({ body: 'not json' }),
      () => ({ status: 404, body: file() }),
    ];
    for (const answer of answers) {
      const h = host({}, answer);
      await run(h, withUrl, now);
      expect(holidayRequests(h)).toHaveLength(1);
      expect(nativeTexts(h)).not.toContain('임시공휴일');
      expect(nativeTexts(h)).toContain('리뷰');
      expect(savedFile(h)).toMatchObject({ attemptedAt: at, data: null });
    }
  });

  it('보관한 파일이 깨졌으면 없는 것으로 본다', async () => {
    const h = host({ files: { [HOLIDAYS]: '{' } });
    await run(h, withUrl, now);
    expect(holidayRequests(h)).toHaveLength(1);
    expect(nativeTexts(h)).toContain('임시공휴일');
  });

  it('파일 다루기가 깨져도 위젯은 지금처럼 그린다', async () => {
    const h = host({});
    const local = h.FileManager.local();
    h.FileManager.local = () => ({ ...local, writeString: () => { throw new Error('쓰기 시험 오류'); } });
    await run(h, withUrl, now);
    expect(h.state.setWidgets).toHaveLength(1);
    expect(nativeTexts(h)).toContain('리뷰');
    expect(nativeTexts(h)).toContain('임시공휴일'); // 보관하지 못해도 이번에는 쓴다
  });

  it('연결이 안 돼 오프라인으로 그릴 때도 받아 둔 공휴일을 쓴다', async () => {
    const files = { ...saved(at - HOUR), [CACHE]: JSON.stringify({ monthId: '2026-11', days: {}, savedAt: 1 }) };
    const h = makeFakeHost({ handler: () => { throw new Error('offline'); }, keychain: loggedIn, files });
    await run(h, withUrl, now);
    expect(nativeTexts(h)).toEqual(expect.arrayContaining(['오프라인', '임시공휴일']));
  });

  it('로그인 전에는 묻지 않는다', async () => {
    const h = host({ keychain: {} });
    await run(h, withUrl, now);
    expect(h.state.requests).toEqual([]);
  });
});

describe('아이폰 알림 예약', () => {
  // 지어낸 알림 문서: 2026-11-16 09:30 알림 하나(now는 2026-11-13 09:00).
  const eventsDoc = { fields: { items: { mapValue: { fields: { abc123: { mapValue: { fields: {
    type: { stringValue: 'alarm' }, date: { stringValue: '2026-11-16' }, text: { stringValue: '회의' }, time: { stringValue: '09:30' },
    advance: { arrayValue: { values: [{ integerValue: '0' }] } },
  } } } } } } } };
  const withEvents = (events?: (req: FakeRequest) => FakeAnswer): Backend => ({
    read: (req) => (req.url.includes('/data/events') ? (events ? events(req) : { body: eventsDoc }) : { body: memoDoc }),
  });
  const ID = 'calfif:abc123@2026-11-16@0';

  it('위젯 실행 뒤 알림을 예약한다', async () => {
    const host = makeNative({ keychain: loggedIn }, withEvents());
    await run(host, cfg, now);
    expect(host.state.requests.map((r) => r.url.split('/documents/')[1] ?? '')).toEqual(['', 'users/owner-test-uid/months/2026-11', 'users/owner-test-uid/data/events', 'users/owner-test-uid/data/push']);
    expect(host.state.scheduled.map((n) => n.identifier)).toEqual([ID]);
    expect(host.state.scheduled[0]).toMatchObject({ body: '09:30 회의', openURL: 'https://example.test/#2026-11-16' });
    expect(JSON.parse(host.state.files.get(CACHE)!)).toMatchObject({ monthId: '2026-11', events: { abc123: { text: '회의' } } });
    expect(host.state.setWidgets).toHaveLength(1);
  });

  // 아이폰에서 켰고 알림 서버가 1분 전에 확인한 푸시 문서. label이나 sender를 바꿔 다른 경우를 만든다.
  const pushDocOf = (label: string, senderAt: number | null) => ({ fields: {
    devices: { mapValue: { fields: { AAAAAAAAAAAAAAAAAAAA: { mapValue: { fields: { token: { stringValue: 't' }, label: { stringValue: label }, at: { integerValue: '1' } } } } } } },
    ...(senderAt === null ? {} : { sender: { mapValue: { fields: { at: { integerValue: String(senderAt) }, testAt: { integerValue: '0' }, error: { stringValue: '' } } } } }),
  } });
  const pushDoc = pushDocOf('아이폰', now().getTime() - 60_000);
  const withPush = (push: (req: FakeRequest) => FakeAnswer): Backend => ({
    read: (req) => (req.url.includes('/data/push') ? push(req) : req.url.includes('/data/events') ? { body: eventsDoc } : { body: memoDoc }),
  });

  it('푸시 알림을 켠 기기가 있으면 예약하지 않고 예약해 둔 것을 지운다(같은 알림이 두 번 오지 않게)', async () => {
    const host = makeNative({ keychain: loggedIn, pending: [{ identifier: ID }, { identifier: 'other:keep' }] }, withPush(() => ({ body: pushDoc })));
    await run(host, cfg, now);
    expect(host.state.scheduled).toEqual([]);
    expect(host.state.pending.map((n) => n.identifier)).toEqual(['other:keep']);
    expect(JSON.parse(host.state.files.get(CACHE)!)).toMatchObject({ pushUntil: now().getTime() - 60_000 + 15 * 60_000 });
    expect(host.state.setWidgets).toHaveLength(1);
  });

  it('알림 서버가 없거나 멈췄거나 PC 브라우저에서만 켰으면 예전처럼 예약한다', async () => {
    for (const doc of [pushDocOf('아이폰', null), pushDocOf('아이폰', now().getTime() - 20 * 60_000), pushDocOf('브라우저', now().getTime() - 60_000)]) {
      const host = makeNative({ keychain: loggedIn }, withPush(() => ({ body: doc })));
      await run(host, cfg, now);
      expect(host.state.scheduled.map((n) => n.identifier)).toEqual([ID]);
    }
  });

  it('푸시 문서를 읽지 못하면 마지막으로 읽은 것을 따르고, 문서가 없으면 예약한다', async () => {
    const host = makeNative({ keychain: loggedIn, files: { [CACHE]: JSON.stringify({ pushUntil: now().getTime() + 60_000 }) } }, withPush(() => ({ status: 503, body: {} })));
    await run(host, cfg, now);
    expect(host.state.scheduled).toEqual([]);
    const none = makeNative({ keychain: loggedIn }, withPush(() => ({ status: 404, body: { error: { status: 'NOT_FOUND' } } })));
    await run(none, cfg, now);
    expect(none.state.scheduled.map((n) => n.identifier)).toEqual([ID]);
    expect(JSON.parse(none.state.files.get(CACHE)!)).toMatchObject({ pushUntil: 0 });
    // 보관한 시각이 지났으면 읽지 못해도 예약한 것으로 돌아간다.
    const old = makeNative({ keychain: loggedIn, files: { [CACHE]: JSON.stringify({ pushUntil: now().getTime() - 1 }) } }, withPush(() => ({ status: 503, body: {} })));
    await run(old, cfg, now);
    expect(old.state.scheduled.map((n) => n.identifier)).toEqual([ID]);
  });

  it('앱에서 실행하면 메뉴가 푸시 알림을 쓴다고 알린다', async () => {
    const host = makeNative({ keychain: loggedIn, runsInApp: true, alerts: [{ button: -1 }] }, withPush(() => ({ body: pushDoc })));
    await run(host, cfg, now);
    expect(host.state.alerts[0].title).toContain('푸시 알림 사용 중');
    expect(host.state.alerts[0].message).toContain('푸시 알림으로 옵니다');
  });

  it('schedule=1이면 예약만 하고 결과를 상자로 보인다', async () => {
    const host = makeNative({ runsInApp: true, keychain: loggedIn, queryParameters: { schedule: '1' }, alerts: [{ button: 0 }] }, withEvents());
    await run(host, cfg, now);
    expect(host.state.widgets).toEqual([]);
    expect(host.state.scheduled.map((n) => n.identifier)).toEqual([ID]);
    expect(host.state.alerts).toHaveLength(1);
    expect(host.state.alerts[0]).toMatchObject({ title: 'CalendarFIF 알림 예약', message: '예약된 알림 1개\n다음: 11월 16일 · 09:30 회의', actions: ['확인'] });
  });

  it('앱 메뉴의 제목에 예약한 수가, 글에 다음 알림이 보인다', async () => {
    const host = makeNative({ runsInApp: true, keychain: loggedIn, alerts: [{ button: -1 }] }, withEvents());
    await run(host, cfg, now);
    expect(host.state.alerts[0].title).toBe('CalendarFIF 위젯 · 알림 1개 예약됨');
    expect(host.state.alerts[0].message).toBe('예약된 알림 1개\n다음: 11월 16일 · 09:30 회의');
  });

  it('예약이 오류 없이 끝났는데 아이폰에 남지 않으면 알림 허용을 켜라고 한다', async () => {
    const menu = makeNative({ runsInApp: true, keychain: loggedIn, silentNotifications: true, alerts: [{ button: -1 }] }, withEvents());
    await run(menu, cfg, now);
    expect(menu.state.alerts[0].title).toBe('CalendarFIF 위젯 · 알림 0개 예약됨');
    expect(menu.state.alerts[0].message).toContain('아이폰에 남지 않았습니다');
    expect(menu.state.alerts[0].message).toContain("'알림 허용'");
    const once = makeNative({ runsInApp: true, keychain: loggedIn, silentNotifications: true, queryParameters: { schedule: '1' }, alerts: [{ button: 0 }] }, withEvents());
    await run(once, cfg, now);
    expect(once.state.alerts[0].message).toContain('아이폰에 남지 않았습니다');
  });

  it('시험 알림은 1분 뒤에 울리게 예약하고, 예약 고르기가 지우지 않는다', async () => {
    const host = makeNative({ runsInApp: true, keychain: loggedIn, alerts: [{ button: 1 }, { button: 0 }] }, withEvents());
    await run(host, cfg, now);
    const test = host.state.scheduled.find((n) => n.identifier === 'calfif-test');
    expect(test).toMatchObject({ title: 'CalendarFIF 시험 알림', sound: 'alert', at: new Date(now().getTime() + 60_000) });
    expect(host.state.alerts[1]).toMatchObject({ title: 'CalendarFIF 시험 알림', message: expect.stringContaining('1분 뒤에 시험 알림이 옵니다') });
    expect(host.state.widgets).toEqual([]);
    // 다음 위젯 실행의 예약 고르기는 시험 알림을 그대로 둔다.
    const again = makeNative({ keychain: loggedIn, pending: host.state.pending.map((n) => ({ identifier: n.identifier, body: n.body, at: n.at ?? undefined })) }, withEvents());
    await run(again, cfg, now);
    expect(again.state.removed).toEqual([]);
    expect(again.state.pending.map((n) => n.identifier)).toContain('calfif-test');
  });

  it('예약은 됐는데 다시 읽지 못하면 예약한 수를 그대로 보인다', async () => {
    const host = makeNative({ runsInApp: true, keychain: loggedIn, alerts: [{ button: -1 }] }, withEvents());
    const real = host.Notification.allPending.bind(host.Notification);
    let reads = 0;
    host.Notification.allPending = async () => {
      reads += 1;
      if (reads > 1) throw new Error('시험 오류'); // 예약 고르기의 읽기는 되고, 확인 읽기는 안 된다
      return real();
    };
    await run(host, cfg, now);
    expect(host.state.alerts[0].title).toBe('CalendarFIF 위젯 · 알림 1개 예약됨');
    expect(host.state.alerts[0].message).toBe('알림 1개를 예약했습니다.');
  });

  it('서버에서 알림을 읽지 못해 보관본으로 예약했으면 그렇다고 알린다', async () => {
    const host = makeNative({ runsInApp: true, keychain: loggedIn, files: cached, queryParameters: { schedule: '1' }, alerts: [{ button: 0 }] }, withEvents(() => ({ status: 503, body: {} })));
    await run(host, cfg, now);
    expect(host.state.alerts[0].message).toBe('예약된 알림 1개\n다음: 11월 16일 · 09:30 비밀\n서버에서 알림을 읽지 못해 마지막으로 받아 둔 것으로 예약했습니다. 방금 만든 알림은 빠졌을 수 있습니다.');
  });

  it('시험 알림이 아이폰에 남지 않으면 알림 허용을 켜라고 한다', async () => {
    const host = makeNative({ runsInApp: true, keychain: loggedIn, silentNotifications: true, alerts: [{ button: 1 }, { button: 0 }] }, withEvents());
    await run(host, cfg, now);
    expect(host.state.alerts[1].message).toContain('시험 알림을 예약하지 못했습니다');
    const failing = makeNative({ runsInApp: true, keychain: loggedIn, failNotifications: true, alerts: [{ button: 1 }, { button: 0 }] }, withEvents());
    await run(failing, cfg, now);
    expect(failing.state.alerts[1].message).toContain('시험 알림을 예약하지 못했습니다');
  });

  it('알림 읽기가 실패해도 위젯을 그리고, 보관한 알림으로 예약한다', async () => {
    const files = { [CACHE]: JSON.stringify({ monthId: '2026-11', days: {}, savedAt: 1, events: { abc123: { type: 'alarm', date: '2026-11-16', text: '보관', time: '09:30', advance: [0] } } }) };
    const host = makeNative({ keychain: loggedIn, files }, withEvents(() => ({ status: 503, body: {} })));
    await run(host, cfg, now);
    expect(nativeTexts(host)).toContain('리뷰');
    expect(host.state.setWidgets).toHaveLength(1);
    expect(host.state.scheduled.map((n) => n.body)).toEqual(['09:30 보관']);
    expect(JSON.parse(host.state.files.get(CACHE)!).events.abc123.text).toBe('보관');
  });

  const ours = [{ identifier: 'calfif:old@2026-11-16@0' }, { identifier: 'other:keep' }];
  const cached = { [CACHE]: JSON.stringify({ monthId: '2026-11', days: {}, savedAt: 1, events: { abc123: { type: 'alarm', date: '2026-11-16', text: '비밀', time: '09:30', advance: [0] } } }) };

  it('로그아웃하면 예약한 알림과 보관한 알림 글을 지운다', async () => {
    const host = makeNative({ runsInApp: true, keychain: loggedIn, files: cached, pending: ours, alerts: [{ button: 2 }, { button: 0 }] }, withEvents());
    await run(host, cfg, now);
    expect(host.state.pending.map((n) => n.identifier)).toEqual(['other:keep']);
    expect(host.state.files.has(CACHE)).toBe(false);
  });

  it('저장된 로그인이 거절돼 지워질 때도 예약한 알림과 보관한 알림 글을 지운다', async () => {
    const host = makeNative({ keychain: loggedIn, files: cached, pending: ours }, { refresh: () => err(400, 'TOKEN_EXPIRED') });
    await run(host, cfg, now);
    expect(host.state.keychain.size).toBe(0);
    expect(host.state.pending.map((n) => n.identifier)).toEqual(['other:keep']);
    expect(host.state.files.get(CACHE) ?? '').not.toContain('비밀');
  });

  it('알림 문서를 읽을 권한이 없으면(403) 보관본으로 예약하지 않고 지운다', async () => {
    const host = makeNative({ keychain: loggedIn, files: cached, pending: ours }, withEvents(() => err(403, 'PERMISSION_DENIED')));
    await run(host, cfg, now);
    expect(host.state.scheduled).toEqual([]);
    expect(host.state.pending.map((n) => n.identifier)).toEqual(['other:keep']);
    expect(host.state.files.get(CACHE)).not.toContain('비밀');
    expect(nativeTexts(host)).toContain('리뷰');
  });

  it('앱 실행은 알림을 한 번만 읽고 예약한다', async () => {
    const host = makeNative({ runsInApp: true, keychain: loggedIn, alerts: [{ button: 0 }] }, withEvents());
    await run(host, cfg, now);
    expect(host.state.requests.filter((r) => r.url.includes('/data/events'))).toHaveLength(1);
    expect(presented(host)).toEqual(['large']);
  });

  it('예약하지 못하면 개수 없이 제목을 보이고 schedule=1은 못 했다고 알린다', async () => {
    const menu = makeNative({ runsInApp: true, keychain: loggedIn, failNotifications: true, alerts: [{ button: -1 }] }, withEvents());
    await run(menu, cfg, now);
    expect(menu.state.alerts[0].title).toBe('CalendarFIF 위젯');
    // 알림 보이기도 거절되므로 보이는 알림은 없다. 예약하지 못한 쪽의 글은 가짜가 거절하지 않는 경우로 본다.
    expect(menu.state.alerts[0].message).toContain('알림을 예약하지 못했습니다');
    const host = makeNative({ runsInApp: true, keychain: loggedIn, queryParameters: { schedule: '1' }, pending: [], alerts: [{ button: 0 }] }, withEvents());
    host.Notification.allPending = async () => { throw new Error('시험 오류'); };
    await run(host, cfg, now);
    expect(host.state.alerts[0].message).toContain('알림을 예약하지 못했습니다');
    expect(host.state.alerts[0].message).toContain('Scriptable → 알림');
  });

  it('schedule=1에 로그인이 없으면 로그인 창 없이 안내만 보인다', async () => {
    const host = makeNative({ runsInApp: true, queryParameters: { schedule: '1' }, alerts: [{ button: 0 }] }, withEvents());
    await run(host, cfg, now);
    expect(host.state.alerts).toHaveLength(1);
    expect(host.state.alerts[0].fields).toEqual([]);
    expect(host.state.alerts[0].message).toContain('먼저 로그인하세요');
    expect(host.state.requests).toEqual([]);
    expect(host.state.scheduled).toEqual([]);
  });

  it('예약이 거절돼도 위젯을 그린다', async () => {
    const host = makeNative({ keychain: loggedIn, failNotifications: true }, withEvents());
    await run(host, cfg, now);
    expect(nativeTexts(host)).toContain('리뷰');
    expect(host.state.setWidgets).toHaveLength(1);
  });

  it('앱에서 알림 기능이 멈추면 15초 뒤에 메뉴를 띄우고 알림 허용 탓으로 돌리지 않는다', async () => {
    vi.useFakeTimers();
    try {
      const host = makeNative({ runsInApp: true, keychain: loggedIn, alerts: [{ button: -1 }] }, withEvents());
      host.Notification.allPending = () => new Promise(() => {}); // 던지지 않고 멈췄다
      const done = run(host, cfg, now);
      await vi.advanceTimersByTimeAsync(14_900);
      expect(host.state.alerts).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(200);
      await done;
      expect(host.state.alerts[0].title).toBe('CalendarFIF 위젯');
      expect(host.state.alerts[0].message).toBe('아이폰 알림 예약이 제때 끝나지 않았습니다. 잠시 뒤 다시 실행해 주세요.');
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('알림 문서를 읽을 권한이 없으면 메뉴가 그렇다고 말한다', async () => {
    const host = makeNative({ runsInApp: true, keychain: loggedIn, alerts: [{ button: -1 }] }, withEvents(() => err(403, 'PERMISSION_DENIED')));
    await run(host, cfg, now);
    expect(host.state.alerts[0].message).toContain('권한이 없어');
  });

  it('Scriptable의 알림 기능이 멈춰 예약이 끝나지 않아도 5초 뒤에는 위젯을 그린다', async () => {
    vi.useFakeTimers();
    try {
      const host = makeNative({ keychain: loggedIn }, withEvents());
      host.Notification.allPending = () => new Promise(() => {}); // 던지지 않고 멈췄다
      const done = run(host, cfg, now);
      await vi.advanceTimersByTimeAsync(4900);
      expect(host.state.requests.some((r) => r.url.includes('/data/events'))).toBe(true); // 알림 문서는 읽었다
      expect(host.state.setWidgets).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(200);
      await done;
      expect(host.state.setWidgets).toHaveLength(1);
      expect(nativeTexts(host)).toContain('리뷰');
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('예약이 제때 끝나면 기다리던 타이머를 거둔다', async () => {
    vi.useFakeTimers();
    try {
      const host = makeNative({ keychain: loggedIn }, withEvents());
      const done = run(host, cfg, now);
      await vi.advanceTimersByTimeAsync(0);
      await done;
      expect(host.state.scheduled.map((n) => n.identifier)).toEqual([ID]);
      expect(host.state.setWidgets).toHaveLength(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('alarmReport', () => {
  const server = (scheduled: number | null) => ({ scheduled, source: 'server' as const });
  const next = { at: new Date(2026, 10, 16, 9, 30), body: '09:30 회의' };

  it('예약하지 못했으면 알림 허용을 켜라고 한다', () => {
    expect(alarmReport(server(null), null)).toContain("'알림 허용'");
  });

  it('다시 읽지 못했으면 예약한 수를 그대로 말한다', () => {
    expect(alarmReport(server(2), null)).toBe('알림 2개를 예약했습니다.');
    expect(alarmReport(server(0), null)).toBe('앞으로 7일 안에 울릴 알림이 없습니다.');
  });

  it('예약할 것이 없으면 없다고 한다', () => {
    expect(alarmReport(server(0), { count: 0, next: null })).toBe('앞으로 7일 안에 울릴 알림이 없습니다.');
  });

  it('예약했는데 하나도 남지 않았으면 알림 허용을 켜라고 한다', () => {
    const text = alarmReport(server(3), { count: 0, next: null });
    expect(text).toContain('아이폰에 남지 않았습니다');
    expect(text).toContain("'잠금 화면'");
  });

  it('남은 수와 다음 알림을 보이고, 덜 남았으면 그것도 말한다', () => {
    expect(alarmReport(server(2), { count: 2, next })).toBe('예약된 알림 2개\n다음: 11월 16일 · 09:30 회의');
    expect(alarmReport(server(3), { count: 2, next })).toBe('예약된 알림 2개\n예약한 3개 중 2개만 아이폰에 남았습니다.\n다음: 11월 16일 · 09:30 회의');
  });

  it('서버에서 읽지 못했으면 보관본으로 했다고 덧붙인다', () => {
    expect(alarmReport({ scheduled: 0, source: 'cache' }, { count: 0, next: null })).toBe('앞으로 7일 안에 울릴 알림이 없습니다.\n서버에서 알림을 읽지 못해 마지막으로 받아 둔 것으로 예약했습니다. 방금 만든 알림은 빠졌을 수 있습니다.');
  });
});

describe('alarmReport의 특별한 경우', () => {
  it('읽을 권한이 없으면 권한을 말하고, 알림 기능이 멈췄으면 다시 하라고 한다(알림 허용 탓으로 돌리지 않는다)', () => {
    expect(alarmReport({ scheduled: 0, source: 'denied' }, { count: 0, next: null })).toContain('권한이 없어');
    const stuck = alarmReport({ scheduled: null, source: 'stuck' }, null);
    expect(stuck).toContain('제때 끝나지 않았습니다');
    expect(stuck).not.toContain('알림 허용');
  });
});

describe('자동 업데이트를 이어 붙인 run', () => {
  const versioned: Config = { ...cfg, version: '0.9.0 (2026-11-16)' };
  const NEWER = '0.9.1 (2026-11-20)';
  // 지어낸 새 위젯 코드: 받은 버전과 붙여 넣은 버전을 적은 위젯을 둔다.
  const libCode = `module.exports = { version: ${JSON.stringify(NEWER)}, run: async (host, cfg) => { const w = new host.ListWidget(); w.addText("받아 둔 " + cfg.version + " / " + cfg.baseVersion); host.Script.setWidget(w); } };\n// CalendarFIF widget code end\n`;
  const cached = () => ({
    '/docs/calendarfif-widget-lib.js': libCode,
    '/docs/calendarfif-update.json': JSON.stringify({ version: NEWER, checkedAt: now().getTime(), triedAt: now().getTime(), unfinished: {}, skipUntil: 0, note: '', libNote: '' }),
  });

  it('받아 둔 새 코드가 있으면 그것이 위젯을 두고, 붙여 넣은 것은 그리지 않는다', async () => {
    const host = makeNative({ keychain: loggedIn, files: cached() });
    await run(host, versioned, now);
    expect(host.state.setWidgets).toHaveLength(1);
    expect(textsOf(lastWidget(host))).toEqual([`받아 둔 ${NEWER} / 0.9.0 (2026-11-16)`]);
    expect(host.state.requests).toEqual([]); // 방금 확인했으므로 묻지 않고, 달도 읽지 않는다(새 코드가 할 일이다)
  });

  it('받아 둔 것이 없으면 붙여 넣은 것으로 그리고, 그 뒤에 새 버전을 묻는다', async () => {
    const host = makeNative({ keychain: loggedIn });
    await run(host, versioned, now);
    expect(host.state.setWidgets).toHaveLength(1);
    expect(textsOf(lastWidget(host))).not.toContain(`받아 둔 ${NEWER} / 0.9.0 (2026-11-16)`);
    const urls = host.state.requests.map((r) => r.url);
    expect(urls.at(-1)).toBe(`https://example.test/widget/version.json?t=${now().getTime()}`);
    expect(urls.findIndex((u) => u.includes('/months/'))).toBeLessThan(urls.length - 1); // 달을 읽어 그린 뒤에 묻는다
  });

  it('버전을 모르는 스크립트는 업데이트를 묻지 않는다', async () => {
    const host = makeNative({ keychain: loggedIn, files: cached() });
    await run(host, cfg, now);
    expect(host.state.requests.some((r) => r.url.includes('/widget/'))).toBe(false);
    expect(textsOf(lastWidget(host))).not.toContain(`받아 둔 ${NEWER} / undefined`);
  });

  it('넘겨받은 실행이 오류를 내면 오류 위젯을 두지 않고 던진다(붙여 넣은 스크립트가 자기 것으로 그린다)', async () => {
    const host = makeNative({ keychain: loggedIn });
    host.Keychain.get = () => { throw new Error('깨짐'); };
    await expect(run(host, { ...versioned, handedOver: true, baseVersion: '0.8.3 (2026-11-16)' }, now)).rejects.toThrow('깨짐');
    expect(host.state.setWidgets).toEqual([]);
    // 붙여 넣은 스크립트 자신은 전처럼 오류 위젯을 둔다.
    const base = makeNative({ keychain: loggedIn });
    base.Keychain.get = () => { throw new Error('깨짐'); };
    await run(base, versioned, now);
    expect(textsOf(lastWidget(base))).toEqual(['오류', '깨짐', '(0.9.0 (2026-11-16))']);
  });

  it('받아 둔 새 코드가 오류를 내면 붙여 넣은 것으로 그린다', async () => {
    const failing = `module.exports = { version: ${JSON.stringify(NEWER)}, run: async () => { throw new Error("새 버전의 잘못"); } };\n// CalendarFIF widget code end\n`;
    const host = makeNative({ keychain: loggedIn, files: { ...cached(), '/docs/calendarfif-widget-lib.js': failing } });
    await run(host, versioned, now);
    expect(host.state.setWidgets).toHaveLength(1);
    expect(textsOf(lastWidget(host))).not.toContain('오류');
    expect(host.state.requests.some((r) => r.url.includes('/months/'))).toBe(true); // 붙여 넣은 것이 달을 읽어 그렸다
  });

  it('Scriptable 앱의 메뉴에 스스로 받는다는 줄을 적는다', async () => {
    const host = make({ runsInApp: true, keychain: loggedIn, alerts: [{ button: -1 }] });
    await run(host, versioned, now);
    expect(host.state.alerts[0].title).toBe('CalendarFIF 위젯 0.9.0 (2026-11-16) · 알림 0개 예약됨');
    expect(host.state.alerts[0].message.split('\n\n')).toEqual(['앞으로 7일 안에 울릴 알림이 없습니다.', expect.stringContaining('새 버전이 나오면 스스로 받습니다.')]);
  });
});

describe('위젯을 눌렀을 때 여는 곳(매개변수 inapp)', () => {
  /** Scriptable의 WebView를 흉내 낸 것을 전역에 둔다. 무엇을 불렀는지 적어 둔다. */
  const withWebView = (fail = false) => {
    const log: { loaded: string[]; presented: unknown[] } = { loaded: [], presented: [] };
    class WebView {
      async loadURL(url: string): Promise<void> {
        if (fail) throw new Error('연결할 수 없다');
        log.loaded.push(url);
      }
      async present(fullscreen?: boolean): Promise<void> {
        log.presented.push(fullscreen);
      }
    }
    (globalThis as Record<string, unknown>).WebView = WebView;
    return log;
  };
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).WebView;
  });

  it('기본은 웹앱의 주소이고, inapp(또는 앱안)이면 이 스크립트를 다시 돌리는 주소다', async () => {
    const plain = makeNative({ keychain: loggedIn });
    await run(plain, cfg, now);
    expect(lastWidget(plain).props.url).toBe('https://example.test/');
    for (const widgetParameter of ['inapp', 'dark 앱안']) {
      const host = makeNative({ keychain: loggedIn, widgetParameter, scriptName: 'CalendarFIF 달력' });
      await run(host, cfg, now);
      expect(lastWidget(host).props.url).toBe(`scriptable:///run/${encodeURIComponent('CalendarFIF 달력')}?open=calendar`);
    }
    // 그림 위젯과 로그인 안내 위젯도 같다.
    const picture = make({ keychain: loggedIn, widgetParameter: 'image inapp' });
    await run(picture, cfg, now);
    expect(lastWidget(picture).props.url).toBe('scriptable:///run/CalendarFIF?open=calendar');
    const loggedOut = makeNative({ widgetParameter: 'inapp' });
    await run(loggedOut, cfg, now);
    expect(lastWidget(loggedOut).props.url).toBe('scriptable:///run/CalendarFIF?open=calendar');
  });

  it('스크립트의 이름을 알 수 없으면 웹앱의 주소로 둔다', async () => {
    const noName = makeNative({ keychain: loggedIn, widgetParameter: 'inapp' });
    delete noName.Script.name;
    await run(noName, cfg, now);
    expect(lastWidget(noName).props.url).toBe('https://example.test/');
    const throwing = makeNative({ keychain: loggedIn, widgetParameter: 'inapp' });
    throwing.Script.name = () => { throw new Error('이름 시험 오류'); };
    await run(throwing, cfg, now);
    expect(lastWidget(throwing).props.url).toBe('https://example.test/');
    const empty = makeNative({ keychain: loggedIn, widgetParameter: 'inapp', scriptName: '' });
    await run(empty, cfg, now);
    expect(lastWidget(empty).props.url).toBe('https://example.test/');
    const odd = makeNative({ keychain: loggedIn, widgetParameter: 'inapp' });
    odd.Script.name = (() => 42) as unknown as () => string;
    await run(odd, cfg, now);
    expect(lastWidget(odd).props.url).toBe('https://example.test/');
    // 이름에 주소에서 뜻이 있는 글자가 있어도 깨지지 않는다.
    const symbols = makeNative({ keychain: loggedIn, widgetParameter: 'inapp', scriptName: '달력 #1/집?' });
    await run(symbols, cfg, now);
    expect(lastWidget(symbols).props.url).toBe('scriptable:///run/%EB%8B%AC%EB%A0%A5%20%231%2F%EC%A7%91%3F?open=calendar');
  });

  it('그 주소로 Scriptable이 열리면 메뉴 대신 달력을 Scriptable 안에서 전체 화면으로 연다. 위젯의 로그인과는 상관없다', async () => {
    for (const keychain of [loggedIn, {}]) {
      const log = withWebView();
      const host = make({ runsInApp: true, keychain, queryParameters: { open: 'calendar' } });
      await run(host, cfg, now);
      expect([log.loaded, log.presented, host.state.alerts.length, host.state.requests.length]).toEqual([['https://example.test/?via=widget'], [true], 0, 0]);
    }
  });

  it('WebView가 없거나 띄우지 못하면 전처럼 메뉴를 보인다', async () => {
    const none = make({ runsInApp: true, keychain: loggedIn, queryParameters: { open: 'calendar' }, alerts: [{ button: -1 }] });
    await run(none, cfg, now);
    expect(none.state.alerts[0].actions).toEqual(['미리 보기', '시험 알림 (1분 뒤)', '로그아웃']);
    // 만들다가, 또는 띄우다가 오류가 나는 WebView.
    for (const broken of [class { constructor() { throw new Error('만들 수 없다'); } }, class { loadURL() { return Promise.resolve(); } present() { return Promise.reject(new Error('띄울 수 없다')); } }]) {
      (globalThis as Record<string, unknown>).WebView = broken;
      const host = make({ runsInApp: true, keychain: loggedIn, queryParameters: { open: 'calendar' }, alerts: [{ button: -1 }] });
      await run(host, cfg, now);
      expect(host.state.alerts).toHaveLength(1);
    }
  });

  it('불러오기를 기다리지 않고 바로 띄운다: 불러오지 못하거나 끝나지 않아도 화면은 뜨고, 닫으면 끝난다', async () => {
    const failing = withWebView(true);
    const offline = make({ runsInApp: true, keychain: loggedIn, queryParameters: { open: 'calendar' } });
    await run(offline, cfg, now);
    expect([failing.presented, offline.state.alerts.length]).toEqual([[true], 0]);
    // 끝나지 않는 불러오기.
    const presented: unknown[] = [];
    (globalThis as Record<string, unknown>).WebView = class { loadURL() { return new Promise(() => {}); } async present(fullscreen?: boolean) { presented.push(fullscreen); } };
    const slow = make({ runsInApp: true, keychain: loggedIn, queryParameters: { open: 'calendar' } });
    await run(slow, cfg, now);
    expect([presented, slow.state.alerts.length]).toEqual([[true], 0]);
  });

  it('host가 아니라 Scriptable의 전역에서 WebView를 가져온다(이미 붙여 넣은 스크립트는 WebView를 넘기지 않는다). 넘겨받은 실행도 같다', async () => {
    const log = withWebView();
    const host = make({ runsInApp: true, keychain: loggedIn, queryParameters: { open: 'calendar' } });
    expect('WebView' in host).toBe(false);
    await run(host, { ...cfg, version: '0.9.1 (2026-11-16)', handedOver: true, baseVersion: '0.9.0 (2026-11-16)' }, now);
    expect([log.loaded, log.presented, host.state.requests.length]).toEqual([['https://example.test/?via=widget'], [true], 0]);
  });

  it('예약만 하러 온 주소(schedule=1)와 같이 오면 달력을 연다. 웹앱의 단추는 schedule=1만 보낸다', async () => {
    const log = withWebView();
    const both = make({ runsInApp: true, keychain: loggedIn, queryParameters: { open: 'calendar', schedule: '1' } });
    await run(both, cfg, now);
    expect([log.presented, both.state.alerts.length]).toEqual([[true], 0]);
    const only = make({ runsInApp: true, keychain: loggedIn, queryParameters: { schedule: '1' } });
    await run(only, cfg, now);
    expect(log.presented).toEqual([true]); // 달력을 다시 열지 않았다
  });

  it('달력을 열지 못하면 메뉴에 까닭을 적는다. 그냥 돌렸을 때는 그 줄이 없다', async () => {
    const lineOf = (h: FakeHost): string | undefined => h.state.alerts[0].message.split('\n\n').find((l) => l.startsWith('달력을 Scriptable 안에서 열지 못했습니다'));
    const none = make({ runsInApp: true, keychain: loggedIn, queryParameters: { open: 'calendar' }, alerts: [{ button: -1 }] });
    await run(none, cfg, now);
    expect(lineOf(none)).toBe('달력을 Scriptable 안에서 열지 못했습니다: Scriptable의 WebView를 찾지 못했다');
    (globalThis as Record<string, unknown>).WebView = class { loadURL() { return Promise.resolve(); } present() { return Promise.reject(new Error('띄울 수 없다')); } };
    const failing = make({ runsInApp: true, keychain: loggedIn, queryParameters: { open: 'calendar' }, alerts: [{ button: -1 }] });
    await run(failing, cfg, now);
    expect(lineOf(failing)).toBe('달력을 Scriptable 안에서 열지 못했습니다: 띄울 수 없다');
    const plain = make({ runsInApp: true, keychain: loggedIn, alerts: [{ button: -1 }] });
    await run(plain, cfg, now);
    expect(lineOf(plain)).toBeUndefined();
    // 위젯에 로그인하지 않았으면 메뉴가 없으므로, 로그인 창 앞에 따로 알린다.
    delete (globalThis as Record<string, unknown>).WebView;
    const loggedOut = make({ runsInApp: true, queryParameters: { open: 'calendar' }, alerts: [{ button: 0 }, { button: -1 }] });
    await run(loggedOut, cfg, now);
    expect([loggedOut.state.alerts[0].title, loggedOut.state.alerts[0].message, loggedOut.state.alerts.length]).toEqual(['CalendarFIF 위젯', '달력을 Scriptable 안에서 열지 못했습니다: Scriptable의 WebView를 찾지 못했다', 2]);
  });

  it('위젯 편집의 "When Interacting"이 "Run Script"인 위젯에서 오면(앱 안의 실행에 위젯의 매개변수가 같이 온다) 달력을 연다', async () => {
    for (const widgetParameter of ['inapp', 'dark 앱안']) {
      const log = withWebView();
      const host = make({ runsInApp: true, keychain: loggedIn, widgetParameter });
      await run(host, cfg, now);
      expect([log.loaded, log.presented, host.state.alerts.length]).toEqual([['https://example.test/?via=widget'], [true], 0]);
    }
    // 매개변수에 inapp이 없으면 전처럼 메뉴다.
    const log = withWebView();
    const other = make({ runsInApp: true, keychain: loggedIn, widgetParameter: 'dark', alerts: [{ button: -1 }] });
    await run(other, cfg, now);
    expect([log.presented, other.state.alerts.length]).toEqual([[], 1]);
  });

  it('다른 주소 매개변수로 열리면 달력을 열지 않는다', async () => {
    const log = withWebView();
    const host = make({ runsInApp: true, keychain: loggedIn, alerts: [{ button: -1 }] });
    await run(host, cfg, now);
    expect([log.loaded, host.state.alerts.length]).toEqual([[], 1]);
  });
});
