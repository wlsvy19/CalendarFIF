import { collection, doc, onSnapshot, runTransaction, setDoc, type Firestore, type Transaction } from 'firebase/firestore';
import { parseAccess, type AccessDoc, type AccessSource } from './access';
import { withTimeLimit } from './timeLimit';
import { codeOf } from './authCommon';
import type { UserRow, UsersSource } from './users';

async function rethrow<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    throw { code: codeOf(e) };
  }
}

// 관리자의 목록 쓰기는 연결이 있어야 한다. 트랜잭션은 서버가 필요하고 대기열에 쌓이지 않는다.
const WRITE_LIMIT_MS = 10000;
function writeNow(db: Firestore, change: (tx: Transaction) => void): Promise<void> {
  return rethrow(withTimeLimit(runTransaction(db, async (tx) => { change(tx); }), WRITE_LIMIT_MS));
}

export function firestoreAccessSource(db: Firestore): AccessSource {
  return {
    watch(uid, onSnap, onError) {
      return onSnapshot(
        doc(db, 'access', uid),
        { includeMetadataChanges: true },
        (snap) =>
          onSnap({
            doc: snap.exists() ? parseAccess(snap.data()) : null,
            fromCache: snap.metadata.fromCache,
            hasPendingWrites: snap.metadata.hasPendingWrites,
          }),
        (error) => onError(error.code),
      );
    },
    claimAdmin(uid, email) {
      const data: AccessDoc = { email, role: 'admin', disabled: false, createdAt: Date.now() };
      return rethrow(setDoc(doc(db, 'access', uid), data));
    },
  };
}

export function firestoreUsersSource(db: Firestore): UsersSource {
  return {
    watchAll(onRows, onError) {
      return onSnapshot(
        collection(db, 'access'),
        (snap) => {
          const rows: UserRow[] = [];
          for (const d of snap.docs) {
            const parsed = parseAccess(d.data());
            if (parsed) rows.push({ uid: d.id, ...parsed });
          }
          rows.sort((a, b) => a.email.localeCompare(b.email));
          onRows(rows);
        },
        (error) => onError(error.code),
      );
    },
    put: (uid, data) => writeNow(db, (tx) => { tx.set(doc(db, 'access', uid), data); }),
    setDisabled: (uid, disabled) => writeNow(db, (tx) => { tx.update(doc(db, 'access', uid), { disabled }); }),
    remove: (uid) => writeNow(db, (tx) => { tx.delete(doc(db, 'access', uid)); }),
  };
}
