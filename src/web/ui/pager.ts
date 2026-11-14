// 달 넘기기의 스크롤 상자. .pager가 옆으로 구르고 칸(.slot)마다 쪽(.grid) 하나가 들어간다.
// 손가락을 따라가고, 미끄러지고, 칸에 멈추는 것은 브라우저가 한다. 스크립트는 어느 칸에 어느 쪽을 붙일지만 정한다.
// 칸은 처음에 한 번 만들고 더하거나 빼거나 크기를 바꾸지 않는다. 그래서 스크롤하는 동안 멈출 자리가 바뀌지 않는다.

export const SLOTS = 2401;
export const CENTER = 1200;

const REST_MS = 150; // 마지막 scroll 뒤 이만큼 조용하면 멈춘 것으로 본다
const ASSIST_MIN_PX = 10; // 이보다 덜 움직인 끌기는 마저 넘기지 않는다
const ASSIST_WATCH_MS = 80; // 손을 뗀 뒤 브라우저가 이어서 넘기는지 지켜보는 시간
const MAX_STEP = 2; // 손가락은 칸을 하나씩 넘긴다(scroll-snap-stop: always). 이보다 먼 위치는 낡은 값으로 본다

/** 스크롤 위치에서 가장 가까운 칸. 0 ~ SLOTS-1로 자른다. */
export function nearestSlot(scrollLeft: number, width: number): number {
  return Math.min(SLOTS - 1, Math.max(0, Math.round(scrollLeft / width)));
}

export type PagerEnv = {
  /** 한 쪽의 폭(px). 기본: el.getBoundingClientRect().width */
  width?(): number;
  /** 기본: matchMedia('(prefers-reduced-motion: reduce)').matches */
  reducedMotion?(): boolean;
  /** 손을 뗀 뒤 브라우저가 넘기지 않으면 대신 넘길지. 기본: !('GestureEvent' in window) */
  assist?: boolean;
  /** 폭이 바뀌면 cb를 부른다. 끊는 함수를 돌려준다. 기본: ResizeObserver(없으면 window의 resize) */
  observeResize?(el: HTMLElement, cb: () => void): () => void;
};

export type PagerDeps = {
  anchor: string; // 처음 보일 쪽
  neighbours: 0 | 1; // 옆 쪽을 붙여 둘지. PC 앱은 0
  step(anchor: string, delta: number): string; // 옆 쪽의 anchor
  fill(grid: HTMLElement, anchor: string): void; // 쪽 하나를 그린다
  onCurrent(anchor: string): void; // 보이는 쪽이 바뀌었다
  /** 손가락으로 넘기는 동안 미뤄 둔 일을 해도 될 때(스크롤이 제자리에 멈췄거나, 다음 손짓이나 단추가 시작될 때) 부른다. */
  onSettle?(): void;
};

export type Pager = {
  el: HTMLElement; // .pager
  anchor(): string; // 지금 쪽
  anchors(): string[]; // 붙어 있는 쪽 모두(칸 순서)
  current(): HTMLElement; // 지금 쪽의 .grid
  place(): void; // 화면에 붙인 뒤 한 번 부른다(스크롤 위치를 지금 칸에 맞춘다)
  go(delta: -1 | 1): void; // 옆 쪽으로
  jump(anchor: string): void; // 바로 그 쪽으로
  refresh(): void; // 붙어 있는 쪽을 모두 다시 그린다
  /** 손가락으로 넘기는 중이라 무거운 일을 미뤄야 하는가. 미뤘으면 onSettle에서 한다. */
  busy(): boolean;
  destroy(): void;
};

// ResizeObserver는 높이가 바뀌어도 부르므로, 받는 쪽(createPager)이 폭을 견주어 본다.
function observeSize(el: HTMLElement, cb: () => void): () => void {
  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(() => cb());
    observer.observe(el);
    return () => observer.disconnect();
  }
  window.addEventListener('resize', cb);
  return () => window.removeEventListener('resize', cb);
}

