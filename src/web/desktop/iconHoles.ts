import type { CalfifDesktop, HoleRect } from '../../desktop/api';

/**
 * PC 앱: 바탕화면 아이콘이 있는 자리만 달력을 투명하게 뚫는다(2026-11-20 사용자: "파일같은것도 위에 냅둘 수 있께 해. 즉 ppt로",
 * "따지면 맨 뒤로 보내기 같은 거지"). 자리는 메인이 창 좌표로 보낸다(src/desktop/holes.ts).
 *
 * 그림: 달력(target)에 clip-path(evenodd)로 구멍을 낸다. 편집 화면, 설정 같은 다른 것은 뚫지 않는다.
 * 마우스: 단추가 아닌 달력 위와 구멍 위에서는 메인에 알려 창이 마우스를 바탕화면으로 보내게 한다(setIgnoreMouseEvents의 forward로
 * 움직임은 계속 들어온다). 그래서 달력 위에서 끌면 바탕화면의 선택 상자가 생긴다(2026-11-20 사용자: DesktopCal처럼).
 * 그 자리가 날짜 칸이면 armed도 알린다. 그때 메인의 마우스 훅이 두 번 누르기와 오른쪽 누르기를 알아채 deskClick으로 돌려준다
 * (src/desktop/deskClicks.ts). 단추(년도, 월, 넘기기, 설정, 카운트다운 칩)는 달력이 직접 받는다.
 * blocked()가 true인 동안(편집이나 설정, 칸 메뉴, 년월 고르기가 떠 있음, 위치 조정 중)은 달력이 마우스를 받는다.
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

/** 달력이 직접 받는 것. 날짜 칸(button.cell)은 바탕화면으로 보낸다. */
const INTERACTIVE = 'button:not(.cell), input, select, textarea, a[href], [contenteditable="true"], .datepick';
const CELL = '.grid.current .cell';

export function mountIconHoles(bridge: CalfifDesktop, target: () => HTMLElement | null, blocked: () => boolean): IconHoles {
  let holes: HoleRect[] = [];
  let told: string | null = null;
  let clipped: HTMLElement | null = null;
  let last: { x: number; y: number } | null = null;

  const paint = (): void => {
    const el = target();
    if (clipped && clipped !== el) clipped.style.removeProperty('clip-path');
    clipped = el;
    if (!el) return;
    const path = holes.length === 0 ? '' : holesPath(holes, el.getBoundingClientRect());
    if (path === '') el.style.removeProperty('clip-path');
    else el.style.setProperty('clip-path', path);
  };
  const tell = (on: boolean, armed: boolean): void => {
    const key = `${on}:${armed}`;
    if (key === told) return;
    told = key;
    bridge.setPassThrough(on, armed);
  };
  const decide = (x: number, y: number, el: Element | null): void => {
    if (blocked()) return tell(false, false);
    if (insideHole(holes, x, y)) return tell(true, false);
    const cal = target();
    if (!el || !cal || !cal.contains(el) || el.closest(INTERACTIVE)) return tell(false, false);
    tell(true, el.closest(CELL) !== null);
  };
  const onMove = (e: MouseEvent): void => {
    last = { x: e.clientX, y: e.clientY };
    const el = e.target instanceof Element ? e.target : document.elementFromPoint(e.clientX, e.clientY);
    decide(e.clientX, e.clientY, el);
  };
  const stop = bridge.onIconHoles((next) => {
    holes = next;
    told = null; // 메인이 마우스 받기를 되돌렸을 수 있다. 다음 움직임에 다시 알린다.
    paint();
  });
  window.addEventListener('mousemove', onMove, { passive: true });
  window.addEventListener('resize', paint);
  return {
    /** 막힘이 바뀌었다(칸 메뉴를 열었다 등): 마지막 마우스 자리로 다시 정한다. */
    resync() {
      told = null;
      paint();
      if (last) decide(last.x, last.y, document.elementFromPoint(last.x, last.y));
    },
    destroy() {
      stop();
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('resize', paint);
      clipped?.style.removeProperty('clip-path');
      if (told !== 'false:false') bridge.setPassThrough(false);
    },
  };
}
