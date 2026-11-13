export type Offset = { x: number; y: number };
export type Size = { width: number; height: number };

const MARGIN = 8;

function limit(value: number, bound: number): number {
  if (bound <= 0) return 0;
  return Math.max(-bound, Math.min(bound, value));
}

/** 가운데에서 offset만큼 옮긴 시트가 창 안(가장자리에서 margin)에 머물도록 offset을 자른다. */
export function clampOffset(offset: Offset, sheet: Size, viewport: Size, margin = MARGIN): Offset {
  return {
    x: limit(offset.x, (viewport.width - sheet.width) / 2 - margin),
    y: limit(offset.y, (viewport.height - sheet.height) / 2 - margin),
  };
}

export type DragMemory = { get(): Offset; set(o: Offset): void };

/** 앱이 켜져 있는 동안만 기억한다. */
export function sessionMemory(): DragMemory {
  let kept: Offset = { x: 0, y: 0 };
  return {
    get: () => kept,
    set: (o) => {
      kept = o;
    },
  };
}

export type DragEnv = {
  measure?(): { sheet: Size; viewport: Size };
  /** 시트 자신의 크기가 바뀔 때 부른다. 기본은 ResizeObserver가 있으면 그것이다. */
  observe?(el: HTMLElement, onChange: () => void): { disconnect(): void };
};

const NOT_A_HANDLE = 'button, input, select, textarea, a';

/** 시트를 제목 줄로 끌어 옮기게 한다. 옮긴 거리는 시트의 --drag-x, --drag-y에 px로 들어간다. */
export function makeDraggable(sheet: HTMLElement, handle: HTMLElement, memory: DragMemory, env?: DragEnv): { destroy(): void } {
  const measure =
    env?.measure ??
    (() => {
      const r = sheet.getBoundingClientRect();
      return { sheet: { width: r.width, height: r.height }, viewport: { width: window.innerWidth, height: window.innerHeight } };
    });
  const apply = (offset: Offset): Offset => {
    const m = measure();
    const next = clampOffset(offset, m.sheet, m.viewport);
    sheet.style.setProperty('--drag-x', `${next.x}px`);
    sheet.style.setProperty('--drag-y', `${next.y}px`);
    return next;
  };

  handle.classList.add('drag-handle');
  apply(memory.get());

  let drag: { pointerId: number; startX: number; startY: number; origin: Offset } | null = null;

  const onDown = (e: PointerEvent): void => {
    if (e.button !== 0 || drag) return;
    if ((e.target as Element | null)?.closest(NOT_A_HANDLE)) return;
    drag = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, origin: memory.get() };
    handle.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: PointerEvent): void => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    memory.set(apply({ x: drag.origin.x + e.clientX - drag.startX, y: drag.origin.y + e.clientY - drag.startY }));
  };
  const end = (e: PointerEvent): void => {
    if (drag && e.pointerId === drag.pointerId) drag = null;
  };
  // 아래쪽 자식이 먼저 잡았던 포인터를 넘겨줄 때도 같은 이벤트가 온다. 제목 줄 자신의 것만 끝으로 본다.
  const onLost = (e: PointerEvent): void => {
    if (e.target === handle) end(e);
  };
  const onResize = (): void => {
    memory.set(apply(memory.get()));
  };

  handle.addEventListener('pointerdown', onDown);
  handle.addEventListener('pointermove', onMove);
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
  handle.addEventListener('lostpointercapture', onLost);
  window.addEventListener('resize', onResize);
  const observe = env?.observe ?? (typeof ResizeObserver === 'undefined' ? null : (el, cb) => { const o = new ResizeObserver(cb); o.observe(el); return o; });
  const sizeWatch = observe?.(sheet, onResize);

  return {
    destroy() {
      handle.removeEventListener('pointerdown', onDown);
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      handle.removeEventListener('lostpointercapture', onLost);
      window.removeEventListener('resize', onResize);
      sizeWatch?.disconnect();
      drag = null;
    },
  };
}
