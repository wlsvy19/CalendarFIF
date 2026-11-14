/**
 * 달력 머리의 년도나 월을 누르면 그 아래에 뜨는 고르기 상자. 년도는 12년씩, 월은 1월~12월을 4×3 칸으로 보여 준다.
 * DesktopCal의 제목 줄 메뉴 "월분 선택"(1월~12월)을 따랐고, 년도도 같은 꼴로 고른다.
 * 바깥(투명한 덮개)을 누르거나 Esc를 누르거나 창이 바뀌면 닫힌다. 고르면 onPick을 부르고 닫는다.
 */

export const MIN_YEAR = 1900;
export const MAX_YEAR = 2100;
const PAGE = 12;
const COLUMNS = 4;
const EDGE_PX = 8;
const GAP_PX = 6;

export type DatePickKind = 'year' | 'month';

export type DatePickProps = {
  kind: DatePickKind;
  /** 지금 보이는 해와 달(1~12). 그 칸을 골라 둔 것으로 보여 준다. */
  year: number;
  month: number;
  /** 'YYYY-MM-DD'. 올해와 이번 달에 표시를 한다. */
  today: string;
  /** 상자를 붙일 곳(누른 단추의 자리). 그 아래에, 화면 밖으로 나가지 않게 놓는다. */
  anchor: { left: number; top: number; bottom: number };
  onPick(year: number, month: number): void;
  onClose(): void;
};

/** year가 든 12년 쪽의 첫 해. 쪽은 MIN_YEAR부터 12년씩 나뉜다(2026이면 2020~2031). */
export function yearPageStart(year: number): number {
  const y = Math.min(MAX_YEAR, Math.max(MIN_YEAR, Math.trunc(year)));
  return MIN_YEAR + Math.floor((y - MIN_YEAR) / PAGE) * PAGE;
}

/** 상자를 놓을 자리. 붙일 곳의 아래, 왼쪽을 맞추되 화면 가장자리에서 8px 안쪽에 둔다. 아래가 모자라면 위로 올린다. */
export function pickPosition(
  anchor: { left: number; top: number; bottom: number },
  size: { width: number; height: number },
  view: { width: number; height: number },
): { left: number; top: number } {
  const left = Math.max(EDGE_PX, Math.min(anchor.left, view.width - EDGE_PX - size.width));
  let top = anchor.bottom + GAP_PX;
  if (top + size.height > view.height - EDGE_PX) {
    const above = anchor.top - GAP_PX - size.height;
    top = above >= EDGE_PX ? above : Math.max(EDGE_PX, view.height - EDGE_PX - size.height);
  }
  return { left, top };
}

const STEP_ICON = (path: string): string =>
  `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"></path></svg>`;

