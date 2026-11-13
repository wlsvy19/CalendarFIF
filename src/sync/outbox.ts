import type { DayValue, PendingEdit } from '../core/types';

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isDayValue = (v: unknown): v is DayValue => isObject(v) && typeof v.text === 'string' && typeof v.color === 'string';
const isPendingEdit = (v: unknown): v is PendingEdit =>
  isObject(v) &&
  typeof v.monthId === 'string' &&
  typeof v.day === 'string' &&
  isDayValue(v.base) &&
  isDayValue(v.next) &&
  typeof v.editedAt === 'number' &&
  (v.sent === undefined || v.sent === true);

/**
 * Queue of edits not yet uploaded, in order; one day may have several entries.
 * An entry is `sent` once an upload has read it (the server may already hold it),
 * and a later edit for that day is then queued as its own entry.
 * It never caches: every read and write goes through storage so that tabs
 * sharing one storage do not erase each other. Once storage cannot be written,
 * a memory list takes over.
 */
export class Outbox {
  private readonly key: string;
  private memory: PendingEdit[] | null = null;
  private isPersistent = true;
  private isCorrupt = false;

  constructor(
    private readonly storage: KeyValueStore,
    uid: string,
  ) {
    this.key = `calfif.outbox.${uid}`;
    this.list(); // detect corrupt content right away
  }

  get persistent(): boolean {
    return this.isPersistent;
  }

  get corruptDetected(): boolean {
    return this.isCorrupt;
  }

  list(): PendingEdit[] {
    if (this.memory) return [...this.memory];
    let raw: string | null = null;
    try {
      raw = this.storage.getItem(this.key);
    } catch {
      return [];
    }
    if (raw === null) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every(isPendingEdit)) return parsed;
    } catch {
      // fall through to quarantine
    }
    this.quarantine(raw);
    return [];
  }

  put(edit: PendingEdit): PendingEdit[] {
    const list = this.list();
    let at = -1;
    list.forEach((e, i) => {
      if (e.monthId === edit.monthId && e.day === edit.day) at = i;
    });
    if (at < 0 || list[at].sent) {
      list.push(edit);
    } else {
      const merged: PendingEdit = { ...list[at], next: edit.next, editedAt: edit.editedAt };
      if (merged.next.text === merged.base.text && merged.next.color === merged.base.color) list.splice(at, 1);
      else list[at] = merged;
    }
    this.write(list);
    return list;
  }

  /** Marks every entry of the month as read by an upload; returns the month's entries in order. */
  markSent(monthId: string): PendingEdit[] {
    const list = this.list();
    let changed = false;
    const marked = list.map((e) => {
      if (e.monthId !== monthId || e.sent) return e;
      changed = true;
      return { ...e, sent: true as const };
    });
    if (changed) this.write(marked);
    return marked.filter((e) => e.monthId === monthId);
  }

  remove(sent: PendingEdit[]): PendingEdit[] {
    const list = this.list().filter(
      (e) => !(e.sent && sent.some((s) => s.monthId === e.monthId && s.day === e.day && s.editedAt === e.editedAt)),
    );
    this.write(list);
    return list;
  }

  private write(list: PendingEdit[]): void {
    if (!this.memory) {
      try {
        this.storage.setItem(this.key, JSON.stringify(list));
        return;
      } catch {
        this.isPersistent = false;
      }
    }
    this.memory = list;
  }

  private quarantine(raw: string): void {
    this.isCorrupt = true;
    try {
      this.storage.setItem(`${this.key}.corrupt.${Date.now()}`, raw);
      this.storage.removeItem(this.key);
    } catch {
      // storage unwritable: the queue simply starts empty
    }
  }
}
