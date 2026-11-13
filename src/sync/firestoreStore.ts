import {
  deleteField,
  doc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  type DocumentReference,
  type Firestore,
} from 'firebase/firestore';
import type { DayChange, MonthDoc } from '../core/types';
import type { MonthStore } from './engine';
import { buildMonthPatch, parseMonthDoc } from './monthDoc';

const RETRY_FIRST_MS = 2000;
const RETRY_MAX_MS = 60000;

export function monthDocRef(db: Firestore, uid: string, monthId: string): DocumentReference {
  return doc(db, 'users', uid, 'months', monthId);
}

export class FirestoreMonthStore implements MonthStore {
  constructor(
    private readonly db: Firestore,
    private readonly uid: string,
  ) {}

  async transactMonth(monthId: string, decide: (server: MonthDoc | null) => Record<string, DayChange>): Promise<void> {
    const ref = monthDocRef(this.db, this.uid, monthId);
    await runTransaction(this.db, async (tx) => {
      const snap = await tx.get(ref);
      const server = snap.exists() ? parseMonthDoc(snap.data()) : null;
      const patch = buildMonthPatch(decide(server), { deleteField, serverTimestamp });
      if (patch) tx.set(ref, patch, { merge: true });
    });
  }

  /**
   * Listens to one month document. On a listener error (the SDK then ends that listener) it reports the
   * error's code and subscribes again after a delay that starts at 2 s and doubles up to 60 s; a delivered
   * snapshot resets the delay. The returned function stops the listener and any pending retry.
   */
  subscribeMonth(monthId: string, listener: (doc: MonthDoc | null) => void, onError?: (code: string) => void): () => void {
    const ref = monthDocRef(this.db, this.uid, monthId);
    let delay = RETRY_FIRST_MS;
    let stopped = false;
    let unsubscribe: (() => void) | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const start = (): void => {
      unsubscribe = onSnapshot(
        ref,
        (snap) => {
          delay = RETRY_FIRST_MS;
          listener(snap.exists() ? parseMonthDoc(snap.data()) : null);
        },
        (error) => {
          onError?.(error.code || 'unknown');
          if (stopped) return;
          retry = setTimeout(() => {
            retry = undefined;
            start();
          }, delay);
          delay = Math.min(delay * 2, RETRY_MAX_MS);
        },
      );
    };
    start();
    return () => {
      stopped = true;
      unsubscribe?.();
      if (retry !== undefined) clearTimeout(retry);
    };
  }
}
