export type UpdateDeps = {
  /** navigator.serviceWorker (controller, addEventListener) */
  container: { controller: unknown; addEventListener(type: 'controllerchange', fn: () => void): void };
  /** 지금 다시 읽으면 안 되는 상태인가 (편집 화면이 열려 있다, 저장되지 않은 편집이 메모리에만 있다) */
  busy(): boolean;
  reload(): void;
  /** 다시 읽은 시각을 기억하는 곳 (sessionStorage) */
  session: Pick<Storage, 'getItem' | 'setItem'>;
  now(): number;
  every(ms: number, fn: () => void): () => void; // setInterval, returns the stop function
};

/** 지금 다시 읽으면 안 되는가: 시트가 열려 있거나, 글자를 입력하는 중이거나, 저장되지 않은 편집이 메모리에만 있다. */
export function isBusy(doc: Document, unsavedOnlyInMemory: boolean): boolean {
  const tag = doc.activeElement?.tagName;
  return doc.documentElement.classList.contains('sheet-open') || tag === 'INPUT' || tag === 'TEXTAREA' || unsavedOnlyInMemory;
}

const KEY = 'calfif.reloadedAt';
const LOOP_GUARD_MS = 60_000;
const RETRY_MS = 1000;

/** 새 버전이 페이지를 넘겨받으면 한 번 다시 읽는다. */
export function reloadOnUpdate(deps: UpdateDeps): void {
  // 처음 설치라면 지금 페이지가 이미 가장 새 것이다.
  if (!deps.container.controller) return;

  /** 다시 읽어도 되는지 정하고, 된다면 시각을 적는다. 저장소를 못 쓰면 다시 읽기를 반복할 수 있으므로 읽지 않는다. */
  const claim = (): boolean => {
    try {
      const last = Number(deps.session.getItem(KEY));
      if (last > 0 && deps.now() - last < LOOP_GUARD_MS) return false;
      deps.session.setItem(KEY, String(deps.now()));
      return true;
    } catch {
      return false;
    }
  };
  let waiting = false;
  deps.container.addEventListener('controllerchange', () => {
    if (waiting) return;
    if (!deps.busy()) {
      if (claim()) deps.reload();
      return;
    }
    waiting = true;
    const stop = deps.every(RETRY_MS, () => {
      if (deps.busy()) return;
      stop();
      if (claim()) deps.reload();
    });
  });
}
