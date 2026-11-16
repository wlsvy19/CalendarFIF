import { expect, it } from 'vitest';
import { buildIco, pngSize } from './ico';
import { CORE_SCALE, appIconSvg, smallIconSvg } from './icon-art';

/** 머리만 있는 가짜 PNG(크기 칸까지). */
function fakePng(width: number, height: number, extra = 0): Uint8Array {
  const png = new Uint8Array(24 + extra);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(png.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return png;
}

it('PNG 머리에서 크기를 읽고, PNG가 아니면 null이다', () => {
  expect(pngSize(fakePng(48, 32))).toEqual({ width: 48, height: 32 });
  expect(pngSize(new Uint8Array(30))).toBeNull();
  expect(pngSize(new Uint8Array(4))).toBeNull();
});

it('.ico: 머리에 개수, 항목마다 크기와 길이와 위치를 적고 PNG를 작은 것부터 이어 붙인다', () => {
  const big = fakePng(256, 256, 10);
  const small = fakePng(16, 16, 3);
  const ico = buildIco([{ size: 256, png: big }, { size: 16, png: small }]);
  const view = new DataView(ico.buffer);
  expect([view.getUint16(0, true), view.getUint16(2, true), view.getUint16(4, true)]).toEqual([0, 1, 2]);
  // 첫 항목: 16px
  expect([ico[6], ico[7], view.getUint16(10, true), view.getUint16(12, true), view.getUint32(14, true), view.getUint32(18, true)]).toEqual([16, 16, 1, 32, small.length, 38]);
  // 둘째 항목: 256px은 0으로 적는다
  expect([ico[22], ico[23], view.getUint32(30, true), view.getUint32(34, true)]).toEqual([0, 0, big.length, 38 + small.length]);
  expect(ico.length).toBe(38 + small.length + big.length);
  expect([...ico.slice(38, 46)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
});

it('.ico: 그림이 없거나, PNG가 아니거나, 적은 크기와 실제 크기가 다르면 던진다', () => {
  expect(() => buildIco([])).toThrow('그림이 없다');
  expect(() => buildIco([{ size: 16, png: new Uint8Array(40) }])).toThrow('PNG가 아니다');
  expect(() => buildIco([{ size: 32, png: fakePng(16, 16) }])).toThrow('실제 크기');
  expect(() => buildIco([{ size: 512, png: fakePng(512, 512) }])).toThrow('실제 크기');
});

it('아이콘 그림: 큰 것은 달력 고리가 있고 불씨가 0.8배이며, 작은 것은 고리 없이 단순하고 불씨를 한 가지 색으로 줄이지 않고 칠한다', () => {
  const full = appIconSvg({ rounded: false });
  const rounded = appIconSvg({ rounded: true });
  const small = smallIconSvg();
  expect(CORE_SCALE).toBe(0.8);
  for (const s of [full, rounded, small]) expect(s.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">')).toBe(true);
  for (const s of [full, rounded]) {
    expect(s).toContain('fill="url(#warm)" transform="translate(50 93) scale(0.8)');
  }
  expect(small).toContain('fill="#FF7A2E" transform="translate(50 93) scale(1.05)');
  // 꽉 찬 네모(아이폰, 웹앱)에는 모서리 깎기가 없고, Windows용에는 있다.
  expect(full).toContain('<rect width="512" height="512" fill="url(#navy)"/>');
  expect(rounded).toContain('<rect width="512" height="512" rx="112" fill="url(#navy)"/>');
  expect((full.match(/rx="15"/g) ?? []).length).toBe(2);
  expect(small).not.toContain('rx="15"');
});
