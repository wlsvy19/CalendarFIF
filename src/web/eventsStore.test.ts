import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AlarmRecord, EventMap } from '../core/events';
import type { EventChange } from '../sync/eventsDoc';
import type { KeyValueStore } from '../sync/outbox';
import { EventsStore, type EventsSource, type SnapshotMeta } from './eventsStore';

const mem = (): KeyValueStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); }, removeItem: (k) => { data.delete(k); } };
};

class FakeSource implements EventsSource {
  onData: ((items: EventMap, meta?: SnapshotMeta) => void) | null = null;
  writes: Record<string, EventChange>[] = [];
  fail = false;
  gate: Promise<void> | null = null;
  subscribe(onData: (items: EventMap, meta?: SnapshotMeta) => void): () => void {
    this.onData = onData;
    return () => { this.onData = null; };
  }
  async write(changes: Record<string, EventChange>): Promise<void> {
    if (this.gate) await this.gate;
    if (this.fail) throw new Error('offline');
    this.writes.push(changes);
  }
  push(items: EventMap, meta?: SnapshotMeta): void { this.onData?.(items, meta); }
}

const rec = (text: string, editedAt = 0): AlarmRecord => ({
  type: 'alarm', date: '2026-11-20', text, done: false, repeat: { freq: 'none' },
  time: '09:00', advance: [0], editedAt, editedBy: 'dev',
});
const KEY = 'calfif.eventsPending.u1';
const flushAll = async (): Promise<void> => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };
const pendingOf = (storage: ReturnType<typeof mem>): Record<string, unknown> => JSON.parse(storage.data.get(KEY) ?? '{}');

let source: FakeSource;
let storage: ReturnType<typeof mem>;
let t: number;
const make = (): EventsStore => new EventsStore({ source, storage, uid: 'u1', editedBy: 'dev', now: () => t });

beforeEach(() => { source = new FakeSource(); storage = mem(); t = 1000; });
afterEach(() => { vi.useRealTimers(); });

