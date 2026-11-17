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
/** 웹 화면이 적어 두는 글. n은 편집 목록이 달라질 때마다 는다. */
const message = (n: number, edits: unknown[] = []): string => JSON.stringify({ v: 1, uid: 'owner-test-uid', n, edits });
/** 오래전에 메뉴에서 시험해 그려진 기록: 그 방법이 되는 것으로 가려져 있다. */
const proven = (how: ReloadTry['how']): Record<string, unknown> => ({
  reload: { epoch: 1, tries: [{ how, why: 'probe', at: T0 - 600_000, got: T0 - 599_000, alive: true, void: false, away: false, shut: false, err: '' }] },
});
const tried = (how: ReloadTry['how'], why: ReloadTry['why'], at: number, more: Partial<ReloadTry> = {}): ReloadTry => ({ how, why, at, got: 0, alive: how === 'finish', void: false, away: false, shut: false, err: '', ...more });

/** 닫기 전에는 닫히지 않는 가짜 WebView. state: 지금 웹 화면이 답하는 [적어 둔 글, 보이는지]. */
function withView() {
  const view = { state: [message(1), 'visible'] as [string, string], reads: 0, presented: 0, close: (): void => {} };
  (globalThis as Record<string, unknown>).WebView = class {
    async loadURL(): Promise<void> {}
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

  it('스크립트가 읽는 사이에 저장하고 서버에 올라가서 목록이 다시 비어도, n이 달라져 저장이 있었음을 안다', async () => {
    const view = withView();
    const host = openHost();
    const { done } = await opened(host);
    view.state = [message(3), 'visible'];
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
    expect(triesIn(host).slice(1)).toEqual([tried('setWidget', 'save', T0 + 900)]);
    // 1.2초 뒤에도 돌고 있으면 살아 있다고 적는다.
    await vi.advanceTimersByTimeAsync(1200);
    expect(triesIn(host)[1]).toMatchObject({ alive: true, void: false });
    // 곧바로 또 저장했다: 또 하지만 적지는 않는다(위젯이 한 번만 그릴 수 있다).
    view.state = [message(3), 'visible'];
    await vi.advanceTimersByTimeAsync(300);
    expect([host.state.setWidgets.length, triesIn(host).length]).toEqual([2, 2]);
    // 지켜보는 시간이 지난 뒤의 저장은 새로 적는다.
    await vi.advanceTimersByTimeAsync(CREDIT_MS);
    view.state = [message(4, [edit]), 'visible'];
    await vi.advanceTimersByTimeAsync(300);
    expect([state.finished, host.state.setWidgets.length, triesIn(host).length]).toEqual([false, 3, 3]);
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
    expect([state.finished, triesIn(host)[1]]).toEqual([false, tried('ping', 'save', T0 + 900)]);

    delete (globalThis as Record<string, unknown>).Safari;
    const view2 = withView();
    const none = openHost(proven('ping'));
    await opened(none);
    view2.state = [message(2, [edit]), 'visible'];
    await vi.advanceTimersByTimeAsync(300);
    expect(triesIn(none)[1]).toEqual(tried('ping', 'save', T0 + 1800, { err: 'Safari.open이 없다' }));
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
    expect([state.finished, host.state.completed, triesIn(host)[1]]).toEqual([false, 1, tried('complete', 'save', T0 + 900)]);
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
    expect(triesIn(host)[1]).toMatchObject({ how: 'setWidget', away: true, void: false, shut: false });
    expect(cacheOf(host).leave).toEqual({ at: T0 + 1200, how: 'left' });
    // 나간 뒤에 위젯이 그리면 그 시도에 적힌다(같은 보관 파일을 쓰는 위젯 실행).
    const widget = make({ keychain: loggedIn, files: seed(cacheOf(host)) });
    await run(widget, cfg, now);
    expect(triesIn(widget)[1]).toMatchObject({ how: 'setWidget', away: true, got: Date.now() });
  });

  it('닫기를 누르면 지켜보던 것은 무효로 하고 닫았다고 적는다. 다 지켜본 것은 그대로 둔다', async () => {
    const view = withView();
    const host = openHost(proven('setWidget'));
    const { done } = await opened(host);
    view.state = [message(2, [edit]), 'visible'];
    await vi.advanceTimersByTimeAsync(300);
    view.close();
    await vi.advanceTimersByTimeAsync(400);
    await done;
    expect(triesIn(host)[1]).toMatchObject({ how: 'setWidget', why: 'save', void: true, shut: false });
    expect(cacheOf(host).leave).toMatchObject({ how: 'closed' });

    const view2 = withView();
    const late = openHost(proven('setWidget'));
    const second = await opened(late);
    view2.state = [message(2, [edit]), 'visible'];
    await vi.advanceTimersByTimeAsync(300 + SETTLE_MS);
    view2.close();
    await vi.advanceTimersByTimeAsync(400);
    await second.done;
    expect(triesIn(late)[1]).toMatchObject({ how: 'setWidget', alive: true, void: false });
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
    expect(triesIn(host)[1]).toMatchObject({ alive: true, away: true, void: false });
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
    expect(triesIn(kept)[1]).toMatchObject({ how: 'setWidget', why: 'leave', void: true });
  });
});

