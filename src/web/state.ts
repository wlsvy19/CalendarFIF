import { shiftMonth } from '../core/dates';
import type { DayValue, MonthDoc } from '../core/types';
import type { Outbox } from '../sync/outbox';
import { applyPending } from '../sync/view';

export type MonthSource = { subscribeMonth(monthId: string, listener: (doc: MonthDoc | null) => void): () => void };

/** Holds the server's month documents the screen needs and overlays the pending edits for display. */
export class CalendarStore {
  private month: string;
  private readonly source: MonthSource;
  private readonly outbox: Outbox;
  private readonly editedBy: string;
  private readonly subscriptions = new Map<string, () => void>();
  private readonly docs = new Map<string, MonthDoc | null>();
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

  /** Subscribes to the month and its neighbours and drops every other subscription. Does not notify. */
  show(monthId: string): void {
    this.month = monthId;
    this.subscribeAround();
  }

  days(monthId: string): Record<string, DayValue> {
    return applyPending(monthId, this.docs.get(monthId) ?? null, this.outbox.list(), this.editedBy);
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
    this.subscriptions.clear();
    this.docs.clear();
    this.listeners.clear();
  }

  private subscribeAround(): void {
    const wanted = new Set([shiftMonth(this.month, -1), this.month, shiftMonth(this.month, 1)]);
    for (const [monthId, unsubscribe] of [...this.subscriptions]) {
      if (wanted.has(monthId)) continue;
      unsubscribe();
      this.subscriptions.delete(monthId);
      this.docs.delete(monthId);
    }
    for (const monthId of wanted) {
      if (this.subscriptions.has(monthId)) continue;
      this.subscriptions.set(
        monthId,
        this.source.subscribeMonth(monthId, (doc) => {
          this.docs.set(monthId, doc);
          this.emit();
        }),
      );
    }
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }
}
