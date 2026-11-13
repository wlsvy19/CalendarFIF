import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DayValue } from '../../core/types';
import type { SyncStatus } from '../../sync/engine';
import type { CalendarStore } from '../state';
import { shiftMonth } from '../../core/dates';
import { DEFAULT_APPEARANCE, type Appearance } from '../appearance';
import { displayLines, mountCalendar, visibleLines } from './calendar';

function fakeStore(days: Record<string, DayValue>) {
  let month = '2026-11';
  return {
    current: () => month,
    show: vi.fn((m: string) => { month = m; }),
    days: (m: string) => (m === '2026-11' ? days : {}),
    onChange: () => () => {},
    readProblem: () => null,
  } as unknown as CalendarStore & { show: ReturnType<typeof vi.fn> };
}
function mount(days: Record<string, DayValue> = {}, status: SyncStatus = { state: 'synced', pending: 0 }) {
  const root = document.createElement('div');
  const store = fakeStore(days);
  const onOpenDay = vi.fn();
  mountCalendar(root, { store, status: { status: () => status, subscribe: () => () => {} }, today: () => '2026-11-13', onOpenDay, onOpenSettings: vi.fn() });
  return { root, store, onOpenDay };
}
const cell = (root: HTMLElement, key: string) => root.querySelector<HTMLElement>(`.cell[data-key="${key}"]`)!;

