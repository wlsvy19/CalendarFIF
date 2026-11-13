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

/** 로그인 뒤 화면: 달력, 또는 안내('none' 허가 없음, 'blocked' 중지됨). */
export type MainScreen = 'calendar' | 'none' | 'blocked';

/** 이 접근 상태에서 둘 화면. 확인 중에는 보이던 것을 그대로 둔다(달력은 확인을 기다리지 않고 먼저 뜬다). */
export function screenFor(state: AccessState, shown: MainScreen): MainScreen {
  if (state === 'none' || state === 'blocked') return state;
  return state === 'checking' ? shown : 'calendar';
}

/** 주소가 #users일 때: 관리자면 사용자 관리를 연다, 보통 사용자면 달력으로 돌아간다, 아직 모르면 기다린다. */
export function usersRoute(state: AccessState): 'open' | 'leave' | 'wait' {
  return state === 'admin' ? 'open' : state === 'user' ? 'leave' : 'wait';
}

const MAX_CLAIM_ATTEMPTS = 2;
// 지켜보기가 실패하면(SDK는 그 지켜보기를 끝낸다) 2초부터 두 배씩 60초까지 기다렸다가 다시 지켜본다.
const RETRY_FIRST_MS = 2000;
const RETRY_MAX_MS = 60000;
// 허가 없음인 동안 다시 확인하는 간격. 마지막 값을 계속 쓴다.
const RECHECK_MS = [30000, 60000, 120000, 300000];
// recheck(done)의 done은 답이 없어도(연결이 없을 때) 이만큼 뒤에 부른다.
const RECHECK_LIMIT_MS = 10000;

export type AccessWatch = {
  stop(): void;
  /** 지금 다시 확인한다: 새로 지켜보고 관리자 표시 만들기를 한 번 더 허락한다. done은 서버의 답이 오면(늦어도 10초 뒤) 한 번 부른다. */
  recheck(done?: () => void): void;
};
/** 허가 없음인 동안 화면이 다시 보이거나(visibilitychange) 연결이 돌아오면(online) 다시 확인한다. */
export type AccessTriggers = { target: EventTarget; doc: { visibilityState: string } };

/**
 * 로그인한 계정의 접근 상태를 알린다. 처음은 'checking'.
 * 규칙을 배포한 직후에는 새 규칙이 모든 요청에 닿기까지 1분쯤 걸린다. 그래서 지켜보기의 오류는 상태를 바꾸지 않고
 * 다시 지켜보며, 'none'은 서버가 "문서 없음"이라고 답하고 만들기가 거부됐을 때만 알린다. 'none'인 동안에도 때때로 다시 확인한다.
 */
