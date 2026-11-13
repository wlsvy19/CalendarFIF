import { buildMonthGrid, shiftMonth, splitDateKey } from '../../core/dates';
import { parseLine, splitLines } from '../../core/text';
import type { SyncStatus } from '../../sync/engine';
import type { CalendarStore } from '../state';
import { statusText } from './status';

const SWIPE_PX = 44;
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

export function mountCalendar(
  root: HTMLElement,
  deps: {
    store: CalendarStore;
    status: { status(): SyncStatus; subscribe(listener: (s: SyncStatus) => void): () => void };
    today(): string;
    onOpenDay(dateKey: string): void;
    onOpenSettings(): void;
  },
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
    <div class="grid"></div>`;
  const q = (selector: string): HTMLElement => el.querySelector<HTMLElement>(selector)!;
  const yearEl = q('.year');
  const monthEl = q('.month');
  const syncEl = q('.sync');
  const syncText = q('.sync-text');
  const grid = q('.grid');
  const [todayBtn, prevBtn, nextBtn, settingsBtn] = [...el.querySelectorAll<HTMLButtonElement>('.app-nav button')];

  function renderStatus(status: SyncStatus): void {
    syncEl.dataset.state = status.state === 'synced' ? 'ok' : status.state === 'sending' ? 'busy' : 'wait';
    syncText.textContent = statusText(status);
  }

  function render(): void {
    const monthId = store.current();
    const [year, month] = monthId.split('-');
    yearEl.textContent = `${year}년`;
    monthEl.textContent = `${Number(month)}월`;
    const cells = buildMonthGrid(monthId);
    const today = deps.today();
    grid.style.setProperty('--rows', String(cells.length / 7));

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
    grid.replaceChildren(...built.map((b) => b.button));

    // 칸 높이를 재서 들어가는 줄 수를 정한다. 높이가 0이면(배치가 없으면) 제한하지 않는다.
    const cellHeight = built[0]?.button.clientHeight ?? 0;
    const lineHeight = window.innerWidth >= WIDE_PX ? 17 : 13;
    const maxLines = cellHeight > 0 ? Math.max(1, Math.floor((cellHeight - NUMBER_AREA_PX) / lineHeight)) : Infinity;
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
    for (const ln of grid.querySelectorAll<HTMLElement>('.ln:not(.more)')) {
      if (ln.scrollWidth > ln.clientWidth) ln.classList.add('cut');
    }
  }

  function go(monthId: string): void {
    store.show(monthId);
    render();
  }

  grid.addEventListener('click', (event) => {
    if (swiped) return;
    const cell = (event.target as Element).closest<HTMLElement>('.cell');
    if (cell?.dataset.key) deps.onOpenDay(cell.dataset.key);
  });
  prevBtn.addEventListener('click', () => go(shiftMonth(store.current(), -1)));
  nextBtn.addEventListener('click', () => go(shiftMonth(store.current(), 1)));
  todayBtn.addEventListener('click', () => go(splitDateKey(deps.today())!.monthId));
  settingsBtn.addEventListener('click', () => deps.onOpenSettings());

  let start: { x: number; y: number } | null = null;
  let swiped = false;
  grid.addEventListener('pointerdown', (e) => {
    start = { x: e.clientX, y: e.clientY };
  });
  grid.addEventListener('pointercancel', () => {
    start = null;
  });
  grid.addEventListener('pointerup', (e) => {
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    start = null;
    if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy)) {
      go(shiftMonth(store.current(), dx < 0 ? 1 : -1));
      // 밀기 끝에 뜨는 click이 날짜 칸을 열지 않게 한다.
      swiped = true;
      setTimeout(() => {
        swiped = false;
      }, 300);
    }
  });

  const offChange = store.onChange(render);
  renderStatus(deps.status.status());
  const offStatus = deps.status.subscribe(renderStatus);
  const onResize = (): void => render();
  window.addEventListener('resize', onResize);
  root.appendChild(el);
  render(); // 붙인 뒤에 그려야 칸 높이를 잴 수 있다

  return {
    destroy() {
      offChange();
      offStatus();
      window.removeEventListener('resize', onResize);
      el.remove();
    },
  };
}
