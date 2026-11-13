export type AccessDoc = { email: string; role: 'admin' | 'user'; disabled: boolean; createdAt: number };
export type AccessState = 'checking' | 'admin' | 'user' | 'blocked' | 'none';

/** Firestore에서 읽은 값이 access 문서 모양이면 돌려주고, 아니면 null. */
export function parseAccess(data: unknown): AccessDoc | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  if (typeof d.email !== 'string' || d.email === '') return null;
  if (d.role !== 'admin' && d.role !== 'user') return null;
  if (typeof d.disabled !== 'boolean') return null;
  if (typeof d.createdAt !== 'number') return null;
  return { email: d.email, role: d.role, disabled: d.disabled, createdAt: d.createdAt };
}

export type AccessSnapshot = { doc: AccessDoc | null; fromCache: boolean; hasPendingWrites: boolean };
export type AccessSource = {
  /** 내 access 문서를 지켜본다. */
  watch(uid: string, onSnapshot: (s: AccessSnapshot) => void, onError: (code: string) => void): () => void;
  /** 관리자 표시를 만든다. 규칙상 관리자 계정만 성공한다. 실패는 { code }를 던진다. */
  claimAdmin(uid: string, email: string): Promise<void>;
};

const MAX_CLAIM_ATTEMPTS = 2;

/** 로그인한 계정의 접근 상태를 알린다. 처음은 'checking'. 끊는 함수를 돌려준다. */
export function watchAccess(
  source: AccessSource,
  session: { uid: string; email: string },
  onState: (state: AccessState) => void,
): () => void {
  let stopped = false;
  let state: AccessState = 'checking';
  let attempts = 0;
  let claiming = false;
  let settled = false; // 만들기가 성공했거나 거부됐다. 더 시도하지 않는다.

  const set = (next: AccessState): void => {
    if (stopped || next === state) return;
    state = next;
    onState(next);
  };

  const claim = (): void => {
    claiming = true;
    attempts += 1;
    source.claimAdmin(session.uid, session.email).then(
      () => {
        claiming = false;
        settled = true;
      },
      (e: unknown) => {
        claiming = false;
        if (stopped) return;
        if ((e as { code?: string } | null)?.code === 'permission-denied') {
          settled = true;
          set('none');
        }
      },
    );
  };

  onState('checking');
  const unwatch = source.watch(
    session.uid,
    (s) => {
      if (stopped || s.hasPendingWrites) return;
      if (s.doc) {
        set(s.doc.disabled ? 'blocked' : s.doc.role);
        return;
      }
      if (s.fromCache) return;
      if (!claiming && !settled && attempts < MAX_CLAIM_ATTEMPTS) claim();
    },
    (code) => {
      if (code === 'permission-denied') set('none');
    },
  );
  return () => {
    stopped = true;
    unwatch();
  };
}
