/**
 * 위젯에서 연 달력이 열자마자 메모를 그리게 하는 것.
 *
 * 2026-11-18 사용자(0.9.28): "홈화면위젯에서는 보이는데, 눌러서 들어갔을때 안보여 … 데이터 를 불러오는데 너무 오래걸려".
 * 메뉴의 기록으로는 연 지 3초에 메모가 다 떠 있었다(메모 칸 54). 없는 것이 아니라 처음 몇 초 동안 빈 칸이 보인 것이다.
 * Scriptable의 웹 화면은 열 때마다 웹앱을 처음부터 불러오고, Firestore가 첫 스냅숏을 줄 때까지 칸이 비어 있다.
 *
 * 그래서 서버에서 받은 달 문서를 이 기기의 저장소에 적어 두고, 다음에 열 때 Firestore의 첫 스냅숏보다 먼저 그것을 넘긴다.
 * 서버의 스냅숏이 오면 그것으로 바뀐다(그 사이에 다른 기기가 고친 것은 1~3초 늦게 보인다). 계정마다 따로 적는다.
 * 걸린 시간은 window.__calfifLoad에 적어 둔다(위젯의 메뉴가 읽는다: src/widget/pending.ts의 PROBE_JS).
 */
import type { DayRecord, MonthDoc } from '../core/types';
import type { KeyValueStore } from '../sync/outbox';
import type { MonthSource } from './state';

/** 적어 두는 달의 수. 넘으면 가장 오래 안 본 달부터 지운다. */
export const SEED_MONTHS = 8;
const keyOf = (uid: string, monthId: string): string => `calfif.monthSeed.${uid}.${monthId}`;
const indexKey = (uid: string): string => `calfif.monthSeed.${uid}`;

/** 처음 그린 때(화면을 연 뒤 ms). seed: 적어 둔 것, server: 서버(또는 SDK 캐시)의 첫 스냅숏. 없으면 -1. */
export type LoadTimes = { seed: number; server: number };

function readIndex(store: KeyValueStore, uid: string): string[] {
  try {
    const v: unknown = JSON.parse(store.getItem(indexKey(uid)) ?? '[]');
    return Array.isArray(v) ? v.filter((m): m is string => typeof m === 'string') : [];
  } catch {
    return [];
  }
}

const isRecord = (v: unknown): v is DayRecord =>
  typeof v === 'object' && v !== null && typeof (v as DayRecord).text === 'string' && typeof (v as DayRecord).color === 'string' && typeof (v as DayRecord).editedAt === 'number';

/** 적어 둔 달 문서. 없거나 모양이 다르면 undefined, 서버에 문서가 없던 달이면 null. 던지지 않는다. */
export function readSeed(store: KeyValueStore, uid: string, monthId: string): MonthDoc | null | undefined {
  try {
    const raw = store.getItem(keyOf(uid, monthId));
    if (raw === null) return undefined;
    const v: unknown = JSON.parse(raw);
    if (v === null) return null;
    if (typeof v !== 'object' || typeof (v as MonthDoc).days !== 'object' || (v as MonthDoc).days === null) return undefined;
    const days: Record<string, DayRecord> = {};
    for (const [day, rec] of Object.entries((v as MonthDoc).days)) if (/^\d{2}$/.test(day) && isRecord(rec)) days[day] = rec;
    return { days };
  } catch {
    return undefined;
  }
}

/** 받은 달 문서를 적어 둔다. 던지지 않는다(저장소가 가득 찼거나 막혔으면 적지 않는다). */
export function writeSeed(store: KeyValueStore, uid: string, monthId: string, doc: MonthDoc | null): void {
  try {
    store.setItem(keyOf(uid, monthId), JSON.stringify(doc));
    const index = [monthId, ...readIndex(store, uid).filter((m) => m !== monthId)];
    for (const old of index.slice(SEED_MONTHS)) store.removeItem(keyOf(uid, old));
    store.setItem(indexKey(uid), JSON.stringify(index.slice(0, SEED_MONTHS)));
  } catch {
    // 적지 못하면 다음에 열 때 전처럼 서버를 기다린다.
  }
}

/**
 * 달을 듣는 쪽(source) 앞에 적어 둔 것을 먼저 넘기는 것을 끼운다. 받은 스냅숏은 적어 둔다.
 * 적어 둔 것은 다음 차례(마이크로태스크)에 넘긴다: 그 전에 진짜 스냅숏이 오면 넘기지 않는다.
 * now: 화면을 연 뒤 ms(performance.now). times: 처음 그린 때를 적는 곳.
 */
export function seededSource(source: MonthSource, store: KeyValueStore, uid: string, now: () => number, times: LoadTimes): MonthSource {
  return {
    subscribeMonth(monthId, listener, onError) {
      let real = false;
      let stopped = false;
      const seed = readSeed(store, uid, monthId);
      if (seed !== undefined) {
        queueMicrotask(() => {
          if (real || stopped) return;
          if (times.seed < 0) times.seed = Math.round(now());
          listener(seed);
        });
      }
      const stop = source.subscribeMonth(
        monthId,
        (doc) => {
          real = true;
          if (times.server < 0) times.server = Math.round(now());
          writeSeed(store, uid, monthId, doc);
          listener(doc);
        },
        onError,
      );
      return () => {
        stopped = true;
        stop();
      };
    },
  };
}
