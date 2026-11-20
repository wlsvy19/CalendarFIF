import { describe, expect, it } from 'vitest';
import { holesIn, iconScreenRects, parseIconGrid, sameHoles } from './holes';

describe('아이콘 자리 뚫기', () => {
  // 이 PC에서 읽은 모양: 목록 창은 왼쪽 모니터부터(-1920, 0), 칸 76x100.
  const grid = { origin: [-1920, 0] as [number, number], spacing: [76, 100] as [number, number], points: [[0, 5], [1920, 5], [76, 105]] as [number, number][] };

  it('아이콘마다 화면 위의 네모(칸에서 2px 안쪽)', () => {
    expect(iconScreenRects(grid)).toEqual([
      { x: -1918, y: 7, width: 72, height: 96 },
      { x: 2, y: 7, width: 72, height: 96 },
      { x: -1842, y: 107, width: 72, height: 96 },
    ]);
  });
  it('칸 크기가 이상하면 뚫지 않는다', () => expect(iconScreenRects({ ...grid, spacing: [0, 0] })).toEqual([]));

  it('창과 겹치는 부분만 창 안의 좌표로, 위에서 아래로', () => {
    const win = { x: -1880, y: 50, width: 400, height: 300 };
    // 첫 아이콘(-1918..-1846, 7..103)은 왼쪽 위가 잘리고, 셋째(-1842..-1770, 107..203)는 다 들어간다. 둘째는 다른 모니터다.
    expect(holesIn(iconScreenRects(grid), win)).toEqual([
      { x: 0, y: 0, width: 34, height: 53 },
      { x: 38, y: 57, width: 72, height: 96 },
    ]);
  });
  it('겹치지 않으면 없다', () => expect(holesIn(iconScreenRects(grid), { x: 500, y: 500, width: 100, height: 100 })).toEqual([]));

  it('같은지', () => {
    const a = [{ x: 1, y: 2, width: 3, height: 4 }];
    expect([sameHoles(a, [{ ...a[0] }]), sameHoles(a, []), sameHoles(a, [{ ...a[0], x: 9 }])]).toEqual([true, false, false]);
  });

  it('iconWorker가 보낸 것의 모양을 본다', () => {
    expect(parseIconGrid(grid)).toEqual(grid);
    expect(parseIconGrid({ ...grid, points: [[1, 'x']] })).toBeNull();
    expect(parseIconGrid({ origin: [0], spacing: [1, 1], points: [] })).toBeNull();
    expect(parseIconGrid(null)).toBeNull();
  });
});
