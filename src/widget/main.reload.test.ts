// 달력에서 저장하면 위젯을 바로 새로 그리게 하는 흐름(reload.ts와 main.ts가 맞물리는 곳).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from './api';
import { makeFakeHost, type FakeAnswer, type FakeHost, type FakeOptions, type FakeRequest } from './fakeHost';
import { run } from './main';
import { CREDIT_MS, SETTLE_MS, type ReloadTry } from './reload';

const cfg: Config = { projectId: 'demo-calfif', apiKey: 'demo-key', appUrl: 'https://example.test/' };
const T0 = new Date(2026, 10, 17, 14, 0, 0).getTime();
/** 가짜 시계를 따르는 지금. */
const now = () => new Date();
const CACHE = '/docs/calendarfif-cache.json';
const loggedIn = { 'calendarfif.refreshToken': 'RT1', 'calendarfif.uid': 'owner-test-uid' };
const memoDoc = { fields: { days: { mapValue: { fields: {} } } } };
const handler = (req: FakeRequest): FakeAnswer => (req.url.includes('/v1/token') ? { body: { id_token: 'ID2', refresh_token: 'RT1', user_id: 'owner-test-uid' } } : { body: memoDoc });
const make = (o: FakeOptions): FakeHost => makeFakeHost({ handler, ...o });
const cacheOf = (h: FakeHost): Record<string, unknown> => JSON.parse(h.state.files.get(CACHE) ?? '{}');
const triesIn = (h: FakeHost): ReloadTry[] => ((cacheOf(h).reload as { tries?: ReloadTry[] } | undefined)?.tries ?? []);
const seed = (cache: Record<string, unknown>): Record<string, string> => ({ [CACHE]: JSON.stringify(cache) });

const edit = { monthId: '2026-11', day: '19', text: '', color: '', editedAt: T0 - 500 };
const other = { monthId: '2026-11', day: '20', text: '회의', color: '', editedAt: T0 - 400 };
/** 웹 화면이 적어 두는 글. n은 편집 목록이 달라질 때마다 는다(저장 +1, 서버에 올라감 +1). */
const message = (n: number, edits: unknown[] = []): string => JSON.stringify({ v: 1, uid: 'owner-test-uid', n, edits });
const tried = (how: ReloadTry['how'], why: ReloadTry['why'], at: number, more: Partial<ReloadTry> = {}): ReloadTry => ({ how, why, at, got: 0, alive: how === 'finish', void: false, away: false, shut: false, err: '', ...more });
/** 오래전에 메뉴에서 두 번 시험해 두 번 다 그려진 기록: 그 방법이 되는 것으로 가려져 있다. */
const PROOF = 2;
const proven = (how: ReloadTry['how']): Record<string, unknown> => ({
  reload: { epoch: 1, tries: [600_000, 595_000].map((ago) => tried(how, 'probe', T0 - ago, { got: T0 - ago + 900, alive: true })) },
});

/** 닫기 전에는 닫히지 않는 가짜 WebView. state: 지금 웹 화면이 답하는 [적어 둔 글, 보이는지]. */
function withView() {
  const view = { state: [message(1), 'visible'] as [string, string], reads: 0, presented: 0, loaded: [] as string[], close: (): void => {} };
  (globalThis as Record<string, unknown>).WebView = class {
    async loadURL(url: string): Promise<void> {
      view.loaded.push(url);
    }
    present(): Promise<void> {
      view.presented += 1;
      return new Promise((resolve) => {
        view.close = resolve;
      });
    }
    async evaluateJavaScript(js: string): Promise<string> {
      if (js.includes('__calfifApp')) return JSON.stringify({ app: '0.9.13', sw: false, bridge: true, log: '' });
      view.reads += 1;
      return JSON.stringify(view.state);
    }
  };
  return view;
}
const openHost = (cache: Record<string, unknown> = {}) => make({ runsInApp: true, keychain: loggedIn, queryParameters: { open: 'calendar' }, files: seed(cache) });
/** 달력을 열고 처음 읽기(0초, 0.3초, 0.6초)를 지나게 한다. */
async function opened(host: FakeHost) {
  const state = { finished: false };
  const done = run(host, cfg, now).then(() => {
    state.finished = true;
  });
  await vi.advanceTimersByTimeAsync(600);
  return { state, done };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as Record<string, unknown>).WebView;
  delete (globalThis as Record<string, unknown>).Safari;
});

