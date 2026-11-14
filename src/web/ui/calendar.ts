import { shiftMonth } from '../../core/dates';
import { holidayLabel } from '../../core/holidays';
import { buildPage, pageMonths, stepPage, type Page } from '../../core/layout';
import { lunarLabel, lunarShort } from '../../core/lunar';
import type { Point } from '../../desktop/api';
import { parseLine, splitLines } from '../../core/text';
import type { SyncStatus } from '../../sync/engine';
import { applyAppearance, pageOptions, WEB_APPEARANCE, type Appearance } from '../appearance';
import { MEMO_METRICS, type MemoSize } from '../prefs';
import type { CalendarStore } from '../state';
import { createPager, type PagerEnv } from './pager';
import { statusText } from './status';

const WIDE_PX = 880;
const NUMBER_AREA_PX = 30; // 날짜 숫자와 칸 안쪽 여백이 차지하는 높이
const HOLIDAY_LINE_PX = { narrow: 14, wide: 16 }; // 웹에서 공휴일 이름 줄과 그 위의 틈이 차지하는 높이(styles.css의 .hname)
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

const chevron = (path: string): string =>
  `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"></path></svg>`;
const DOTS =
  '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"></circle><circle cx="12" cy="12" r="2"></circle><circle cx="19" cy="12" r="2"></circle></svg>';
const GEAR =
  '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"></path></svg>';

export function visibleLines<T>(lines: T[], maxLines: number): { shown: T[]; more: number } {
  if (lines.length <= maxLines) return { shown: lines, more: 0 };
  const shown = lines.slice(0, Math.max(0, maxLines - 1));
  return { shown, more: lines.length - shown.length };
}

/** 메모 한 줄씩. 빈 줄은 빼고, 설정에 따라 완료 줄을 숨기거나 안 끝낸 줄 뒤로 보낸다. */
export function displayLines(text: string, opts: { showDone: boolean; doneToBottom: boolean }): { text: string; done: boolean }[] {
  const lines = splitLines(text).filter((l) => l.trim() !== '').map(parseLine);
  const visible = opts.showDone ? lines : lines.filter((l) => !l.done);
  return opts.doneToBottom ? [...visible.filter((l) => !l.done), ...visible.filter((l) => l.done)] : visible;
}

/** reducedMotion은 pager가 따로 주지 않으면 달 넘기기에 넘긴다. */
export type CalendarEnv = { reducedMotion?(): boolean; pager?: PagerEnv };

export type CalendarDeps = {
  store: CalendarStore;
  status: { status(): SyncStatus; subscribe(listener: (s: SyncStatus) => void): () => void };
  today(): string;
  onOpenDay(dateKey: string): void;
  onOpenSettings(): void;
  appearance?: Appearance;
  /** 웹앱이 준다. 주면 appearance는 동작(시작 요일, 음력, 공휴일, 완료 줄 등)만 정하고 모양은 웹의 것(styles.css)을 쓴다. */
  web?: WebLook;
  /** PC 앱에서만 준다. 두 번 눌러 열고, 오른쪽 클릭은 칸 메뉴, 설정 단추 대신 메뉴 단추를 둔다. */
  desktop?: { onDayMenu(dateKey: string, at: Point): void; onOpenMenu(at: Point): void };
};

/** 웹 모양에서 고를 수 있는 것: 칸 안 메모의 글자 크기. */
export type WebLook = { memoSize: MemoSize };

export type CalendarHandle = { destroy(): void; setAppearance(a: Appearance, web?: WebLook): void; goToday(): void; showMonth(monthId: string): void };

const dowSpan = (dow: number): string => `<span${dow === 0 ? ' class="sun"' : dow === 6 ? ' class="sat"' : ''}>${WEEKDAYS[dow]}</span>`;

function spanOf(className: string, text: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = className;
  span.textContent = text;
  return span;
}

