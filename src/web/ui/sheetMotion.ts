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
  // inert를 모르는 iOS 15.5 이전을 위해 pointer-events도 끈다.
  for (const el of [scrim, sheet]) {
    el.setAttribute('inert', '');
    el.style.pointerEvents = 'none';
  }
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
  // 들어오는 중에 닫아도 시트가 있는 자리에서 내려가기 시작하게 한다. 끝 값만 주면 아직 도는 들어오기 애니메이션의
  // 값을 따라 올라가므로, 지금 값을 읽어 시작 값으로 쓰고 들어오기 애니메이션은 멈춘다.
  const from = { transform: getComputedStyle(sheet).transform, opacity: getComputedStyle(scrim).opacity };
  sheet.style.animation = 'none';
  scrim.style.animation = 'none';
  const slide = sheet.animate([{ transform: from.transform && from.transform !== 'none' ? from.transform : 'translateY(0)' }, { transform: 'translateY(100%)' }], {
    duration: EXIT_MS,
    easing: 'cubic-bezier(0.4, 0, 1, 1)',
    fill: 'forwards',
  });
  scrim.animate([{ opacity: from.opacity || '1' }, { opacity: 0 }], { duration: EXIT_MS, easing: 'ease-out', fill: 'forwards' });
  void slide.finished.then(finish, finish);
}
