import { afterEach, describe, expect, it, vi } from 'vitest';
import { holidayNames, setOfficialHolidays } from '../core/holidays';
import type { KeyValueStore } from '../sync/outbox';
import { fetchHolidayFile, HOLIDAY_CACHE_KEY, startHolidayFeed, type HolidayFeedDeps } from './holidayFeed';

// 지어낸 공휴일 자료와 주소.
const URL = 'https://example.com/holidays.json';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 10, 14, 0, 0, 0);
const file = (...days: [string, string][]) => ({ version: 1, updatedAt: '2026-11-13T18:23:05.000Z', years: { 2026: { days: days.map(([date, name]) => ({ date, name })) } } });
const A = file(['2026-08-14', '임시공휴일']);
const B = file(['2026-11-13', '임시공휴일']);

function memoryStore(initial: Record<string, string> = {}): KeyValueStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}
const brokenStore: KeyValueStore = {
  getItem: () => { throw new Error('막힘'); },
  setItem: () => { throw new Error('막힘'); },
  removeItem: () => { throw new Error('막힘'); },
};
const saved = (fetchedAt: number, data: unknown, attemptedAt = fetchedAt) => ({ [HOLIDAY_CACHE_KEY]: JSON.stringify({ fetchedAt, data, attemptedAt }) });

/** 보이는지 바꿀 수 있는 가짜 문서. */
class FakeDoc extends EventTarget {
  visibilityState = 'visible';
  set(next: 'visible' | 'hidden'): void {
    this.visibilityState = next;
    this.dispatchEvent(new Event('visibilitychange'));
  }
}
const fakeDoc = () => new FakeDoc();
const settle = () => new Promise((r) => setTimeout(r, 0));

function setup(opts: { url?: string; store?: KeyValueStore; answers?: (() => unknown)[]; now?: number } = {}) {
  let clock = opts.now ?? T0;
  const answers = [...(opts.answers ?? [])];
  const fetchJson = vi.fn(async (_url: string) => {
    const next = answers.shift();
    if (!next) throw new Error('준비한 답이 없다');
    return next();
  });
  const onChange = vi.fn();
  const doc = fakeDoc();
  let tick: (() => void) | null = null;
  const every = vi.fn((_ms: number, fn: () => void) => {
    tick = fn;
    return () => { tick = null; };
  });
  const store = opts.store ?? memoryStore();
  const deps: HolidayFeedDeps = { url: opts.url ?? URL, store, fetchJson, now: () => clock, onChange, doc, every };
  const feed = startHolidayFeed(deps);
  return {
    feed, fetchJson, onChange, doc, store, every,
    advance: (ms: number) => { clock += ms; },
    tick: () => tick?.(),
    get ticking() { return tick !== null; },
  };
}
const stored = (store: KeyValueStore) => JSON.parse(store.getItem(HOLIDAY_CACHE_KEY)!) as { fetchedAt: number; attemptedAt: number; data: unknown };

afterEach(() => setOfficialHolidays(null));

