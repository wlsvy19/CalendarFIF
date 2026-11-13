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
