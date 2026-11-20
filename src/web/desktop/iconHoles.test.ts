// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeBridge } from './fakeBridge';
import { holesPath, insideHole, mountIconHoles } from './iconHoles';

describe('PC 앱: 바탕화면 아이콘 자리 뚫기', () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('달력 상자 기준의 evenodd 경로: 바깥 네모와 구멍들, 상자 밖의 구멍은 뺀다', () => {
    const box = { left: 10, top: 20, width: 300, height: 200 };
    expect(holesPath([{ x: 30, y: 40, width: 72, height: 96 }, { x: 900, y: 0, width: 10, height: 10 }], box)).toBe('path(evenodd, "M0 0H300V200H0ZM20 20h72v96h-72Z")');
    expect(holesPath([], box)).toBe('');
  });
  it('구멍 안인지', () => {
    const h = [{ x: 10, y: 10, width: 20, height: 20 }];
    expect([insideHole(h, 10, 10), insideHole(h, 29, 29), insideHole(h, 30, 15), insideHole(h, 5, 15)]).toEqual([true, true, false, false]);
  });

  it('받은 자리로 달력을 뚫고, 구멍 위와 단추가 아닌 달력 위에서는 바탕화면으로 보내라고 알린다. 날짜 칸이면 armed. 막힌 동안은 알리지 않는다', () => {
    const cal = document.createElement('div');
    cal.className = 'calendar';
    cal.innerHTML = '<header><button class="next">다음</button><span class="title">11월</span></header><div class="grid current"><button class="cell" data-key="2026-11-20"><span class="ln">메모</span></button></div>';
    const outside = document.createElement('div');
    document.body.append(cal, outside);
    vi.spyOn(cal, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300, x: 0, y: 0, toJSON() {} } as DOMRect);
    const bridge = new FakeBridge();
    let busy = false;
    const handle = mountIconHoles(bridge, () => cal, () => busy);
    bridge.emitHoles([{ x: 50, y: 60, width: 72, height: 96 }]);
    expect(cal.style.getPropertyValue('clip-path')).toContain('M50 60h72v96h-72Z');
    const move = (el: Element, x = 200, y = 200) => el.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y, bubbles: true }));
    const memo = cal.querySelector('.ln')!;
    move(memo, 60, 70); // 구멍 위: 보내지만 날짜 칸으로 보지 않는다
    move(memo, 61, 71); // 그대로면 다시 알리지 않는다
    move(memo); // 날짜 칸
    move(cal.querySelector('.title')!); // 단추가 아닌 머리
    move(cal.querySelector('.next')!); // 단추는 달력이 받는다
    move(outside); // 달력 밖(다른 화면)
    move(memo);
    busy = true;
    move(memo);
    busy = false;
    move(memo);
    expect(bridge.calls.filter((c) => c[0] === 'setPassThrough')).toEqual([
      ['setPassThrough', true, false],
      ['setPassThrough', true, true],
      ['setPassThrough', true, false],
      ['setPassThrough', false, false],
      ['setPassThrough', true, true],
      ['setPassThrough', false, false],
      ['setPassThrough', true, true],
    ]);
    bridge.emitHoles([]);
    expect(cal.style.getPropertyValue('clip-path')).toBe('');
    handle.destroy();
    expect(bridge.calls.at(-1)).toEqual(['setPassThrough', false, false]);
  });
});
