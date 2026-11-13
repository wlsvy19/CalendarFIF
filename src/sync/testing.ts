import type { DayChange, DayRecord, DayValue, MonthDoc, PendingEdit } from '../core/types';
import type { MonthStore } from './engine';
import type { KeyValueStore } from './outbox';

export class MemoryStorage implements KeyValueStore {
  data = new Map<string, string>();
  failWrites = false;
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error('storage write failed');
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    if (this.failWrites) throw new Error('storage write failed');
    this.data.delete(key);
  }
}

export class FakeMonthStore implements MonthStore {
  docs: Map<string, MonthDoc>;
  calls: string[] = [];
  failMonths = new Set<string>();
  hold?: Promise<void>;
  beforeSecondDecide?: () => void;
  failAfterDecide = new Set<string>();
  failAfterCommit = new Set<string>();
  afterCommit?: () => void;
  /** When set, a failing month rejects with an error carrying this `code` (like a FirestoreError). */
  failCode?: string;

  constructor(docs: Record<string, MonthDoc> = {}) {
    this.docs = new Map(Object.entries(docs));
  }

  async transactMonth(monthId: string, decide: (server: MonthDoc | null) => Record<string, DayChange>): Promise<void> {
    this.calls.push(monthId);
    if (this.hold) await this.hold;
    if (this.failMonths.has(monthId)) {
      const error = new Error(`transaction failed: ${monthId}`);
      throw this.failCode === undefined ? error : Object.assign(error, { code: this.failCode });
    }
    if (this.beforeSecondDecide) {
      decide(this.docs.get(monthId) ?? null);
      const hook = this.beforeSecondDecide;
      this.beforeSecondDecide = undefined;
      hook();
    }
    const changes = decide(this.docs.get(monthId) ?? null);
    if (this.failAfterDecide.has(monthId)) throw new Error(`transaction failed after decide: ${monthId}`);
    const days = { ...(this.docs.get(monthId)?.days ?? {}) };
    for (const [day, change] of Object.entries(changes)) {
      if (change === 'delete') delete days[day];
      else days[day] = change;
    }
    this.docs.set(monthId, { days });
    if (this.afterCommit) {
      const hook = this.afterCommit;
      this.afterCommit = undefined;
      hook();
    }
    if (this.failAfterCommit.has(monthId)) throw new Error(`transaction failed after commit: ${monthId}`);
  }
}

export const val = (text: string, color = ''): DayValue => ({ text, color });
export const rec = (text: string, color = '', editedAt = 1, editedBy = 'x'): DayRecord => ({
  text,
  color,
  editedAt,
  editedBy,
});
export const edit = (monthId: string, day: string, baseText: string, nextText: string, editedAt = 100): PendingEdit => ({
  monthId,
  day,
  base: val(baseText),
  next: val(nextText),
  editedAt,
});
