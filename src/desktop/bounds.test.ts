import { expect, it } from 'vitest';
import { applyDrag, clampBounds, defaultBounds, layoutKey, resolveBounds, type DisplayInfo } from './bounds';

const one: DisplayInfo[] = [{ bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1032 }, primary: true }];
const two: DisplayInfo[] = [...one, { bounds: { x: -1920, y: 0, width: 1920, height: 1080 }, workArea: { x: -1920, y: 0, width: 1920, height: 1040 }, primary: false }];
const wa = one.map((d) => d.workArea);
const r = { x: 100, y: 100, width: 800, height: 600 };

it('모니터 구성 문자열과 처음 보는 구성의 기본 자리(주 모니터가 아닌 모니터의 오른쪽, 폭 65%, 높이 96%)', () => {
  expect([layoutKey(one), layoutKey(two), layoutKey([...two].reverse())]).toEqual(['0,0,1920x1080', '-1920,0,1920x1080|0,0,1920x1080', '-1920,0,1920x1080|0,0,1920x1080']);
  expect([defaultBounds(one), defaultBounds(two)]).toEqual([{ x: 652, y: 20, width: 1248, height: 991 }, { x: -1269, y: 21, width: 1248, height: 998 }]);
});
it('화면 밖으로 완전히 나가지 않게 80px을 남기고 위쪽은 넘지 않는다', () => {
  expect([clampBounds(r, wa), clampBounds({ ...r, x: -5000 }, wa), clampBounds({ ...r, y: -300 }, wa), clampBounds({ ...r, y: 5000 }, wa)])
    .toEqual([r, { ...r, x: -720 }, { ...r, y: 0 }, { ...r, y: 952 }]);
  expect(clampBounds({ x: 0, y: 0, width: 3000, height: 100 }, wa)).toEqual({ x: 0, y: 0, width: 1920, height: 240 });
  expect(clampBounds({ ...r, x: -1500, y: 10 }, two.map((d) => d.workArea))).toEqual({ ...r, x: -1500, y: 10 });
});
it('모니터를 빼면 남은 모니터의 기본 자리로, 다시 꽂으면 그 구성의 자리로', () => {
  const saved = { [layoutKey(two)]: { ...r, x: -1500, y: 10 } };
  expect([resolveBounds(saved, two), resolveBounds(saved, one)]).toEqual([{ ...r, x: -1500, y: 10 }, defaultBounds(one)]);
});
it('끌어서 옮기고 가장자리로 크기를 바꾸되 최소 크기를 지킨다', () => {
  expect([applyDrag(r, 'move', 50, -20, wa), applyDrag(r, 'se', 100, 50, wa), applyDrag(r, 'nw', 600, 500, wa), applyDrag(r, 'w', -50, 999, wa), applyDrag(r, 'move', -5000, 0, wa)])
    .toEqual([{ x: 150, y: 80, width: 800, height: 600 }, { x: 100, y: 100, width: 900, height: 650 }, { x: 540, y: 460, width: 360, height: 240 }, { x: 50, y: 100, width: 850, height: 600 }, { ...r, x: -720 }]);
});
it('모니터가 하나도 없으면 자리를 정하지 않고 던지지 않는다', () => {
  expect([defaultBounds([]), resolveBounds({ k: r }, []), clampBounds(r, [])]).toEqual([null, null, r]);
});
it('취소로 돌아갈 자리는 지금 있는 모니터 안으로 들어온다', () => {
  const before = { ...r, x: -1500, y: 10 }; // 빠진 모니터 위의 자리
  expect(clampBounds(before, wa)).toEqual({ ...r, x: -720, y: 10 });
});

// 주인의 배치: 주 모니터(1920x1080) 왼쪽에 더 크고 배율이 다른(1.25) 보조 모니터. DisplayInfo에는 배율이 없고 Electron은 DIP로 알려 주므로
// 픽셀 값(2560x1440)과 1.25배 DIP 값(2048x1152)을 둘 다 본다.
const leftOf = (width: number, height: number, workHeight: number): DisplayInfo[] => [
  ...one,
  { bounds: { x: -width, y: 0, width, height }, workArea: { x: -width, y: 0, width, height: workHeight }, primary: false },
];
const inside = (r: { x: number; y: number; width: number; height: number }, wa: { x: number; y: number; width: number; height: number }) =>
  r.x >= wa.x && r.y >= wa.y && r.x + r.width <= wa.x + wa.width && r.y + r.height <= wa.y + wa.height;
for (const layout of [leftOf(2560, 1440, 1392), leftOf(2048, 1152, 1114)]) {
  const secondary = layout[1].workArea;
  it(`왼쪽의 더 큰 보조 모니터(${secondary.width}x${layout[1].bounds.height}): 기본 자리, 저장한 자리, 모니터를 뺐을 때, 구성 문자열`, () => {
    const placed = defaultBounds(layout)!;
    expect(inside(placed, secondary)).toBe(true);
    const saved = { [layoutKey(layout)]: { x: secondary.x + 300, y: 40, width: 1500, height: 900 } };
    expect(resolveBounds(saved, layout)).toEqual({ x: secondary.x + 300, y: 40, width: 1500, height: 900 });
    expect(inside(resolveBounds(saved, one)!, one[0].workArea)).toBe(true);
    expect(new Set([layoutKey(layout), layoutKey(one), layoutKey(two)]).size).toBe(3);
  });
}
