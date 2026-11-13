import { normalizeColor } from '../core/color';
import { resolveEdits } from '../core/merge';
import { normalizeText } from '../core/text';
import type { DayChange, DayValue, MonthDoc, PendingEdit } from '../core/types';
import type { Outbox } from './outbox';

export interface MonthStore {
  transactMonth(monthId: string, decide: (server: MonthDoc | null) => Record<string, DayChange>): Promise<void>;
}
/** reason 'denied': the most recent failed upload was refused for lack of permission. */
export type SyncStatus = { state: 'synced' | 'sending' | 'waiting'; pending: number; reason?: 'denied' };
export type CommitListener = (monthId: string, changes: Record<string, DayChange>) => void;

const DENIED_CODES = new Set(['permission-denied', 'unauthenticated']);

function errorCode(e: unknown): string | undefined {
  const code = (e as { code?: unknown } | null | undefined)?.code;
  return typeof code === 'string' ? code : undefined;
}

export class SyncEngine {
  private running: Promise<void> | null = null;
  /** The last flush ended with edits still waiting; retries keep reporting `waiting` until one succeeds. */
  private failed = false;
  private denied = false;
  private readonly listeners = new Set<(status: SyncStatus) => void>();
  private readonly commitListeners = new Set<CommitListener>();
  private readonly store: MonthStore;
  private readonly outbox: Outbox;
  private readonly editedBy: string;
  private readonly now: () => number;

  constructor(deps: { store: MonthStore; outbox: Outbox; editedBy: string; now?: () => number }) {
    this.store = deps.store;
    this.outbox = deps.outbox;
    this.editedBy = deps.editedBy;
    this.now = deps.now ?? Date.now;
  }

  saveEdit(monthId: string, day: string, base: DayValue, next: DayValue): void {
    const clean: DayValue = { text: normalizeText(next.text), color: normalizeColor(next.color) };
    if (clean.text === base.text && clean.color === base.color) return;
    if (this.outbox.list().length === 0) this.clearFailure(); // a failure before the queue emptied is not this edit's
    this.outbox.put({ monthId, day, base, next: clean, editedAt: this.now() });
    this.emit();
    void this.flush();
  }

  flush(): Promise<void> {
    if (!this.running) {
      this.running = this.run().finally(() => {
        this.running = null;
        this.failed = this.pendingCount() > 0;
        this.emit();
      });
      this.emit();
    }
    return this.running;
  }

  status(): SyncStatus {
    const pending = this.pendingCount();
    if (pending === 0) return { state: 'synced', pending };
    const reason = this.denied ? { reason: 'denied' as const } : {};
    if (this.running && !this.failed) return { state: 'sending', pending, ...reason };
    return { state: 'waiting', pending, ...reason };
  }

  subscribe(listener: (status: SyncStatus) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Called after a month's transaction has committed, with the changes the last `decide` wrote.
   * Runs in the same synchronous step that removes the sent edits from the queue.
   */
  onCommit(listener: CommitListener): () => void {
    this.commitListeners.add(listener);
    return () => {
      this.commitListeners.delete(listener);
    };
  }

  /** Queue length; an empty queue also clears the failure state. */
  private pendingCount(): number {
    const pending = this.outbox.list().length;
    if (pending === 0) this.clearFailure();
    return pending;
  }

  private clearFailure(): void {
    this.failed = false;
    this.denied = false;
  }

  private emit(): void {
    const status = this.status();
    for (const listener of [...this.listeners]) listener(status);
  }

  private async run(): Promise<void> {
    // Let edits saved in the same tick join this run.
    await Promise.resolve();
    let sent: number;
    do {
      sent = 0;
      const months = [...new Set(this.outbox.list().map((e) => e.monthId))];
      for (const monthId of months) sent += await this.sendMonth(monthId);
    } while (sent > 0 && this.outbox.list().length > 0);
  }

  /** Uploads one month; returns how many edits went up (0 on failure). */
  private async sendMonth(monthId: string): Promise<number> {
    let read: PendingEdit[] = [];
    let changes: Record<string, DayChange> = {};
    try {
      await this.store.transactMonth(monthId, (server) => {
        read = this.outbox.markSent(monthId);
        changes = resolveEdits(read, server?.days ?? {}, this.editedBy);
        return changes;
      });
    } catch (e) {
      const code = errorCode(e);
      this.denied = code !== undefined && DENIED_CODES.has(code);
      return 0;
    }
    this.denied = false;
    this.outbox.remove(read);
    if (Object.keys(changes).length > 0) {
      for (const listener of [...this.commitListeners]) listener(monthId, changes);
    }
    return read.length;
  }
}