describe('달력에서 저장했을 때', () => {
  it('되는 것으로 가려진 방법이 없으면 달력을 띄운 채 스크립트를 끝낸다(화면 앞에 있을 때 끝나야 위젯이 그려진다)', async () => {
    const view = withView();
    const host = openHost();
    const { state, done } = await opened(host);
    expect(state.finished).toBe(false);
    view.state = [message(2, [edit]), 'visible'];
    await vi.advanceTimersByTimeAsync(300);
    await done;
    expect(state.finished).toBe(true);
    // 끝내기 전에 올리지 못한 편집을 적어 두었다(위젯이 그리면서 얹는다). 닫은 것이 아니므로 닫았다고 적지 않는다.
    expect(cacheOf(host)).toMatchObject({ pending: { uid: 'owner-test-uid', edits: [edit] }, session: T0 });
    expect(cacheOf(host).leave).toBeUndefined();
    expect(triesIn(host)).toEqual([tried('finish', 'save', T0 + 900)]);
    // 붙여 넣은 스크립트의 마지막 새 버전 확인이 바로 실패하게 해 둔다(네트워크를 기다리지 않고 끝나게).
    await expect(new host.Request('https://example.test/widget/version.json').loadString()).rejects.toThrow('스크립트를 바로 끝내려고 확인을 건너뛰었다');
    await expect(new host.Request('https://example.test/widget/version.json').loadJSON()).rejects.toThrow('스크립트를 바로 끝내려고 확인을 건너뛰었다');
    // 끝낸 뒤에는 더 읽지 않는다.
    const reads = view.reads;
    await vi.advanceTimersByTimeAsync(5000);
    expect(view.reads).toBe(reads);
  });

  it('처음 읽은 것과 달라지지 않은 것은 저장으로 보지 않는다', async () => {
    const view = withView();
    view.state = [message(1, [edit]), 'visible']; // 앞에 올리지 못해 남아 있던 편집
    const host = openHost();
    const { state } = await opened(host);
    await vi.advanceTimersByTimeAsync(3000);
    expect([state.finished, triesIn(host)]).toEqual([false, []]);
  });

  it('앞서 남아 있던 편집이 달력을 열자마자 서버에 올라간 것은 저장이 아니다(스크립트를 끝내지 않는다). 그 뒤의 저장은 저장이다', async () => {
    const view = withView();
    view.state = [message(1, [edit, other]), 'visible'];
    const host = openHost();
    const { state, done } = await opened(host);
    // 하나가 올라갔다, 나머지도 올라갔다, 보여 주는 값만 달라졌다(n은 그대로다).
    for (const next of [message(2, [other]), message(3), message(3)]) {
      view.state = [next, 'visible'];
      await vi.advanceTimersByTimeAsync(300);
    }
    view.state = [message(3, []), 'visible'];
    await vi.advanceTimersByTimeAsync(900);
    expect([state.finished, triesIn(host)]).toEqual([false, []]);
    expect(cacheOf(host).pending).toMatchObject({ edits: [] });
    // 이제 저장했다.
    view.state = [message(4, [edit]), 'visible'];
    await vi.advanceTimersByTimeAsync(300);
    await done;
    expect(triesIn(host).map((t) => [t.how, t.why])).toEqual([['finish', 'save']]);
  });

  it('스크립트가 읽는 사이에 저장하고 서버에 올라가서 목록이 다시 비어도, n이 둘 늘어 저장이 있었음을 안다', async () => {
    const view = withView();
    const host = openHost();
    const { done } = await opened(host);
    view.state = [message(3), 'visible'];
    await vi.advanceTimersByTimeAsync(300);
    await done;
    expect(triesIn(host).map((t) => t.how)).toEqual(['finish']);
  });

  it('n을 적지 않는 옛 웹앱(0.9.12까지)에서도 목록에 새 편집이 생기면 저장으로 본다', async () => {
    const view = withView();
    const old = (edits: unknown[]): string => JSON.stringify({ v: 1, uid: 'owner-test-uid', edits });
    view.state = [old([]), 'visible'];
    const host = openHost();
    const { done } = await opened(host);
    view.state = [old([edit]), 'visible'];
    await vi.advanceTimersByTimeAsync(300);
    await done;
    expect(triesIn(host).map((t) => t.how)).toEqual(['finish']);
  });

  it('setWidget이 되는 것으로 가려져 있으면 그것을 하고 달력을 계속 지켜본다. 방금 한 것을 지켜보는 동안에는 하기만 하고 따로 적지 않는다', async () => {
    const view = withView();
    const host = openHost(proven('setWidget'));
    const { state } = await opened(host);
    view.state = [message(2, [edit]), 'visible'];
    await vi.advanceTimersByTimeAsync(300);
    expect([state.finished, host.state.setWidgets.length]).toEqual([false, 1]);
    expect(triesIn(host).slice(PROOF)).toEqual([tried('setWidget', 'save', T0 + 900)]);
    // 곧바로 또 저장했다: 또 하지만 적지는 않는다(위젯이 한 번만 그릴 수 있다).
    view.state = [message(3, [edit, other]), 'visible'];
    await vi.advanceTimersByTimeAsync(300);
    expect([host.state.setWidgets.length, triesIn(host).length]).toEqual([2, PROOF + 1]);
    // 그림이 적힐 수 있는 시간이 지난 뒤의 저장은 새로 적는다. 저장할 때 한 것에는 살아 있음을 적지 않는다(위젯이 같은 파일을 쓰는 때와 겹치지 않게).
    await vi.advanceTimersByTimeAsync(CREDIT_MS);
    view.state = [message(5, [edit]), 'visible'];
    await vi.advanceTimersByTimeAsync(300);
    expect([state.finished, host.state.setWidgets.length, triesIn(host).length]).toEqual([false, 3, PROOF + 2]);
    expect(triesIn(host)[PROOF]).toEqual(tried('setWidget', 'save', T0 + 900));
    expect(view.reads).toBeGreaterThan(10);
  });

  it('ping이 되는 것으로 가려져 있으면 이 스크립트를 주소로 한 번 더 돌린다. Safari.open이 없으면 못 했다고 적는다', async () => {
    const open = vi.fn();
    (globalThis as Record<string, unknown>).Safari = { open };
    const view = withView();
    const host = openHost(proven('ping'));
    const { state } = await opened(host);
    view.state = [message(2, [edit]), 'visible'];
    await vi.advanceTimersByTimeAsync(300);
    expect(open.mock.calls).toEqual([['scriptable:///run/CalendarFIF?open=calendar&ping=1']]);
    expect([state.finished, triesIn(host)[PROOF]]).toEqual([false, tried('ping', 'save', T0 + 900)]);

    delete (globalThis as Record<string, unknown>).Safari;
    const view2 = withView();
    const none = openHost(proven('ping'));
    await opened(none);
    view2.state = [message(2, [edit]), 'visible'];
    await vi.advanceTimersByTimeAsync(300);
    expect(triesIn(none)[PROOF]).toEqual(tried('ping', 'save', T0 + 1800, { err: 'Safari.open이 없다' }));
  });

  it('스크립트 이름에 빈칸이 있으면 주소에 맞게 바꿔 적는다', async () => {
    const open = vi.fn();
    (globalThis as Record<string, unknown>).Safari = { open };
    const view = withView();
    const host = make({ runsInApp: true, keychain: loggedIn, queryParameters: { open: 'calendar' }, files: seed(proven('ping')), scriptName: 'Untitled Script' });
    await opened(host);
    view.state = [message(2, [edit]), 'visible'];
    await vi.advanceTimersByTimeAsync(300);
    expect(open.mock.calls).toEqual([['scriptable:///run/Untitled%20Script?open=calendar&ping=1']]);
  });

  it('complete가 되는 것으로 가려져 있으면 Script.complete()를 부르고 계속 지켜본다', async () => {
    const view = withView();
    const host = openHost(proven('complete'));
    const { state } = await opened(host);
    view.state = [message(2, [edit]), 'visible'];
    await vi.advanceTimersByTimeAsync(300);
    expect([state.finished, host.state.completed, triesIn(host)[PROOF]]).toEqual([false, 1, tried('complete', 'save', T0 + 900)]);
  });

  it('메뉴에서 한 번만 그려진 방법은 아직 쓰지 않는다(스크립트를 끝낸다)', async () => {
    const view = withView();
    const once = { reload: { epoch: 1, tries: [tried('setWidget', 'probe', T0 - 600_000, { got: T0 - 599_000, alive: true })] } };
    const host = openHost(once);
    const { done } = await opened(host);
    view.state = [message(2, [edit]), 'visible'];
    await vi.advanceTimersByTimeAsync(300);
    await done;
    expect([host.state.setWidgets.length, triesIn(host)[1]]).toEqual([0, tried('finish', 'save', T0 + 900)]);
  });

  it('스크립트 끝내기까지 안 되는 것으로 가려져 있으면 아무것도 하지 않고 계속 지켜본다', async () => {
    const view = withView();
    const twice = [tried('finish', 'save', T0 - 120_000), tried('finish', 'save', T0 - 60_000)];
    const host = openHost({ reload: { epoch: 1, tries: twice } });
    const { state } = await opened(host);
    view.state = [message(2, [edit]), 'visible'];
    await vi.advanceTimersByTimeAsync(3000);
    expect([state.finished, triesIn(host)]).toEqual([false, twice]);
  });
});