it('칸에 들어가는 만큼만 줄을 보여 준다', () => {
  expect(visibleLines(['a', 'b'], 3)).toEqual({ shown: ['a', 'b'], more: 0 });
  expect(visibleLines(['a', 'b', 'c', 'd'], 3)).toEqual({ shown: ['a', 'b'], more: 2 });
  expect(visibleLines(['a', 'b', 'c'], 1)).toEqual({ shown: [], more: 3 });
});
it('한 달을 그린다', () => {
  const { root } = mount({ '13': { text: '회의\n[+]장보기', color: 'F12424' } });
  expect(root.querySelectorAll('.cell')).toHaveLength(35);
  expect(root.textContent).toContain('2026년');
  expect(root.textContent).toContain('11월');
  expect(root.textContent).toContain('동기화됨');
  const day = cell(root, '2026-11-13');
  expect(day.classList.contains('today')).toBe(true);
  expect(day.dataset.color).toBe('F12424');
  expect(day.style.getPropertyValue('--day-color')).toBe('#F12424');
  const lines = [...day.querySelectorAll('.ln')];
  expect(lines.map((el) => el.textContent)).toEqual(['회의', '장보기']);
  expect(lines[1].classList.contains('done')).toBe(true);
  expect(cell(root, '2026-11-01').classList.contains('sun')).toBe(true);
  expect(cell(root, '2026-11-07').classList.contains('sat')).toBe(true);
  expect(cell(root, '2026-12-05').classList.contains('other')).toBe(true);
});
it('달을 넘기고, 날짜를 누르면 알린다', () => {
  const { root, store, onOpenDay } = mount();
  root.querySelector<HTMLElement>('[aria-label="다음 달"]')!.click();
  expect(store.show).toHaveBeenLastCalledWith('2026-12');
  root.querySelector<HTMLElement>('[aria-label="다음 달"]')!.click();
  expect(store.show).toHaveBeenLastCalledWith('2027-01');
  root.querySelector<HTMLElement>('[aria-label="이전 달"]')!.click();
  expect(store.show).toHaveBeenLastCalledWith('2026-12');
  [...root.querySelectorAll('button')].find((b) => b.textContent === '오늘')!.click();
  expect(store.show).toHaveBeenLastCalledWith('2026-11');
  cell(root, '2026-11-20').click();
  expect(onOpenDay).toHaveBeenCalledWith('2026-11-20');
});
it('대기 중이면 건수를 보여 준다', () => {
  expect(mount({}, { state: 'waiting', pending: 2 }).root.textContent).toContain('오프라인 (대기 2건)');
});
it('읽기 문제를 보여 주고, 연결이 끊기거나 이어지면 상태를 다시 그린다', () => {
  const problem = mount();
  (problem.store as unknown as { readProblem: () => string | null }).readProblem = () => 'denied';
  window.dispatchEvent(new Event('offline'));
  expect(problem.root.querySelector('.sync-text')!.textContent).toBe('권한이 없어 읽지 못했습니다');

  const { root } = mount();
  const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  window.dispatchEvent(new Event('offline'));
  expect(root.querySelector('.sync-text')!.textContent).toBe('오프라인');
  onLine.mockReturnValue(true);
  window.dispatchEvent(new Event('online'));
  expect(root.querySelector('.sync-text')!.textContent).toBe('동기화됨');
  onLine.mockRestore();
});
describe('날짜가 바뀌면', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('자정이 지나면 오늘 표시를 옮긴다', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 13, 23, 59, 50));
    const midnight = new Date(2026, 10, 14).getTime();
    const root = document.createElement('div');
    const handle = mountCalendar(root, {
      store: fakeStore({}),
      status: { status: () => ({ state: 'synced', pending: 0 }), subscribe: () => () => {} },
      today: () => (Date.now() < midnight ? '2026-11-13' : '2026-11-14'),
      onOpenDay: vi.fn(),
      onOpenSettings: vi.fn(),
    });
    expect(cell(root, '2026-11-13').classList.contains('today')).toBe(true);
    await vi.advanceTimersByTimeAsync(15000);
    expect(cell(root, '2026-11-14').classList.contains('today')).toBe(true);
    expect(cell(root, '2026-11-13').classList.contains('today')).toBe(false);
    handle.destroy();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('다시 보이게 될 때 날짜가 바뀌었으면 다시 그린다', () => {
    let today = '2026-11-13';
    const root = document.createElement('div');
    const handle = mountCalendar(root, {
      store: fakeStore({}),
      status: { status: () => ({ state: 'synced', pending: 0 }), subscribe: () => () => {} },
      today: () => today,
      onOpenDay: vi.fn(),
      onOpenSettings: vi.fn(),
    });
    today = '2026-11-14';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(cell(root, '2026-11-14').classList.contains('today')).toBe(true);
    const calendar = root.firstElementChild as HTMLElement;
    handle.destroy();
    today = '2026-11-15';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(cell(calendar, '2026-11-15').classList.contains('today')).toBe(false);
  });
});
describe('달 넘기기', () => {
  afterEach(() => { vi.useRealTimers(); });
  function swipeMount(reduced = false) {
    let t = 0;
    const root = document.createElement('div');
    const store = fakeStore({});
    const onOpenDay = vi.fn();
    mountCalendar(root, { store, status: { status: () => ({ state: 'synced', pending: 0 }), subscribe: () => () => {} }, today: () => '2026-11-13', onOpenDay, onOpenSettings: vi.fn() },
      { frame: (cb) => cb(), reducedMotion: () => reduced, now: () => t });
    const pager = root.querySelector<HTMLElement>('.pager')!;
    const fire = (type: string, x: number, y: number, at: number) => {
      t = at;
      pager.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId: 1, bubbles: true }));
    };
    return { root, store, onOpenDay, fire, track: root.querySelector<HTMLElement>('.track')! };
  }
  it('끄는 동안 손가락을 따라 움직이고, 20%를 넘게 끌고 놓으면 200ms 미끄러진 뒤 넘어간다', () => {
    vi.useFakeTimers();
    const { root, store, track, fire } = swipeMount(); // 폭은 window.innerWidth = 1024
    fire('pointerdown', 600, 300, 0);
    fire('pointermove', 550, 302, 30);
    expect(track.style.transform).toBe('translate3d(-50px, 0px, 0px)');
    const peek = root.querySelector<HTMLElement>('.grid.peek')!;
    expect([peek.dataset.side, peek.querySelector('.cell[data-key="2026-12-01"]') !== null]).toEqual(['next', true]);
    fire('pointermove', 390, 300, 800);
    fire('pointerup', 390, 300, 1000);
    expect([track.style.transform, track.style.transition.includes('200ms')]).toEqual(['translate3d(-1024px, 0px, 0px)', true]);
    expect(store.show).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(store.show).toHaveBeenLastCalledWith('2026-12');
    expect([track.style.transform, root.querySelector('.grid.peek')]).toEqual(['', null]);
  });
  it('세로로 움직이면 넘기지 않는다', () => {
    const { root, store, track, fire } = swipeMount();
    fire('pointerdown', 500, 300, 0);
    fire('pointermove', 505, 380, 30);
    fire('pointerup', 505, 420, 60);
    expect([track.style.transform, root.querySelector('.grid.peek'), store.show.mock.calls.length]).toEqual(['', null, 0]);
  });
  it('동작 줄이기가 켜져 있으면 따라 움직이지 않고 손을 떼는 순간 넘기며, 그 뒤의 click은 날짜를 열지 않는다', () => {
    const { root, store, onOpenDay, track, fire } = swipeMount(true);
    fire('pointerdown', 600, 300, 0);
    fire('pointermove', 300, 300, 100);
    expect(track.style.transform).toBe('');
    fire('pointerup', 300, 300, 200);
    expect(store.show).toHaveBeenLastCalledWith('2026-12');
    cell(root, '2026-12-10').click();
    expect(onOpenDay).not.toHaveBeenCalled();
  });
  it('놓은 신호 없이 끝난 세로 끌기가 남아 있어도 다음 가로 끌기는 달을 넘긴다', () => {
    vi.useFakeTimers();
    const { store, fire } = swipeMount();
    fire('pointerdown', 500, 300, 0);
    fire('pointermove', 505, 380, 30); // 세로로 정해지고 pointerup은 오지 않는다
    fire('pointerdown', 600, 300, 100);
    fire('pointermove', 500, 302, 130);
    fire('pointermove', 300, 300, 200);
    fire('pointerup', 300, 300, 230);
    vi.advanceTimersByTime(300);
    expect(store.show).toHaveBeenLastCalledWith('2026-12');
  });
  it('미끄러지는 중에 다음 달 버튼을 누르면 두 달 뒤에서 멈추고, 오늘 버튼이면 오늘의 달이다', () => {
    vi.useFakeTimers();
    for (const label of ['다음 달', '오늘']) {
      const { root, store, fire } = swipeMount();
      fire('pointerdown', 600, 300, 0);
      fire('pointermove', 300, 300, 100);
      fire('pointerup', 300, 300, 200);
      [...root.querySelectorAll<HTMLElement>('.app-nav button')].find((b) => b.getAttribute('aria-label') === label || b.textContent === label)!.click();
      vi.advanceTimersByTime(300);
      expect(store.current()).toBe(label === '오늘' ? '2026-11' : '2027-01');
    }
  });
});

