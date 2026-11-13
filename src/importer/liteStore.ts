import { deleteField, doc, getDoc, runTransaction, serverTimestamp, type DocumentReference, type Firestore } from 'firebase/firestore/lite';
import type { DayChange, MonthDoc } from '../core/types';
import type { MonthStore } from '../sync/engine';
import { buildMonthPatch, parseMonthDoc } from '../sync/monthDoc';

/** 가져오기 도구(Node)용 달 문서 저장소. 실시간 구독이 필요 없어 가벼운 Lite SDK를 쓴다. */
export class LiteMonthStore implements MonthStore {
  constructor(
    private readonly db: Firestore,
    private readonly uid: string,
  ) {}

  private ref(monthId: string): DocumentReference {
    return doc(this.db, 'users', this.uid, 'months', monthId);
  }

  async transactMonth(monthId: string, decide: (server: MonthDoc | null) => Record<string, DayChange>): Promise<void> {
    const ref = this.ref(monthId);
    await runTransaction(this.db, async (tx) => {
      const snap = await tx.get(ref);
      const server = snap.exists() ? parseMonthDoc(snap.data()) : null;
      const patch = buildMonthPatch(decide(server), { deleteField, serverTimestamp });
      if (patch) tx.set(ref, patch, { merge: true });
    });
  }

  async getMonth(monthId: string): Promise<MonthDoc | null> {
    const snap = await getDoc(this.ref(monthId));
    return snap.exists() ? parseMonthDoc(snap.data()) : null;
  }
}