describe('지켜보던 시도', () => {
  it('화면이 가려지면(홈 화면으로 나갔다) 나가서 지켜보지 못했다고 적는다(무효는 아니다: 그려지면 위젯이 적는다). 나갔다고도 적는다', async () => {
    const view = withView();
    const host = openHost(proven('setWidget'));
    await opened(host);
    view.state = [message(2, [edit]), 'visible'];
    await vi.advanceTimersByTimeAsync(300);
    view.state = [message(2, [edit]), 'hidden'];
    await vi.advanceTimersByTimeAsync(300);
    expect(triesIn(host)[PROOF]).toMatchObject({ how: 'setWidget', away: true, void: false, shut: false });
    expect(cacheOf(host).leave).toEqual({ at: T0 + 1200, how: 'left' });
    // 나간 뒤에 위젯이 그리면 그 시도에 적힌다(같은 보관 파일을 쓰는 위젯 실행).
    const widget = make({ keychain: loggedIn, files: seed(cacheOf(host)) });
    await run(widget, cfg, now);
    expect(triesIn(widget)[PROOF]).toMatchObject({ how: 'setWidget', away: true, got: Date.now() });
  });

  it('그림이 적힐 수 있는 시간(5초)이 지난 뒤에 가려진 것은 그대로 둔다: 화면 앞에서 지켜보고도 그려지지 않은 것이다', async () => {
    const view = withView();
    const host = openHost(proven('setWidget'));
    await opened(host);
    view.state = [message(2, [edit]), 'visible'];
    await vi.advanceTimersByTimeAsync(300 + CREDIT_MS);
    view.state = [message(2, [edit]), 'hidden'];
    await vi.advanceTimersByTimeAsync(600);
    expect(triesIn(host)[PROOF]).toEqual(tried('setWidget', 'save', T0 + 900));
  });

  it('저장하고 5초 안에 닫기를 누르면 그 시도는 무효다: 닫히면 스크립트가 끝나고 그것이 위젯을 그리게 한다', async () => {
    // 닫힌 웹 화면이 그대로 보인다고 답하는 경우와 가려졌다고 답하는 경우.
    for (const after of ['visible', 'hidden']) {
      const view = withView();
      const host = openHost(proven('setWidget'));
      const { done } = await opened(host);
      view.state = [message(2, [edit]), 'visible'];
      await vi.advanceTimersByTimeAsync(300);
      view.state = [message(2, [edit]), after];
      view.close();
      await vi.advanceTimersByTimeAsync(400);
      await done;
      expect(triesIn(host)[PROOF]).toEqual(tried('setWidget', 'save', Date.now() - 400, { void: true }));
      // 닫은 것으로 적는다(홈 화면으로 나간 것으로 적지 않는다). 그 뒤에 그려진 것은 그 시도의 것이 아니다.
      expect(cacheOf(host).leave).toMatchObject({ how: 'closed' });
      const widget = make({ keychain: loggedIn, files: seed(cacheOf(host)) });
      await run(widget, cfg, now);
      expect(triesIn(widget)[PROOF]).toMatchObject({ got: 0, void: true });
    }
  });

  it('편집 화면을 연 채 닫기를 누르면(닫히면서 저장된다) 닫힌 뒤에는 아무것도 더 하지 않는다', async () => {
    const open = vi.fn();
    (globalThis as Record<string, unknown>).Safari = { open };
    const view = withView();
    const host = openHost(proven('ping'));
    const { done } = await opened(host);
    view.state = [message(2, [edit]), 'hidden'];
    view.close();
    await vi.advanceTimersByTimeAsync(400);
    await done;
    expect([open.mock.calls.length, triesIn(host).length]).toEqual([0, PROOF]);
    // 닫히면서 저장된 것은 받아 적었다(스크립트가 끝나면서 위젯이 그린다).
    expect(cacheOf(host)).toMatchObject({ leave: { how: 'closed' }, pending: { edits: [edit] } });
  });

  it('다 지켜본 뒤에 닫은 것은 그대로 둔다', async () => {
    const view = withView();
    const host = openHost(proven('setWidget'));
    const { done } = await opened(host);
    view.state = [message(2, [edit]), 'visible'];
    await vi.advanceTimersByTimeAsync(300 + SETTLE_MS);
    view.close();
    await vi.advanceTimersByTimeAsync(400);
    await done;
    expect(triesIn(host)[PROOF]).toEqual(tried('setWidget', 'save', T0 + 900));
  });

  it('앱이 멈춰 있다가 깨어났으면(읽기 사이가 길게 벌어졌다) 그 사이의 것은 지켜보지 못한 것으로 적는다', async () => {
    const view = withView();
    const host = openHost(proven('setWidget'));
    await opened(host);
    view.state = [message(2, [edit]), 'visible'];
    await vi.advanceTimersByTimeAsync(300);
    // 타이머는 돌지 않고 시계만 10분 간다.
    vi.setSystemTime(Date.now() + 600_000);
    await vi.advanceTimersByTimeAsync(300);
    expect(triesIn(host)[PROOF]).toMatchObject({ away: true, void: false });
  });
});

