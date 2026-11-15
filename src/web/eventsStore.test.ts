import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AlarmRecord, EventMap } from '../core/events';
import type { EventChange } from '../sync/eventsDoc';
import type { KeyValueStore } from '../sync/outbox';
import { EventsStore, type EventsSource } from './eventsStore';

const mem = (): KeyValueStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); }, removeItem: (k) => { data.delete(k); } };
};

class FakeSource implements EventsSource {
  onData: ((items: EventMap) => void) | null = null;
  writes: Record<string, EventChange>[] = [];
  fail = false;
  subscribe(onData: (items: EventMap) => void): () => void {
    this.onData = onData;
    return () => { this.onData = null; };
  }
  async write(changes: Record<string, EventChange>): Promise<void> {
    if (this.fail) throw new Error('offline');
    this.writes.push(changes);
  }
  push(items: EventMap): void { this.onData?.(items); }
}

const rec = (text: string, editedAt = 0): AlarmRecord => ({
  type: 'alarm', date: '2026-11-20', text, done: false, repeat: { freq: 'none' },
  time: '09:00', advance: [0], editedAt, editedBy: 'dev',
});
const KEY = 'calfif.eventsPending.u1';
const flushAll = async (): Promise<void> => { for (let i = 0; i < 5; i += 1) await Promise.resolve(); };

let source: FakeSource;
let storage: ReturnType<typeof mem>;
let t: number;
const make = (): EventsStore => new EventsStore({ source, storage, uid: 'u1', editedBy: 'dev', now: () => t });

beforeEach(() => { source = new FakeSource(); storage = mem(); t = 1000; });
afterEach(() => { vi.useRealTimers(); });

describe('EventsStore', () => {
  it('저장하면 바로 items에 보이고 저장소에 남고 보낸다', async () => {
    const s = make();
    s.save('a1', rec('가'));
    expect(s.items().a1.text).toBe('가');
    expect(s.items().a1.editedAt).toBe(1000);
    expect(s.items().a1.editedBy).toBe('dev');
    expect(JSON.parse(storage.data.get(KEY)!).a1.editedAt).toBe(1000);
    await flushAll();
    expect(source.writes).toHaveLength(1);
    expect((source.writes[0].a1 as AlarmRecord).text).toBe('가');
    s.destroy();
  });
  it('서버가 따라잡으면 보내지 않은 변경을 지운다', async () => {
    const s = make();
    s.save('a1', rec('가'));
    await flushAll();
    source.push({ a1: rec('가', 1000) });
    expect(JSON.parse(storage.data.get(KEY) ?? '{}')).toEqual({});
    expect(s.items().a1.text).toBe('가');
    expect(s.loaded()).toBe(true);
    s.destroy();
  });
  it('서버의 더 새 값이 이긴다', async () => {
    const s = make();
    source.fail = true;
    s.save('a1', rec('내것'));
    await flushAll();
    source.push({ a1: rec('남의것', 5000) });
    expect(s.items().a1.text).toBe('남의것');
    expect(JSON.parse(storage.data.get(KEY) ?? '{}')).toEqual({});
    s.destroy();
  });
  it('보내기에 실패하면 남겼다가 online에 다시 보낸다', async () => {
    const s = make();
    source.fail = true;
    s.save('a1', rec('가'));
    await flushAll();
    expect(source.writes).toHaveLength(0);
    expect(Object.keys(JSON.parse(storage.data.get(KEY)!))).toEqual(['a1']);
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
    s.destroy();
  });
  it('다시 열면 저장소의 보내지 않은 변경을 이어서 보낸다', async () => {
    const a = make();
    source.fail = true;
    a.save('a1', rec('가'));
    await flushAll();
    a.destroy();
    source.fail = false;
    const b = make();
    expect(b.items().a1.text).toBe('가');
    b.flush();
    await flushAll();
    expect(source.writes).toHaveLength(1);
    expect(Object.keys(source.writes[0])).toEqual(['a1']);
    b.destroy();
  });
  it('삭제는 서버에서 사라지면 끝난다', async () => {
    const s = make();
    source.push({ a1: rec('가', 10) });
    s.remove('a1');
    expect(s.items().a1).toBeUndefined();
    await flushAll();
    expect(source.writes[0]).toEqual({ a1: 'delete' });
    source.push({ a1: rec('가', 10) });
    expect(Object.keys(JSON.parse(storage.data.get(KEY)!))).toEqual(['a1']);
    source.push({});
    expect(JSON.parse(storage.data.get(KEY) ?? '{}')).toEqual({});
    s.destroy();
  });
  it('바뀔 때마다 version이 오르고 알린다', async () => {
    const s = make();
    const fn = vi.fn();
    s.onChange(fn);
    const v0 = s.version();
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
