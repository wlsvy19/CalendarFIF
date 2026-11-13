import { buildMonthGrid, shiftMonth, splitDateKey } from '../../core/dates';
import { parseLine, splitLines } from '../../core/text';
import type { SyncStatus } from '../../sync/engine';
import type { CalendarStore } from '../state';
import { statusText } from './status';
import { dragOffset, lockAxis, SWIPE, swipeOutcome, velocity, type Sample } from './swipe';

const WIDE_PX = 880;
const NUMBER_AREA_PX = 30; // 날짜 숫자와 칸 안쪽 여백이 차지하는 높이
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

const chevron = (path: string): string =>
  `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"></path></svg>`;
const GEAR =
  '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"></path></svg>';

export function visibleLines(lines: string[], maxLines: number): { shown: string[]; more: number } {
  if (lines.length <= maxLines) return { shown: lines, more: 0 };
  const shown = lines.slice(0, Math.max(0, maxLines - 1));
  return { shown, more: lines.length - shown.length };
}

export type CalendarEnv = { frame?(cb: () => void): void; reducedMotion?(): boolean; now?(): number };

export function mountCalendar(
  root: HTMLElement,
  deps: {
    store: CalendarStore;
    status: { status(): SyncStatus; subscribe(listener: (s: SyncStatus) => void): () => void };
    today(): string;
    onOpenDay(dateKey: string): void;
    onOpenSettings(): void;
  },
  env: CalendarEnv = {},
): { destroy(): void } {
  const { store } = deps;
  const el = document.createElement('section');
  el.className = 'app calendar';
  el.setAttribute('aria-label', '달력');
  el.innerHTML = `
    <div class="app-head">
      <div class="app-meta">
        <span class="year"></span>
        <span class="sync" data-state="ok"><i></i><span class="sync-text"></span></span>
      </div>
      <h2 class="month"></h2>
      <div class="app-nav">
        <button type="button" class="pill">오늘</button>
        <button type="button" class="iconbtn" aria-label="이전 달">${chevron('M15 5l-7 7 7 7')}</button>
        <button type="button" class="iconbtn" aria-label="다음 달">${chevron('M9 5l7 7-7 7')}</button>
        <button type="button" class="iconbtn" aria-label="설정">${GEAR}</button>
      </div>
    </div>
    <div class="dow" aria-hidden="true">${WEEKDAYS.map((d) => `<span>${d}</span>`).join('')}</div>
    <div class="pager"><div class="track"><div class="grid"></div></div></div>`;
  const q = (selector: string): HTMLElement => el.querySelector<HTMLElement>(selector)!;
  const yearEl = q('.year');
  const monthEl = q('.month');
  const syncEl = q('.sync');
  const syncText = q('.sync-text');
  const pager = q('.pager');
  const track = q('.track');
  const grid = q('.grid');
  const [todayBtn, prevBtn, nextBtn, settingsBtn] = [...el.querySelectorAll<HTMLButtonElement>('.app-nav button')];

  function renderStatus(status: SyncStatus = deps.status.status()): void {
    const readProblem = store.readProblem();
    const online = navigator.onLine;
    const trouble = readProblem !== null || (status.state === 'synced' && !online);
    syncEl.dataset.state = (trouble || status.state === 'waiting') ? 'wait' : status.state === 'sending' ? 'busy' : 'ok';
    syncText.textContent = statusText(status, readProblem, online);
  }

  let renderedToday = '';

  // 격자 요소 하나에 한 달의 칸을 채운다. maxLinesHint가 있으면 칸 높이를 재지 않고 그 줄 수를 쓴다(끄는 중에 옆 달을 그릴 때).
  // 쓴 줄 수를 돌려준다.
  function fillGrid(target: HTMLElement, monthId: string, today: string, maxLinesHint?: number): number {
    const cells = buildMonthGrid(monthId);
    target.style.setProperty('--rows', String(cells.length / 7));

    const daysByMonth = new Map<string, ReturnType<CalendarStore['days']>>();
    const built = cells.map((c) => {
      let days = daysByMonth.get(c.monthId);
      if (!days) {
        days = store.days(c.monthId);
        daysByMonth.set(c.monthId, days);
      }
      const value = days[c.day];
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'cell';
      button.dataset.key = c.dateKey;
      if (c.dow === 0) button.classList.add('sun');
      if (c.dow === 6) button.classList.add('sat');
      if (!c.inMonth) button.classList.add('other');
      if (c.dateKey === today) button.classList.add('today');
      if (value?.color) {
        button.dataset.color = value.color;
        button.style.setProperty('--day-color', `#${value.color}`);
      }
      const num = document.createElement('span');
      num.className = 'num';
      num.textContent = String(c.dayOfMonth);
      button.append(num);
      const lines = splitLines(value?.text ?? '').filter((l) => l.trim() !== '');
      return { button, lines };
    });
    target.replaceChildren(...built.map((b) => b.button));

    // 칸 높이를 재서 들어가는 줄 수를 정한다. 높이가 0이면(배치가 없으면) 제한하지 않는다.
    let maxLines = maxLinesHint;
    if (maxLines === undefined) {
      const cellHeight = built[0]?.button.clientHeight ?? 0;
      const lineHeight = window.innerWidth >= WIDE_PX ? 17 : 13;
      maxLines = cellHeight > 0 ? Math.max(1, Math.floor((cellHeight - NUMBER_AREA_PX) / lineHeight)) : Infinity;
    }
    for (const { button, lines } of built) {
      if (lines.length === 0) continue;
      const { shown, more } = visibleLines(lines, maxLines);
      const memo = document.createElement('span');
      memo.className = 'memo';
      for (const raw of shown) {
        const { done, text } = parseLine(raw);
        const ln = document.createElement('span');
        ln.className = done ? 'ln done' : 'ln';
        ln.textContent = text;
        memo.append(ln);
      }
      if (more > 0) {
        const tail = document.createElement('span');
        tail.className = 'ln more';
        tail.textContent = `+${more}`;
        memo.append(tail);
      }
      button.append(memo);
    }
    // 잘린 줄 표시는 배치를 읽어야 해서 본 격자에서만 한다.
    if (maxLinesHint === undefined) {
      for (const ln of target.querySelectorAll<HTMLElement>('.ln:not(.more)')) {
        if (ln.scrollWidth > ln.clientWidth) ln.classList.add('cut');
      }
    }
    return maxLines;
  }

  let lastMaxLines: number | undefined;

  function render(): void {
    const monthId = store.current();
    const [year, month] = monthId.split('-');
    yearEl.textContent = `${year}년`;
    monthEl.textContent = `${Number(month)}월`;
    const today = deps.today();
    renderedToday = today;
    lastMaxLines = fillGrid(grid, monthId, today);
  }

  function go(monthId: string): void {
    store.show(monthId);
    render();
  }

  pager.addEventListener('click', (event) => {
    if (swiped) return;
    // 누르는 사이에 칸이 다시 그려지면 target이 격자가 된다. 누른 자리의 칸을 찾아 쓴다.
    let cell = (event.target as Element).closest<HTMLElement>('.cell');
    if (!cell) cell = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('.cell') ?? null;
    if (cell?.dataset.key) deps.onOpenDay(cell.dataset.key);
  });
  // 미끄러지는 중에 버튼을 누르면 그 미끄러짐을 먼저 끝내고 그 달에서 이어 간다.
  prevBtn.addEventListener('click', () => { settle?.finish(); go(shiftMonth(store.current(), -1)); });
  nextBtn.addEventListener('click', () => { settle?.finish(); go(shiftMonth(store.current(), 1)); });
  todayBtn.addEventListener('click', () => { settle?.finish(); go(splitDateKey(deps.today())!.monthId); });
  settingsBtn.addEventListener('click', () => deps.onOpenSettings());

  const frame = env.frame ?? ((cb: () => void) => void requestAnimationFrame(cb));
  const reducedMotion = env.reducedMotion ?? (() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const now = env.now ?? (() => performance.now());

  type Drag = { id: number; x0: number; y0: number; width: number; axis: 'x' | 'y' | null; samples: Sample[]; x: number; queued: boolean };
  let drag: Drag | null = null;
  let swiped = false;
  let destroyed = false;
  const MAX_SAMPLES = 16;
  let swipedTimer: ReturnType<typeof setTimeout> | undefined;
  let settle: { finish(): void; timer: ReturnType<typeof setTimeout> } | null = null;

  const setTransform = (x: number): void => {
    track.style.transform = `translate3d(${x}px, 0px, 0px)`;
  };

  // 끌기가 x로 정해진 뒤 300ms 동안은 click이 날짜 칸을 열지 않게 한다.
  function holdClicks(): void {
    clearTimeout(swipedTimer);
    swipedTimer = setTimeout(() => {
      swiped = false;
    }, 300);
  }

  function ensurePeek(side: 'next' | 'prev'): void {
    const current = track.querySelector<HTMLElement>('.grid.peek');
    if (current?.dataset.side === side) return;
    const peek = current ?? document.createElement('div');
    peek.className = 'grid peek';
    peek.dataset.side = side;
    fillGrid(peek, shiftMonth(store.current(), side === 'next' ? 1 : -1), deps.today(), lastMaxLines);
    if (!current) track.append(peek);
  }

  function release(width: number, outcome: -1 | 0 | 1): void {
    if (reducedMotion()) {
      if (outcome !== 0) go(shiftMonth(store.current(), outcome));
      return;
    }
    if (outcome !== 0) ensurePeek(outcome === 1 ? 'next' : 'prev');
    const target = shiftMonth(store.current(), outcome);
    track.style.transition = `transform ${SWIPE.durationMs}ms ease-out`;
    setTransform(-outcome * width);
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      track.removeEventListener('transitionend', onEnd);
      settle = null;
      track.style.transition = '';
      track.style.transform = '';
      track.querySelector('.peek')?.remove();
      if (outcome !== 0 && !destroyed) go(target);
    };
    const timer = setTimeout(finish, SWIPE.durationMs + 60);
    const onEnd = (e: TransitionEvent): void => {
      if (e.target === track && e.propertyName === 'transform') finish();
    };
    track.addEventListener('transitionend', onEnd);
    settle = { finish, timer };
  }

  pager.addEventListener('pointerdown', (e) => {
    settle?.finish();
    if (drag) {
      // 놓은 신호를 못 받은 낡은 끌기는 버리고 새로 시작한다.
      drag = null;
      swiped = false;
      clearTimeout(swipedTimer);
      track.style.transform = '';
      track.querySelector('.peek')?.remove();
    }
    // 레이아웃은 여기서 한 번만 읽는다.
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, width: pager.clientWidth || window.innerWidth, axis: null, samples: [{ x: e.clientX, t: now() }], x: 0, queued: false };
  });
  pager.addEventListener('pointermove', (e) => {
    const d = drag;
    if (!d || e.pointerId !== d.id || d.axis === 'y') return;
    const dx = e.clientX - d.x0;
    if (d.axis === null) {
      d.axis = lockAxis(dx, e.clientY - d.y0);
      if (d.axis === 'x') {
        swiped = true;
        try {
          pager.setPointerCapture(e.pointerId);
        } catch {
          /* 없거나 실패해도 계속한다 */
        }
      }
    }
    if (d.axis !== 'x') return;
    d.samples.push({ x: e.clientX, t: now() });
    if (d.samples.length > MAX_SAMPLES) d.samples.shift();
    if (reducedMotion() || dx === 0) return;
    ensurePeek(dx < 0 ? 'next' : 'prev');
    d.x = dragOffset(dx, d.width);
    if (!d.queued) {
      d.queued = true;
      frame(() => {
        d.queued = false;
        if (drag === d) setTransform(d.x);
      });
    }
  });
  pager.addEventListener('pointerup', (e) => {
    const d = drag;
    if (!d || e.pointerId !== d.id) return;
    drag = null;
    if (d.axis !== 'x') return;
    d.samples.push({ x: e.clientX, t: now() });
    if (d.samples.length > MAX_SAMPLES) d.samples.shift();
    holdClicks();
    release(d.width, swipeOutcome(e.clientX - d.x0, d.width, velocity(d.samples)));
  });
  const onCancel = (e: PointerEvent): void => {
    const d = drag;
    if (!d || e.pointerId !== d.id) return;
    drag = null;
    if (d.axis !== 'x') return;
    holdClicks();
    release(d.width, 0);
  };
  pager.addEventListener('pointercancel', onCancel);
  pager.addEventListener('lostpointercapture', onCancel);

  // 읽기 문제는 store가 바뀔 때, 연결 상태는 창의 online/offline 이벤트로 알 수 있다.
  const offChange = store.onChange(() => {
    render();
    renderStatus();
  });
  renderStatus();
  const offStatus = deps.status.subscribe(renderStatus);
  const onConnection = (): void => renderStatus();
  window.addEventListener('online', onConnection);
  window.addEventListener('offline', onConnection);
  const onResize = (): void => render();
  window.addEventListener('resize', onResize);

  // 창을 켜 둔 채 날짜가 바뀌어도 오늘 표시가 따라가게 한다. 자정 직후의 타이머는 숨은 탭에서 늦어질 수 있어
  // 다시 보이게 될 때도 확인한다.
  let midnightTimer: ReturnType<typeof setTimeout> | undefined;
  const checkToday = (): void => {
    if (deps.today() !== renderedToday) render();
    armMidnight();
  };
  const armMidnight = (): void => {
    if (midnightTimer !== undefined) clearTimeout(midnightTimer);
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
    midnightTimer = setTimeout(checkToday, next.getTime() - now.getTime());
  };
  const onVisibility = (): void => {
    if (document.visibilityState === 'visible') checkToday();
  };
  document.addEventListener('visibilitychange', onVisibility);
  armMidnight();

  root.appendChild(el);
  render(); // 붙인 뒤에 그려야 칸 높이를 잴 수 있다

  return {
    destroy() {
      offChange();
      offStatus();
      window.removeEventListener('online', onConnection);
      window.removeEventListener('offline', onConnection);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
      if (midnightTimer !== undefined) clearTimeout(midnightTimer);
      destroyed = true;
      drag = null;
      clearTimeout(swipedTimer);
      if (settle) clearTimeout(settle.timer);
      el.remove();
    },
  };
}
