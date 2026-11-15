import type { EventMap, EventRecord } from '../core/events';
import { parseEventRecord } from '../core/events';
import type { EventChange, EventsWriteResult, PendingChange } from '../sync/eventsDoc';
import type { KeyValueStore } from '../sync/outbox';

// 알림과 카운트다운의 화면용 저장소: 서버 값 위에 방금 올린 값과 아직 보내지 않은 변경을 얹어 보여 준다.

/** confirmed: 서버가 확인한 스냅숏인가(로컬 반영이나 캐시가 아님). 알리지 않으면 확인된 것으로 본다. */
export type SnapshotMeta = { confirmed: boolean };
export type EventsSource = {
  subscribe(onData: (items: EventMap, meta?: SnapshotMeta) => void, onError: (e: unknown) => void): () => void;
  /** 서버의 지금 값과 견주어 쓴다(트랜잭션). 서버의 값이 이긴 변경은 쓰지 않고 dropped로 알린다. 연결이 없으면 거절한다. */
  write(pending: Record<string, PendingChange>): Promise<EventsWriteResult>;
};
export type EventsView = { items(): EventMap; version(): number; onChange(fn: () => void): () => void };

type Pending = Record<string, PendingChange>;
/** 트랜잭션이 쓴 값. 스냅숏이 보여 줄 때까지 화면에 남긴다(트랜잭션은 SDK의 로컬 캐시를 거치지 않는다). */
type Committed = { change: EventChange; editedAt: number; at: number };

const RETRY_MS = 30_000;
/** 올린 값이 스냅숏에 보이지 않아도 남기는 시간. 이보다 오래된 것은 다음 스냅숏을 따른다(달 문서와 같은 10초). */
const COMMITTED_MS = 10_000;

/** 스냅숏의 그 항목이 올린 값을 보이거나 그 뒤에 쓴 값인가. */
function settled(c: Committed, server: EventRecord | undefined): boolean {
  if (c.change === 'delete') return server === undefined || server.editedAt > c.editedAt;
  return server !== undefined && server.editedAt >= c.editedAt;
}

