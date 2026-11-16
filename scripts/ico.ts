// Windows 아이콘 파일(.ico)을 만든다. 크기마다 PNG를 그대로 담는다(Windows Vista 이상이 읽는다).

export type IcoImage = { size: number; png: Uint8Array };

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** PNG 머리에서 가로, 세로를 읽는다. PNG가 아니면 null. */
export function pngSize(png: Uint8Array): { width: number; height: number } | null {
  if (png.length < 24 || PNG_MAGIC.some((b, i) => png[i] !== b)) return null;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/**
 * 여러 크기의 PNG를 .ico 하나로 묶는다. 크기는 1~256의 정사각형이고, PNG의 실제 크기와 같아야 한다(다르면 던진다).
 * 작은 것부터 담는다.
 */
export function buildIco(images: IcoImage[]): Uint8Array {
  if (images.length === 0) throw new Error('아이콘에 담을 그림이 없다');
  const sorted = [...images].sort((a, b) => a.size - b.size);
  for (const { size, png } of sorted) {
    const real = pngSize(png);
    if (!real) throw new Error(`${size}px 그림이 PNG가 아니다`);
    if (size < 1 || size > 256 || real.width !== size || real.height !== size) throw new Error(`${size}px 그림의 실제 크기가 ${real.width}x${real.height}다`);
  }
  const HEADER = 6;
  const ENTRY = 16;
  const total = HEADER + ENTRY * sorted.length + sorted.reduce((n, i) => n + i.png.length, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint16(0, 0, true); // 예약
  view.setUint16(2, 1, true); // 1 = 아이콘
  view.setUint16(4, sorted.length, true);
  let offset = HEADER + ENTRY * sorted.length;
  sorted.forEach(({ size, png }, i) => {
    const at = HEADER + ENTRY * i;
    out[at] = size === 256 ? 0 : size; // 0은 256을 뜻한다
    out[at + 1] = size === 256 ? 0 : size;
    out[at + 2] = 0; // 팔레트 없음
    out[at + 3] = 0;
    view.setUint16(at + 4, 1, true); // 색 평면
    view.setUint16(at + 6, 32, true); // 픽셀당 비트
    view.setUint32(at + 8, png.length, true);
    view.setUint32(at + 12, offset, true);
    out.set(png, offset);
    offset += png.length;
  });
  return out;
}
