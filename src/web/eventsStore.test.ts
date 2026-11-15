import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AlarmRecord, EventMap } from '../core/events';
import { decideEventsWrite, type EventChange, type EventsWriteResult, type PendingChange } from '../sync/eventsDoc';
import type { KeyValueStore } from '../sync/outbox';
import { EventsStore, type EventsSource, type SnapshotMeta } from './eventsStore';

const mem = (): KeyValueStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); }, removeItem: (k) => { data.delete(k); } };
};

/** 가짜 서버. write는 트랜잭션처럼 doc(서버의 지금 값)과 견주어 쓴다. 스냅숏은 시험이 push로 따로 보낸다. */
class FakeSource implements EventsSource {
  onData: ((items: EventMap, meta?: SnapshotMeta) => void) | null = null;
  /** 보낸 변경(트랜잭션에 넘긴 것). 서버의 값이 이겨 쓰지 않은 것도 들어 있다. */
  writes: Record<string, EventChange>[] = [];
  sent: Record<string, PendingChange>[] = [];
  doc: EventMap = {};
  fail = false;
  gate: Promise<void> | null = null;
  subscribe(onData: (items: EventMap, meta?: SnapshotMeta) => void): () => void {
    this.onData = onData;
    return () => { this.onData = null; };
  }
  async write(pending: Record<string, PendingChange>): Promise<EventsWriteResult> {
    if (this.gate) await this.gate;
    if (this.fail) throw new Error('offline');
    this.sent.push(pending);
    this.writes.push(Object.fromEntries(Object.entries(pending).map(([id, p]) => [id, p.change])));
    const { changes, result } = decideEventsWrite(this.doc, pending);
    const next = { ...this.doc };
    for (const [id, c] of Object.entries(changes)) {
      if (c === 'delete') delete next[id];
      else next[id] = c;
    }
    this.doc = next;
    return result;
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
    source.doc = { a1: rec('가', 10) };
    source.push({ a1: rec('가', 10) });
    s.remove('a1');
    expect(s.items().a1).toBeUndefined();
    await flushAll();
    expect(source.writes[0]).toEqual({ a1: 'delete' });
    expect(source.doc).toEqual({});
    expect(pendingOf(storage)).toEqual({});
    expect(s.items().a1).toBeUndefined(); // 스냅숏이 오기 전에도 다시 나타나지 않는다
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
    source.push({ a1: rec('나', 5000) }); // 보이는 값이 바뀐다(서버의 더 새 값)
    expect(s.version()).toBeGreaterThan(v1);
    s.destroy();
  });

  it('서버가 받은 뒤에도 보이는 것이 같으면 version을 올리지 않는다', async () => {
    const s = make();
    const fn = vi.fn();
    s.onChange(fn);
    s.save('a1', rec('가'));
    const v1 = s.version();
    fn.mockClear();
    await flushAll(); // 트랜잭션이 썼다. 스냅숏은 아직이다.
    expect(source.doc.a1.text).toBe('가');
    expect(s.items().a1.text).toBe('가');
    source.push({ a1: rec('가', 1000) }, { confirmed: false }); // 캐시
    source.push({ a1: rec('가', 1000) }); // 서버가 보여 준 값이 같다
    source.push({ a1: rec('가', 1000) }); // 메타데이터만 바뀐 스냅숏
    expect([s.version(), fn.mock.calls.length]).toEqual([v1, 0]);
    source.push({ a1: rec('나', 2000) });
    expect(s.version()).toBe(v1 + 1);
    expect(fn).toHaveBeenCalledTimes(1);
    s.destroy();
  });

  it('다시 열었을 때 스냅숏 전에 보내도 서버의 더 새 편집을 덮지 않고, 화면은 서버 값을 따른다', async () => {
    const a = make();
    source.fail = true;
    a.save('a1', rec('오래된 편집')); // 오프라인에서 고쳤다(editedAt 1000)
    await flushAll();
    a.destroy();
    source.doc = { a1: rec('다른 기기의 새 편집', 5000) };
    source.fail = false;
    const b = make(); // 만들자마자 보낸다(스냅숏 전)
    await flushAll();
    expect(source.writes).toHaveLength(1);
    expect(source.doc.a1.text).toBe('다른 기기의 새 편집');
    expect(pendingOf(storage)).toEqual({});
    expect(b.items().a1).toBeUndefined(); // 진 변경은 버리고 서버 값(아직 모름)을 따른다
    source.push({ a1: rec('다른 기기의 새 편집', 5000) });
    expect(b.items().a1.text).toBe('다른 기기의 새 편집');
    b.destroy();
  });

  it('다른 곳에서 지운 항목을 고친 오래된 저장은 되살리지 않는다', async () => {
    const s = make();
    source.doc = { a1: rec('처음', 10) };
    source.push({ a1: rec('처음', 10) });
    source.fail = true;
    s.save('a1', rec('고침'));
    await flushAll();
    expect((pendingOf(storage).a1 as { wasNew: boolean }).wasNew).toBe(false);
    source.doc = {}; // 그 사이 다른 기기가 지웠다
    source.fail = false;
    window.dispatchEvent(new Event('online'));
    await flushAll();
    expect(source.sent.at(-1)!.a1).toMatchObject({ wasNew: false });
    expect(source.doc.a1).toBeUndefined();
    expect(pendingOf(storage)).toEqual({});
    source.push({});
    expect(s.items().a1).toBeUndefined();
    s.destroy();
  });

  it('이 기기에서 새로 만든 항목은 서버에 없어도 쓰고, 다시 고쳐도 새 항목으로 남는다', async () => {
    const a = make();
    source.push({});
    source.fail = true;
    a.save('n1', rec('새것'));
    t = 2000;
    a.save('n1', rec('새것 고침'));
    await flushAll();
    expect((pendingOf(storage).n1 as { wasNew: boolean }).wasNew).toBe(true);
    a.destroy();
    source.fail = false;
    const b = make(); // 다시 열어도 저장소의 wasNew를 지킨다
    await flushAll();
    expect(source.doc.n1.text).toBe('새것 고침');
    expect(pendingOf(storage)).toEqual({});
    b.destroy();
  });

  it('방금 올린 값은 스냅숏이 보여 줄 때까지 남고, 낡은 스냅숏에 없어도 사라지지 않는다', async () => {
    const s = make();
    source.push({ old: rec('지울 것', 10) });
    source.doc = { old: rec('지울 것', 10) };
    s.save('a1', rec('가'));
    s.remove('old');
    await flushAll();
    expect(pendingOf(storage)).toEqual({});
    source.push({ old: rec('지울 것', 10) }); // 쓰기 전에 읽은 낡은 스냅숏
    expect([Object.keys(s.items()), s.items().a1.text]).toEqual([['a1'], '가']);
    source.push({ a1: rec('가', 1000) }); // 따라잡았다
    expect(Object.keys(s.items())).toEqual(['a1']);
    t += 11_000;
    source.push({}); // 따라잡은 뒤로는 서버를 따른다(다른 곳에서 지웠다)
    expect(s.items()).toEqual({});
    s.destroy();
  });

  it('스냅숏이 끝내 보여 주지 않은 올린 값은 10초 뒤의 스냅숏부터 서버를 따른다', async () => {
    const s = make();
    source.push({});
    s.save('a1', rec('가'));
    await flushAll();
    source.push({});
    expect(s.items().a1.text).toBe('가');
    t += 11_000;
    source.push({});
    expect(s.items().a1).toBeUndefined();
    s.destroy();
  });

  it('flush는 서버가 받으면 끝나고, 보내지 못하면 거절한다(변경은 남는다)', async () => {
    const s = make();
    source.fail = true;
    s.save('a1', rec('가'));
    await expect(s.flush()).rejects.toThrow();
    expect(Object.keys(pendingOf(storage))).toEqual(['a1']);
    source.fail = false;
    await expect(s.flush()).resolves.toBeUndefined();
    expect(pendingOf(storage)).toEqual({});
    s.destroy();
  });

  it('보내는 중에 부른 flush는 그 사이의 변경까지 보낸 뒤에 끝난다', async () => {
    const s = make();
    let release!: () => void;
    source.gate = new Promise<void>((r) => { release = r; });
    s.save('a1', rec('가'));
    t = 2000;
    s.save('b2', rec('나'));
    let done = false;
    const flushed = s.flush().then(() => { done = true; });
    await flushAll();
    expect(done).toBe(false);
    source.gate = null;
    release();
    await flushed;
    expect(source.writes.map((w) => Object.keys(w))).toEqual([['a1'], ['b2']]);
    expect(pendingOf(storage)).toEqual({});
    s.destroy();
  });

  it('오프라인이면(online이 false) 보내지 않고 flush는 거절한다', async () => {
    let up = false;
    const s = new EventsStore({ source, storage, uid: 'u1', editedBy: 'dev', now: () => t, online: () => up });
    s.save('a1', rec('가'));
    await expect(s.flush()).rejects.toThrow();
    expect(source.writes).toHaveLength(0);
    up = true;
    await s.flush();
    expect(source.writes).toHaveLength(1);
    s.destroy();
  });

  it('destroy 뒤에는 보내던 것이 끝나도 더 보내지 않고 타이머도 걸지 않는다', async () => {
    vi.useFakeTimers();
    const s = make();
    let release!: () => void;
    source.gate = new Promise<void>((r) => { release = r; });
    s.save('a1', rec('가'));
    s.save('a1', rec('나')); // 보내는 중에 다시 고침
    s.destroy();
    source.gate = null;
    release();
    await flushAll();
    expect(source.writes).toHaveLength(1);
    s.save('a1', rec('다')); // 늦게 온 호출도 아무 일 없다
    await flushAll();
    expect(source.writes).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