export function createPager(deps: PagerDeps, env: PagerEnv = {}): Pager {
  const el = document.createElement('div');
  el.className = 'pager';
  const width = env.width ?? (() => el.getBoundingClientRect().width);
  const reducedMotion = env.reducedMotion ?? (() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  // Safari와 아이폰의 모든 브라우저에는 GestureEvent가 있다. 아이폰에서는 손을 뗄 때 움직이고 있으면 시스템이 넘겨 주고,
  // 그 움직임에 스크립트가 끼어들면 안 된다.
  const assist = env.assist ?? !('GestureEvent' in window);

  // PC 앱(neighbours 0)은 스크롤하지 않으므로 칸을 하나만 둔다. 스크롤 위치가 늘 0이라
  // 창 폭이 소수점 단위로 바뀌어도(배율을 쓰는 화면) 쪽이 칸 밖으로 밀려나지 않는다.
  const count = deps.neighbours === 0 ? 1 : SLOTS;
  const clamp = (i: number): number => Math.min(count - 1, Math.max(0, i));
  const slots: HTMLElement[] = [];
  const strip = document.createDocumentFragment();
  for (let i = 0; i < count; i++) {
    const slot = document.createElement('div');
    slot.className = 'slot';
    slots.push(slot);
    strip.append(slot);
  }
  el.append(strip);

  let currentSlot = count === 1 ? 0 : CENTER;
  let currentAnchor = deps.anchor;
  const pages = new Map<number, HTMLElement>(); // 칸 번호 -> 그 칸의 .grid
  let placedWidth: number | null = null;
  let pending: number | null = null; // 단추나 도움으로 스크롤해 가는 칸
  let restTimer: ReturnType<typeof setTimeout> | undefined;
  // 손가락으로 넘기는 동안(스크롤이 멈추기 전까지)은 쪽을 다시 그리지 않고 미뤄 둔다. 화면이 미끄러지는 도중에 쪽을 통째로
  // 다시 만들면 폰에서 그만큼 멈칫한다. 미룬 쪽은 스크롤이 멈추거나 다음 손가락이 닿을 때(움직이기 전에) 그린다.
  // 단추로 넘길 때는 미루지 않는다(가는 쪽이 바로 보여야 한다).
  const stale = new Set<number>(); // 다시 그려야 하는데 미뤄 둔 칸
  let moving = false; // 스크롤이 움직이는 중(마지막 scroll 뒤 REST_MS 안)
  let byFinger = false; // 마지막 움직임을 손가락이 시작했다
  let remount = false; // 손가락으로 넘기는 중에 지금 칸이 바뀌어, 쪽을 옮겨 붙이는 일을 미뤘다
  const deferring = (): boolean => moving && byFinger;

  const anchorAt = (i: number): string => (i === currentSlot ? currentAnchor : deps.step(currentAnchor, i - currentSlot));
  const mountedSlots = (): number[] => [...pages.keys()].sort((a, b) => a - b);
  function fillSlot(i: number): void {
    stale.delete(i);
    const grid = pages.get(i);
    if (grid) deps.fill(grid, anchorAt(i));
  }
  /** 미뤄 둔 쪽을 지금 그리고(지금 쪽부터), 미뤄 둔 다른 일을 하라고 알린다. */
  function flush(): void {
    if (remount) {
      remount = false;
      mount(false);
    }
    for (const i of [...stale].sort((a, b) => Math.abs(a - currentSlot) - Math.abs(b - currentSlot))) fillSlot(i);
    deps.onSettle?.();
  }

  // 지금 칸과 (neighbours가 1이면) 양옆 칸에 쪽을 붙인다. 빠지는 쪽의 요소는 새 칸으로 옮겨 다시 쓴다.
  // refill이 거짓이면 이미 제 칸에 있는 쪽은 다시 그리지 않는다. fill은 쪽이 칸 안에 있을 때 부른다(칸 높이를 잰다).
  function mount(refill: boolean): void {
    const wanted: number[] = [];
    for (let i = currentSlot - deps.neighbours; i <= currentSlot + deps.neighbours; i++) {
      if (i >= 0 && i < count) wanted.push(i);
    }
    const spare: HTMLElement[] = [];
    for (const [i, grid] of [...pages]) {
      if (wanted.includes(i)) continue;
      pages.delete(i);
      stale.delete(i);
      spare.push(grid);
    }
    for (const i of wanted) {
      let grid = pages.get(i);
      const arrived = grid === undefined;
      if (!grid) {
        grid = spare.pop() ?? document.createElement('div');
        grid.className = 'grid';
        slots[i].append(grid);
        pages.set(i, grid);
      }
      grid.classList.toggle('current', i === currentSlot);
      grid.toggleAttribute('inert', i !== currentSlot);
      // 손가락으로 넘기는 중에 새로 붙은 쪽(화면 밖, 다음 넘기기에 들어올 쪽)은 멈춘 뒤에 그린다.
      if (refill) fillSlot(i);
      else if (arrived) {
        if (deferring()) stale.add(i);
        else fillSlot(i);
      }
    }
    for (const grid of spare) grid.remove();
  }

  function place(): void {
    const w = width();
    if (w <= 0) return;
    placedWidth = w;
    el.scrollLeft = currentSlot * w;
  }
  // 폭 변화가 지금 칸의 위치를 반 화소보다 많이 옮기면 다시 맞춰야 한다. 가운데 칸은 폭의 1200배 자리에 있다.
  const widthMoved = (w: number): boolean => placedWidth === null || Math.abs(w - placedWidth) * (currentSlot + 1) > 0.5;

  // 스크롤이 멈추면 단추로 가던 칸을 잊는다. 두 번 빨리 누르면 두 칸을 가고, 멈춘 뒤에는 지금 칸에서 다시 센다.
  function restLater(): void {
    clearTimeout(restTimer);
    restTimer = setTimeout(rest, REST_MS);
  }
  // 스크롤이 멈췄다(scrollend나 REST_MS 동안 조용함). 다만 손을 뗀 순간에도 scrollend가 오고 그 뒤에 칸에 맞추는 움직임이
  // 이어질 수 있으므로, 칸에 맞지 않았으면 조금 더 기다린다(세 번까지). 그 사이 scroll이 오면 기다림은 처음부터 다시 센다.
  let settleWaits = 0;
  function rest(): void {
    clearTimeout(restTimer);
    pending = null;
    const w = width();
    const onSlot = w <= 0 || Math.abs(el.scrollLeft - Math.round(el.scrollLeft / w) * w) < 0.5;
    if (moving && !onSlot && settleWaits < 3) {
      settleWaits += 1;
      restTimer = setTimeout(rest, REST_MS);
      return;
    }
    settleWaits = 0;
    moving = false;
    flush();
  }

  // 도움: 손가락이 멈춘 뒤 떼면 Chromium은 제자리로 돌아간다. 그때 끌던 쪽으로 마저 넘긴다.
  let touchStartLeft: number | null = null;
  let watch: { endLeft: number; dir: 1 | -1; timer: ReturnType<typeof setTimeout> } | null = null;

  function stopWatch(): void {
    if (watch) clearTimeout(watch.timer);
    watch = null;
  }
  function finishTurn(): void {
    if (!watch) return;
    const { endLeft, dir } = watch;
    stopWatch();
    const w = width();
    if (w <= 0) return;
    const target = clamp(dir > 0 ? Math.ceil(endLeft / w - 0.001) : Math.floor(endLeft / w + 0.001));
    pending = target;
    restLater();
    el.scrollTo({ left: target * w, behavior: 'smooth' });
  }

  function onScroll(): void {
    moving = true;
    settleWaits = 0;
    restLater();
    if (placedWidth === null) return;
    const w = width();
    if (w <= 0) return;
    // 폭이 바뀌는 중이다. 옛 위치를 새 폭으로 나누면 먼 칸이 나오므로(폰을 돌리면 1000달을 건너뛴다) 지금 칸에 다시 맞춘다.
    if (widthMoved(w)) {
      place();
      return;
    }
    const i = clamp(nearestSlot(el.scrollLeft, w));
    // 단추나 도움이 스크롤하는 중이 아니면 먼 위치는 낡은 값이다(예: 폰을 돌린 직후). 따라가면 수백 달을 건너뛴다.
    if (Math.abs(i - currentSlot) > MAX_STEP && pending === null) {
      place();
      return;
    }
    if (i !== currentSlot) {
      currentAnchor = deps.step(currentAnchor, i - currentSlot);
      currentSlot = i;
      // 손가락으로 넘기는 중이면 쪽을 옮겨 붙이고 지금 쪽 표시를 바꾸는 일은 멈춘 뒤에 한다. 화면 밖의 쪽 하나(수백 개의 요소)를
      // 반대편 칸으로 옮기는 일이라 브라우저가 그만큼 배치를 다시 계산하고, 움직이는 도중이면 화면이 멈칫한다.
      // 새 지금 칸에 쪽이 이미 붙어 있을 때만 미룬다(한 칸씩 넘기면 늘 그렇다).
      if (deferring() && pages.has(i)) remount = true;
      else mount(false);
      deps.onCurrent(currentAnchor);
    }
    if (watch) {
      const forward = (el.scrollLeft - watch.endLeft) * watch.dir;
      if (forward >= 1) stopWatch(); // 브라우저가 이어서 넘긴다
      else if (forward <= -1) finishTurn(); // 제자리로 돌아가기 시작했다
    }
  }

  // 끄는 중에 손가락 밑의 칸이 다시 그려지면 그 손짓의 나머지 터치 이벤트는 떨어져 나간 칸에만 가고 .pager에는 오지 않는다.
  // 그래서 손가락이 처음 닿은 요소에도 touchend/touchcancel을 단다. 한 손짓은 한 번만 처리한다:
  // 먼저 받은 쪽이 touchStartLeft를 비우므로 거품으로 .pager에 다시 와도 아무것도 하지 않는다.
  let targetListening: AbortController | null = null;
  function stopTargetListening(): void {
    targetListening?.abort();
    targetListening = null;
  }
  function onTouchStart(e: TouchEvent): void {
    // 움직이기 전에 미뤄 둔 쪽을 그린다. 그래야 이번 손짓에 들어오는 쪽이 옛 내용으로 보이지 않는다.
    byFinger = true;
    flush();
    pending = null;
    if (!assist) return;
    stopWatch();
    stopTargetListening();
    touchStartLeft = e.touches.length === 1 ? el.scrollLeft : null;
    const target = e.target;
    if (touchStartLeft === null || !target || target === el) return;
    targetListening = new AbortController();
    const opts = { passive: true, signal: targetListening.signal };
    target.addEventListener('touchend', (ev) => onTouchEnd(ev as TouchEvent), opts);
    target.addEventListener('touchcancel', onTouchCancel, opts);
  }
  function onTouchEnd(e: TouchEvent): void {
    if (touchStartLeft === null || e.touches.length > 0) return;
    stopTargetListening();
    const endLeft = el.scrollLeft;
    const travel = endLeft - touchStartLeft;
    touchStartLeft = null;
    if (placedWidth === null || Math.abs(travel) < ASSIST_MIN_PX) return;
    watch = { endLeft, dir: travel > 0 ? 1 : -1, timer: setTimeout(finishTurn, ASSIST_WATCH_MS) };
  }
  function onTouchCancel(): void {
    stopTargetListening();
    touchStartLeft = null;
  }

  function jump(anchor: string): void {
    currentAnchor = anchor;
    pending = null;
    byFinger = false;
    remount = false;
    stale.clear(); // 아래의 mount(true)가 붙어 있는 쪽을 모두 다시 그린다
    stopWatch();
    // 끝에 가까우면 가운데 칸으로 돌아온다. 폭이 없으면 스크롤 위치가 따라올 수 없으니 칸을 옮기지 않는다.
    if (count > 1 && width() > 0 && Math.min(currentSlot, count - 1 - currentSlot) <= 2) currentSlot = CENTER;
    mount(true);
    place(); // 단추로 시작한 부드러운 스크롤이 아직 가고 있으면 이것으로 멈춘다
    deps.onCurrent(currentAnchor);
  }

  function go(delta: -1 | 1): void {
    byFinger = false;
    flush();
    const w = width();
    if (deps.neighbours === 0 || reducedMotion() || w <= 0 || placedWidth === null) {
      jump(deps.step(currentAnchor, delta));
      return;
    }
    stopWatch();
    const target = clamp((pending ?? currentSlot) + delta);
    pending = target;
    restLater();
    el.scrollTo({ left: target * w, behavior: 'smooth' });
  }

  const listening = new AbortController();
  const on = { passive: true, signal: listening.signal };
  el.addEventListener('scroll', onScroll, on);
  el.addEventListener('scrollend', rest, on); // 지원하지 않는 브라우저에서는 오지 않고 restLater가 맡는다
  el.addEventListener('touchstart', onTouchStart, on);
  if (assist) {
    el.addEventListener('touchend', onTouchEnd, on);
    el.addEventListener('touchcancel', onTouchCancel, on);
  }
  const stopResize = (env.observeResize ?? observeSize)(el, () => {
    if (widthMoved(width())) place();
  });

  mount(true);

  return {
    el,
    anchor: () => currentAnchor,
    anchors: () => mountedSlots().map(anchorAt),
    current: () => pages.get(currentSlot)!,
    place,
    go,
    jump,
    // 붙어 있는 쪽을 모두 다시 그린다. 손가락으로 넘기는 중이면 멈춘 뒤로 미룬다.
    refresh() {
      if (deferring()) {
        for (const i of mountedSlots()) stale.add(i);
        return;
      }
      for (const i of mountedSlots()) fillSlot(i);
    },
    busy: deferring,
    destroy() {
      listening.abort();
      stopTargetListening();
      stopResize();
      clearTimeout(restTimer);
      stopWatch();
    },
  };
}
