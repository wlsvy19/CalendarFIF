import { collection, deleteDoc, doc, onSnapshot, setDoc, updateDoc, type Firestore } from 'firebase/firestore';
import { parseAccess, type AccessDoc, type AccessSource } from './access';
import { codeOf, type UserRow, type UsersSource } from './users';

async function rethrow<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    throw { code: codeOf(e) };
  }
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
    put: (uid, data) => rethrow(setDoc(doc(db, 'access', uid), data)),
    setDisabled: (uid, disabled) => rethrow(updateDoc(doc(db, 'access', uid), { disabled })),
    remove: (uid) => rethrow(deleteDoc(doc(db, 'access', uid))),
  };
}