describe('EventsStore', () => {
  it('저장하면 바로 items에 보이고 저장소에 남고 보낸다', async () => {
    const s = make();
    source.gate = new Promise<void>(() => {});
    s.save('a1', rec('가'));
    expect(s.items().a1.text).toBe('가');
    expect(s.items().a1.editedAt).toBe(1000);
    expect(s.items().a1.editedBy).toBe('dev');
    expect((pendingOf(storage).a1 as { editedAt: number }).editedAt).toBe(1000);
    source.gate = null;
    s.destroy();
    const s2 = make(); // 다시 열면 이어서 보낸다
    await flushAll();
    expect(source.writes).toHaveLength(1);
    expect((source.writes[0].a1 as AlarmRecord).text).toBe('가');
    s2.destroy();
  });
  it('서버가 받으면 보내지 않은 변경을 지운다', async () => {
    const s = make();
    s.save('a1', rec('가'));
    await flushAll();
    expect(source.writes).toHaveLength(1);
    expect(pendingOf(storage)).toEqual({});
    source.push({ a1: rec('가', 1000) });
    expect(s.items().a1.text).toBe('가');
    expect(s.loaded()).toBe(true);
    s.destroy();
  });
  it('확인된 스냅숏이 따라잡았으면 지운다', async () => {
    const s = make();
    source.fail = true;
    s.save('a1', rec('가'));
    await flushAll();
    source.push({ a1: rec('가', 1000) });
    expect(pendingOf(storage)).toEqual({});
    s.destroy();
  });
  it('서버의 더 새 값이 이긴다', async () => {
    const s = make();
    source.fail = true;
    s.save('a1', rec('내것'));
    await flushAll();
    source.push({ a1: rec('남의것', 5000) });
    expect(s.items().a1.text).toBe('남의것');
    expect(pendingOf(storage)).toEqual({});
    s.destroy();
  });
  it('로컬 반영 스냅숏(confirmed false)은 보내지 않은 변경을 지우지 않는다', async () => {
    const s = make();
    source.fail = true;
    s.save('a1', rec('가'));
    await flushAll();
    source.push({ a1: rec('가', 1000) }, { confirmed: false });
    expect(Object.keys(pendingOf(storage))).toEqual(['a1']);
    expect(s.items().a1.text).toBe('가');
    s.destroy();
  });
  it('보내기에 실패하면 남겼다가 online에 다시 보낸다', async () => {
    const s = make();
    source.fail = true;
    s.save('a1', rec('가'));
    await flushAll();
    expect(source.writes).toHaveLength(0);
    expect(Object.keys(pendingOf(storage))).toEqual(['a1']);
    source.fail = false;
    window.dispatchEvent(new Event('online'));
    await flushAll();
    expect(source.writes).toHaveLength(1);
    s.destroy();
  });
  it('30초 타이머로도 다시 보낸다', async () => {
    vi.useFakeTimers();
    const s = make();
    source.fail = true;
    s.save('a1', rec('가'));
    await vi.advanceTimersByTimeAsync(0);
    source.fail = false;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(source.writes).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0); // 다 보냈으면 타이머도 멈춘다
    s.destroy();
  });
  it('다시 열면 저장소의 보내지 않은 변경을 바로 이어서 보낸다', async () => {
    const a = make();
    source.fail = true;
    a.save('a1', rec('가'));
    await flushAll();
    a.destroy();
    source.fail = false;
    const b = make();
    expect(b.items().a1.text).toBe('가');
    await flushAll();
    expect(source.writes).toHaveLength(1);
    expect(Object.keys(source.writes[0])).toEqual(['a1']);
    b.destroy();
  });
  it('삭제는 서버가 받으면 끝난다', async () => {
    const s = make();
    source.push({ a1: rec('가', 10) });
    s.remove('a1');
    expect(s.items().a1).toBeUndefined();
    await flushAll();
    expect(source.writes[0]).toEqual({ a1: 'delete' });
    expect(pendingOf(storage)).toEqual({});
    s.destroy();
  });
  it('저장했다가 서버가 보기 전에 지우면 낡은 스냅숏에 항목이 없어도 삭제를 보낸다', async () => {
    const s = make();
    source.fail = true;
    s.save('a1', rec('가'));
    s.remove('a1');
    await flushAll();
    source.push({}); // 낡은 스냅숏: 항목이 없다
    expect(Object.keys(pendingOf(storage))).toEqual(['a1']);
    source.fail = false;
    window.dispatchEvent(new Event('online'));
    await flushAll();
    expect(source.writes.at(-1)).toEqual({ a1: 'delete' });
    expect(pendingOf(storage)).toEqual({});
    s.destroy();
  });
  it('서버의 더 새 항목이 확인되면 보내지 않은 삭제도 버린다', async () => {
    const s = make();
    source.fail = true;
    s.remove('a1');
    await flushAll();
    source.push({ a1: rec('남의것', 9000) });
    expect(s.items().a1.text).toBe('남의것');
    expect(pendingOf(storage)).toEqual({});
    s.destroy();
  });
  it('보내는 동안 또 고치면 이어서 보내고 동시에 두 번 보내지 않는다', async () => {
    const s = make();
    let release!: () => void;
    source.gate = new Promise<void>((r) => { release = r; });
    s.save('a1', rec('가'));
    await flushAll();
    t = 2000;
    s.save('b2', rec('나'));
    await flushAll();
    expect(source.writes).toHaveLength(0);
    source.gate = null;
    release();
    await flushAll();
    expect(source.writes).toHaveLength(2);
    expect(Object.keys(source.writes[0])).toEqual(['a1']);
    expect(Object.keys(source.writes[1])).toEqual(['b2']);
    expect(pendingOf(storage)).toEqual({});
    s.destroy();
  });
  it('보내는 동안 같은 항목을 다시 고치면 그 변경은 남아 다시 보낸다', async () => {
    const s = make();
    let release!: () => void;
    source.gate = new Promise<void>((r) => { release = r; });
    s.save('a1', rec('첫'));
    await flushAll();
    t = 2000;
    s.save('a1', rec('둘'));
    source.gate = null;
    release();
    await flushAll();
    expect(source.writes).toHaveLength(2);
    expect((source.writes[1].a1 as AlarmRecord).text).toBe('둘');
    s.destroy();
  });
  it('저장소가 던지거나 내용이 깨졌으면 빈 것으로 본다', () => {
    const boom = (): never => { throw new Error('x'); };
    const throwing: KeyValueStore = { getItem: boom, setItem: boom, removeItem: boom };
    const a = new EventsStore({ source, storage: throwing, uid: 'u1', editedBy: 'dev' });
    expect(a.items()).toEqual({});
    a.save('a1', rec('가'));
    expect(a.items().a1.text).toBe('가');
    a.destroy();
    for (const bad of ['{not json', '[1,2]', '{"a1":{"change":{"type":"x"},"editedAt":1}}', '"str"']) {
      storage.data.set(KEY, bad);
      const b = make();
      expect(b.items()).toEqual({});
      b.destroy();
    }
  });
  it('destroy는 online 듣기와 타이머를 거둔다', async () => {
    vi.useFakeTimers();
    const s = make();
    source.fail = true;
    s.save('a1', rec('가'));
    await vi.advanceTimersByTimeAsync(0);
    s.destroy();
    source.fail = false;
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(source.writes).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('보낼 것이 없으면 write를 부르지 않는다', async () => {
    const s = make();
    await s.flush();
    expect(source.writes).toHaveLength(0);
    s.destroy();
  });
  it('바뀔 때마다 version이 오르고 알린다', async () => {
    const s = make();
    const fn = vi.fn();
    s.onChange(fn);
    const v0 = s.version();
    source.fail = true;
    s.save('a1', rec('가'));
    const v1 = s.version();
    expect(v1).toBeGreaterThan(v0);
    expect(fn).toHaveBeenCalled();
    await flushAll();
    source.push({ a1: rec('가', 1000) });
    expect(s.version()).toBeGreaterThan(v1);
    s.destroy();
  });
});
