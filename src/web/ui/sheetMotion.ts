export type DismissEnv = { animate?: boolean };

const EXIT_MS = 260;
const GIVE_UP_MS = 400;

function defaultAnimate(sheet: HTMLElement): boolean {
  return (
    typeof sheet.animate === 'function' &&
    window.matchMedia('(max-width: 879.98px)').matches &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches &&
    !document.documentElement.classList.contains('desk')
  );
}

/** 시트와 가림막을 치운다. 폰 화면에서는 아래로 미끄러져 나간 뒤에 없앤다. */
export function dismiss(scrim: HTMLElement, sheet: HTMLElement, env?: DismissEnv): void {
  const remove = (): void => {
    scrim.remove();
    sheet.remove();
  };
  if (!(env?.animate ?? defaultAnimate(sheet))) {
    remove();
    return;
  }
  // 나가는 동안 눌리거나 초점을 받지 않게 하고, 그 사이 새로 열린 시트와 id가 겹치지 않게 한다.
  scrim.setAttribute('inert', '');
  sheet.setAttribute('inert', '');
  for (const el of sheet.querySelectorAll('[id]')) el.removeAttribute('id');
  sheet.removeAttribute('aria-labelledby');
  let done = false;
  const finish = (): void => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    remove();
  };
  const timer = setTimeout(finish, GIVE_UP_MS);
  const slide = sheet.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(100%)' }], {
    duration: EXIT_MS,
    easing: 'cubic-bezier(0.4, 0, 1, 1)',
    fill: 'forwards',
  });
  scrim.animate([{ opacity: 1 }, { opacity: 0 }], { duration: EXIT_MS, easing: 'ease-out', fill: 'forwards' });
  void slide.finished.then(finish, finish);
}
