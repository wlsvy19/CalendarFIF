import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MonthDoc } from '../core/types';
import { Outbox } from '../sync/outbox';
import { MemoryStorage, edit, rec } from '../sync/testing';
import { CalendarStore } from './state';

function fakeSource() {
  const listeners = new Map<string, (doc: MonthDoc | null) => void>();
  const errors = new Map<string, (code: string) => void>();
  return {
    listeners,
    errors,
    subscribeMonth(monthId: string, listener: (doc: MonthDoc | null) => void, onError?: (code: string) => void) {
      listeners.set(monthId, listener);
      if (onError) errors.set(monthId, onError);
      return () => { listeners.delete(monthId); errors.delete(monthId); };
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

describe('올린 값 덧씌우기', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  function committed() {
    const source = fakeSource();
    const store = new CalendarStore({ source, outbox: new Outbox(new MemoryStorage(), 'u1'), editedBy: 'pc', initialMonth: '2026-11' });
    const changed = vi.fn();
    store.onChange(changed);
    const snapshot = (doc: MonthDoc | null) => source.listeners.get('2026-11')!(doc);
    snapshot({ days: { '13': rec('A') } });
    store.noteCommitted('2026-11', { '13': rec('A\nB', '', 1000, 'pc') });
    return { store, changed, snapshot, text: () => store.days('2026-11')['13']?.text };
  }

  it('올린 값을 다음 스냅숏이 올 때까지 보여 준다', () => {
    const { changed, text } = committed();
    expect(text()).toBe('A\nB');
    expect(changed).toHaveBeenCalledTimes(2);
  });
  it('올린 값과 같은 스냅숏이 오면 덧씌우기를 걷는다', () => {
    const { snapshot, text } = committed();
    snapshot({ days: { '13': rec('A\nB', '', 1000, 'pc') } });
    expect(text()).toBe('A\nB');
    snapshot({ days: { '13': rec('A\nB\nC', '', 2000) } });
    expect(text()).toBe('A\nB\nC');
  });
  it('올리기 전의 오래된 스냅숏은 덧씌운 값을 바꾸지 않는다', () => {
    const { snapshot, text } = committed();
    snapshot({ days: { '13': rec('A', '', 1) } });
    expect(text()).toBe('A\nB');
  });
  it('더 늦게 고친 스냅숏이 오면 그 값을 보여 준다', () => {
    const { snapshot, text } = committed();
    snapshot({ days: { '13': rec('Z', '', 5000) } });
    expect(text()).toBe('Z');
  });
  it('맞는 스냅숏이 오지 않으면 10초 뒤에 걷는다', () => {
    const { changed, text } = committed();
    vi.advanceTimersByTime(9999);
    expect(text()).toBe('A\nB');
    vi.advanceTimersByTime(1);
    expect(text()).toBe('A');
    expect(changed).toHaveBeenCalledTimes(3);
  });
  it('지운 날짜는 그 날짜가 없는 스냅숏이 오면 걷는다', () => {
    const { store, snapshot, text } = committed();
    store.noteCommitted('2026-11', { '13': 'delete' });
    expect(text()).toBeUndefined();
    snapshot({ days: { '13': rec('A', '', 1) } });
    expect(text()).toBeUndefined();
    snapshot({ days: {} });
    snapshot({ days: { '13': rec('A', '', 1) } });
    expect(text()).toBe('A');
  });
  it('구독하지 않는 달과 창을 벗어난 달은 덧씌우지 않는다', () => {
    const { store, changed, snapshot, text } = committed();
    expect(() => store.noteCommitted('2031-01', { '01': rec('X') })).not.toThrow();
    expect(store.days('2031-01')).toEqual({});
    expect(changed).toHaveBeenCalledTimes(2);
    store.show('2027-02');
    store.show('2026-11');
    snapshot({ days: { '13': rec('A', '', 1) } });
    expect(text()).toBe('A');
  });
});

it('구독 오류를 달마다 모아 읽기 문제로 알린다', () => {
  const source = fakeSource();
  const store = new CalendarStore({ source, outbox: new Outbox(new MemoryStorage(), 'u1'), editedBy: 'pc', initialMonth: '2026-11' });
  const changed = vi.fn();
  store.onChange(changed);
  expect(store.readProblem()).toBeNull();
  source.errors.get('2026-10')!('unavailable');
  expect(store.readProblem()).toBe('failed');
  expect(changed).toHaveBeenCalledTimes(1);
  source.errors.get('2026-11')!('permission-denied');
  expect(store.readProblem()).toBe('denied');
  expect(changed).toHaveBeenCalledTimes(2);
  source.errors.get('2026-12')!('unauthenticated');
  expect(changed).toHaveBeenCalledTimes(2);
  source.listeners.get('2026-11')!(null);
  source.listeners.get('2026-12')!(null);
  expect(store.readProblem()).toBe('failed');
  source.listeners.get('2026-10')!(null);
  expect(store.readProblem()).toBeNull();
  source.errors.get('2026-10')!('permission-denied');
  store.show('2027-01');
  expect(store.readProblem()).toBeNull();
});
it('더 필요한 달도 구독하고, 구독 중인지 알려 준다', () => {
  const source = fakeSource();
  const store = new CalendarStore({ source, outbox: new Outbox(new MemoryStorage(), 'u1'), editedBy: 'pc', initialMonth: '2026-01' });
  store.show('2026-01', ['2026-03']);
  expect([...source.listeners.keys()].sort()).toEqual(['2025-12', '2026-01', '2026-02', '2026-03']);
  expect(store.covers('2026-03')).toBe(true);
  store.show('2026-01');
  expect(store.covers('2026-03')).toBe(false);
});
