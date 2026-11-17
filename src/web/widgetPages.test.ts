import { describe, expect, it, vi } from 'vitest';
import { CLOSED_PAGE, PAGES_KEY, announcePage, announceWidgetPage, type PagesEnv } from './widgetPages';

/** 같은 저장소를 쓰는 화면들을 흉내 낸다: 한 화면이 알리면 다른 화면들의 채널과 storage 이벤트로 간다(자기에게는 가지 않는다). */
function world() {
  const pages: { id: string; onMessage: ((data: unknown) => void) | null; onStorage: ((event: { key: string | null; newValue: string | null }) => void) | null; retired: number }[] = [];
  const open = (id: string, at: number, ways: { channel?: boolean; storage?: boolean } = { channel: true, storage: true }) => {
    const page = { id, onMessage: null as ((data: unknown) => void) | null, onStorage: null as ((event: { key: string | null; newValue: string | null }) => void) | null, retired: 0 };
    pages.push(page);
    const env: PagesEnv = {
      id, at,
      channel: ways.channel
        ? {
          postMessage: (data) => { for (const p of pages) if (p !== page) p.onMessage?.(data); },
          set onmessage(listener: ((event: { data: unknown }) => void) | null) { page.onMessage = listener ? (data) => listener({ data }) : null; },
          get onmessage() { return null; },
        }
        : null,
      storage: ways.storage ? { setItem: (key, value) => { for (const p of pages) if (p !== page) p.onStorage?.({ key, newValue: value }); } } : null,
      onStorage: (listener) => { page.onStorage = listener; },
      retire: () => { page.retired += 1; },
    };
    announcePage(env);
    return page;
  };
  return { open, pages };
}

describe('announcePage', () => {
  it('새 화면이 뜨면 앞의 화면들이 한 번씩 물러난다. 새 화면은 그대로다', () => {
    const w = world();
    const first = w.open('a', 1000);
    expect(first.retired).toBe(0);
    const second = w.open('b', 2000);
    // 두 길(채널과 storage)로 다 들려도 한 번만 물러난다.
    expect([first.retired, second.retired]).toEqual([1, 0]);
    const third = w.open('c', 3000);
    expect([first.retired, second.retired, third.retired]).toEqual([1, 1, 0]);
  });

  it('어느 한 길만 돼도 물러난다', () => {
    for (const ways of [{ channel: true }, { storage: true }]) {
      const w = world();
      const first = w.open('a', 1000, ways);
      w.open('b', 2000, ways);
      expect(first.retired).toBe(1);
    }
  });

  it('더 먼저 뜬 화면의 알림, 자기 알림, 모양이 다른 알림, 다른 열쇠의 storage 이벤트에는 움직이지 않는다', () => {
    const w = world();
    const mine = w.open('me', 5000);
    mine.onMessage?.({ id: 'old', at: 4000 });
    mine.onMessage?.({ id: 'me', at: 9000 });
    for (const bad of [null, 'x', 7, {}, { id: '', at: 9000 }, { id: 'x' }, { id: 'x', at: 'y' }]) mine.onMessage?.(bad);
    mine.onStorage?.({ key: 'calfif.prefs', newValue: JSON.stringify({ id: 'new', at: 9000 }) });
    mine.onStorage?.({ key: PAGES_KEY, newValue: 'not json' });
    mine.onStorage?.({ key: PAGES_KEY, newValue: null });
    expect(mine.retired).toBe(0);
    mine.onStorage?.({ key: PAGES_KEY, newValue: JSON.stringify({ id: 'new', at: 9000 }) });
    expect(mine.retired).toBe(1);
  });

  it('길이 없거나 막혀 있어도 던지지 않는다', () => {
    const broken: PagesEnv = {
      id: 'a', at: 1,
      channel: { postMessage: () => { throw new Error('막혔다'); }, onmessage: null },
      storage: { setItem: () => { throw new Error('막혔다'); } },
      onStorage: () => { throw new Error('막혔다'); },
      retire: vi.fn(),
    };
    expect(() => announcePage(broken)).not.toThrow();
    expect(() => announcePage({ id: 'a', at: 1, channel: null, storage: null, onStorage: () => {}, retire: vi.fn() })).not.toThrow();
  });

  it('물러나는 쪽은 스크립트가 없는 안내 쪽이다(위젯 스크립트가 여는 주소와 같은 이름)', () => {
    expect(CLOSED_PAGE).toBe('closed.html');
  });
});

describe('announceWidgetPage', () => {
  /** 브라우저의 window를 흉내 낸 것. set: localStorage에 적은 것. replaced: 바뀌어 간 주소. */
  const fakeWindow = () => {
    const state = { set: [] as [string, string][], replaced: [] as string[], listeners: [] as ((event: { key: string | null; newValue: string | null }) => void)[] };
    const win = {
      localStorage: { setItem: (key: string, value: string) => { state.set.push([key, value]); } },
      addEventListener: (type: string, listener: (event: { key: string | null; newValue: string | null }) => void) => { if (type === 'storage') state.listeners.push(listener); },
      location: { replace: (url: string) => { state.replaced.push(url); } },
      document: { baseURI: 'https://example.test/app/?x=1#2026-11-17' },
    };
    return { win: win as unknown as Window, state };
  };

  it('떴음을 localStorage에 적고, 더 나중에 뜬 화면의 알림이 오면 안내 쪽으로 바뀐다', () => {
    const { win, state } = fakeWindow();
    announceWidgetPage(win);
    expect(state.set).toHaveLength(1);
    expect(state.set[0][0]).toBe(PAGES_KEY);
    const mine = JSON.parse(state.set[0][1]) as { id: string; at: number };
    expect(mine.at).toBeGreaterThan(0);
    state.listeners[0]({ key: PAGES_KEY, newValue: JSON.stringify({ id: 'newer', at: mine.at + 5000 }) });
    expect(state.replaced).toEqual(['https://example.test/app/closed.html']);
  });

  it('한 문서에서는 한 번만 건다(두 번 걸리면 뒤의 것을 새 화면으로 알고 스스로 물러난다)', () => {
    const { win, state } = fakeWindow();
    announceWidgetPage(win);
    announceWidgetPage(win);
    expect([state.set.length, state.listeners.length, state.replaced]).toEqual([1, 1, []]);
  });
});
