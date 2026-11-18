import { describe, expect, it } from 'vitest';
import type { MonthDoc } from '../core/types';
import type { KeyValueStore } from '../sync/outbox';
import { SEED_MONTHS, readSeed, seededSource, writeSeed, type LoadTimes } from './monthSeed';
import type { MonthSource } from './state';

const memory = (): KeyValueStore & { map: Map<string, string> } => {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
};
const doc = (text: string): MonthDoc => ({ days: { '19': { text, color: 'F12424', editedAt: 5, editedBy: 'web' } } });
const UID = 'owner-test-uid';

/** 스냅숏을 손으로 보내는 가짜 source. */
function fakeSource() {
  const listeners = new Map<string, (d: MonthDoc | null) => void>();
  const source: MonthSource = {
    subscribeMonth: (m, l) => {
      listeners.set(m, l);
      return () => listeners.delete(m);
    },
  };
  return { source, emit: (m: string, d: MonthDoc | null) => listeners.get(m)?.(d), listening: () => [...listeners.keys()] };
}

describe('적어 두기', () => {
  it('적은 달을 그대로 읽는다. 문서가 없던 달은 null, 적은 적 없으면 undefined. 계정마다 따로다', () => {
    const store = memory();
    writeSeed(store, UID, '2026-11', doc('배경'));
    writeSeed(store, UID, '2026-12', null);
    expect(readSeed(store, UID, '2026-11')).toEqual(doc('배경'));
    expect(readSeed(store, UID, '2026-12')).toBeNull();
    expect(readSeed(store, UID, '2027-01')).toBeUndefined();
    expect(readSeed(store, 'other-uid', '2026-11')).toBeUndefined();
  });

  it(`${SEED_MONTHS}달까지만 남긴다(가장 오래 안 본 달부터 지운다)`, () => {
    const store = memory();
    for (let i = 1; i <= SEED_MONTHS + 2; i++) writeSeed(store, UID, `2026-${String(i).padStart(2, '0')}`, doc(`${i}`));
    expect(readSeed(store, UID, '2026-01')).toBeUndefined();
    expect(readSeed(store, UID, '2026-02')).toBeUndefined();
    expect(readSeed(store, UID, '2026-03')).toEqual(doc('3'));
    writeSeed(store, UID, '2026-03', doc('3'));
    writeSeed(store, UID, '2026-11', doc('11'));
    expect(readSeed(store, UID, '2026-03')).toEqual(doc('3')); // 방금 다시 본 달은 남는다
    expect(readSeed(store, UID, '2026-04')).toBeUndefined();
  });

  it('깨진 것은 읽지 않고, 막힌 저장소에서도 던지지 않는다', () => {
    const store = memory();
    store.setItem(`calfif.monthSeed.${UID}.2026-11`, '{x');
    expect(readSeed(store, UID, '2026-11')).toBeUndefined();
    store.setItem(`calfif.monthSeed.${UID}.2026-11`, JSON.stringify({ days: { '19': { text: 1 }, '20': doc('a').days['19'] } }));
    expect(readSeed(store, UID, '2026-11')).toEqual({ days: { '20': doc('a').days['19'] } });
    const broken: KeyValueStore = { getItem: () => { throw new Error('막힘'); }, setItem: () => { throw new Error('막힘'); }, removeItem: () => {} };
    expect(() => writeSeed(broken, UID, '2026-11', doc('a'))).not.toThrow();
    expect(readSeed(broken, UID, '2026-11')).toBeUndefined();
  });
});

describe('seededSource', () => {
  it('적어 둔 달을 서버의 첫 스냅숏보다 먼저 넘기고, 스냅숏이 오면 그것을 넘기며 적어 둔다. 처음 그린 때를 적는다', async () => {
    const store = memory();
    writeSeed(store, UID, '2026-11', doc('지난번'));
    const fake = fakeSource();
    let clock = 40;
    const times: LoadTimes = { seed: -1, server: -1 };
    const got: (MonthDoc | null)[] = [];
    seededSource(fake.source, store, UID, () => clock, times).subscribeMonth('2026-11', (d) => got.push(d));
    expect(got).toEqual([]); // 같은 차례에는 넘기지 않는다
    await Promise.resolve();
    expect([got, times]).toEqual([[doc('지난번')], { seed: 40, server: -1 }]);
    clock = 2800;
    fake.emit('2026-11', doc('서버'));
    expect([got.at(-1), times, readSeed(store, UID, '2026-11')]).toEqual([doc('서버'), { seed: 40, server: 2800 }, doc('서버')]);
  });

  it('서버의 스냅숏이 먼저 왔거나 듣기를 그만두었으면 적어 둔 것을 넘기지 않는다. 적어 둔 것이 없으면 서버를 기다린다', async () => {
    const store = memory();
    writeSeed(store, UID, '2026-11', doc('지난번'));
    writeSeed(store, UID, '2026-12', doc('12월'));
    const fake = fakeSource();
    const times: LoadTimes = { seed: -1, server: -1 };
    const got: string[] = [];
    const seeded = seededSource(fake.source, store, UID, () => 1, times);
    seeded.subscribeMonth('2026-11', (d) => got.push(`11:${d?.days['19']?.text}`));
    fake.emit('2026-11', doc('서버'));
    const stop = seeded.subscribeMonth('2026-12', (d) => got.push(`12:${d?.days['19']?.text}`));
    stop();
    seeded.subscribeMonth('2027-01', (d) => got.push(`1:${d === null ? 'null' : 'doc'}`));
    await Promise.resolve();
    expect(got).toEqual(['11:서버']);
    expect(times.seed).toBe(-1);
  });
});
