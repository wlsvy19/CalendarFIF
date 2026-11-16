// 앱 아이콘의 그림(SVG). 2026-11-16에 사용자가 고른 시안: 남색 바탕, 흰 달력, 차가운(파란) 불꽃 속에 따뜻한 불씨.
// FIF는 Flame in Frozen(차가운 불꽃: 머리는 차갑게, 가슴은 뜨겁게)이다. 사용자의 다른 앱 GitFIF(어두운 네모에 파란 불꽃)와
// 헷갈리지 않도록 달력 모양을 넣었다. 불씨는 사용자의 말("조금만 더 작게")대로 처음 시안의 0.8배다.

/** 불꽃(100x100 상자 안). */
const FLAME = 'M52 4 C56 20 78 34 78 60 C78 80 66 96 50 96 C34 96 22 80 22 62 C22 50 28 41 35 33 C36 42 39 47 44 48 C41 33 44 16 52 4 Z';
/** 불꽃 속의 불씨(같은 상자). */
const CORE = 'M50 52 C53 61 64 67 64 78 C64 87 58 93 50 93 C42 93 36 87 36 78 C36 69 46 63 50 52 Z';
/** 불씨의 크기(처음 시안이 1). 바닥 가운데(50, 93)를 붙든 채 줄인다. */
export const CORE_SCALE = 0.8;

const GRADIENTS = `
    <linearGradient id="navy" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1B2A4E"/><stop offset="1" stop-color="#0A1226"/></linearGradient>
    <linearGradient id="head" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4C8DFF"/><stop offset="1" stop-color="#2459E8"/></linearGradient>
    <linearGradient id="cool" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6FD3FF"/><stop offset="1" stop-color="#1F58F5"/></linearGradient>
    <linearGradient id="warm" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFD25E"/><stop offset="1" stop-color="#FF6B3A"/></linearGradient>`;

const flame = (x: number, y: number, scale: number, core = { scale: CORE_SCALE, fill: 'url(#warm)' }): string =>
  `<g transform="translate(${x} ${y}) scale(${scale})"><path d="${FLAME}" fill="url(#cool)"/>` +
  `<path d="${CORE}" fill="${core.fill}" transform="translate(50 93) scale(${core.scale}) translate(-50 -93)"/></g>`;

const svg = (body: string): string => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs>${GRADIENTS}${body}</svg>`;

/**
 * 큰 아이콘(48px 이상). rounded가 false면 네모를 꽉 채운다(아이폰과 웹앱 설치 화면이 스스로 모서리를 깎는다).
 * true면 모서리를 둥글게 깎고 바깥을 비운다(Windows는 깎아 주지 않는다).
 */
export function appIconSvg(opts: { rounded: boolean }): string {
  return svg(`
    <clipPath id="page"><rect x="92" y="112" width="328" height="320" rx="58"/></clipPath>
  </defs>
  <rect width="512" height="512" ${opts.rounded ? 'rx="112" ' : ''}fill="url(#navy)"/>
  <rect x="92" y="112" width="328" height="320" rx="58" fill="#F3F8FF"/>
  <g clip-path="url(#page)"><rect x="92" y="112" width="328" height="84" fill="url(#head)"/></g>
  <rect x="166" y="78" width="30" height="72" rx="15" fill="#DCE9FF"/>
  <rect x="316" y="78" width="30" height="72" rx="15" fill="#DCE9FF"/>
  ${flame(164, 208, 1.86)}`);
}

/**
 * 작은 아이콘(32px 이하: 트레이, 탐색기의 작은 보기). 같은 그림을 단순하게: 고리를 빼고 달력과 불꽃을 키웠다.
 * 큰 그림을 그대로 줄이면 불꽃이 점으로 보인다. 16px에서 가장자리가 번지지 않게 달력의 변을 32의 배수(16px의 한 칸)에 맞췄고,
 * 불씨는 몇 칸 안 되어 파란색과 섞이면 탁해지므로 줄이지 않고 한 가지 색으로 칠한다.
 */
export function smallIconSvg(): string {
  return svg(`
    <clipPath id="page"><rect x="32" y="64" width="448" height="416" rx="64"/></clipPath>
  </defs>
  <rect width="512" height="512" rx="96" fill="url(#navy)"/>
  <rect x="32" y="64" width="448" height="416" rx="64" fill="#F3F8FF"/>
  <g clip-path="url(#page)"><rect x="32" y="64" width="448" height="96" fill="url(#head)"/></g>
  ${flame(112, 172, 2.88, { scale: 1.05, fill: '#FF7A2E' })}`);
}