function mountA(a: Partial<Appearance>, today = '2026-11-13') {
  const root = document.createElement('div');
  const store = fakeStore({ '13': { text: '[+]끝낸 일\n회의\n[+]장보기\n운동', color: '' } });
  store.show(today.slice(0, 7)); // main.ts처럼 저장소는 오늘의 달에서 시작한다
  mountCalendar(root, { store, status: { status: () => ({ state: 'synced', pending: 0 }), subscribe: () => () => {} }, today: () => today, onOpenDay: vi.fn(), onOpenSettings: vi.fn(), appearance: { ...DEFAULT_APPEARANCE, ...a } });
  return root;
}
const has = (el: Element, c: string) => el.classList.contains(c);
describe('화면 설정', () => {
  it('변동 월은 지난 주 한 줄과 앞으로 네 줄이고 흐린 칸이 없다. 단일 행과 시작 요일', () => {
    const root = mountA({});
    const cells = [...root.querySelectorAll<HTMLElement>('.cell')];
    expect([cells.length, cells[0].dataset.key, root.querySelector('.cell.other'), root.querySelector('[aria-label="다음"]') !== null]).toEqual([35, '2026-11-01', null, true]);
    expect(mountA({ layout: 'week' }).querySelectorAll('.cell')).toHaveLength(7);
    expect([...mountA({ layout: 'days' }).querySelectorAll('.dow span')].map((s) => s.textContent)).toEqual(['금', '토', '일', '월', '화', '수', '목']);
    const mon = mountA({ layout: 'month', weekStart: 1 });
    expect([mon.querySelectorAll('.cell').length, mon.querySelector('.dow span')!.textContent]).toEqual([42, '월']);
  });
  it('주 번호, 공휴일, 음력, 쉬는날', () => {
    expect([...mountA({ weekNumbers: true }).querySelectorAll('.wk')].map((w) => w.textContent)).toEqual(['45', '46', '47', '48', '49']);
    const root = mountA({ layout: 'month', lunar: true }, '2026-12-10');
    const xmas = cell(root, '2026-12-25');
    expect([has(xmas, 'holiday'), has(xmas, 'rest'), xmas.querySelector('.hname')!.textContent, xmas.querySelector('.lunar')!.textContent]).toEqual([true, true, '성탄절', '음 11.17']);
    expect([has(cell(root, '2026-12-06'), 'rest'), has(cell(root, '2026-12-07'), 'rest')]).toEqual([true, false]);
    const off = mountA({ layout: 'month', holidays: false, showRestDays: false }, '2026-12-10');
    expect([off.querySelector('.hname'), off.querySelector('.cell.rest')]).toEqual([null, null]);
  });
  it('완료한 줄 숨기기와 맨 아래로 보내기, 줄 머리, 그림자, 월 간격, 제목 줄', () => {
    expect(displayLines('[+]A\nB\n\n[+]C\nD', { showDone: true, doneToBottom: true })).toEqual([{ text: 'B', done: false }, { text: 'D', done: false }, { text: 'A', done: true }, { text: 'C', done: true }]);
    expect(displayLines('[+]A\nB', { showDone: false, doneToBottom: false })).toEqual([{ text: 'B', done: false }]);
    const root = mountA({ showDone: false, bullet: 'number' });
    expect([...cell(root, '2026-11-13').querySelectorAll('.ln')].map((l) => l.textContent)).toEqual(['회의', '운동']);
    const cal = root.querySelector<HTMLElement>('.calendar')!;
    expect([cal.dataset.bullet, has(cal, 'shadow'), has(cal, 'month-gap')]).toEqual(['number', true, true]);
    expect([[...cell(root, '2026-12-01').classList].filter((c) => c.startsWith('m-')), has(cell(root, '2026-11-01'), 'm-top')]).toEqual([['m-top', 'm-left'], false]);
    const off = mountA({ shadow: false, titleBar: false }).querySelector<HTMLElement>('.calendar')!;
    expect([has(off, 'shadow'), off.querySelector<HTMLElement>('.app-head')!.hidden]).toEqual([false, true]);
  });
});
describe('구독과 날짜 열기', () => {
  function mountS(a: Partial<Appearance> | undefined) {
    const root = document.createElement('div');
    let month = '2026-11';
    const subscribed = new Set<string>();
    const store = {
      current: () => month,
      show: vi.fn((m: string, also: string[] = []) => {
        month = m;
        subscribed.clear();
        for (const x of [shiftMonth(m, -1), m, shiftMonth(m, 1), ...also]) subscribed.add(x);
      }),
      covers: (m: string) => subscribed.has(m),
      days: () => ({}),
      onChange: () => () => {},
      readProblem: () => null,
    } as unknown as CalendarStore & { show: ReturnType<typeof vi.fn> };
    store.show('2026-11');
    store.show.mockClear();
    const handle = mountCalendar(root, { store, status: { status: () => ({ state: 'synced', pending: 0 }), subscribe: () => () => {} }, today: () => '2026-11-13', onOpenDay: vi.fn(), onOpenSettings: vi.fn(), appearance: a && { ...DEFAULT_APPEARANCE, ...a } });
    return { root, store, handle, subscribed };
  }
  const title = (root: HTMLElement) => root.querySelector('.month')!.textContent;
  it('여러 달에 걸친 쪽은 앞뒤 한 달 밖의 달을 더해서 구독한다', () => {
    const { store } = mountS({ layout: 'floating', maxRows: 8, pastWeeks: 0 });
    expect(store.show).toHaveBeenLastCalledWith('2026-11', ['2027-01']);
  });
  it('쪽이 바뀌면 앞 쪽이 더한 달을 정리한다', () => {
    const { handle, subscribed } = mountS({ layout: 'floating', maxRows: 8, pastWeeks: 0 });
    expect(subscribed.has('2027-01')).toBe(true);
    handle.setAppearance({ ...DEFAULT_APPEARANCE, layout: 'month' });
    expect([...subscribed].sort()).toEqual(['2026-10', '2026-11', '2026-12']);
  });
  it('전체 월은 다른 달의 날짜를 열면 그 달로 넘어간다', () => {
    const { root, store, handle } = mountS(undefined);
    handle.showMonth('2026-12');
    expect([store.current(), title(root)]).toEqual(['2026-12', '12월']);
  });
  it('다른 배치는 보이는 쪽에 있는 날짜를 열어도 쪽을 바꾸지 않는다', () => {
    const { root, store, handle } = mountS({ layout: 'floating' });
    handle.showMonth('2026-12'); // 쪽은 11월 1일부터 12월 5일까지
    expect([store.current(), title(root)]).toEqual(['2026-11', '11월']);
    handle.showMonth('2027-06');
    expect([store.current(), title(root)]).toEqual(['2027-06', '6월']);
  });
});
it('PC 앱에서는 두 번 눌러야 열고, 오른쪽 클릭은 칸 메뉴, 메뉴 단추는 앱 메뉴', () => {
  const root = document.createElement('div');
  const onOpenDay = vi.fn(), onDayMenu = vi.fn(), onOpenMenu = vi.fn();
  mountCalendar(root, { store: fakeStore({}), status: { status: () => ({ state: 'synced', pending: 0 }), subscribe: () => () => {} }, today: () => '2026-11-13', onOpenDay, onOpenSettings: vi.fn(), appearance: DEFAULT_APPEARANCE, desktop: { onDayMenu, onOpenMenu } });
  const day = cell(root, '2026-11-20');
  day.click();
  expect(onOpenDay).not.toHaveBeenCalled();
  day.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  expect(onOpenDay).toHaveBeenCalledWith('2026-11-20');
  const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 50 });
  day.dispatchEvent(ev);
  expect([ev.defaultPrevented, onDayMenu.mock.calls[0], root.querySelector('[aria-label="설정"]')]).toEqual([true, ['2026-11-20', { x: 40, y: 50 }], null]);
  root.querySelector('[aria-label="메뉴"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 600, clientY: 20 }));
  expect(onOpenMenu).toHaveBeenCalledWith({ x: 600, y: 20 });
});
it('PC 앱에서 마우스 끌기는 달을 넘기지 않는다', () => {
  const root = document.createElement('div');
  const store = fakeStore({});
  const onOpenDay = vi.fn();
  mountCalendar(root, { store, status: { status: () => ({ state: 'synced', pending: 0 }), subscribe: () => () => {} }, today: () => '2026-11-13', onOpenDay, onOpenSettings: vi.fn(), appearance: { ...DEFAULT_APPEARANCE, layout: 'month' }, desktop: { onDayMenu: vi.fn(), onOpenMenu: vi.fn() } }, { reducedMotion: () => true });
  const pager = root.querySelector<HTMLElement>('.pager')!;
  const at = (type: string, x: number) => pager.dispatchEvent(Object.assign(new MouseEvent(type, { bubbles: true, clientX: x, clientY: 100 }), { pointerId: 1, pointerType: 'mouse' }));
  at('pointerdown', 300); at('pointermove', 100); at('pointerup', 100);
  expect([store.current(), root.querySelector('.month')!.textContent]).toEqual(['2026-11', '11월']);
});
it('덮여 있지 않은 달을 열면 쪽의 여분 달도 구독한다', () => {
  const root = document.createElement('div');
  let month = '2026-11';
  const subscribed = new Set<string>();
  const store = {
    current: () => month,
    show: vi.fn((m: string, also: string[] = []) => {
      month = m;
      subscribed.clear();
      for (const x of [shiftMonth(m, -1), m, shiftMonth(m, 1), ...also]) subscribed.add(x);
    }),
    covers: (m: string) => subscribed.has(m),
    days: () => ({}),
    onChange: () => () => {},
    readProblem: () => null,
  } as unknown as CalendarStore & { show: ReturnType<typeof vi.fn> };
  const handle = mountCalendar(root, { store, status: { status: () => ({ state: 'synced', pending: 0 }), subscribe: () => () => {} }, today: () => '2026-11-13', onOpenDay: vi.fn(), onOpenSettings: vi.fn(), appearance: { ...DEFAULT_APPEARANCE, layout: 'floating', maxRows: 8, pastWeeks: 0 } });
  handle.showMonth('2027-06');
  handle.showMonth('2026-11'); // 오늘의 달: 쪽은 오늘 주부터 시작해 2027-01까지 간다
  expect([store.show.mock.lastCall, subscribed.has('2027-01')]).toEqual([['2026-11', ['2027-01']], true]);
});