/** 키 순서와 상관없이 내용이 같으면 같은 글. 화면에 보이는 것이 바뀌었는지 볼 때 쓴다. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (typeof v === 'object' && v !== null) {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

export class EventsStore implements EventsView {
  private readonly key: string;
  private readonly now: () => number;
  private server: EventMap = {};
  private pending: Pending;
  private readonly committed = new Map<string, Committed>();
  private view: EventMap = {};
  private viewText = canonical({});
  private ver = 0;
  private isLoaded = false;
  /** 보내기 고리가 도는 중인가. 고리가 끝나는 그 자리에서 내려서, 끝난 고리에 새 변경을 맡기지 않는다. */
  private sending = false;
  private running: Promise<void> = Promise.resolve();
  private again = false;
  private destroyed = false;
  private readonly listeners = new Set<() => void>();
  private unsubscribe: (() => void) | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly onOnline = (): void => this.kick();

  constructor(private readonly opts: { source: EventsSource; storage: KeyValueStore; uid: string; editedBy: string; now?: () => number; online?: () => boolean }) {
    this.key = `calfif.eventsPending.${opts.uid}`;
    this.now = opts.now ?? (() => Date.now());
    this.pending = this.readPending();
    this.refresh();
    this.unsubscribe = opts.source.subscribe(
      (items, meta) => this.onServer(items, meta?.confirmed !== false),
      () => { /* 듣기는 원본이 다시 시도한다 */ },
    );
    if (typeof window !== 'undefined') window.addEventListener('online', this.onOnline);
    this.syncTimer();
    // 지난번에 보내지 못한 변경을 이어서 보낸다. 서버의 지금 값과 견주는 것은 트랜잭션이 하므로 스냅숏을 기다리지 않는다.
    this.kick();
  }

  items(): EventMap { return this.view; }
  version(): number { return this.ver; }
  loaded(): boolean { return this.isLoaded; }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  save(id: string, rec: EventRecord): void {
    const editedAt = this.now();
    // 서버에 있던 항목을 고친 것인지 기억한다. 다른 곳에서 그 사이 지웠으면 이 저장으로 되살리지 않는다.
    const prev = this.pending[id];
    const wasNew = prev && prev.change !== 'delete' ? prev.wasNew : !this.knownOnServer(id);
    this.pending[id] = { change: { ...rec, editedAt, editedBy: this.opts.editedBy }, editedAt, wasNew };
    this.changed();
    this.kick();
  }

  remove(id: string): void {
    this.pending[id] = { change: 'delete', editedAt: this.now(), wasNew: false };
    this.changed();
    this.kick();
  }

  /**
   * 보내지 않은 변경을 보낸다. 다 보냈으면(서버가 받았거나 서버의 더 새 값에 졌으면) 끝나고, 보내지 못한 것이 남으면
   * (연결 없음 등) 거절한다. 남은 변경은 online과 30초 타이머에 다시 보낸다. 보내는 중에 부르면 동시에 두 번 보내지 않고,
   * 그 보내기가 그 사이의 변경까지 보낸 뒤에 끝난다.
   */
  flush(): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    if (this.sending) {
      this.again = true;
      return this.running;
    }
    this.running = this.send();
    return this.running;
  }

  destroy(): void {
    this.destroyed = true; // 보내던 쓰기가 끝나도 이어 보내지 않고, 타이머와 듣는 쪽도 더는 움직이지 않는다
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (typeof window !== 'undefined') window.removeEventListener('online', this.onOnline);
    this.stopTimer();
    this.listeners.clear();
  }

  /** 안에서 부르는 보내기: 실패는 남은 변경으로 다루므로 거절을 삼킨다. */
  private kick(): void {
    void this.flush().catch(() => undefined);
  }

  private async send(): Promise<void> {
    this.sending = true;
    try {
      do {
        this.again = false;
        if (this.opts.online && !this.opts.online()) break;
        const sent = Object.entries(this.pending);
        if (sent.length === 0) break;
        let result: EventsWriteResult;
        try {
          result = await this.opts.source.write(Object.fromEntries(sent));
        } catch {
          break; // 남겨 두고 online이나 타이머에 다시 보낸다
        }
        if (this.destroyed) return;
        this.settle(sent, result);
      } while (this.again && !this.destroyed);
    } finally {
      this.sending = false;
    }
    if (!this.destroyed && Object.keys(this.pending).length > 0) throw new Error('보내지 못한 변경이 남았다');
  }

  /**
   * 트랜잭션이 끝났다. 쓴 것은 스냅숏이 보여 줄 때까지 화면에 남기고, 서버의 값이 이긴 것은 버려 화면이 서버 값을 따르게 한다.
   * 그 사이 다시 고친 항목은 남겨 다음에 보낸다.
   */
  private settle(sent: [string, PendingChange][], result: EventsWriteResult): void {
    const written = new Set(result.written);
    const dropped = new Set(result.dropped);
    let changed = false;
    for (const [id, p] of sent) {
      if (this.pending[id] !== p || !(written.has(id) || dropped.has(id))) continue;
      delete this.pending[id];
      changed = true;
      if (written.has(id) && !(this.isLoaded && settled({ change: p.change, editedAt: p.editedAt, at: 0 }, this.server[id]))) {
        this.committed.set(id, { change: p.change, editedAt: p.editedAt, at: this.now() });
      } else {
        this.committed.delete(id);
      }
    }
    if (changed) this.changed();
  }

  private onServer(items: EventMap, confirmed: boolean): void {
    if (this.destroyed) return;
    this.server = items;
    this.isLoaded = true;
    const t = this.now();
    for (const [id, c] of [...this.committed]) {
      if (settled(c, items[id]) || t - c.at > COMMITTED_MS) this.committed.delete(id);
    }
    let dropped = false;
    if (confirmed) {
      // 서버가 확인한 스냅숏만 보고 버린다. 저장은 서버가 따라잡았거나 더 새 값이 있을 때, 삭제는 더 새 값이 있을 때만.
      // 삭제가 끝나는 때는 보내기가 끝난 때다(낡은 스냅숏에 항목이 없는 것으로는 끝내지 않는다). 다른 곳의 삭제가 이기는지는
      // 트랜잭션이 서버의 지금 값으로 정한다.
      for (const [id, p] of Object.entries(this.pending)) {
        const s = items[id];
        const drop = s !== undefined && (p.change === 'delete' ? s.editedAt > p.editedAt : s.editedAt >= p.editedAt);
        if (drop) { delete this.pending[id]; dropped = true; }
      }
    }
    if (dropped) {
      this.writePending();
      this.syncTimer();
    }
    this.refresh();
  }

  /** 서버에 그 항목이 있다고 아는가. 방금 올린 값을 스냅숏보다 먼저 본다. */
  private knownOnServer(id: string): boolean {
    const c = this.committed.get(id);
    if (c) return c.change !== 'delete';
    return this.server[id] !== undefined;
  }

  private changed(): void {
    this.writePending();
    this.syncTimer();
    this.refresh();
  }

  private syncTimer(): void {
    const has = Object.keys(this.pending).length > 0;
    if (this.destroyed) return;
    if (has && this.timer === undefined && typeof window !== 'undefined') {
      this.timer = setInterval(() => this.kick(), RETRY_MS);
    } else if (!has) this.stopTimer();
  }

  private stopTimer(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** 화면에 보일 값을 다시 만든다. 보이는 것이 바뀌었을 때만 판을 올리고 알린다(달력이 쪽을 다시 그리지 않게). */
  private refresh(): void {
    const out: EventMap = { ...this.server };
    for (const [id, c] of this.committed) {
      if (c.change === 'delete') delete out[id];
      else out[id] = c.change;
    }
    for (const [id, p] of Object.entries(this.pending)) {
      if (p.change === 'delete') delete out[id];
      else out[id] = p.change;
    }
    const text = canonical(out);
    if (text === this.viewText) return;
    this.view = out;
    this.viewText = text;
    this.ver += 1;
    // 듣는 쪽이 던져도 저장(save)이 쓰기를 시작하기 전에 끊기지 않게 한다. 오류는 콘솔에만 남긴다(글 내용은 적지 않는다).
    for (const fn of [...this.listeners]) {
      try { fn(); } catch (e) { console.error('EventsStore 듣는 쪽 오류', e instanceof Error ? e.message : 'unknown'); }
    }
  }

  private readPending(): Pending {
    let raw: string | null = null;
    try { raw = this.opts.storage.getItem(this.key); } catch { return {}; }
    if (raw === null) return {};
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
      const out: Pending = {};
      for (const [id, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v !== 'object' || v === null) continue;
        const { change, editedAt, wasNew } = v as { change?: unknown; editedAt?: unknown; wasNew?: unknown };
        if (typeof editedAt !== 'number') continue;
        if (change === 'delete') { out[id] = { change, editedAt, wasNew: false }; continue; }
        const rec = parseEventRecord(change);
        // wasNew가 없는 옛 형식은 새 항목으로 본다(사용자가 만든 것을 잃지 않는 쪽).
        if (rec) out[id] = { change: rec, editedAt, wasNew: typeof wasNew === 'boolean' ? wasNew : true };
      }
      return out;
    } catch {
      return {};
    }
  }

  private writePending(): void {
    try {
      if (Object.keys(this.pending).length === 0) this.opts.storage.removeItem(this.key);
      else this.opts.storage.setItem(this.key, JSON.stringify(this.pending));
    } catch {
      // 저장소를 쓸 수 없으면 메모리에만 둔다
    }
  }
}
