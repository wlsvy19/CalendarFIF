import { expect, it } from 'vitest';
import { Outbox } from './outbox';
import { MemoryStorage, edit } from './testing';

const KEY = 'calfif.outbox.u1';

it('같은 날짜의 편집은 base를 두고 next와 editedAt만 바꾼다', () => {
  const o = new Outbox(new MemoryStorage(), 'u1');
  o.put(edit('2026-11', '13', 'A', 'A\nB', 100));
  o.put(edit('2026-11', '13', 'A\nB', 'A\nB\nC', 200));
  expect(o.list()).toEqual([edit('2026-11', '13', 'A', 'A\nB\nC', 200)]);
});
it('대기 중인 편집 위에서 고친 것이 아니면 따로 넣는다', () => {
  const o = new Outbox(new MemoryStorage(), 'u1');
  o.put(edit('2026-11', '13', 'A', 'A\nX', 100));
  o.put(edit('2026-11', '13', 'A', 'A\nY', 200));
  expect(o.list()).toEqual([edit('2026-11', '13', 'A', 'A\nX', 100), edit('2026-11', '13', 'A', 'A\nY', 200)]);
});
it('같은 날짜의 마지막 항목 위에서 고친 것만 합친다', () => {
  const o = new Outbox(new MemoryStorage(), 'u1');
  o.put(edit('2026-11', '13', 'A', 'A\nX', 100));
  o.put(edit('2026-11', '13', 'A', 'A\nY', 200));
  o.put(edit('2026-11', '13', 'A\nY', 'A\nY\nZ', 300));
  expect(o.list()).toEqual([edit('2026-11', '13', 'A', 'A\nX', 100), edit('2026-11', '13', 'A', 'A\nY\nZ', 300)]);
});
it('base로 되돌린 편집은 대기열에서 빠진다', () => {
  const o = new Outbox(new MemoryStorage(), 'u1');
  o.put(edit('2026-11', '13', 'A', 'B', 100));
  o.put(edit('2026-11', '13', 'B', 'A', 200));
  expect(o.list()).toEqual([]);
});
it('탭 두 개가 같은 저장소를 써도 서로의 편집을 지우지 않는다', () => {
  const s = new MemoryStorage();
  const a = new Outbox(s, 'u1');
  const b = new Outbox(s, 'u1');
  a.put(edit('2026-11', '13', '', 'X'));
  b.put(edit('2026-11', '14', '', 'Y'));
  expect(a.list().map((e) => e.day)).toEqual(['13', '14']);
});
it('보낸 뒤 바뀌지 않은 편집만 지운다', () => {
  const o = new Outbox(new MemoryStorage(), 'u1');
  const sent = o.put(edit('2026-11', '13', 'A', 'B', 100));
  o.put(edit('2026-11', '13', 'B', 'C', 200));
  o.remove(sent);
  expect(o.list()).toEqual([edit('2026-11', '13', 'A', 'C', 200)]);
});
it('깨진 내용은 따로 보관하고 빈 대기열로 시작한다', () => {
  const s = new MemoryStorage();
  s.setItem(KEY, '{oops');
  const o = new Outbox(s, 'u1');
  expect(o.list()).toEqual([]);
  expect(o.corruptDetected).toBe(true);
  expect([...s.data].some(([k, value]) => k.startsWith(`${KEY}.corrupt.`) && value === '{oops')).toBe(true);
});
it('저장소에 쓸 수 없으면 메모리에 두고 알린다', () => {
  const s = new MemoryStorage();
  s.failWrites = true;
  const o = new Outbox(s, 'u1');
  o.put(edit('2026-11', '13', '', 'X'));
  expect(o.list()).toHaveLength(1);
  expect(o.persistent).toBe(false);
});
it('보낸 항목 뒤의 편집은 자기 base로 따로 쌓인다', () => {
  const o = new Outbox(new MemoryStorage(), 'u1');
  o.put(edit('2026-11', '13', 'A\nB', 'A', 100));
  o.markSent('2026-11');
  o.put(edit('2026-11', '13', 'A', 'A\nB', 200));
  expect(o.list()).toEqual([{ ...edit('2026-11', '13', 'A\nB', 'A', 100), sent: true }, edit('2026-11', '13', 'A', 'A\nB', 200)]);
});
it('markSent는 같은 저장소의 다른 Outbox에도 보인다', () => {
  const s = new MemoryStorage();
  const a = new Outbox(s, 'u1');
  const b = new Outbox(s, 'u1');
  a.put(edit('2026-11', '13', '', 'X'));
  a.put(edit('2026-12', '01', '', 'Y'));
  expect(a.markSent('2026-11').map((e) => e.day)).toEqual(['13']);
  expect(b.list().map((e) => e.sent)).toEqual([true, undefined]);
});
it('remove는 보낸 표시가 없는 같은 항목은 지우지 않는다', () => {
  const o = new Outbox(new MemoryStorage(), 'u1');
  o.put(edit('2026-11', '13', 'A\nB', 'A', 100));
  const sent = o.markSent('2026-11');
  o.put(edit('2026-11', '13', 'A', 'A\nB', 100));
  o.remove(sent);
  expect(o.list()).toEqual([edit('2026-11', '13', 'A', 'A\nB', 100)]);
});
it.each([['[null]'], ['[{"monthId":"2026-11"}]']])('항목이 올바르지 않은 %s는 따로 보관하고 빈 대기열로 시작한다', (raw) => {
  const s = new MemoryStorage();
  s.setItem(KEY, raw);
  const o = new Outbox(s, 'u1');
  expect(o.list()).toEqual([]);
  expect([...s.data].some(([k, value]) => k.startsWith(`${KEY}.corrupt.`) && value === raw)).toBe(true);
});
it('깨진 내용은 만들자마자 알린다', () => {
  const s = new MemoryStorage();
  s.setItem(KEY, '{oops');
  expect(new Outbox(s, 'u1').corruptDetected).toBe(true);
});
