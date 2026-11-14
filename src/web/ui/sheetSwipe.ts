import { noteReleaseVelocity, translateYOf } from './sheetMotion';

// 폰 화면의 시트를 손가락으로 끌어 내려 닫는다. 끄는 동안 시트는 손가락을 그대로 따라가고, 놓으면 닫히거나 제자리로 돌아간다.
// 넓은 화면(가운데 상자)과 PC 앱(:root.desk)에서는 아무것도 하지 않는다. 터치만 듣는다(마우스는 듣지 않는다).

const NARROW = '(max-width: 879.98px)';
const REDUCED = '(prefers-reduced-motion: reduce)';
/**
 * 손가락이 이만큼 움직여야 첫 움직임으로 보고 누가 가질지 정한다. 정하기 전에는 touchmove도 touchend도 막지 않는다.
 * 빈 곳과 글자 위에서는 3px: iOS가 스스로 스크롤을 시작하기(10pt쯤) 전에 정한다. 닿을 때의 1~2px 떨림으로는 정하지 않는다.
 * 누르면 동작하는 것(단추, 색, 스위치, 글 칸) 위에서는 8px: iOS Safari는 막은(preventDefault) touchmove가 하나라도 있으면
 * 그 손가락에 click을 주지 않으므로, 엄지가 7px까지 굴러도 누르기가 그대로 눌리게 한다.
 */
const DECIDE_PX = 3;
const DECIDE_ON_CONTROL_PX = 8;
const CONTROL = 'button, input, textarea, select, label, summary, a[href], [role="radio"], [role="switch"], [role="button"], [contenteditable]';
/**
 * 이만큼 내려간 뒤부터 시트가 따라온다. 그 뒤로는 튀지 않고 손가락과 같은 만큼 움직인다.
 * 첫 움직임이 이미 이보다 멀리서 오면(Chromium은 처음 몇 px의 touchmove를 보내지 않는다) 거기서부터 따라온다.
 */
const DEAD_PX = 6;
/** 이보다 많이 끌었으면 손을 뗄 때 브라우저가 만드는 click을 막는다. */
const TAP_PX = 10;
/** 글 칸에서 이보다 늦게 움직이기 시작하면 길게 누르기(커서 옮기기, 고르기)로 보고 브라우저에 맡긴다. */
const LONG_PRESS_MS = 350;
const CLOSE_PX = 160;
const CLOSE_RATIO = 0.3;
/** 아래로 튕기듯 놓았다고 볼 속도(px/ms)와 그때 필요한 거리. */
const FLICK_SPEED = 0.5;
const FLICK_PX = 24;
const VELOCITY_WINDOW_MS = 100;
const SPRING_MS = 220;
const SPRING_EASE = 'cubic-bezier(0.32, 0.72, 0, 1)'; // 들어오는 움직임(sheet-in)과 같은 곡선
/** 시트가 제 높이만큼 내려갔을 때 가림막에 남는 진하기. */
const SCRIM_MIN = 0.15;
const CLICK_GUARD_MS = 400;

const TEXT_TYPES = new Set(['text', 'search', 'email', 'password', 'tel', 'url', 'number']);

function isTextField(el: Element): boolean {
  return el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && TEXT_TYPES.has((el as HTMLInputElement).type));
}
function isRange(el: Element): boolean {
  return el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'range';
}

/** 손가락 밑의 요소에서 시트까지(둘 다 넣어서) 위로 스크롤할 것이 남은 요소가 있는가. */
export function canScrollUp(target: Element, sheet: Element): boolean {
  for (let el: Element | null = target; el; el = el.parentElement) {
    if (el.scrollTop > 0) return true;
    if (el === sheet) break;
  }
  return false;
}

/** 손가락 밑의 요소에서 시트까지(둘 다 넣어서) test를 만족하는 요소가 있는가. */
function within(target: Element, sheet: Element, test: (el: Element) => boolean): boolean {
  for (let el: Element | null = target; el; el = el.parentElement) {
    if (test(el)) return true;
    if (el === sheet) break;
  }
  return false;
}

/** 손가락이 닿은 곳에 따라 누가 가질지 정하는 거리(px). 누르면 동작하는 것 위면 8px, 아니면 3px. */
export function decideDistance(target: Element, sheet: Element): number {
  return within(target, sheet, (el) => el.matches(CONTROL)) ? DECIDE_ON_CONTROL_PX : DECIDE_PX;
}

/** 시트의 제목 줄(.sheet-bar) 안에서 닿았는가. 제목 줄은 시트가 스크롤되어 있어도 끌어 닫는 손잡이다. */
export function onTitleBar(target: Element, sheet: Element): boolean {
  return within(target, sheet, (el) => el.classList.contains('sheet-bar'));
}

