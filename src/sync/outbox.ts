import type { PendingEdit } from '../core/types';

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Queue of edits not yet uploaded. It never caches: every read and write goes
 * through storage so that tabs sharing one storage do not erase each other.
 * Once storage cannot be written, a memory list takes over.
 */
export class Outbox {
  persistent = true;
  corruptDetected = false;
  private readonly key: string;
  private memory: PendingEdit[] | null = null;

  constructor(
    private readonly storage: KeyValueStore,
    uid: string,
  ) {
    this.key = `calfif.outbox.${uid}`;
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
      if (Array.isArray(parsed)) return parsed as PendingEdit[];
    } catch {
      // fall through to quarantine
    }
    this.quarantine(raw);
    return [];
  }

  put(edit: PendingEdit): PendingEdit[] {
    const list = this.list();
    const at = list.findIndex((e) => e.monthId === edit.monthId && e.day === edit.day);
    if (at < 0) {
      list.push(edit);
    } else {
      const merged: PendingEdit = { ...list[at], next: edit.next, editedAt: edit.editedAt };
      if (merged.next.text === merged.base.text && merged.next.color === merged.base.color) list.splice(at, 1);
      else list[at] = merged;
    }
    this.write(list);
    return list;
  }

  remove(sent: PendingEdit[]): PendingEdit[] {
    const list = this.list().filter(
      (e) => !sent.some((s) => s.monthId === e.monthId && s.day === e.day && s.editedAt === e.editedAt),
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
        this.persistent = false;
      }
    }
    this.memory = list;
  }

  private quarantine(raw: string): void {
    this.corruptDetected = true;
    try {
      this.storage.setItem(`${this.key}.corrupt.${Date.now()}`, raw);
      this.storage.removeItem(this.key);
    } catch {
      // storage unwritable: the queue simply starts empty
    }
  }
}
