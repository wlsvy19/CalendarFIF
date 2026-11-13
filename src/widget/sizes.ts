export type Family = 'small' | 'medium' | 'large';
export type Size = { width: number; height: number };

// "짧은 변x긴 변" -> [작은 위젯 한 변, 중간·큰 위젯 가로, 중간 높이, 큰 높이]
const TABLE: Record<string, [number, number, number, number]> = {
  '428x926': [170, 364, 170, 382],
  '430x932': [170, 364, 170, 382],
  '414x896': [169, 360, 169, 379],
  '390x844': [158, 338, 158, 354],
  '393x852': [158, 338, 158, 354],
  '375x812': [155, 329, 155, 345],
  '375x667': [148, 321, 148, 324],
};

/** 화면 크기(pt)에 맞는 위젯 크기. 표에 없는 기기는 비율로 정한다. */
export function widgetSize(screen: Size, family: Family): Size {
  const shorter = Math.min(screen.width, screen.height);
  const longer = Math.max(screen.width, screen.height);
  const row = TABLE[`${shorter}x${longer}`];
  let small: number;
  let wide: number;
  let mediumH: number;
  let largeH: number;
  if (row) {
    [small, wide, mediumH, largeH] = row;
  } else {
    wide = Math.round(shorter * 0.855);
    largeH = Math.round(wide * 1.048);
    mediumH = small = Math.round(wide * 0.467);
  }
  if (family === 'small') return { width: small, height: small };
  if (family === 'medium') return { width: wide, height: mediumH };
  return { width: wide, height: largeH };
}
