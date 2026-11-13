import type { CalfifDesktop, DragKind } from '../../desktop/api';

const KINDS: DragKind[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

/** 위치 및 크기 조정 덮개. 끈 거리(처음 포인터 자리 기준)를 메인에 보내고, 적용·취소를 알린다. */
export function mountAdjust(root: HTMLElement, bridge: CalfifDesktop): { destroy(): void } {
  const overlay = document.createElement('div');
  overlay.className = 'adjust';
  overlay.innerHTML = `
    <div class="adjust-bar">
      <span class="adjust-hint">끌어서 옮기고, 가장자리를 끌어 크기를 바꿉니다.</span>
      <button type="button" class="adjust-apply">적용</button>
      <button type="button" class="adjust-cancel">취소</button>
    </div>
    <div class="adjust-move"></div>
    ${KINDS.map((k) => `<div class="adjust-handle" data-kind="${k}"></div>`).join('')}`;
  let drag: { kind: DragKind; x: number; y: number } | null = null;

  overlay.addEventListener('pointerdown', (e) => {
    const target = e.target as Element;
    const kind = target.classList.contains('adjust-move') ? 'move' : target.classList.contains('adjust-handle') ? (target.getAttribute('data-kind') as DragKind) : null;
    if (!kind) return;
    drag = { kind, x: e.screenX, y: e.screenY };
    bridge.dragStart();
    try {
      target.setPointerCapture(e.pointerId);
    } catch {
      // 잡지 못해도 계속한다.
    }
  });
  overlay.addEventListener('pointermove', (e) => {
    if (drag) bridge.drag(drag.kind, e.screenX - drag.x, e.screenY - drag.y);
  });
  const end = (): void => {
    drag = null;
  };
  overlay.addEventListener('pointerup', end);
  overlay.addEventListener('pointercancel', end);
  overlay.querySelector('.adjust-apply')!.addEventListener('click', () => bridge.adjustDone(true));
  overlay.querySelector('.adjust-cancel')!.addEventListener('click', () => bridge.adjustDone(false));
  root.append(overlay);
  return { destroy: () => overlay.remove() };
}
