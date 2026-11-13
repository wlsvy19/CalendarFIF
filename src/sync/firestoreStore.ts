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

  subscribeMonth(monthId: string, listener: (doc: MonthDoc | null) => void): () => void {
    return onSnapshot(monthDocRef(this.db, this.uid, monthId), (snap) => {
      listener(snap.exists() ? parseMonthDoc(snap.data()) : null);
    });
  }
}
