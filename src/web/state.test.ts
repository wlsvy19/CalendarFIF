import { expect, it, vi } from 'vitest';
import type { MonthDoc } from '../core/types';
import { Outbox } from '../sync/outbox';
import { MemoryStorage, edit, rec } from '../sync/testing';
import { CalendarStore } from './state';

function fakeSource() {
  const listeners = new Map<string, (doc: MonthDoc | null) => void>();
  return {
    listeners,
    subscribeMonth(monthId: string, listener: (doc: MonthDoc | null) => void) {
      listeners.set(monthId, listener);
      return () => { listeners.delete(monthId); };
    },
  };
}

it('보는 달과 앞뒤 달만 구독한다', () => {
  const source = fakeSource();
  const store = new CalendarStore({ source, outbox: new Outbox(new MemoryStorage(), 'u1'), editedBy: 'pc', initialMonth: '2026-11' });
  expect([...source.listeners.keys()].sort()).toEqual(['2026-10', '2026-11', '2026-12']);
  store.show('2026-12');
  expect(store.current()).toBe('2026-12');
  expect([...source.listeners.keys()].sort()).toEqual(['2026-11', '2026-12', '2027-01']);
});
it('서버 값에 대기 편집을 얹고, 바뀌면 알린다', () => {
  const source = fakeSource();
  const outbox = new Outbox(new MemoryStorage(), 'u1');
  const store = new CalendarStore({ source, outbox, editedBy: 'pc', initialMonth: '2026-11' });
  const changed = vi.fn();
  store.onChange(changed);
  source.listeners.get('2026-11')!({ days: { '13': rec('A') } });
  expect(changed).toHaveBeenCalledTimes(1);
  outbox.put(edit('2026-11', '13', 'A', 'A\nB'));
  store.refresh();
  expect(changed).toHaveBeenCalledTimes(2);
  expect(store.days('2026-11')).toEqual({ '13': { text: 'A\nB', color: '' } });
  expect(store.days('2026-10')).toEqual({});
});
it('달의 첫 답이 오면 불러온 것으로 본다', () => {
  const source = fakeSource();
  const store = new CalendarStore({ source, outbox: new Outbox(new MemoryStorage(), 'u1'), editedBy: 'pc', initialMonth: '2026-11' });
  expect(store.isLoaded('2026-11')).toBe(false);
  source.listeners.get('2026-11')!({ days: { '13': rec('A') } });
  expect(store.isLoaded('2026-11')).toBe(true);
  source.listeners.get('2026-12')!(null);
  expect(store.isLoaded('2026-12')).toBe(true);
  expect(store.isLoaded('2026-10')).toBe(false);
  source.listeners.get('2026-10')!(null);
  store.show('2026-12');
  expect(store.isLoaded('2026-10')).toBe(false);
  expect(store.isLoaded('2026-11')).toBe(true);
});
