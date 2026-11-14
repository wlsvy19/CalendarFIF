/**
 * 시험용: 폰 화면(좁은 화면)인 것처럼 하고 el에서 손가락 하나로 dy만큼 아래로 끈 뒤 뗀다.
 * 끝나면 matchMedia를 되돌리고 끈 뒤의 click 막기를 치운다.
 */
export function swipeDown(el: Element, dy = 300): void {
  const original = window.matchMedia;
  window.matchMedia = ((q: string) => ({ matches: q === '(max-width: 879.98px)' })) as typeof window.matchMedia;
  try {
    const fire = (type: string, y: number, down: boolean): void => {
      const t = new Touch({ identifier: 1, target: el, clientX: 100, clientY: y });
      el.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: down ? [t] : [], changedTouches: [t] }));
    };
    fire('touchstart', 100, true);
    for (let i = 1; i <= 10; i++) fire('touchmove', 100 + (dy * i) / 10, true);
    fire('touchend', 100 + dy, false);
  } finally {
    window.matchMedia = original;
    window.dispatchEvent(new TouchEvent('touchstart'));
  }
}
