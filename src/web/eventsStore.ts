import type { EventMap, EventRecord } from '../core/events';
import { parseEventRecord } from '../core/events';
import type { EventChange } from '../sync/eventsDoc';
import type { KeyValueStore } from '../sync/outbox';

// 알림과 카운트다운의 화면용 저장소: 서버 값 위에 아직 보내지 않은 변경을 얹어 보여 준다.

export type EventsSource = {
  subscribe(onData: (items: EventMap) => void, onError: (e: unknown) => void): () => void;
  write(changes: Record<string, EventChange>): Promise<void>;
};
export type EventsView = { items(): EventMap; version(): number; onChange(fn: () => void): () => void };

type Pending = Record<string, { change: EventChange; editedAt: number }>;

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
      (items) => this.onServer(items),
      () => { /* 듣기는 원본이 다시 시도한다 */ },
    );
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.onOnline);
      this.timer = setInterval(() => { if (Object.keys(this.pending).length > 0) void this.flush(); }, RETRY_MS);
    }
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
    if (Object.keys(this.pending).length === 0) return;
    if (this.opts.online && !this.opts.online()) return;
    this.sending = true;
    try {
      do {
        this.again = false;
        const changes: Record<string, EventChange> = {};
        for (const [id, p] of Object.entries(this.pending)) changes[id] = p.change;
        try {
          await this.opts.source.write(changes);
        } catch {
          return; // 남겨 두고 online이나 타이머에 다시 보낸다
        }
      } while (this.again);
    } finally {
      this.sending = false;
    }
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (typeof window !== 'undefined') window.removeEventListener('online', this.onOnline);
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    this.listeners.clear();
  }

  private onServer(items: EventMap): void {
    this.server = items;
    this.isLoaded = true;
    let dropped = false;
    for (const [id, p] of Object.entries(this.pending)) {
      const s = items[id];
      const caught = p.change === 'delete' ? s === undefined : s !== undefined && s.editedAt >= p.editedAt;
      if (caught) { delete this.pending[id]; dropped = true; }
    }
    if (dropped) this.writePending();
    this.rebuild();
    this.bump();
  }

  private changed(): void {
    this.writePending();
    this.rebuild();
    this.bump();
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
