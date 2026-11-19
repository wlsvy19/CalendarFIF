/** animate: 움직일지(기본은 폰 화면). screenBottom: 화면 아래 끝(px, 시트의 top과 같은 기준). 기본은 창과 기기 화면 가운데 큰 것. */
export type DismissEnv = { animate?: boolean; screenBottom?: number };

const EXIT_MS = 260;
const GIVE_UP_MS = 400;
/** 이미 거의 다 내려간 시트도 이만큼(EXIT_MS의 비율)은 움직여 보인다. */
const MIN_EXIT_RATIO = 0.45;

function defaultAnimate(sheet: HTMLElement): boolean {
  return (
    typeof sheet.animate === 'function' &&
    window.matchMedia('(max-width: 879.98px)').matches &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches &&
    !document.documentElement.classList.contains('desk')
  );
}

/** 계산된 transform 값(matrix(...) 또는 matrix3d(...))의 세로 이동(px). 없거나 읽을 수 없으면 0. */
export function translateYOf(transform: string | null | undefined): number {
  const m = /^matrix(3d)?\(([^)]*)\)$/.exec((transform ?? '').trim());
  if (!m) return 0;
  const values = m[2].split(',').map((v) => Number.parseFloat(v));
  const y = m[1] ? values[13] : values[5];
  return Number.isFinite(y) ? y : 0;
}

// 손가락으로 끌어 내리다 놓은 시트의 아래쪽 속도. 이어서 오는 dismiss가 그 속도로 내려가기 시작하게 한다.
const releaseSpeeds = new WeakMap<HTMLElement, number>();

/** 끌어 내리던 시트를 놓을 때의 아래쪽 속도(px/ms)를 적어 둔다. 다음 dismiss가 한 번 쓴다. */
export function noteReleaseVelocity(sheet: HTMLElement, pxPerMs: number): void {
  releaseSpeeds.set(sheet, pxPerMs);
}

/**
 * 시트가 from(px)만큼 내려가 있을 때 나가는 시간과 곡선. 남은 거리에 비례해 짧아지되 EXIT_MS의 45%보다 짧지 않다.
 * 놓을 때의 속도(px/ms)가 있으면 그 속도로 내려가기 시작해서 빨라진다(멈칫하지 않는다). 없으면 처음처럼 천천히 시작한다.
 */
export function exitMotion(from: number, height: number, velocity = 0): { duration: number; easing: string } {
  if (!(height > 0)) return { duration: EXIT_MS, easing: 'cubic-bezier(0.4, 0, 1, 1)' };
  const floor = EXIT_MS * MIN_EXIT_RATIO;
  const left = Math.min(height, Math.max(0, height - from));
  let duration = Math.max(floor, (EXIT_MS * left) / height);
  if (velocity > 0 && left > 0) duration = Math.max(floor, Math.min(duration, left / velocity));
  // cubic-bezier(0.4, y1, 1, 1)의 처음 기울기는 y1 / 0.4이고, 시트의 처음 속도는 (평균 속도 x 기울기)다. 기울기 1이 곧은 선이다.
  const slope = velocity > 0 && left > 0 ? Math.min(1, velocity / (left / duration)) : 0;
  return { duration: Math.round(duration), easing: `cubic-bezier(0.4, ${Math.round(0.4 * slope * 1000) / 1000}, 1, 1)` };
}

/**
 * 시트가 화면 밖으로 다 나가려면 내려가야 할 거리(px). top: 움직이기 전(transform 없이) 시트의 위 끝.
 * 글자판이 떠 있으면 시트는 글자판 위에 앉아 화면 가운데에 있어서, 제 높이만큼 내려가도 화면 안에 남았다가(글자판이 내려가면 드러난다)
 * 갑자기 없어졌다. 2026-11-18 사용자: 글자판이 뜬 편집 화면을 끌어 내리면 "매끄럽지가 않아. 부드럽게 아래로 샥 들어가는 느낌이었으면".
 * 높이를 모르면(0) 0을 준다(제 높이, translateY(100%)로 내려간다).
 */
export function exitTravel(height: number, top: number, screenBottom: number): number {
  if (!(height > 0)) return 0;
  return Math.max(height, Number.isFinite(screenBottom) && Number.isFinite(top) ? screenBottom - top : 0);
}

function defaultScreenBottom(): number {
  const vv = window.visualViewport;
  const shift = vv?.offsetTop ?? 0;
  return Math.max(window.innerHeight || 0, document.documentElement.clientHeight || 0, vv ? shift + vv.height : 0, (window.screen?.height ?? 0) + shift);
}

/** 시트와 가림막을 치운다. 폰 화면에서는 아래로 미끄러져 나간 뒤에 없앤다. */
export function dismiss(scrim: HTMLElement, sheet: HTMLElement, env?: DismissEnv): void {
  const remove = (): void => {
    scrim.remove();
    sheet.remove();
  };
  const velocity = releaseSpeeds.get(sheet) ?? 0;
  releaseSpeeds.delete(sheet);
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
  // 시트 안의 글 칸이 초점을 갖고 있으면 지금 놓는다: 글자판이 시트와 같은 때에 내려가기 시작한다(inert에 맡기면 늦거나,
  // inert를 모르는 iOS에서는 시트가 없어질 때까지 글자판이 남는다).
  const active = document.activeElement;
  if (active instanceof HTMLElement && sheet.contains(active)) active.blur();
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
  // 들어오는 중이나 손가락으로 끌던 중에 닫아도 시트가 있는 자리에서 내려가기 시작하게 한다. 끝 값만 주면 아직 도는 들어오기
  // 애니메이션의 값을 따라 올라가므로, 지금 값을 읽어 시작 값으로 쓰고 들어오기 애니메이션은 멈춘다.
  const from = { transform: getComputedStyle(sheet).transform, opacity: getComputedStyle(scrim).opacity };
  sheet.style.animation = 'none';
  scrim.style.animation = 'none';
  const fromY = translateYOf(from.transform);
  const height = sheet.offsetHeight;
  const travel = exitTravel(height, sheet.getBoundingClientRect().top - fromY, env?.screenBottom ?? defaultScreenBottom());
  const motion = exitMotion(fromY, travel > 0 ? travel : height, velocity);
  const to = travel > height ? `translateY(${Math.ceil(travel)}px)` : 'translateY(100%)';
  const slide = sheet.animate([{ transform: from.transform && from.transform !== 'none' ? from.transform : 'translateY(0)' }, { transform: to }], {
    duration: motion.duration,
    easing: motion.easing,
    fill: 'forwards',
  });
  scrim.animate([{ opacity: from.opacity || '1' }, { opacity: 0 }], { duration: motion.duration, easing: 'ease-out', fill: 'forwards' });
  void slide.finished.then(finish, finish);
}