describe('편집 화면을 연 채 나갔을 때', () => {
  it('가려지면서 저장된 것은 나갈 때 청해 둔다(판정에는 넣지 않는다). 가려진 방법이 없으면 스크립트를 끝낸다', async () => {
    const view = withView();
    const host = openHost();
    const { done } = await opened(host);
    view.state = [message(2, [edit]), 'hidden'];
    await vi.advanceTimersByTimeAsync(300);
    await done;
    expect(triesIn(host)).toEqual([tried('finish', 'leave', T0 + 900, { void: true })]);
    expect(cacheOf(host)).toMatchObject({ leave: { at: T0 + 900, how: 'left' }, pending: { edits: [edit] } });

    const view2 = withView();
    const kept = openHost(proven('setWidget'));
    const second = await opened(kept);
    view2.state = [message(2, [edit]), 'hidden'];
    await vi.advanceTimersByTimeAsync(300);
    expect([second.state.finished, kept.state.setWidgets.length]).toEqual([false, 1]);
    expect(triesIn(kept)[PROOF]).toMatchObject({ how: 'setWidget', why: 'leave', void: true });
  });

  it('돌아와서(다시 보인다) 저장하고 또 나가면 다시 나갔다고 적는다', async () => {
    const view = withView();
    const host = openHost(proven('setWidget'));
    await opened(host);
    view.state = [message(1), 'hidden'];
    await vi.advanceTimersByTimeAsync(300);
    expect(cacheOf(host).leave).toEqual({ at: T0 + 900, how: 'left' });
    view.state = [message(2, [edit]), 'visible'];
    await vi.advanceTimersByTimeAsync(300);
    expect(host.state.setWidgets).toHaveLength(1);
    view.state = [message(2, [edit]), 'hidden'];
    await vi.advanceTimersByTimeAsync(300);
    expect(cacheOf(host).leave).toEqual({ at: T0 + 1500, how: 'left' });
  });
});