export function mountCalendar(root: HTMLElement, deps: CalendarDeps, env: CalendarEnv = {}): CalendarHandle {
  const { store } = deps;
  // 설정이 없거나 웹 모양(web)이면 웹앱처럼 그리고 PC 앱의 CSS 변수를 쓰지 않는다.
  let appearance: Appearance = deps.appearance ?? WEB_APPEARANCE;
  let web: WebLook | undefined = deps.web;
  let custom = deps.appearance !== undefined && web === undefined;
  const firstAnchor = store.current() === deps.today().slice(0, 7) ? deps.today() : `${store.current()}-01`;
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
        <button type="button" class="iconbtn" aria-label="${deps.desktop ? '메뉴' : '설정'}">${deps.desktop ? DOTS : GEAR}</button>
      </div>
    </div>
    <div class="dow" aria-hidden="true"></div>`;
  const q = (selector: string): HTMLElement => el.querySelector<HTMLElement>(selector)!;
  const yearEl = q('.year');
  const monthEl = q('.month');
  const syncEl = q('.sync');
  const syncText = q('.sync-text');
  const dowEl = q('.dow');
  const head = q('.app-head');
  const [todayBtn, prevBtn, nextBtn, settingsBtn] = [...el.querySelectorAll<HTMLButtonElement>('.app-nav button')];

  function renderStatus(status: SyncStatus = deps.status.status()): void {
    const readProblem = store.readProblem();
    const online = navigator.onLine;
    const trouble = readProblem !== null || (status.state === 'synced' && !online);
    syncEl.dataset.state = (trouble || status.state === 'waiting') ? 'wait' : status.state === 'sending' ? 'busy' : 'ok';
    syncText.textContent = statusText(status, readProblem, online);
  }

  // 격자 요소 하나에 한 쪽의 칸을 채운다. 칸 높이는 그 쪽이 놓인 자리에서 잰다.
  function fillGrid(target: HTMLElement, page: Page, today: string): void {
    target.style.setProperty('--rows', String(page.rows.length));
    const a = appearance;
    const lineOpts = { showDone: a.showDone, doneToBottom: a.doneToBottom };

    // 공휴일과 음력은 칸마다 한 번만 계산한다.
    const daysByMonth = new Map<string, ReturnType<CalendarStore['days']>>();
    const built: { button: HTMLButtonElement; lines: { text: string; done: boolean }[]; named: boolean }[] = [];
    const children: HTMLElement[] = [];
    page.rows.forEach((row, rowIndex) => {
      if (a.weekNumbers) children.push(spanOf('wk', String(row.week)));
      row.cells.forEach((c, col) => {
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
        const holiday = a.holidays ? holidayLabel(c.dateKey) : '';
        if (holiday !== '') button.classList.add('holiday');
        if (holiday !== '' || (a.showRestDays && a.restDays.includes(c.dow))) button.classList.add('rest');
        if (c.dayOfMonth <= 7 && rowIndex > 0) button.classList.add('m-top');
        if (c.dayOfMonth === 1 && col > 0) button.classList.add('m-left');
        if (value?.color) {
          button.dataset.color = value.color;
          button.style.setProperty('--day-color', `#${value.color}`);
        }
        const header = spanOf('head', '');
        header.append(spanOf('num', String(c.dayOfMonth)));
        if (holiday !== '') header.append(spanOf('hname', holiday));
        // 음력 표 밖의 날짜는 적지 않는다. 웹의 좁은 칸에는 '음'을 뺀 짧은 꼴을 쓴다.
        const lunar = a.lunar ? (custom ? lunarLabel(c.dateKey) : lunarShort(c.dateKey)) : '';
        if (lunar !== '') header.append(spanOf('lunar', lunar));
        button.append(header);
        children.push(button);
        built.push({ button, lines: displayLines(value?.text ?? '', lineOpts), named: holiday !== '' });
      });
    });
    target.replaceChildren(...children);

    // 칸 높이를 재서 들어가는 줄 수를 정한다. 높이가 0이면(배치가 없으면) 제한하지 않는다.
    const first = built[0]?.button;
    const cellHeight = first?.clientHeight ?? 0;
    let lineHeight: number;
    let used: number;
    if (custom) {
      lineHeight = Math.round(a.memoFont.size * a.lineSpacing);
      const style = first ? getComputedStyle(first) : null;
      const padding = style ? (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0) : 0;
      used = (first?.querySelector<HTMLElement>('.head')?.offsetHeight ?? 0) + padding;
    } else {
      // 메모 줄의 글자 크기와 높이는 여기서 정해 CSS 변수로 넘긴다(styles.css의 .ln). 줄 수 계산과 늘 같은 값을 쓰게 한다.
      const memo = MEMO_METRICS[web?.memoSize ?? 'medium'];
      const metrics = window.innerWidth >= WIDE_PX ? memo.wide : memo.narrow;
      el.style.setProperty('--memo-size', `${metrics.size}px`);
      el.style.setProperty('--memo-line', `${metrics.line}px`);
      lineHeight = metrics.line;
      used = NUMBER_AREA_PX;
    }
    const linesIn = (taken: number): number => (cellHeight > 0 ? Math.max(1, Math.floor((cellHeight - taken) / lineHeight)) : Infinity);
    const maxLines = linesIn(used);
    // 웹에서는 공휴일 이름이 숫자 아래에 한 줄을 차지한다(PC 앱은 숫자 옆에 놓는다).
    const maxNamedLines = custom ? maxLines : linesIn(used + (window.innerWidth >= WIDE_PX ? HOLIDAY_LINE_PX.wide : HOLIDAY_LINE_PX.narrow));
    for (const { button, lines, named } of built) {
      if (lines.length === 0) continue;
      const { shown, more } = visibleLines(lines, named ? maxNamedLines : maxLines);
      const memo = spanOf('memo', '');
      for (const { done, text } of shown) memo.append(spanOf(done ? 'ln done' : 'ln', text));
      if (more > 0) memo.append(spanOf('ln more', `+${more}`));
      button.append(memo);
    }
    // 잘린 줄 표시: 폭을 모두 읽은 뒤에 표시를 붙인다(줄마다 배치를 다시 계산하지 않게).
    const cut = [...target.querySelectorAll<HTMLElement>('.ln:not(.more)')].filter((ln) => ln.scrollWidth > ln.clientWidth);
    for (const ln of cut) ln.classList.add('cut');
  }

  function applyClasses(): void {
    const a = appearance;
    el.classList.toggle('shadow', a.shadow);
    el.classList.toggle('month-gap', a.monthGap);
    el.classList.toggle('with-wk', a.weekNumbers);
    el.dataset.bullet = a.bullet;
    head.hidden = !a.titleBar;
    const monthLayout = a.layout === 'month';
    prevBtn.setAttribute('aria-label', monthLayout ? '이전 달' : '이전');
    nextBtn.setAttribute('aria-label', monthLayout ? '다음 달' : '다음');
    if (custom) applyAppearance(el, a);
  }

  // 달 넘기기는 브라우저의 스크롤이 한다. 쪽이 바뀌면(스크롤이 반을 넘거나 바로 가면) 머리와 구독을 바꾼다.
  const pager = createPager(
    {
      anchor: firstAnchor,
      neighbours: deps.desktop ? 0 : 1, // PC 앱은 단추로만 넘기고 옆 쪽을 붙여 두지 않는다
      step: (a, delta) => stepPage(pageOptions(appearance), a, delta),
      fill: (grid, a) => fillGrid(grid, buildPage(pageOptions(appearance), a), deps.today()),
      onCurrent: () => {
        renderHead();
        subscribe();
      },
    },
    { ...env.pager, reducedMotion: env.pager?.reducedMotion ?? env.reducedMotion },
  );
  el.append(pager.el);

  function renderHead(): void {
    const page = buildPage(pageOptions(appearance), pager.anchor());
    const [year, month] = page.title.split('-');
    yearEl.textContent = `${year}년`;
    monthEl.textContent = `${Number(month)}월`;
    dowEl.innerHTML = (appearance.weekNumbers ? '<span></span>' : '') + page.weekdays.map(dowSpan).join('');
  }

  // 구독할 달을 알린다. 붙어 있는 쪽들이 보여 주는 달 중 지금 달과 그 앞뒤 한 달 밖의 것은 더해서 구독한다.
  // 그래야 미끄러져 들어오거나 나가는 쪽도 메모를 잃지 않는다.
  function subscribe(): void {
    const opts = pageOptions(appearance);
    const title = buildPage(opts, pager.anchor()).title;
    const near = [shiftMonth(title, -1), title, shiftMonth(title, 1)];
    const months = new Set(pager.anchors().flatMap((a) => pageMonths(buildPage(opts, a))));
    store.show(title, [...months].filter((m) => !near.includes(m)).sort());
  }

  // 쪽은 그대로 두고 머리와 붙어 있는 쪽을 모두 다시 그린다.
  let renderedToday = deps.today();
  function redraw(): void {
    renderedToday = deps.today();
    renderHead();
    pager.refresh();
  }

  pager.el.addEventListener('click', (event) => {
    if (deps.desktop) return; // PC 앱은 한 번 눌러서는 열지 않는다
    // 누르는 사이에 칸이 다시 그려지면 target이 격자가 된다. 누른 자리의 칸을 찾아 쓴다.
    let cell = (event.target as Element).closest<HTMLElement>('.cell');
    if (!cell) cell = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('.cell') ?? null;
    // 옆 쪽은 inert라 눌리지 않는다. inert를 모르는 환경도 있어 지금 쪽의 칸만 연다.
    if (cell?.dataset.key && cell.closest('.grid.current')) deps.onOpenDay(cell.dataset.key);
  });
  if (deps.desktop) {
    const desktop = deps.desktop;
    const cellKey = (event: MouseEvent): string | undefined => (event.target as Element).closest<HTMLElement>('.cell')?.dataset.key;
    pager.el.addEventListener('dblclick', (event) => {
      const key = cellKey(event);
      if (key) deps.onOpenDay(key);
    });
    pager.el.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      const key = cellKey(event);
      if (key) desktop.onDayMenu(key, { x: event.clientX, y: event.clientY });
    });
  }
  const goToday = (): void => pager.jump(deps.today());
  prevBtn.addEventListener('click', () => pager.go(-1));
  nextBtn.addEventListener('click', () => pager.go(1));
  todayBtn.addEventListener('click', goToday);
  settingsBtn.addEventListener('click', (event) => {
    if (deps.desktop) deps.desktop.onOpenMenu({ x: event.clientX, y: event.clientY });
    else deps.onOpenSettings();
  });

  // 읽기 문제는 store가 바뀔 때, 연결 상태는 창의 online/offline 이벤트로 알 수 있다.
  const offChange = store.onChange(() => {
    redraw();
    renderStatus();
  });
  renderStatus();
  const offStatus = deps.status.subscribe(renderStatus);
  const onConnection = (): void => renderStatus();
  window.addEventListener('online', onConnection);
  window.addEventListener('offline', onConnection);
  const onResize = (): void => redraw();
  window.addEventListener('resize', onResize);

  // 창을 켜 둔 채 날짜가 바뀌어도 오늘 표시가 따라가게 한다. 자정 직후의 타이머는 숨은 탭에서 늦어질 수 있어
  // 다시 보이게 될 때도 확인한다.
  let midnightTimer: ReturnType<typeof setTimeout> | undefined;
  const checkToday = (): void => {
    const today = deps.today();
    if (today !== renderedToday) {
      // 어제를 보고 있었으면 오늘로 따라간다.
      const follow = pager.anchor() === renderedToday;
      renderedToday = today;
      if (follow) pager.jump(today);
      else redraw();
    }
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
  applyClasses();
  pager.place();
  // 붙인 뒤에 그려야 칸 높이를 잴 수 있다
  renderHead();
  subscribe();
  pager.refresh();

  return {
    setAppearance(next, nextWeb) {
      appearance = next;
      if (nextWeb) web = nextWeb;
      custom = web === undefined;
      applyClasses();
      pager.jump(pager.anchor()); // 넘기는 폭과 배치가 바뀌었을 수 있다
    },
    goToday,
    // 열려는 날짜의 달로 간다. 전체 월은 보이는 달이 아니면 그 달로 넘어가고, 다른 배치는 이미 구독 중이면(보이는 쪽에 있으면) 그대로 둔다.
    // 그대로 둘 때 다시 그리지 않는다: 여는 쪽(main.ts)이 이어서 store.refresh()로 다시 그린다.
    showMonth(monthId) {
      const shown = appearance.layout === 'month' ? pager.anchor().slice(0, 7) === monthId : store.covers(monthId);
      if (shown) return;
      const today = deps.today();
      pager.jump(monthId === today.slice(0, 7) ? today : `${monthId}-01`);
    },
    destroy() {
      offChange();
      offStatus();
      window.removeEventListener('online', onConnection);
      window.removeEventListener('offline', onConnection);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
      if (midnightTimer !== undefined) clearTimeout(midnightTimer);
      pager.destroy();
      el.remove();
    },
  };
}
