import { expect, it, vi } from 'vitest';
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