export type FirstMove = {
  dx: number;
  dy: number;
  /** 손가락이 닿은 뒤 첫 움직임까지의 시간. */
  elapsedMs: number;
  cancelable: boolean;
  fingers: number;
  target: Element;
  sheet: Element;
};

/**
 * 첫 움직임에서 이 손짓을 시트가 가질지 정한다. 아니면 그 손짓은 끝까지 브라우저(스크롤, 글 고르기)의 것이다.
 * 제목 줄에서 시작한 손짓은 시트가 스크롤되어 있어도 가진다(제목 줄 자신은 스크롤하지 않는다).
 */
export function mayClaim(m: FirstMove): boolean {
  if (!m.cancelable || m.fingers !== 1) return false;
  if (!(m.dy > 0 && m.dy > Math.abs(m.dx))) return false; // 아래쪽이고 세로가 더 커야 한다
  if (isRange(m.target)) return false;
  if (isTextField(m.target) && m.elapsedMs > LONG_PRESS_MS) return false;
  return onTitleBar(m.target, m.sheet) || !canScrollUp(m.target, m.sheet);
}

export type Sample = { t: number; y: number };

/** 손을 뗄 때(now)의 아래쪽 속도(px/ms). 마지막 100ms 동안 움직인 거리로 본다. 멈췄다가 떼면 0에 가깝다. */
export function releaseVelocity(samples: Sample[], now: number, windowMs = VELOCITY_WINDOW_MS): number {
  if (samples.length < 2) return 0;
  const last = samples[samples.length - 1];
  if (now - last.t > windowMs) return 0;
  let i = samples.length - 1;
  while (i > 0 && samples[i - 1].t >= now - windowMs) i--;
  if (i === samples.length - 1) i--; // 창 안에 마지막 것 하나뿐이면 그 앞의 것과 잰다
  const first = samples[i];
  return (last.y - first.y) / Math.max(1, now - first.t);
}

/** 놓은 시트를 닫을지: 시트 높이의 30%(많아야 160px)보다 내려왔거나, 24px보다 내려온 채 빠르게 아래로 놓았다. */
export function shouldClose(dy: number, velocity: number, height: number): boolean {
  const far = height > 0 ? Math.min(CLOSE_PX, CLOSE_RATIO * height) : CLOSE_PX;
  return dy > far || (velocity > FLICK_SPEED && dy > FLICK_PX);
}

/** 시트가 dy만큼 내려갔을 때 가림막 진하기의 비율. 제 높이만큼 내려가면 SCRIM_MIN이다. */
function scrimFactor(dy: number, height: number): number {
  const part = height > 0 ? Math.min(1, Math.max(0, dy / height)) : 0;
  return 1 - (1 - SCRIM_MIN) * part;
}

export type SwipeEnv = {
  /** 폰 배치인가. 손가락이 닿을 때마다 본다. 기본은 좁은 화면이고 <html>에 desk가 없을 때다. */
  phone?(): boolean;
  reducedMotion?(): boolean;
  /** 터치 이벤트가 일어난 시각(ms). 기본은 eventTime이다. */
  now?(e: Event): number;
};

/**
 * 터치 이벤트가 일어난 시각(ms, performance.now()와 같은 기준). 이벤트를 처리한 시각이 아니라 기기가 손가락을 읽은 시각이라,
 * 화면 그리기가 밀려 이벤트가 늦게 처리되어도 놓을 때의 속도가 바르게 나온다. timeStamp가 다른 기준이면 지금 시각을 쓴다.
 */
export function eventTime(e: Event, now = performance.now()): number {
  const t = e.timeStamp;
  return Number.isFinite(t) && t > 0 && Math.abs(now - t) < 10000 ? t : now;
}

type Track = {
  id: number;
  x0: number;
  y0: number;
  t0: number;
  target: Element;
  /** 손가락이 이만큼 움직이면 누가 가질지 정한다(decideDistance). */
  decideAt: number;
  /** watch: 아직 정하지 않았다. claimed: 시트가 가졌다. ignored: 브라우저에 돌려줬다. */
  state: 'watch' | 'claimed' | 'ignored';
  base: number;
  height: number;
  scrimScale: number;
  /** 손가락이 여기(닿은 곳에서 아래로 px)를 넘으면 시트가 따라오기 시작한다. */
  startDy: number;
  following: boolean;
  offset: number;
  travel: number;
  samples: Sample[];
};

function findTouch(list: TouchList, id: number): Touch | null {
  for (let i = 0; i < list.length; i++) if (list[i].identifier === id) return list[i];
  return null;
}

/**
 * 폰 화면에서 시트를 아래로 끌어 닫게 한다. 닫을 때 opts.onClose를 한 번 부르고, 시트를 치우는 것(dismiss)은 부른 쪽이 한다.
 * destroy는 dismiss보다 먼저 부른다. 끌던 자리나 돌아가던 자리를 그대로 두므로 dismiss가 거기서 내려간다.
 */