describe('위젯을 다시 눌러 새 달력이 떴을 때', () => {
  it('앞의 실행은 가려진 달력을 더 지켜보지 않는다. 새 달력이 적은 것을 덮어쓰지 않고, 스크립트는 그 달력이 닫힐 때 끝난다', async () => {
    const view = withView();
    const host = openHost();
    const { state, done } = await opened(host);
    expect(cacheOf(host).session).toBe(T0);
    // 새 실행이 자기 번호(더 크다)와 떠 있는 때를 적었다.
    host.state.files.set(CACHE, JSON.stringify({ ...cacheOf(host), session: T0 + 1000, activeAt: 7, bridge: { at: 7, ok: 1, fail: 0, lastOkAt: 7, lastError: '' } }));
    const before = host.state.files.get(CACHE);
    await vi.advanceTimersByTimeAsync(4000);
    const reads = view.reads;
    await vi.advanceTimersByTimeAsync(20_000);
    // 더 읽지 않고 더 적지 않는다. 새 달력이 떠 있는 동안에는 끝내지 않는다(끝나는 것이 새 달력을 건드리는지 모른다).
    expect([state.finished, view.reads, host.state.files.get(CACHE)]).toEqual([false, reads, before]);
    expect(cacheOf(host)).toMatchObject({ session: T0 + 1000, activeAt: 7 });
    // 가려진 달력은 스크립트가 없는 안내 쪽으로 바꾼다(남은 웹앱이 서버에 붙어 있거나 오류를 적지 않게).
    expect(view.loaded).toEqual([`https://example.test/?via=widget&t=${T0}`, 'https://example.test/closed.html']);
    // 가려져 있던 그 달력을 닫으면 끝난다. 닫았다고 적지 않고(새 달력의 기록이다) 요청도 그대로 된다.
    view.close();
    await vi.advanceTimersByTimeAsync(0);
    await done;
    expect([state.finished, cacheOf(host).leave]).toEqual([true, undefined]);
    await expect(new host.Request('https://example.test/x').loadString()).resolves.toBeDefined();
  });

  it('안내 쪽의 주소는 웹앱 주소의 폴더에 붙인다. 물음표와 # 뒤는 뗀다', async () => {
    for (const [appUrl, page] of [['https://example.test', 'https://example.test/closed.html'], ['https://example.test/app/index.html?x=1#top', 'https://example.test/app/closed.html'], ['https://example.test/app/', 'https://example.test/app/closed.html']]) {
      const view = withView();
      const host = openHost();
      void run(host, { ...cfg, appUrl }, now);
      await vi.advanceTimersByTimeAsync(600);
      host.state.files.set(CACHE, JSON.stringify({ ...cacheOf(host), session: Date.now() + 1000 }));
      await vi.advanceTimersByTimeAsync(4000);
      expect(view.loaded.at(-1)).toBe(page);
    }
  });

  it('보관 파일의 번호가 더 작으면(다른 쪽이 옛 것을 다시 적었다) 그대로 지켜본다', async () => {
    const view = withView();
    const host = openHost();
    const { state } = await opened(host);
    host.state.files.set(CACHE, JSON.stringify({ ...cacheOf(host), session: T0 - 5000 }));
    const reads = view.reads;
    await vi.advanceTimersByTimeAsync(4000);
    expect([state.finished, view.reads > reads]).toEqual([false, true]);
  });
});

