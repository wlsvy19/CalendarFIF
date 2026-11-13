import { expect, it } from 'vitest';
import { MemoryStorage } from '../sync/testing';
import { openStorage } from './storage';

it('쓸 수 있는 저장소는 그대로 쓰고 시험한 흔적을 남기지 않는다', () => {
  const local = new MemoryStorage();
  const { store, persistent } = openStorage(() => local);
  expect(persistent).toBe(true);
  expect(store).toBe(local);
  expect(local.data.size).toBe(0);
});
it('저장소를 열 수 없으면 메모리에 둔다', () => {
  const { store, persistent } = openStorage(() => {
    throw new Error('SecurityError');
  });
  expect(persistent).toBe(false);
  store.setItem('k', 'v');
  expect(store.getItem('k')).toBe('v');
  store.removeItem('k');
  expect(store.getItem('k')).toBeNull();
});
it('저장소에 쓸 수 없으면 메모리에 둔다', () => {
  const local = new MemoryStorage();
  local.failWrites = true;
  const { store, persistent } = openStorage(() => local);
  expect(persistent).toBe(false);
  expect(store).not.toBe(local);
  store.setItem('k', 'v');
  expect(store.getItem('k')).toBe('v');
});
