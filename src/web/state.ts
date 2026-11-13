import { shiftMonth } from '../core/dates';
import type { DayChange, DayRecord, DayValue, MonthDoc } from '../core/types';
import type { Outbox } from '../sync/outbox';
import { applyPending } from '../sync/view';

export type MonthSource = {
  subscribeMonth(monthId: string, listener: (doc: MonthDoc | null) => void, onError?: (code: string) => void): () => void;
};
export type ReadProblem = 'denied' | 'failed';

/** How long a committed value stays on screen when no snapshot confirms or replaces it. */
const COMMITTED_MS = 10000;
const DENIED_CODES = new Set(['permission-denied', 'unauthenticated']);

type Committed = { change: DayChange; timer: ReturnType<typeof setTimeout> };

/** True when a snapshot's day shows our committed value or a record written after it. */
function settled(change: DayChange, record: DayRecord | undefined): boolean {
  if (change === 'delete') return record === undefined;
  if (!record) return false;
  const same = record.text === change.text && record.color === change.color && record.editedAt === change.editedAt;
  return same || record.editedAt > change.editedAt;
}

/**
 * Holds the server's month documents the screen needs and overlays the pending edits for display.
 * Values an upload has just committed are kept on top of the last snapshot until a snapshot shows them
 * (transactions do not pass through the SDK's local cache, so the listener learns of them later).
 */
export class CalendarStore {
  private month: string;
  private readonly source: MonthSource;
  private readonly outbox: Outbox;
  private readonly editedBy: string;
  private readonly subscriptions = new Map<string, () => void>();
  private readonly docs = new Map<string, MonthDoc | null>();
  private readonly committed = new Map<string, Map<string, Committed>>();
  private readonly problems = new Map<string, ReadProblem>();
  private readonly listeners = new Set<() => void>();

  constructor(deps: { source: MonthSource; outbox: Outbox; editedBy: string; initialMonth: string }) {
    this.source = deps.source;
    this.outbox = deps.outbox;
    this.editedBy = deps.editedBy;
    this.month = deps.initialMonth;
    this.subscribeAround();
  }

  current(): string {
    return this.month;
  }

  /** Subscribes to the month, its neighbours and the months in `also`, and drops every other subscription. Does not notify. */
  show(monthId: string, also: string[] = []): void {
    this.month = monthId;
    this.subscribeAround(also);
  }

  /** True while the month is subscribed. */
  covers(monthId: string): boolean {
    return this.subscriptions.has(monthId);
  }

  /** True once the server has answered for the month (even when the document does not exist). */
  isLoaded(monthId: string): boolean {
    return this.docs.has(monthId);
  }

  days(monthId: string): Record<string, DayValue> {
    return applyPending(monthId, this.withCommitted(monthId), this.outbox.list(), this.editedBy);
  }

  /** Keeps values an upload just wrote on screen until a snapshot of the month shows them. Ignores months outside the window. */
  noteCommitted(monthId: string, changes: Record<string, DayChange>): void {
    if (!this.subscriptions.has(monthId)) return;
    let overlay = this.committed.get(monthId);
    if (!overlay) {
      overlay = new Map();
      this.committed.set(monthId, overlay);
    }
    for (const [day, change] of Object.entries(changes)) {
      const previous = overlay.get(day);
      if (previous) clearTimeout(previous.timer);
      const entry: Committed = {
        change,
        timer: setTimeout(() => {
          if (this.committed.get(monthId)?.get(day) !== entry) return;
          this.committed.get(monthId)!.delete(day);
          this.emit();
        }, COMMITTED_MS),
      };
      overlay.set(day, entry);
    }
    this.emit();
  }

  /** 'denied' if any subscribed month was refused, else 'failed' if any failed to load, else null. */
  readProblem(): ReadProblem | null {
    const problems = [...this.problems.values()];
    if (problems.includes('denied')) return 'denied';
    return problems.includes('failed') ? 'failed' : null;
  }

  refresh(): void {
    this.emit();
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  destroy(): void {
    for (const unsubscribe of this.subscriptions.values()) unsubscribe();
    for (const monthId of [...this.committed.keys()]) this.dropCommitted(monthId);
    this.subscriptions.clear();
    this.docs.clear();
    this.problems.clear();
    this.listeners.clear();
  }

  private withCommitted(monthId: string): MonthDoc | null {
    const server = this.docs.get(monthId) ?? null;
    const overlay = this.committed.get(monthId);
    if (!overlay || overlay.size === 0) return server;
    const days = { ...(server?.days ?? {}) };
    for (const [day, { change }] of overlay) {
      if (change === 'delete') delete days[day];
      else days[day] = change;
    }
    return { days };
  }

  private dropCommitted(monthId: string): void {
    for (const { timer } of this.committed.get(monthId)?.values() ?? []) clearTimeout(timer);
    this.committed.delete(monthId);
  }

  private receive(monthId: string, doc: MonthDoc | null): void {
    this.docs.set(monthId, doc);
    this.problems.delete(monthId);
    const overlay = this.committed.get(monthId);
    if (overlay) {
      for (const [day, { change, timer }] of [...overlay]) {
        if (!settled(change, doc?.days[day])) continue;
        clearTimeout(timer);
        overlay.delete(day);
      }
    }
    this.emit();
  }

  private fail(monthId: string, code: string): void {
    const before = this.readProblem();
    this.problems.set(monthId, DENIED_CODES.has(code) ? 'denied' : 'failed');
    if (this.readProblem() !== before) this.emit();
  }

  private subscribeAround(also: string[] = []): void {
    const wanted = new Set([shiftMonth(this.month, -1), this.month, shiftMonth(this.month, 1), ...also]);
    for (const [monthId, unsubscribe] of [...this.subscriptions]) {
      if (wanted.has(monthId)) continue;
      unsubscribe();
      this.subscriptions.delete(monthId);
      this.docs.delete(monthId);
      this.problems.delete(monthId);
      this.dropCommitted(monthId);
    }
    for (const monthId of wanted) {
      if (this.subscriptions.has(monthId)) continue;
      this.subscriptions.set(
        monthId,
        this.source.subscribeMonth(
          monthId,
          (doc) => this.receive(monthId, doc),
          (code) => this.fail(monthId, code),
        ),
      );
    }
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }
}
