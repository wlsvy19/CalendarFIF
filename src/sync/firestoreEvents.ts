import { FieldPath, deleteField, doc, onSnapshot, runTransaction, serverTimestamp, type Firestore } from 'firebase/firestore';
import type { EventMap } from '../core/events';
import type { EventsSource, SnapshotMeta } from '../web/eventsStore';
import { buildEventsWrite, decideEventsWrite, parseEventsDoc, type EventsWriteResult, type PendingChange } from './eventsDoc';

const RETRY_FIRST_MS = 2000;
const RETRY_MAX_MS = 60000;

/** users/{uid}/data/events 문서 하나를 듣고 쓴다. 달 문서와 따로라서 옛 앱이 건드리지 않는다. */
export class FirestoreEventsSource implements EventsSource {
  constructor(
    private readonly db: Firestore,
    private readonly uid: string,
  ) {}

  private ref() {
    return doc(this.db, 'users', this.uid, 'data', 'events');
  }

  /** 듣기 오류가 나면 알리고 2초부터 두 배씩(최대 60초) 뒤에 다시 듣는다. 스냅숏이 오면 지연을 되돌린다. */
  subscribe(onData: (items: EventMap, meta?: SnapshotMeta) => void, onError: (e: unknown) => void): () => void {
    const ref = this.ref();
    let delay = RETRY_FIRST_MS;
    let stopped = false;
    let unsubscribe: (() => void) | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const start = (): void => {
      unsubscribe = onSnapshot(
        ref,
        { includeMetadataChanges: true },
        (snap) => {
          delay = RETRY_FIRST_MS;
          // 서버가 확인한 스냅숏만 confirmed. 로컬 반영(hasPendingWrites)이나 캐시는 보여 주기만 한다.
          const confirmed = !snap.metadata.hasPendingWrites && !snap.metadata.fromCache;
          onData(snap.exists() ? parseEventsDoc(snap.data()) : {}, { confirmed });
        },
        (error) => {
          onError(error);
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

  /**
   * 트랜잭션으로 쓴다(달 문서와 같다). 서버의 지금 값을 읽어 decideEventsWrite가 고른 것만 쓰므로 다른 기기의 더 새 편집과
   * 다른 곳의 삭제가 이긴다. 항목은 mergeFields로 통째로 바꾼다. 트랜잭션은 SDK의 오프라인 대기열을 거치지 않아서
   * 연결이 없으면 실패하고, 다시 보내기는 EventsStore의 보내지 않은 변경이 맡는다(SDK가 뒤늦게 옛 값을 다시 쓰지 않는다).
   */
  async write(pending: Record<string, PendingChange>): Promise<EventsWriteResult> {
    const ref = this.ref();
    return runTransaction(this.db, async (tx) => {
      const snap = await tx.get(ref);
      const { changes, result } = decideEventsWrite(snap.exists() ? parseEventsDoc(snap.data()) : {}, pending);
      const w = buildEventsWrite(changes, { deleteField, serverTimestamp });
      if (w) tx.set(ref, w.data, { mergeFields: w.fields.map((p) => new FieldPath(...p)) });
      return result;
    });
  }
}
