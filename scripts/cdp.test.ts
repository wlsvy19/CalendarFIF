import { expect, it } from 'vitest';
import { EDGE_PATHS, findEdge } from './cdp';

it('있는 첫 경로를 돌려준다', () => {
  expect(findEdge((p) => p === EDGE_PATHS[1])).toBe(EDGE_PATHS[1]);
  expect(findEdge(() => true)).toBe(EDGE_PATHS[0]);
});
it('하나도 없으면 null이다', () => {
  expect(findEdge(() => false)).toBeNull();
});
