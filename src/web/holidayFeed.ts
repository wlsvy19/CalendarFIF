import { parseOfficialHolidays, setOfficialHolidays, type OfficialYear } from '../core/holidays';
import type { KeyValueStore } from '../sync/outbox';

/** 받아 둔 공휴일 자료를 이 기기에 두는 칸: { fetchedAt, data, attemptedAt }. data는 올려 둔 파일과 같은 꼴이다. */
export const HOLIDAY_CACHE_KEY = 'calfif.holidays';
const FRESH_MS = 24 * 3_600_000; // 받은 지 이만큼 안이면 다시 받지 않는다
const RETRY_MS = 3_600_000; // 받지 못하면 이만큼 지나야 다시 받는다
const CHECK_EVERY_MS = 3_600_000; // 켜 둔 채 보이는 창(PC 앱)도 이만큼마다 확인한다
const FETCH_TIMEOUT_MS = 10_000;

type Years = Record<string, OfficialYear>;
type Saved = { fetchedAt: number; attemptedAt: number; data: Years | null };
const NOTHING: Saved = { fetchedAt: 0, attemptedAt: 0, data: null };

type VisibilityTarget = {
  readonly visibilityState: string;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
};

export type HolidayFeedDeps = {
  /** 공휴일 자료 파일의 주소(VITE_HOLIDAY_URL). 비었으면 아무것도 하지 않는다. */
  url: string;
  store: KeyValueStore;
  /** 주소의 JSON을 받는다. 받지 못하면 거절한다. */
  fetchJson(url: string): Promise<unknown>;
  now(): number;
  /** 쓰는 자료가 바뀌었을 때(달력을 다시 그릴 때). 시작할 때 저장해 둔 것을 쓰는 것은 알리지 않는다. */
  onChange(): void;
  /** 다시 보이게 될 때 확인한다. */
  doc?: VisibilityTarget;
  /** 주기적으로 확인한다. 멈추는 함수를 돌려준다. */
  every?(ms: number, fn: () => void): () => void;
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const within = (now: number, at: number, ms: number): boolean => at > 0 && now - at >= 0 && now - at < ms;

function readSaved(store: KeyValueStore): Saved {
  try {
    const raw = store.getItem(HOLIDAY_CACHE_KEY);
    if (raw === null) return NOTHING;
    const value: unknown = JSON.parse(raw);
    if (!isObject(value)) return NOTHING;
    const data = parseOfficialHolidays(value.data);
    return {
      fetchedAt: data && typeof value.fetchedAt === 'number' ? value.fetchedAt : 0,
      attemptedAt: typeof value.attemptedAt === 'number' ? value.attemptedAt : 0,
      data,
    };
  } catch {
    return NOTHING; // 저장소가 막혔거나 깨졌다: 없는 것으로 본다
  }
}

function writeSaved(store: KeyValueStore, saved: Saved): void {
  try {
    store.setItem(HOLIDAY_CACHE_KEY, JSON.stringify({
      fetchedAt: saved.fetchedAt,
      attemptedAt: saved.attemptedAt,
      data: saved.data ? { version: 1, years: saved.data } : null,
    }));
  } catch {
    // 저장하지 못해도 이 창에서는 쓴다. 시도한 시각은 메모리에 남는다.
  }
}

/**
 * 공휴일 자료를 하루에 한 번 받아 계산한 공휴일에 더한다(setOfficialHolidays). 로그인과 상관없이 페이지마다 한 번 켠다.
 * 시작하면 저장해 둔 것을 바로 쓰고, 받은 지 24시간이 지났고 마지막 시도가 한 시간보다 오래면 받는다.
 * 받지 못하거나 파일이 잘못되면 저장해 둔 것을 그대로 쓴다. 다시 보이게 될 때와 한 시간마다 다시 확인한다.
 */
export function startHolidayFeed(deps: HolidayFeedDeps): { stop(): void } {
  if (deps.url === '') return { stop() {} };
  let saved = readSaved(deps.store);
  let applied = '';
  let busy = false;
  let stopped = false;

  /** data를 쓴다. 쓰던 것과 다르면 true. */
  const apply = (data: Years | null): boolean => {
    const key = data ? JSON.stringify(data) : '';
    if (key === applied) return false;
    applied = key;
    setOfficialHolidays(data);
    return true;
  };
  if (saved.data) apply(saved.data);

  const check = async (): Promise<void> => {
    if (busy || stopped) return;
    // 다른 창이 그사이에 받아 두었으면 그것을 쓴다.
    const latest = readSaved(deps.store);
    if (latest.data && latest.fetchedAt > saved.fetchedAt) {
      saved = { ...latest, attemptedAt: Math.max(latest.attemptedAt, saved.attemptedAt) };
      if (apply(saved.data)) deps.onChange();
    } else if (latest.attemptedAt > saved.attemptedAt) {
      saved = { ...saved, attemptedAt: latest.attemptedAt };
    }
    const now = deps.now();
    if (saved.data && within(now, saved.fetchedAt, FRESH_MS)) return;
    if (within(now, saved.attemptedAt, RETRY_MS)) return;
    busy = true;
    saved = { ...saved, attemptedAt: now };
    let data: Years | null = null;
    try {
      data = parseOfficialHolidays(await deps.fetchJson(deps.url));
    } catch {
      data = null;
    }
    busy = false;
    if (stopped) return;
    if (data) saved = { fetchedAt: deps.now(), attemptedAt: saved.attemptedAt, data };
    writeSaved(deps.store, saved);
    if (data && apply(data)) deps.onChange();
  };

  const onVisibility = (): void => {
    if (deps.doc?.visibilityState === 'visible') void check();
  };
  deps.doc?.addEventListener('visibilitychange', onVisibility);
  const stopTimer = deps.every?.(CHECK_EVERY_MS, () => void check());
  void check();
  return {
    stop() {
      stopped = true;
      deps.doc?.removeEventListener('visibilitychange', onVisibility);
      stopTimer?.();
    },
  };
}

/** 공휴일 자료 파일을 받는다: 쿠키 없이, 브라우저 캐시를 쓰지 않고, 10초가 지나면 그만둔다. */
export async function fetchHolidayFile(
  url: string,
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response> = (u, init) => fetch(u, init),
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { credentials: 'omit', cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error(`공휴일 자료를 받지 못했습니다 (${response.status})`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}