export function mountDatePick(root: HTMLElement, props: DatePickProps): { el: HTMLElement; destroy(): void } {
  const todayYear = Number(props.today.slice(0, 4));
  const todayMonth = Number(props.today.slice(5, 7));

  const scrim = document.createElement('div');
  scrim.className = 'datepick-scrim';
  const panel = document.createElement('div');
  panel.className = `datepick ${props.kind}`;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', props.kind === 'year' ? '연도 선택' : '월 선택');
  const head = document.createElement('div');
  head.className = 'datepick-head';
  const label = document.createElement('span');
  label.className = 'datepick-label';
  const grid = document.createElement('div');
  grid.className = 'datepick-grid';
  grid.setAttribute('role', 'group');
  grid.setAttribute('aria-label', props.kind === 'year' ? '연도' : '월');
  panel.append(head, grid);

  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    props.onClose();
  };
  const pick = (year: number, month: number): void => {
    if (closed) return;
    if (year !== props.year || month !== props.month) props.onPick(year, month);
    close();
  };

  const item = (text: string, year: number, month: number, current: boolean, now: boolean, enabled: boolean): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = now ? 'datepick-item now' : 'datepick-item';
    b.textContent = text;
    b.dataset.year = String(year);
    b.dataset.month = String(month);
    if (current) b.setAttribute('aria-current', 'true');
    b.disabled = !enabled;
    return b;
  };

  let pageStart = yearPageStart(props.year);
  let prevBtn: HTMLButtonElement | null = null;
  let nextBtn: HTMLButtonElement | null = null;

  function fillYears(): void {
    label.textContent = `${pageStart} – ${pageStart + PAGE - 1}`;
    const items: HTMLButtonElement[] = [];
    for (let y = pageStart; y < pageStart + PAGE; y++) {
      items.push(item(String(y), y, props.month, y === props.year, y === todayYear, y >= MIN_YEAR && y <= MAX_YEAR));
    }
    grid.replaceChildren(...items);
    prevBtn!.disabled = pageStart <= MIN_YEAR;
    nextBtn!.disabled = pageStart + PAGE > MAX_YEAR;
  }

  if (props.kind === 'year') {
    const stepButton = (aria: string, path: string, delta: number): HTMLButtonElement => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'datepick-step';
      b.setAttribute('aria-label', aria);
      b.innerHTML = STEP_ICON(path);
      b.addEventListener('click', () => {
        const next = pageStart + delta;
        if (next < MIN_YEAR || next > MAX_YEAR) return;
        pageStart = next;
        fillYears();
      });
      return b;
    };
    prevBtn = stepButton('이전 12년', 'M15 5l-7 7 7 7', -PAGE);
    nextBtn = stepButton('다음 12년', 'M9 5l7 7-7 7', PAGE);
    head.append(prevBtn, label, nextBtn);
    fillYears();
  } else {
    head.classList.add('solo');
    label.textContent = `${props.year}년`;
    head.append(label);
    const items: HTMLButtonElement[] = [];
    for (let m = 1; m <= 12; m++) items.push(item(`${m}월`, props.year, m, m === props.month, props.year === todayYear && m === todayMonth, true));
    grid.replaceChildren(...items);
  }

  grid.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('.datepick-item');
    if (!b || b.disabled) return;
    pick(Number(b.dataset.year), Number(b.dataset.month));
  });
  // 바깥을 누르면 닫는다. pointerdown이 아니라 click에서 닫는다: 먼저 덮개를 치우면 같은 누르기가 만든 click이 밑의 날짜 칸으로 가서
  // 편집 화면이 열린다(아이폰).
  scrim.addEventListener('click', close);

  panel.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    const items = [...grid.querySelectorAll<HTMLButtonElement>('.datepick-item:not(:disabled)')];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -COLUMNS, ArrowDown: COLUMNS }[e.key];
    if (step !== undefined && at >= 0) {
      e.preventDefault();
      items[Math.max(0, Math.min(items.length - 1, at + step))].focus();
      return;
    }
    if (e.key !== 'Tab') return;
    const stops = [...panel.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    if (stops.length === 0) return;
    const first = stops[0];
    const last = stops[stops.length - 1];
    if (e.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });
  // 다른 프로그램으로 옮겨 가거나 화면 크기가 바뀌면(자리가 어긋나므로) 닫는다.
  const onLeave = (): void => close();
  window.addEventListener('blur', onLeave);
  window.addEventListener('resize', onLeave);

  root.append(scrim, panel);
  const rect = panel.getBoundingClientRect();
  const pos = pickPosition(props.anchor, { width: rect.width, height: rect.height }, { width: window.innerWidth, height: window.innerHeight });
  panel.style.left = `${pos.left}px`;
  panel.style.top = `${pos.top}px`;
  (grid.querySelector<HTMLButtonElement>('[aria-current="true"]') ?? grid.querySelector<HTMLButtonElement>('.datepick-item:not(:disabled)'))?.focus({ preventScroll: true });

  return {
    el: panel,
    destroy() {
      closed = true;
      window.removeEventListener('blur', onLeave);
      window.removeEventListener('resize', onLeave);
      scrim.remove();
      panel.remove();
    },
  };
}
