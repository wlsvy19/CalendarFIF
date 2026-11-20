import type { CalfifDesktop } from '../../desktop/api';

/**
 * PC 앱: 달력 위를 마우스로 끌면 창이 따라 옮겨진다(2026-11-20 사용자: "캘린더데스크는 캘린더 위에서 마우스 드래그 되거든? 이거는 안돼.
 * 캘린더데스크처럼 드래그 되게 해."). 그 전에는 메뉴의 "위치 및 크기"를 골라야만 옮길 수 있었다.
 *
 * 누르고 THRESHOLD_PX 넘게 움직여야 끌기가 시작된다. 그보다 적게 움직이면 그냥 누른 것이라 날짜 두 번 누르기(편집), 오른쪽 메뉴,
 * 단추는 전처럼 듣는다. 끈 뒤에 따라오는 click과 dblclick은 버린다. 자리는 놓을 때 메인이 저장한다(dragEnd).
 * 단추, 글 칸, 고르는 상자, 편집 화면 위에서는 시작하지 않고, canStart가 false인 동안(편집이나 설정이 떠 있음, 위치 조정 중)도 그렇다.
 */
export const THRESHOLD_PX = 4;
const NO_DRAG = 'input, textarea, select, a, [contenteditable], .app-nav, .title-btn, .pill, .datepick, .sheet, [role="dialog"], .adjust';

export function mountMoveDrag(target: HTMLElement, bridge: CalfifDesktop, canStart: () => boolean): { destroy(): void } {
  let press: { id: number; x: number; y: number; started: boolean } | null = null;
  let swallowUntil = 0;

  const onDown = (e: PointerEvent): void => {
    if (e.button !== 0 || !e.isPrimary || !canStart()) return;
    if ((e.target as Element | null)?.closest(NO_DRAG)) return;
    press = { id: e.pointerId, x: e.screenX, y: e.screenY, started: false };
  };
  const onMove = (e: PointerEvent): void => {
    if (!press || e.pointerId !== press.id) return;
    const dx = e.screenX - press.x;
    const dy = e.screenY - press.y;
    if (!press.started) {
      if (Math.hypot(dx, dy) < THRESHOLD_PX) return;
      press.started = true;
      bridge.dragStart();
      try {
        target.setPointerCapture(e.pointerId);
      } catch {
        // 잡지 못해도 계속한다(창이 움직이며 커서 밑에 있다).
      }
    }
    bridge.drag('move', dx, dy);
  };
  const onEnd = (e: PointerEvent): void => {
    if (!press || e.pointerId !== press.id) return;
    if (press.started) {
      bridge.dragEnd();
      swallowUntil = performance.now() + 400;
    }
    press = null;
  };
  // 끈 뒤에 오는 누르기는 날짜를 열거나 단추를 누른 것이 아니다.
  const swallow = (e: Event): void => {
    if (performance.now() > swallowUntil) return;
    e.stopPropagation();
    e.preventDefault();
  };

  target.addEventListener('pointerdown', onDown);
  target.addEventListener('pointermove', onMove);
  target.addEventListener('pointerup', onEnd);
  target.addEventListener('pointercancel', onEnd);
  target.addEventListener('lostpointercapture', onEnd);
  target.addEventListener('click', swallow, true);
  target.addEventListener('dblclick', swallow, true);
  return {
    destroy() {
      target.removeEventListener('pointerdown', onDown);
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onEnd);
      target.removeEventListener('pointercancel', onEnd);
      target.removeEventListener('lostpointercapture', onEnd);
      target.removeEventListener('click', swallow, true);
      target.removeEventListener('dblclick', swallow, true);
      if (press?.started) bridge.dragEnd();
      press = null;
    },
  };
}