export function attachSwipeToClose(sheet: HTMLElement, scrim: HTMLElement, opts: { onClose(): void }, env?: SwipeEnv): { destroy(): void } {
  const phone =
    env?.phone ??
    (() => typeof window.matchMedia === 'function' && window.matchMedia(NARROW).matches && !document.documentElement.classList.contains('desk'));
  const reduced = env?.reducedMotion ?? (() => typeof window.matchMedia === 'function' && window.matchMedia(REDUCED).matches);
  const timeOf = env?.now ?? ((e: Event) => eventTime(e));

  let track: Track | null = null;
  let springs: Animation[] = [];
  let closed = false;
  let destroyed = false;
  let guardOff: (() => void) | null = null;

  const place = (t: Track, offset: number): void => {
    t.offset = offset;
    sheet.style.transform = `translate3d(0, ${offset}px, 0)`;
    scrim.style.opacity = String(Math.round(t.scrimScale * scrimFactor(offset, t.height) * 1000) / 1000);
  };

  // 돌고 있는 움직임(들어오기, 되돌아가기)을 지금 자리에서 멈추고 그 자리를 inline 값으로 둔다. dismiss와 같은 방법이다.
  const freeze = (): { y: number; opacity: number } => {
    const y = Math.max(0, translateYOf(getComputedStyle(sheet).transform));
    const read = Number.parseFloat(getComputedStyle(scrim).opacity);
    const opacity = Number.isFinite(read) ? read : 1;
    for (const a of springs) a.cancel();
    springs = [];
    sheet.style.animation = 'none';
    scrim.style.animation = 'none';
    sheet.style.transform = `translate3d(0, ${y}px, 0)`;
    scrim.style.opacity = String(opacity);
    return { y, opacity };
  };

  const grab = (t: Track): void => {
    const { y, opacity } = freeze();
    t.state = 'claimed';
    t.base = y;
    t.height = sheet.offsetHeight || window.innerHeight;
    t.scrimScale = Math.min(1, opacity / scrimFactor(y, t.height));
    place(t, y);
  };

  // 제자리(0)로 돌아간다. inline 값은 바로 지우고 그 차이만 움직임으로 보인다. 그래서 돌아가는 중에 dismiss가 와도
  // 지금 자리에서 내려가고, 다 돌아간 뒤의 dismiss는 0에서 내려간다.
  const settle = (t: Track): void => {
    const from = t.offset;
    const fromOpacity = Number.parseFloat(scrim.style.opacity);
    sheet.style.removeProperty('transform');
    scrim.style.removeProperty('opacity');
    const moved = from > 0 || (Number.isFinite(fromOpacity) && fromOpacity < 1);
    if (!moved || reduced() || typeof sheet.animate !== 'function' || typeof scrim.animate !== 'function') return;
    const timing = { duration: SPRING_MS, easing: SPRING_EASE };
    const mine = [
      sheet.animate([{ transform: `translate3d(0, ${from}px, 0)` }, { transform: 'translate3d(0, 0, 0)' }], timing),
      scrim.animate([{ opacity: Number.isFinite(fromOpacity) ? fromOpacity : 1 }, { opacity: 1 }], timing),
    ];
    springs = mine;
    // 다시 잡으면 cancel하므로 finished가 거부될 수 있다(둘 다 받아 둔다).
    void mine[1].finished.catch(() => {});
    void mine[0].finished.then(
      () => {
        if (springs === mine) springs = [];
      },
      () => {},
    );
  };

  // 끌고 난 손가락을 떼면 브라우저가 click을 만들 수 있다. 시트가 이미 내려가는 중이면 그 click이 밑의 날짜 칸에 갈 수 있다.
  // 그래서 잠깐 동안 손가락이나 마우스가 만든 다음 click 하나를 먹는다(키보드와 코드가 만든 click은 detail이 0이라 그대로 둔다).
  // 새 손가락이 닿거나 시간이 지나면 그만둔다. 시트가 치워져도 남는다.
  const armClickGuard = (): void => {
    guardOff?.();
    const swallow = (ev: MouseEvent): void => {
      if (ev.detail === 0) return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      off();
    };
    const off = (): void => {
      clearTimeout(timer);
      window.removeEventListener('click', swallow, true);
      window.removeEventListener('touchstart', off, true);
      if (guardOff === off) guardOff = null;
    };
    const timer = setTimeout(off, CLICK_GUARD_MS);
    window.addEventListener('click', swallow, true);
    window.addEventListener('touchstart', off, { capture: true, passive: true });
    guardOff = off;
  };

  const onStart = (e: TouchEvent): void => {
    if (closed) return;
    if (track) {
      if (findTouch(e.touches, track.id) && !findTouch(e.changedTouches, track.id)) {
        // 손가락이 하나 더 닿았다. 아직 정하기 전이면 이 손짓은 브라우저의 것이다. 끄는 중이면 첫 손가락만 따라간다.
        if (track.state === 'watch') track.state = 'ignored';
        return;
      }
      // 끝을 듣지 못한 손가락(그 밑의 요소가 다시 그려졌다). 새로 닿은 손가락이 같은 번호를 다시 쓸 수도 있다(Chromium).
      // 끌던 것이면 제자리로 돌려 놓고 새로 시작한다.
      if (track.state === 'claimed') settle(track);
      track = null;
    }
    if (e.touches.length !== 1 || !phone()) return;
    const p = e.changedTouches[0];
    if (!p) return;
    const target = e.target as Element;
    track = {
      id: p.identifier,
      x0: p.clientX,
      y0: p.clientY,
      t0: timeOf(e),
      target,
      decideAt: decideDistance(target, sheet),
      state: 'watch',
      base: 0,
      height: 0,
      scrimScale: 1,
      startDy: DEAD_PX,
      following: false,
      offset: 0,
      travel: 0,
      samples: [],
    };
  };

  const onMove = (e: TouchEvent): void => {
    const t = track;
    if (!t || t.state === 'ignored') return;
    const p = findTouch(e.changedTouches, t.id);
    if (!p) return;
    const dx = p.clientX - t.x0;
    const dy = p.clientY - t.y0;
    if (t.state === 'watch') {
      if (Math.hypot(dx, dy) < t.decideAt) return; // 아직 누르기일 수 있다. 막지 않는다.
      // iOS Safari는 스크롤이나 끝에서 늘어나기가 시작된 뒤에는 touchmove를 막을 수 없다. 그래서 첫 움직임에서 정하고 바꾸지 않는다.
      const first: FirstMove = { dx, dy, elapsedMs: timeOf(e) - t.t0, cancelable: e.cancelable, fingers: e.touches.length, target: t.target, sheet };
      if (!mayClaim(first)) {
        t.state = 'ignored';
        return;
      }
      grab(t);
      t.startDy = Math.max(DEAD_PX, dy);
    }
    if (e.cancelable) e.preventDefault();
    t.travel = Math.max(t.travel, Math.hypot(dx, dy));
    if (!t.following && dy > t.startDy) t.following = true;
    const at = timeOf(e);
    t.samples.push({ t: at, y: p.clientY });
    while (t.samples.length > 2 && at - t.samples[0].t > VELOCITY_WINDOW_MS * 2) t.samples.shift();
    // 위로는 늘이지 않는다(0보다 올라가지 않는다).
    place(t, t.following ? Math.max(0, t.base + dy - t.startDy) : t.base);
  };

  const onEnd = (e: TouchEvent): void => {
    const t = track;
    if (!t || !findTouch(e.changedTouches, t.id)) return;
    track = null;
    if (t.state !== 'claimed') return;
    if (t.travel > TAP_PX) {
      if (e.cancelable) e.preventDefault();
      armClickGuard();
    }
    const velocity = releaseVelocity(t.samples, timeOf(e));
    if (!closed && shouldClose(t.offset, velocity, t.height)) {
      closed = true;
      noteReleaseVelocity(sheet, Math.max(0, velocity));
      opts.onClose();
      // 부른 쪽이 시트를 치우지 않았으면(치우는 중이면 inert다) 제자리로 돌려 놓는다.
      if (!destroyed && sheet.isConnected && !sheet.hasAttribute('inert')) settle(t);
      return;
    }
    settle(t);
  };

  const onCancel = (e: TouchEvent): void => {
    const t = track;
    if (!t || !findTouch(e.changedTouches, t.id)) return;
    track = null;
    if (t.state === 'claimed') settle(t);
  };

  sheet.addEventListener('touchstart', onStart, { passive: true });
  // 첫 움직임을 막아야(preventDefault) 브라우저가 스크롤을 시작하지 않으므로 passive가 아니어야 한다.
  sheet.addEventListener('touchmove', onMove, { passive: false });
  sheet.addEventListener('touchend', onEnd, { passive: false });
  sheet.addEventListener('touchcancel', onCancel, { passive: true });

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      sheet.removeEventListener('touchstart', onStart);
      sheet.removeEventListener('touchmove', onMove);
      sheet.removeEventListener('touchend', onEnd);
      sheet.removeEventListener('touchcancel', onCancel);
      if (springs.length > 0) freeze(); // 돌아가는 중이면 그 자리에 둔다. 이어서 부르는 dismiss가 거기서 내려간다.
      track = null;
    },
  };
}