describe('위젯을 다시 눌러 새 달력이 떴을 때', () => {
  it('앞의 실행은 가려진 달력을 더 지켜보지 않고 끝낸다. 새 달력이 적은 것을 덮어쓰지 않는다', async () => {
    withView();
    const host = openHost();
    const { state, done } = await opened(host);
    expect(cacheOf(host).session).toBe(T0);
    // 새 실행이 자기 번호와 떠 있는 때를 적었다.
    host.state.files.set(CACHE, JSON.stringify({ ...cacheOf(host), session: T0 + 1000, activeAt: 7 }));
    await vi.advanceTimersByTimeAsync(4000);
    await done;
    expect(state.finished).toBe(true);
    expect(cacheOf(host)).toMatchObject({ session: T0 + 1000, activeAt: 7 });
    expect(cacheOf(host).leave).toBeUndefined();
    await expect(new host.Request('https://example.test/x').loadString()).rejects.toThrow('스크립트를 바로 끝내려고');
  });
});

describe('빈 실행(ping)', () => {
  it('아무것도 띄우지 않고, 네트워크를 쓰지 않고 바로 끝난다', async () => {
    const view = withView();
    const host = make({ runsInApp: true, keychain: loggedIn, queryParameters: { open: 'calendar', ping: '1' } });
    await run(host, cfg, now);
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
    // 다 지켜본 뒤에 닫았다: 셋 다 살아 있었고 무효가 아니다(그림이 없었으니 안 되는 것으로 가려진다).
    await vi.advanceTimersByTimeAsync(SETTLE_MS + 600);
    menu.close();
    await vi.advanceTimersByTimeAsync(0);
    await done;
    expect(state.finished).toBe(true);
    expect(triesIn(host)).toEqual([
      tried('setWidget', 'probe', start + 300, { alive: true }),
      tried('ping', 'probe', start + 5400, { alive: true }),
      tried('complete', 'probe', start + 10_500, { alive: true }),
    ]);
    // 다음에 메뉴를 열면 결과가 상태에 나오고, 다시 시험하지 않는다.
    const again = await menuHost(cacheOf(host));
    expect(again.menu.shown[0]).toContain('바로 그리기: setWidget 안 됨 · ping 안 됨 · complete 안 됨 · finish 시험 전');
    expect(again.menu.shown[0]).not.toContain('시험하는 중입니다');
    await vi.advanceTimersByTimeAsync(5000);
    expect(again.host.state.setWidgets).toHaveLength(0);
    again.menu.close();
    await vi.advanceTimersByTimeAsync(0);
    await again.done;
  });

  it('위젯이 그려서 그 시도에 적히면 더 해 보지 않는다', async () => {
    const open = vi.fn();
    (globalThis as Record<string, unknown>).Safari = { open };
    const { host, menu, done } = await menuHost({ draws });
    await vi.advanceTimersByTimeAsync(300);
    // 위젯이 그리면서 적는 것을 흉내 낸다.
    const cache = cacheOf(host);
    const tries = triesIn(host);
    host.state.files.set(CACHE, JSON.stringify({ ...cache, reload: { epoch: 1, tries: [{ ...tries[0], got: tries[0].at + 700 }] } }));
    await vi.advanceTimersByTimeAsync(15_000);
    expect([open.mock.calls.length, host.state.completed, triesIn(host).length]).toEqual([0, 0, 1]);
    expect(triesIn(host)[0]).toMatchObject({ how: 'setWidget', alive: true, void: false });
    menu.close();
    await vi.advanceTimersByTimeAsync(0);
    await done;
  });

  it('지켜보는 중에 메뉴를 닫으면 그 시도는 무효다. ping이나 complete를 하자마자 닫혔으면 그렇다고 적는다', async () => {
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
    expect(triesIn(shut.host).map((t) => [t.how, t.void, t.shut])).toEqual([['setWidget', true, false], ['ping', true, true]]);
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