export function watchAccess(
  source: AccessSource,
  session: { uid: string; email: string },
  onState: (state: AccessState) => void,
  triggers?: AccessTriggers,
): AccessWatch {
  let stopped = false;
  let state: AccessState = 'checking';
  let attempts = 0;
  let claiming = false;
  let denied = false; // 만들기가 거부됐다. 다시 확인할 때까지 이 계정은 관리자가 아니다.
  let claimed = false; // 만들기가 성공했다. 문서가 보일 때까지 다시 시도하지 않는다.
  let emptyOnServer = false; // 서버가 마지막으로 "문서 없음"이라고 답했다.

  let generation = 0; // 지금 지켜보기의 번호. 끝난 지켜보기가 늦게 보낸 알림은 무시한다.
  let unwatch: (() => void) | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let retryDelay = RETRY_FIRST_MS;
  let recheckTimer: ReturnType<typeof setTimeout> | undefined;
  let recheckStep = 0;
  let waiters: Array<() => void> = [];
  let waitLimit: ReturnType<typeof setTimeout> | undefined;

  // 다시 확인의 답이 왔다: 기다리는 쪽에 알린다.
  const settle = (): void => {
    clearTimeout(waitLimit);
    waitLimit = undefined;
    const done = waiters;
    waiters = [];
    for (const fn of done) fn();
  };

  const scheduleRecheck = (): void => {
    if (stopped || state !== 'none' || recheckTimer !== undefined) return;
    const wait = RECHECK_MS[Math.min(recheckStep, RECHECK_MS.length - 1)];
    recheckStep += 1;
    recheckTimer = setTimeout(() => {
      recheckTimer = undefined;
      recheckNow();
      scheduleRecheck();
    }, wait);
  };

  const set = (next: AccessState): void => {
    if (stopped || next === state) return;
    state = next;
    if (next === 'none') {
      scheduleRecheck();
    } else {
      clearTimeout(recheckTimer);
      recheckTimer = undefined;
      recheckStep = 0;
    }
    onState(next);
  };

  const claim = (): void => {
    claiming = true;
    attempts += 1;
    source.claimAdmin(session.uid, session.email).then(
      () => {
        claiming = false;
        claimed = true; // 문서가 보이는 스냅샷이 오면 끝난다
      },
      (e: unknown) => {
        claiming = false;
        if (stopped) return;
        if ((e as { code?: string } | null)?.code === 'permission-denied') {
          denied = true;
          // 만드는 사이 문서가 왔으면(관리자가 추가했으면) 그 상태를 둔다.
          if (emptyOnServer) set('none');
        }
        settle();
      },
    );
  };

  const handleSnapshot = (s: AccessSnapshot): void => {
    retryDelay = RETRY_FIRST_MS;
    if (s.hasPendingWrites) return;
    if (s.doc) {
      emptyOnServer = false;
      if (claimed) {
        // 관리자 문서가 나중에 사라지면 한 번 더 만들어 볼 수 있게 한다.
        claimed = false;
        attempts = 0;
      }
      set(s.doc.disabled ? 'blocked' : s.doc.role);
      settle();
      return;
    }
    if (s.fromCache) return;
    emptyOnServer = true;
    if (denied) {
      set('none');
      settle();
      return;
    }
    if (claiming || claimed) return; // 만들기의 답이나 문서가 오면 끝난다
    if (attempts < MAX_CLAIM_ATTEMPTS) claim();
    else settle();
  };

  const handleError = (): void => {
    settle();
    retry = setTimeout(() => {
      retry = undefined;
      subscribe();
    }, retryDelay);
    retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
  };

  // 지켜보기를 새로 시작한다. 하던 지켜보기와 기다리던 다시 지켜보기는 버린다.
  function subscribe(): void {
    clearTimeout(retry);
    retry = undefined;
    unwatch?.();
    const mine = ++generation;
    const live = (): boolean => !stopped && mine === generation;
    unwatch = source.watch(
      session.uid,
      (s) => {
        if (live()) handleSnapshot(s);
      },
      () => {
        if (!live()) return;
        generation += 1; // 이 지켜보기는 끝났다
        handleError();
      },
    );
  }

  // 거부된 만들기를 한 번 더 허락하고 새로 지켜본다. 상태는 서버의 답이 올 때까지 그대로다.
  function recheckNow(): void {
    if (stopped) return;
    denied = false;
    attempts = Math.min(attempts, MAX_CLAIM_ATTEMPTS - 1);
    subscribe();
  }

  const onOnline = (): void => {
    if (state === 'none') recheckNow();
  };
  const onVisibility = (): void => {
    if (state === 'none' && triggers?.doc.visibilityState === 'visible') recheckNow();
  };
  triggers?.target.addEventListener('online', onOnline);
  triggers?.target.addEventListener('visibilitychange', onVisibility);

  onState('checking');
  subscribe();
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      unwatch?.();
      clearTimeout(retry);
      clearTimeout(recheckTimer);
      clearTimeout(waitLimit);
      waiters = [];
      triggers?.target.removeEventListener('online', onOnline);
      triggers?.target.removeEventListener('visibilitychange', onVisibility);
    },
    recheck(done) {
      if (stopped) return;
      if (done) {
        waiters.push(done);
        waitLimit ??= setTimeout(settle, RECHECK_LIMIT_MS);
      }
      recheckNow();
    },
  };
}
