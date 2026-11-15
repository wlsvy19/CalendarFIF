import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AlarmRecord, EventMap } from '../core/events';
import type { KeyValueStore } from '../sync/outbox';
import { FIRED_KEY, startAlarmClock } from './alarmClock';
import type { EventsView } from './eventsStore';

const mem = (): KeyValueStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); }, removeItem: (k) => { data.delete(k); } };
};
const alarm = (date: string, time: string, text = '약'): AlarmRecord => ({
  type: 'alarm', date, text, done: false, repeat: { freq: 'none' }, time, advance: [0], editedAt: 0, editedBy: 'dev',
});
const at = (d: string, hh: number, mm: number): number => {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day, hh, mm).getTime();
};

let items: EventMap;
let listeners: Set<() => void>;
let view: EventsView;
let t: number;
let timers: { fn: () => void; ms: number; id: number }[];
let nextId: number;
const setTimer = (fn: () => void, ms: number): unknown => { nextId += 1; timers.push({ fn, ms, id: nextId }); return nextId; };
const clearTimer = (id: unknown): void => { timers = timers.filter((x) => x.id !== id); };
const fakeDoc = () => {
  const l = new Map<string, () => void>();
  return {
    visibilityState: 'visible' as DocumentVisibilityState,
    addEventListener: (type: string, fn: () => void) => { l.set(type, fn); },
    removeEventListener: (type: string) => { l.delete(type); },
    fire: (type: string) => l.get(type)?.(),
  };
};

beforeEach(() => {
  items = { a1: alarm('2026-11-20', '09:00') };
  listeners = new Set();
  view = { items: () => items, version: () => 0, onChange: (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; } };
  t = at('2026-11-20', 8, 59);
  timers = [];
  nextId = 0;
});
afterEach(() => { vi.useRealTimers(); });

const start = (storage: KeyValueStore, onRing = vi.fn(), doc = fakeDoc()) => ({
  onRing,
  doc,
  clock: startAlarmClock({ view, storage, now: () => t, onRing, setTimer, clearTimer, doc: doc as unknown as Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'> }),
});

describe('startAlarmClock', () => {
  it('시각이 되면 울리고 다시 check해도 두 번 울리지 않는다', () => {
    const { clock, onRing } = start(mem());
    expect(onRing).not.toHaveBeenCalled();
    t = at('2026-11-20', 9, 0);
    clock.check();
    clock.check();
    expect(onRing).toHaveBeenCalledTimes(1);
    expect(onRing.mock.calls[0][0][0].key).toBe('a1@2026-11-20@0');
    clock.stop();
  });

  it('10분 넘게 지난 것은 울리지 않는다', () => {
    const { clock, onRing } = start(mem());
    t = at('2026-11-20', 9, 11);
    clock.check();
    expect(onRing).not.toHaveBeenCalled();
    clock.stop();
  });

  it('10분 안에 지난 것은 깨어난 뒤에도 울린다', () => {
    const { clock, onRing } = start(mem());
    t = at('2026-11-20', 9, 8);
    clock.check();
    expect(onRing).toHaveBeenCalledTimes(1);
    clock.stop();
  });

  it('다시 시작해도 저장소에 적힌 것은 울리지 않는다', () => {
    const storage = mem();
    const first = start(storage);
    t = at('2026-11-20', 9, 0);
    first.clock.check();
    first.clock.stop();
    const second = start(storage);
    second.clock.check();
    expect(second.onRing).not.toHaveBeenCalled();
    second.clock.stop();
  });

  it('다른 탭이 저장소에 적은 것은 다시 읽어 거른다', () => {
    const storage = mem();
    const { clock, onRing } = start(storage);
    t = at('2026-11-20', 9, 0);
    storage.setItem(FIRED_KEY, JSON.stringify({ 'a1@2026-11-20@0': t }));
    clock.check();
    expect(onRing).not.toHaveBeenCalled();
    clock.stop();
  });

  it('자료가 바뀌면 다음 타이머를 다시 건다', () => {
    const { clock } = start(mem());
    expect(timers).toHaveLength(1);
    expect(timers[0].ms).toBe(60_000); // 1분 뒤라 최대치
    items = { a1: alarm('2026-11-20', '09:00'), b1: alarm('2026-11-20', '08:59', '이른') };
    t = at('2026-11-20', 8, 58) + 59_000; // 08:58:59
    for (const fn of [...listeners]) fn();
    expect(timers).toHaveLength(1); // 이전 타이머를 지우고 하나만
    expect(timers[0].ms).toBe(1_000); // 08:59까지 1초
    clock.stop();
    expect(timers).toHaveLength(0);
    expect(listeners.size).toBe(0);
  });

  it('보이게 되면 check한다', () => {
    const { clock, onRing, doc } = start(mem());
    t = at('2026-11-20', 9, 5);
    doc.visibilityState = 'hidden';
    doc.fire('visibilitychange');
    expect(onRing).not.toHaveBeenCalled();
    doc.visibilityState = 'visible';
    doc.fire('visibilitychange');
    expect(onRing).toHaveBeenCalledTimes(1);
    clock.stop();
  });

  it('30일 넘은 기록은 지운다', () => {
    const storage = mem();
    storage.setItem(FIRED_KEY, JSON.stringify({ old: t - 31 * 86_400_000, recent: t - 86_400_000 }));
    const { clock } = start(storage);
    clock.check();
    expect(JSON.parse(storage.data.get(FIRED_KEY)!)).toEqual({ recent: t - 86_400_000 });
    clock.stop();
  });

  it('저장소가 던져도 메모리로 기억한다', () => {
    const broken: KeyValueStore = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
      removeItem: () => { throw new Error('blocked'); },
    };
    const { clock, onRing } = start(broken);
    t = at('2026-11-20', 9, 0);
    clock.check();
    clock.check();
    expect(onRing).toHaveBeenCalledTimes(1);
    clock.stop();
  });
});