describe('빈 실행(ping)', () => {
  it('받아 쓰는 코드는 아무것도 띄우지 않고 네트워크도 쓰지 않고 바로 끝난다(붙여 넣은 0.9.0은 그 앞에 새 버전을 확인한다)', async () => {
    const view = withView();
    const host = make({ runsInApp: true, keychain: loggedIn, queryParameters: { open: 'calendar', ping: '1' } });
    await run(host, { ...cfg, handedOver: true }, now);
    expect([view.presented, host.state.alerts.length, host.state.requests.length, host.state.files.has(CACHE)]).toEqual([0, 0, 0, false]);
    await expect(new host.Request('https://example.test/widget/version.json').loadString()).rejects.toThrow('스크립트를 바로 끝내려고');
  });
});

describe('위젯이 그릴 때', () => {
  it('그 바로 앞에 한 시도에 그림의 시각을 적는다. 너무 앞의 것에는 적지 않는다', async () => {
    const mine = tried('finish', 'save', T0 - 1000);
    const host = make({ keychain: loggedIn, files: seed({ reload: { epoch: 1, tries: [tried('ping', 'probe', T0 - 60_000), mine] } }) });
    await run(host, cfg, now);
    expect(host.state.setWidgets).toHaveLength(1);
    expect(triesIn(host)).toEqual([tried('ping', 'probe', T0 - 60_000), { ...mine, got: T0 }]);
    expect((cacheOf(host).draws as { at: number }[]).map((d) => d.at)).toEqual([T0]);

    const old = make({ keychain: loggedIn, files: seed({ reload: { epoch: 1, tries: [tried('finish', 'save', T0 - CREDIT_MS - 1)] } }) });
    await run(old, cfg, now);
    expect(triesIn(old)).toEqual([tried('finish', 'save', T0 - CREDIT_MS - 1)]);
  });
});

