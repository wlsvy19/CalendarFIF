import type { CalfifDesktop, HoleRect } from '../../desktop/api';

/**
 * PC 앱: 바탕화면 아이콘이 있는 자리만 달력을 투명하게 뚫는다(2026-11-20 사용자: "파일같은것도 위에 냅둘 수 있께 해. 즉 ppt로",
 * "따지면 맨 뒤로 보내기 같은 거지"). 자리는 메인이 창 좌표로 보낸다(src/desktop/holes.ts).
 *
 * 그림: 달력(target)에 clip-path(evenodd)로 구멍을 낸다. 편집 화면, 설정 같은 다른 것은 뚫지 않는다.
 * 마우스: 커서가 구멍 위에 있으면 메인에 알려 창이 마우스를 바탕화면으로 보내게 한다(setIgnoreMouseEvents의 forward로 움직임은
 * 계속 들어온다). blocked()가 true인 동안(편집이나 설정이 떠 있음, 위치 조정 중)은 알리지 않는다.
 */
export function holesPath(holes: HoleRect[], box: { left: number; top: number; width: number; height: number }): string {
  const n = (v: number): string => String(Math.round(v * 10) / 10);
  const parts = [`M0 0H${n(box.width)}V${n(box.height)}H0Z`];
  for (const h of holes) {
    const x = h.x - box.left;
    const y = h.y - box.top;
    if (x + h.width <= 0 || y + h.height <= 0 || x >= box.width || y >= box.height) continue;
    parts.push(`M${n(x)} ${n(y)}h${n(h.width)}v${n(h.height)}h${n(-h.width)}Z`);
  }
  return parts.length === 1 ? '' : `path(evenodd, "${parts.join('')}")`;
}

export const insideHole = (holes: HoleRect[], x: number, y: number): boolean =>
  holes.some((h) => x >= h.x && x < h.x + h.width && y >= h.y && y < h.y + h.height);

export type IconHoles = { destroy(): void; resync(): void };

export function mountIconHoles(bridge: CalfifDesktop, target: () => HTMLElement | null, blocked: () => boolean): IconHoles {
  let holes: HoleRect[] = [];
  let told: boolean | null = null;
  let clipped: HTMLElement | null = null;

  const paint = (): void => {
    const el = target();
    if (clipped && clipped !== el) clipped.style.removeProperty('clip-path');
    clipped = el;
    if (!el) return;
    const path = holes.length === 0 ? '' : holesPath(holes, el.getBoundingClientRect());
    if (path === '') el.style.removeProperty('clip-path');
    else el.style.setProperty('clip-path', path);
  };
  const tell = (on: boolean): void => {
    if (on === told) return;
    told = on;
    bridge.setPassThrough(on);
  };
  const onMove = (e: MouseEvent): void => {
    tell(!blocked() && insideHole(holes, e.clientX, e.clientY));
  };
  const stop = bridge.onIconHoles((next) => {
    holes = next;
    told = null; // 메인이 마우스 받기를 되돌렸을 수 있다. 다음 움직임에 다시 알린다.
    paint();
  });
  window.addEventListener('mousemove', onMove, { passive: true });
  window.addEventListener('resize', paint);
  return {
    resync() {
      told = null;
      paint();
    },
    destroy() {
      stop();
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('resize', paint);
      clipped?.style.removeProperty('clip-path');
      if (told !== false) bridge.setPassThrough(false);
    },
  };
}
