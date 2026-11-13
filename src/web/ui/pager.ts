// 달 넘기기의 스크롤 상자. .pager가 옆으로 구르고 칸(.slot)마다 쪽(.grid) 하나가 들어간다.
// 손가락을 따라가고, 미끄러지고, 칸에 멈추는 것은 브라우저가 한다. 스크립트는 어느 칸에 어느 쪽을 붙일지만 정한다.
// 칸은 처음에 한 번 만들고 더하거나 빼거나 크기를 바꾸지 않는다. 그래서 스크롤하는 동안 멈출 자리가 바뀌지 않는다.

export const SLOTS = 2401;
export const CENTER = 1200;

const REST_MS = 150; // 마지막 scroll 뒤 이만큼 조용하면 멈춘 것으로 본다
const ASSIST_MIN_PX = 10; // 이보다 덜 움직인 끌기는 마저 넘기지 않는다
const ASSIST_WATCH_MS = 80; // 손을 뗀 뒤 브라우저가 이어서 넘기는지 지켜보는 시간

const clampSlot = (i: number): number => Math.min(SLOTS - 1, Math.max(0, i));

/** 스크롤 위치에서 가장 가까운 칸. 0 ~ SLOTS-1로 자른다. */
export function nearestSlot(scrollLeft: number, width: number): number {
  return clampSlot(Math.round(scrollLeft / width));
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

  const slots: HTMLElement[] = [];
  const strip = document.createDocumentFragment();
  for (let i = 0; i < SLOTS; i++) {
    const slot = document.createElement('div');
    slot.className = 'slot';
    slots.push(slot);
    strip.append(slot);
  }
  el.append(strip);

  let currentSlot = CENTER;
  let currentAnchor = deps.anchor;
  const pages = new Map<number, HTMLElement>(); // 칸 번호 -> 그 칸의 .grid
  let placedWidth: number | null = null;
  let pending: number | null = null; // 단추나 도움으로 스크롤해 가는 칸
  let restTimer: ReturnType<typeof setTimeout> | undefined;

  const anchorAt = (i: number): string => (i === currentSlot ? currentAnchor : deps.step(currentAnchor, i - currentSlot));
  const mountedSlots = (): number[] => [...pages.keys()].sort((a, b) => a - b);

  // 지금 칸과 (neighbours가 1이면) 양옆 칸에 쪽을 붙인다. 빠지는 쪽의 요소는 새 칸으로 옮겨 다시 쓴다.
  // refill이 거짓이면 이미 제 칸에 있는 쪽은 다시 그리지 않는다. fill은 쪽이 칸 안에 있을 때 부른다(칸 높이를 잰다).
  function mount(refill: boolean): void {
    const wanted: number[] = [];
    for (let i = currentSlot - deps.neighbours; i <= currentSlot + deps.neighbours; i++) {
      if (i >= 0 && i < SLOTS) wanted.push(i);
    }
    const spare: HTMLElement[] = [];
    for (const [i, grid] of [...pages]) {
      if (wanted.includes(i)) continue;
      pages.delete(i);
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
      if (arrived || refill) deps.fill(grid, anchorAt(i));
    }
    for (const grid of spare) grid.remove();
  }

  function place(): void {
    const w = width();
    if (w <= 0) return;
    placedWidth = w;
    el.scrollLeft = currentSlot * w;
  }

  // 스크롤이 멈추면 단추로 가던 칸을 잊는다. 두 번 빨리 누르면 두 칸을 가고, 멈춘 뒤에는 지금 칸에서 다시 센다.
  function restLater(): void {
    clearTimeout(restTimer);
    restTimer = setTimeout(() => {
      pending = null;
    }, REST_MS);
  }
  function rest(): void {
    clearTimeout(restTimer);
    pending = null;
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
    const target = clampSlot(dir > 0 ? Math.ceil(endLeft / w - 0.001) : Math.floor(endLeft / w + 0.001));
    pending = target;
    restLater();
    el.scrollTo({ left: target * w, behavior: 'smooth' });
  }

  function onScroll(): void {
    restLater();
    if (placedWidth === null) return;
    const w = width();
    if (w <= 0) return;
    // 폭이 바뀌는 중이다. 옛 위치를 새 폭으로 나누면 먼 칸이 나오므로(폰을 돌리면 1000달을 건너뛴다) 지금 칸에 다시 맞춘다.
    if (Math.abs(w - placedWidth) > 0.5) {
      place();
      return;
    }
    const i = nearestSlot(el.scrollLeft, w);
    if (i !== currentSlot) {
      currentAnchor = deps.step(currentAnchor, i - currentSlot);
      currentSlot = i;
      mount(false);
      deps.onCurrent(currentAnchor);
    }
    if (watch) {
      const forward = (el.scrollLeft - watch.endLeft) * watch.dir;
      if (forward >= 1) stopWatch(); // 브라우저가 이어서 넘긴다
      else if (forward <= -1) finishTurn(); // 제자리로 돌아가기 시작했다
    }
  }

  function onTouchStart(e: TouchEvent): void {
    pending = null;
    if (!assist) return;
    stopWatch();
    touchStartLeft = e.touches.length === 1 ? el.scrollLeft : null;
  }
  function onTouchEnd(e: TouchEvent): void {
    if (touchStartLeft === null || e.touches.length > 0) return;
    const endLeft = el.scrollLeft;
    const travel = endLeft - touchStartLeft;
    touchStartLeft = null;
    if (placedWidth === null || Math.abs(travel) < ASSIST_MIN_PX) return;
    watch = { endLeft, dir: travel > 0 ? 1 : -1, timer: setTimeout(finishTurn, ASSIST_WATCH_MS) };
  }
  function onTouchCancel(): void {
    touchStartLeft = null;
  }

  function jump(anchor: string): void {
    currentAnchor = anchor;
    pending = null;
    stopWatch();
    if (Math.min(currentSlot, SLOTS - 1 - currentSlot) <= 2) currentSlot = CENTER;
    mount(true);
    place(); // 단추로 시작한 부드러운 스크롤이 아직 가고 있으면 이것으로 멈춘다
    deps.onCurrent(currentAnchor);
  }

  function go(delta: -1 | 1): void {
    const w = width();
    if (deps.neighbours === 0 || reducedMotion() || w <= 0 || placedWidth === null) {
      jump(deps.step(currentAnchor, delta));
      return;
    }
    stopWatch();
    const target = clampSlot((pending ?? currentSlot) + delta);
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
    if (placedWidth === null || Math.abs(width() - placedWidth) > 0.5) place();
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
    refresh() {
      for (const i of mountedSlots()) deps.fill(pages.get(i)!, anchorAt(i));
    },
    destroy() {
      listening.abort();
      stopResize();
      clearTimeout(restTimer);
      stopWatch();
    },
  };
}