describe('startHolidayFeed', () => {
  it('처음: 받아서 저장하고 쓰고, 바뀌었다고 알린다', async () => {
    const s = setup({ answers: [() => A] });
    expect(s.fetchJson).toHaveBeenCalledWith(URL);
    await settle();
    expect(holidayNames('2026-08-14')).toEqual(['임시공휴일']);
    expect(s.onChange).toHaveBeenCalledTimes(1);
    expect(stored(s.store)).toMatchObject({ fetchedAt: T0, attemptedAt: T0, data: { version: 1, years: A.years } });
  });

  it('저장해 둔 것은 시작하자마자 쓴다. 24시간 안이면 다시 받지 않는다', async () => {
    const s = setup({ store: memoryStore(saved(T0 - 23 * HOUR, A)) });
    expect(holidayNames('2026-08-14')).toEqual(['임시공휴일']);
    expect(s.fetchJson).not.toHaveBeenCalled();
    s.doc.set('hidden');
    s.doc.set('visible');
    s.tick();
    await settle();
    expect(s.fetchJson).not.toHaveBeenCalled();
    expect(s.onChange).not.toHaveBeenCalled();
  });

  it('24시간이 지났으면 받는다. 같은 자료면 알리지 않고 받은 시각만 고친다', async () => {
    const s = setup({ store: memoryStore(saved(T0 - 25 * HOUR, A)), answers: [() => A] });
    expect(holidayNames('2026-08-14')).toEqual(['임시공휴일']);
    expect(s.fetchJson).toHaveBeenCalledTimes(1);
    await settle();
    expect(s.onChange).not.toHaveBeenCalled();
    expect(stored(s.store).fetchedAt).toBe(T0);
  });

  it('새 자료가 오면 바꿔 쓰고 알린다', async () => {
    const s = setup({ store: memoryStore(saved(T0 - 25 * HOUR, A)), answers: [() => B] });
    await settle();
    expect(holidayNames('2026-08-14')).toEqual([]);
    expect(holidayNames('2026-11-13')).toEqual(['임시공휴일']);
    expect(s.onChange).toHaveBeenCalledTimes(1);
  });

  it('켜 둔 채 하루가 지나면 다시 보일 때 받는다', async () => {
    const s = setup({ answers: [() => A, () => B] });
    await settle();
    s.advance(23 * HOUR);
    s.doc.set('visible');
    await settle();
    expect(s.fetchJson).toHaveBeenCalledTimes(1);
    s.advance(2 * HOUR);
    s.doc.set('hidden');
    await settle();
    expect(s.fetchJson).toHaveBeenCalledTimes(1); // 숨을 때는 보지 않는다
    s.doc.set('visible');
    await settle();
    expect(s.fetchJson).toHaveBeenCalledTimes(2);
    expect(holidayNames('2026-11-13')).toEqual(['임시공휴일']);
    expect(s.onChange).toHaveBeenCalledTimes(2);
  });

  it('보이는 채로 켜 둔 창(PC 앱)도 한 시간마다 확인해 하루가 지나면 받는다', async () => {
    const s = setup({ answers: [() => A, () => B] });
    expect(s.every).toHaveBeenCalledWith(HOUR, expect.any(Function));
    await settle();
    s.advance(25 * HOUR);
    s.tick();
    await settle();
    expect(s.fetchJson).toHaveBeenCalledTimes(2);
  });

  it('받지 못하면 저장해 둔 것을 그대로 쓰고, 한 시간이 지나야 다시 받는다', async () => {
    const s = setup({ store: memoryStore(saved(T0 - 25 * HOUR, A)), answers: [() => { throw new Error('연결 안 됨'); }, () => B] });
    await settle();
    expect(holidayNames('2026-08-14')).toEqual(['임시공휴일']);
    expect(stored(s.store)).toMatchObject({ fetchedAt: T0 - 25 * HOUR, attemptedAt: T0, data: { version: 1, years: A.years } });
    s.advance(59 * 60_000);
    s.doc.set('visible');
    await settle();
    expect(s.fetchJson).toHaveBeenCalledTimes(1);
    s.advance(2 * 60_000);
    s.doc.set('visible');
    await settle();
    expect(s.fetchJson).toHaveBeenCalledTimes(2);
    expect(holidayNames('2026-11-13')).toEqual(['임시공휴일']);
    expect(s.onChange).toHaveBeenCalledTimes(1);
  });

  it('다시 열어도 마지막 시도가 한 시간 안이면 받지 않는다', async () => {
    const s = setup({ store: memoryStore(saved(T0 - 25 * HOUR, A, T0 - 30 * 60_000)) });
    await settle();
    expect(s.fetchJson).not.toHaveBeenCalled();
    expect(holidayNames('2026-08-14')).toEqual(['임시공휴일']);
  });

  it('잘못된 파일은 받지 못한 것과 같다', async () => {
    const s = setup({ store: memoryStore(saved(T0 - 25 * HOUR, A)), answers: [() => ({ version: 2, years: {} })] });
    await settle();
    expect(holidayNames('2026-08-14')).toEqual(['임시공휴일']);
    expect(s.onChange).not.toHaveBeenCalled();
    expect(stored(s.store)).toMatchObject({ fetchedAt: T0 - 25 * HOUR, attemptedAt: T0 });
  });

  it('저장해 둔 것이 깨졌으면 없는 것으로 보고 받는다', async () => {
    const s = setup({ store: memoryStore({ [HOLIDAY_CACHE_KEY]: '{' }), answers: [() => A] });
    await settle();
    expect(s.fetchJson).toHaveBeenCalledTimes(1);
    expect(holidayNames('2026-08-14')).toEqual(['임시공휴일']);
  });

  it('받는 동안에는 또 받지 않는다', async () => {
    let release!: (v: unknown) => void;
    const s = setup({ answers: [() => new Promise((r) => (release = r))] });
    s.doc.set('visible');
    s.tick();
    expect(s.fetchJson).toHaveBeenCalledTimes(1);
    release(A);
    await settle();
    expect(s.onChange).toHaveBeenCalledTimes(1);
  });

  it('저장소가 막혀도 동작한다(시도한 시각은 메모리에 둔다)', async () => {
    const s = setup({ store: brokenStore, answers: [() => { throw new Error('연결 안 됨'); }, () => A] });
    await settle();
    s.advance(30 * 60_000);
    s.doc.set('visible');
    await settle();
    expect(s.fetchJson).toHaveBeenCalledTimes(1);
    s.advance(31 * 60_000);
    s.doc.set('visible');
    await settle();
    expect(s.fetchJson).toHaveBeenCalledTimes(2);
    expect(holidayNames('2026-08-14')).toEqual(['임시공휴일']);
    expect(s.onChange).toHaveBeenCalledTimes(1);
  });

  it('주소가 비었으면 아무것도 하지 않는다', async () => {
    const store = memoryStore(saved(T0 - HOUR, A));
    const s = setup({ url: '', store });
    s.doc.set('visible');
    await settle();
    expect(s.fetchJson).not.toHaveBeenCalled();
    expect(s.every).not.toHaveBeenCalled();
    expect(holidayNames('2026-08-14')).toEqual([]);
    expect(s.onChange).not.toHaveBeenCalled();
  });

  it('멈춘 뒤에는 듣지 않고, 늦게 온 답도 쓰지 않는다', async () => {
    let release!: (v: unknown) => void;
    const s = setup({ answers: [() => new Promise((r) => (release = r)), () => B] });
    s.feed.stop();
    expect(s.ticking).toBe(false);
    release(A);
    await settle();
    expect(holidayNames('2026-08-14')).toEqual([]);
    expect(s.onChange).not.toHaveBeenCalled();
    s.advance(2 * DAY);
    s.doc.set('visible');
    await settle();
    expect(s.fetchJson).toHaveBeenCalledTimes(1);
  });

  it('다른 창이 먼저 받아 저장했으면 그것을 쓰고 받지 않는다', async () => {
    const s = setup({ store: memoryStore(saved(T0 - 25 * HOUR, A, T0 - 2 * HOUR)), answers: [() => A] });
    await settle();
    expect(s.fetchJson).toHaveBeenCalledTimes(1);
    s.advance(25 * HOUR);
    // 다른 창이 방금 B를 받아 두었다
    s.store.setItem(HOLIDAY_CACHE_KEY, JSON.stringify({ fetchedAt: T0 + 25 * HOUR - 60_000, attemptedAt: T0 + 25 * HOUR - 60_000, data: B }));
    s.doc.set('visible');
    await settle();
    expect(s.fetchJson).toHaveBeenCalledTimes(1);
    expect(holidayNames('2026-11-13')).toEqual(['임시공휴일']);
    expect(s.onChange).toHaveBeenCalledTimes(1);
  });
});

describe('fetchHolidayFile', () => {
  afterEach(() => vi.useRealTimers());

  it('쿠키 없이, 캐시를 쓰지 않고 받는다', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(A), { status: 200 }));
    expect(await fetchHolidayFile(URL, fetchImpl)).toEqual(A);
    const init = fetchImpl.mock.calls[0][1]!;
    expect([fetchImpl.mock.calls[0][0], init.credentials, init.cache, init.signal instanceof AbortSignal]).toEqual([URL, 'omit', 'no-store', true]);
  });

  it('HTTP 오류는 실패다', async () => {
    const fetchImpl = vi.fn(async () => new Response('없음', { status: 404 }));
    await expect(fetchHolidayFile(URL, fetchImpl)).rejects.toThrow('404');
  });

  it('10초가 지나면 그만둔다', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => signal!.addEventListener('abort', () => reject(new Error('aborted'))));
    });
    const pending = fetchHolidayFile(URL, fetchImpl);
    const caught = pending.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(signal!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(signal!.aborted).toBe(true);
    expect(await caught).toBeInstanceOf(Error);
  });
});
