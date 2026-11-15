import { FieldPath, deleteField, doc, onSnapshot, serverTimestamp, setDoc, type Firestore } from 'firebase/firestore';
import type { EventMap } from '../core/events';
import type { EventsSource } from '../web/eventsStore';
import { buildEventsWrite, parseEventsDoc, type EventChange } from './eventsDoc';

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
  subscribe(onData: (items: EventMap) => void, onError: (e: unknown) => void): () => void {
    const ref = this.ref();
    let delay = RETRY_FIRST_MS;
    let stopped = false;
    let unsubscribe: (() => void) | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const start = (): void => {
      unsubscribe = onSnapshot(
        ref,
        (snap) => {
          delay = RETRY_FIRST_MS;
          onData(snap.exists() ? parseEventsDoc(snap.data()) : {});
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

  async write(changes: Record<string, EventChange>): Promise<void> {
    const w = buildEventsWrite(changes, { deleteField, serverTimestamp });
    if (!w) return;
    await setDoc(this.ref(), w.data, { mergeFields: w.fields.map((p) => new FieldPath(...p)) });
  }
}
