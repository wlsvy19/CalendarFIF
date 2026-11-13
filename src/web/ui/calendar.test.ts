import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DayValue } from '../../core/types';
import type { SyncStatus } from '../../sync/engine';
import type { CalendarStore } from '../state';
import { mountCalendar, visibleLines } from './calendar';

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
