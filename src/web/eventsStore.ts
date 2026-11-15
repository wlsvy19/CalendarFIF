import type { EventMap, EventRecord } from '../core/events';
import { parseEventRecord } from '../core/events';
import type { EventChange } from '../sync/eventsDoc';
import type { KeyValueStore } from '../sync/outbox';

// 알림과 카운트다운의 화면용 저장소: 서버 값 위에 아직 보내지 않은 변경을 얹어 보여 준다.

/** confirmed: 서버가 확인한 스냅숏인가(로컬 반영이나 캐시가 아님). 알리지 않으면 확인된 것으로 본다. */
export type SnapshotMeta = { confirmed: boolean };
export type EventsSource = {
  subscribe(onData: (items: EventMap, meta?: SnapshotMeta) => void, onError: (e: unknown) => void): () => void;
  write(changes: Record<string, EventChange>): Promise<void>;
};
export type EventsView = { items(): EventMap; version(): number; onChange(fn: () => void): () => void };

type PendingEntry = { change: EventChange; editedAt: number };
type Pending = Record<string, PendingEntry>;

const RETRY_MS = 30_000;

export class EventsStore implements EventsView {
  private readonly key: string;
  private readonly now: () => number;
  private server: EventMap = {};
  private pending: Pending;
  private view: EventMap = {};
  private ver = 0;
  private isLoaded = false;
  private sending = false;
  private again = false;
  private serverJson = '';
  private readonly listeners = new Set<() => void>();
  private unsubscribe: (() => void) | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly onOnline = (): void => { void this.flush(); };

  constructor(private readonly opts: { source: EventsSource; storage: KeyValueStore; uid: string; editedBy: string; now?: () => number; online?: () => boolean }) {
    this.key = `calfif.eventsPending.${opts.uid}`;
    this.now = opts.now ?? (() => Date.now());
    this.pending = this.readPending();
    this.rebuild();
    this.unsubscribe = opts.source.subscribe(
      (items, meta) => this.onServer(items, meta?.confirmed !== false),
      () => { /* 듣기는 원본이 다시 시도한다 */ },
    );
    if (typeof window !== 'undefined') window.addEventListener('online', this.onOnline);
    this.syncTimer();
    void this.flush(); // 지난번에 보내지 못한 변경을 이어서 보낸다
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
    this.pending[id] = { change: { ...rec, editedAt, editedBy: this.opts.editedBy }, editedAt };
    this.changed();
    void this.flush();
  }

  remove(id: string): void {
    this.pending[id] = { change: 'delete', editedAt: this.now() };
    this.changed();
    void this.flush();
  }

  async flush(): Promise<void> {
    if (this.sending) { this.again = true; return; }
    if (this.opts.online && !this.opts.online()) return;
    this.sending = true;
    try {
      do {
        this.again = false;
        const sent = Object.entries(this.pending);
        if (sent.length === 0) return;
        const changes: Record<string, EventChange> = {};
        for (const [id, p] of sent) changes[id] = p.change;
        try {
          await this.opts.source.write(changes);
        } catch {
          return; // 남겨 두고 online이나 타이머에 다시 보낸다
        }
        // 서버가 받았다. 그 사이 다시 고친 항목은 남긴다.
        let dropped = false;
        for (const [id, p] of sent) {
          if (this.pending[id] === p) { delete this.pending[id]; dropped = true; }
        }
        if (dropped) this.changed();
      } while (this.again);
    } finally {
      this.sending = false;
    }
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (typeof window !== 'undefined') window.removeEventListener('online', this.onOnline);
    this.stopTimer();
    this.listeners.clear();
  }

  private onServer(items: EventMap, confirmed: boolean): void {
    const json = JSON.stringify(items);
    const same = this.isLoaded && json === this.serverJson;
    this.server = items;
    this.serverJson = json;
    this.isLoaded = true;
    let dropped = false;
    if (confirmed) {
      // 서버가 확인한 스냅숏만 보고 버린다. 저장은 서버가 따라잡았거나 더 새 값이 있을 때, 삭제는 더 새 값이 있을 때만.
      // 삭제가 끝나는 때는 보내기가 성공한 때다(낡은 스냅숏에 항목이 없는 것으로는 끝내지 않는다).
      for (const [id, p] of Object.entries(this.pending)) {
        const s = items[id];
        const drop = s !== undefined && (p.change === 'delete' ? s.editedAt > p.editedAt : s.editedAt >= p.editedAt);
        if (drop) { delete this.pending[id]; dropped = true; }
      }
    }
    if (dropped) { this.changed(); return; }
    if (same) return; // 메타데이터만 바뀐 스냅숏
    this.rebuild();
    this.bump();
  }

  private changed(): void {
    this.writePending();
    this.syncTimer();
    this.rebuild();
    this.bump();
  }

  private syncTimer(): void {
    const has = Object.keys(this.pending).length > 0;
    if (has && this.timer === undefined && typeof window !== 'undefined') {
      this.timer = setInterval(() => { void this.flush(); }, RETRY_MS);
    } else if (!has) this.stopTimer();
  }

  private stopTimer(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }

  private bump(): void {
    this.ver += 1;
    for (const fn of [...this.listeners]) fn();
  }

  private rebuild(): void {
    const out: EventMap = { ...this.server };
    for (const [id, p] of Object.entries(this.pending)) {
      if (p.change === 'delete') delete out[id];
      else out[id] = p.change;
    }
    this.view = out;
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
        const { change, editedAt } = v as { change?: unknown; editedAt?: unknown };
        if (typeof editedAt !== 'number') continue;
        if (change === 'delete') { out[id] = { change, editedAt }; continue; }
        const rec = parseEventRecord(change);
        if (rec) out[id] = { change: rec, editedAt };
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
