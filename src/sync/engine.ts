import { normalizeColor } from '../core/color';
import { resolveEdits } from '../core/merge';
import { normalizeText } from '../core/text';
import type { DayChange, DayValue, MonthDoc, PendingEdit } from '../core/types';
import type { Outbox } from './outbox';

export interface MonthStore {
  transactMonth(monthId: string, decide: (server: MonthDoc | null) => Record<string, DayChange>): Promise<void>;
}
export type SyncStatus = { state: 'synced' | 'sending' | 'waiting'; pending: number };

export class SyncEngine {
  private running: Promise<void> | null = null;
  private readonly listeners = new Set<(status: SyncStatus) => void>();
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
    this.outbox.put({ monthId, day, base, next: clean, editedAt: this.now() });
    this.emit();
    void this.flush();
  }

  flush(): Promise<void> {
    if (!this.running) {
      this.running = this.run().finally(() => {
        this.running = null;
        this.emit();
      });
      this.emit();
    }
    return this.running;
  }

  status(): SyncStatus {
    const pending = this.outbox.list().length;
    if (this.running) return { state: 'sending', pending };
    return { state: pending > 0 ? 'waiting' : 'synced', pending };
  }

  subscribe(listener: (status: SyncStatus) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
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
    try {
      await this.store.transactMonth(monthId, (server) => {
        read = this.outbox.markSent(monthId);
        return resolveEdits(read, server?.days ?? {}, this.editedBy);
      });
    } catch {
      return 0;
    }
    this.outbox.remove(read);
    return read.length;
  }
}