describe('메뉴를 띄워 둔 동안의 시험', () => {
  const draws = [{ at: T0 - 5000, v: '0.9.13', src: 'server', over: 0, next: T0 + 900_000 }];
  /** 닫기 전에는 닫히지 않는 메뉴를 가진 host. shown: 띄운 메뉴의 글. close: 메뉴를 닫는다(닫기). */
  async function menuHost(cache: Record<string, unknown>) {
    const host = make({ runsInApp: true, keychain: loggedIn, files: seed(cache) });
    const menu = { shown: [] as string[], close: (): void => {} };
    (host as { Alert: unknown }).Alert = class {
      title = '';
      message = '';
      addTextField(): undefined {
        return undefined;
      }
      addSecureTextField(): void {}
      addAction(): void {}
      addCancelAction(): void {}
      presentAlert(): Promise<number> {
        menu.shown.push(this.message);
        return new Promise((resolve) => {
          menu.close = () => resolve(-1);
        });
      }
      textFieldValue(): string {
        return '';
      }
    };
    const state = { finished: false };
    const done = run(host, cfg, now).then(() => {
      state.finished = true;
    });
    for (let i = 0; i < 50 && menu.shown.length === 0; i += 1) await vi.advanceTimersByTimeAsync(0);
    expect(menu.shown).toHaveLength(1);
    return { host, menu, state, done };
  }
  /** 위젯이 그리면서 적는 것을 흉내 낸다: 마지막 시도에 그 0.7초 뒤의 그림을 적는다. */
  const drawFor = (host: FakeHost): void => {
    const tries = triesIn(host);
    const last = tries[tries.length - 1];
    host.state.files.set(CACHE, JSON.stringify({ ...cacheOf(host), reload: { epoch: 1, tries: [...tries.slice(0, -1), { ...last, got: last.at + 700 }] } }));
  };

  it('가리지 못한 방법을 차례로 해 본다: setWidget, 5초 뒤 ping, 또 5초 뒤 complete. 메뉴에 시험 중이라고 적는다', async () => {
    const open = vi.fn();
    (globalThis as Record<string, unknown>).Safari = { open };
    const { host, menu, state, done } = await menuHost({ draws });
    const start = Date.now();
    expect(menu.shown[0]).toContain('위젯을 바로 새로 그리는 방법을 시험하는 중입니다. 이 창을 20초쯤 뒤에 닫아 주세요');
    await vi.advanceTimersByTimeAsync(300);
    expect([host.state.setWidgets.length, open.mock.calls.length, host.state.completed]).toEqual([1, 0, 0]);
    await vi.advanceTimersByTimeAsync(4800);
    expect([host.state.setWidgets.length, open.mock.calls.length, host.state.completed]).toEqual([1, 0, 0]);
    await vi.advanceTimersByTimeAsync(300);
    expect([host.state.setWidgets.length, open.mock.calls.length, host.state.completed]).toEqual([1, 1, 0]);
    await vi.advanceTimersByTimeAsync(5100);
    expect([host.state.setWidgets.length, open.mock.calls.length, host.state.completed]).toEqual([1, 1, 1]);
    // 마지막 것의 그림이 적힐 수 있는 시간(5초)이 지난 뒤에 닫았다: 20초 안이다. 셋 다 살아 있었고 무효가 아니다.
    await vi.advanceTimersByTimeAsync(CREDIT_MS + 300);
    expect(Date.now() - start).toBeLessThan(20_000);
    menu.close();
    await vi.advanceTimersByTimeAsync(0);
    await done;
    expect(state.finished).toBe(true);
    expect(triesIn(host)).toEqual([
      tried('setWidget', 'probe', start + 300, { alive: true }),
      tried('ping', 'probe', start + 5400, { alive: true }),
      tried('complete', 'probe', start + 10_500, { alive: true }),
    ]);
    // 그림이 없었으니 다 지나면 안 되는 것으로 가려진다. 다음에 메뉴를 열면 결과가 상태에 나오고, 다시 시험하지 않는다.
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    const again = await menuHost(cacheOf(host));
    expect(again.menu.shown[0]).toContain('바로 그리기: setWidget 안 됨 · ping 안 됨 · complete 안 됨 · finish 시험 전');
    expect(again.menu.shown[0]).not.toContain('시험하는 중입니다');
    await vi.advanceTimersByTimeAsync(5000);
    expect(again.host.state.setWidgets).toHaveLength(0);
    again.menu.close();
    await vi.advanceTimersByTimeAsync(0);
    await again.done;
  });

  it('그려진 방법은 한 번 더 해 본다(다른 까닭으로 그려진 것일 수 있다). 두 번 다 그려지면 더 시험하지 않고 그 방법을 쓴다', async () => {
    const open = vi.fn();
    (globalThis as Record<string, unknown>).Safari = { open };
    const { host, menu, done } = await menuHost({ draws });
    await vi.advanceTimersByTimeAsync(300);
    drawFor(host);
    // 그려지자마자 다시 하지 않는다: 위젯은 한 번에 두 번 잇달아 그려지기도 해서, 그 둘째 그림이 다시 한 것의 것으로 적힌다. 5초를 채운다.
    await vi.advanceTimersByTimeAsync(4800);
    expect([host.state.setWidgets.length, triesIn(host).length]).toEqual([1, 1]);
    await vi.advanceTimersByTimeAsync(300);
    expect([host.state.setWidgets.length, triesIn(host).length]).toEqual([2, 2]);
    drawFor(host);
    await vi.advanceTimersByTimeAsync(20_000);
    expect([host.state.setWidgets.length, open.mock.calls.length, host.state.completed, triesIn(host).length]).toEqual([2, 0, 0, 2]);
    menu.close();
    await vi.advanceTimersByTimeAsync(0);
    await done;
    expect(triesIn(host).map((t) => [t.how, t.got > 0, t.alive, t.void])).toEqual([['setWidget', true, true, false], ['setWidget', true, true, false]]);
    const again = await menuHost(cacheOf(host));
    expect(again.menu.shown[0]).toContain('바로 그리기: setWidget 됨 · ping 시험 전 · complete 시험 전 · finish 시험 전');
    expect(again.menu.shown[0]).not.toContain('시험하는 중입니다');
    again.menu.close();
    await vi.advanceTimersByTimeAsync(0);
    await again.done;
  });

  it('한 번 더 했을 때 그려지지 않으면 다음 방법으로 넘어간다(그 방법은 다음에 다시 시험한다)', async () => {
    const open = vi.fn();
    (globalThis as Record<string, unknown>).Safari = { open };
    const { host, menu, done } = await menuHost({ draws });
    await vi.advanceTimersByTimeAsync(300);
    drawFor(host);
    await vi.advanceTimersByTimeAsync(CREDIT_MS + 100);
    expect(host.state.setWidgets).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(CREDIT_MS + 100);
    expect([host.state.setWidgets.length, open.mock.calls.length, host.state.completed]).toEqual([2, 1, 0]);
    await vi.advanceTimersByTimeAsync(CREDIT_MS + 100);
    expect(host.state.completed).toBe(1);
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    menu.close();
    await vi.advanceTimersByTimeAsync(0);
    await done;
    const again = await menuHost(cacheOf(host));
    expect(again.menu.shown[0]).toContain('바로 그리기: setWidget 시험 전 · ping 안 됨 · complete 안 됨 · finish 시험 전');
    expect(again.menu.shown[0]).toContain('시험하는 중입니다');
    again.menu.close();
    await vi.advanceTimersByTimeAsync(0);
    await again.done;
  });

  it('그림이 적힐 수 있는 동안에 메뉴를 닫으면 그 시도는 무효다. ping이나 complete를 하자마자 닫혔으면 그렇다고 적는다', async () => {
    (globalThis as Record<string, unknown>).Safari = { open: vi.fn() };
    const early = await menuHost({ draws });
    await vi.advanceTimersByTimeAsync(1000);
    early.menu.close();
    await vi.advanceTimersByTimeAsync(0);
    await early.done;
    expect(triesIn(early.host)).toEqual([expect.objectContaining({ how: 'setWidget', void: true, shut: false })]);
    // 닫은 뒤에는 더 하지 않는다.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(triesIn(early.host)).toHaveLength(1);

    const shut = await menuHost({ draws });
    await vi.advanceTimersByTimeAsync(5400);
    await vi.advanceTimersByTimeAsync(300);
    shut.menu.close();
    await vi.advanceTimersByTimeAsync(0);
    await shut.done;
    // setWidget은 5초를 다 지켜봤다(무효가 아니다). ping은 하고 0.3초 만에 닫혔다.
    expect(triesIn(shut.host).map((t) => [t.how, t.alive, t.void, t.shut])).toEqual([['setWidget', true, false, false], ['ping', false, true, true]]);
  });

  it('위젯이 그린 기록이 없으면(홈 화면에 위젯이 없다) 시험하지 않는다', async () => {
    const { host, menu, done } = await menuHost({});
    expect(menu.shown[0]).not.toContain('시험하는 중입니다');
    await vi.advanceTimersByTimeAsync(10_000);
    expect([host.state.setWidgets.length, triesIn(host)]).toEqual([0, []]);
    menu.close();
    await vi.advanceTimersByTimeAsync(0);
    await done;
  });
});
