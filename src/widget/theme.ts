export type Theme = 'light' | 'dark';
export type Palette = {
  surface: string;
  surface2: string;
  ink: string;
  muted: string;
  hairline: string;
  accent: string;
  onAccent: string;
  sun: string;
  sat: string;
};

export const PALETTES: Record<Theme, Palette> = {
  light: { surface: '#FFFFFF', surface2: '#F3F5F8', ink: '#151B26', muted: '#5A6575', hairline: '#DCE1E8', accent: '#2550D0', onAccent: '#FFFFFF', sun: '#D4352C', sat: '#2A5FD6' },
  dark: { surface: '#161B22', surface2: '#1D232C', ink: '#ECEFF4', muted: '#9BA6B5', hairline: '#2A313B', accent: '#8DAEFF', onAccent: '#0D1116', sun: '#FF7F76', sat: '#86ABFF' },
};

const channels = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** '#RRGGBB' 두 색을 섞는다. ratio는 a의 몫(0~1). */
export function mixHex(a: string, b: string, ratio: number): string {
  const ca = channels(a);
  const cb = channels(b);
  const mixed = ca.map((v, i) => Math.round(v * ratio + cb[i] * (1 - ratio)).toString(16).padStart(2, '0'));
  return `#${mixed.join('').toUpperCase()}`;
}

/** 날짜 배경색(RRGGBB, '#' 없음)을 칸 바탕에 깐 색. 밝은 화면 38%, 어두운 화면 45%. */
export function dayBackground(color: string, theme: Theme): string {
  return mixHex(`#${color}`, PALETTES[theme].surface, theme === 'light' ? 0.38 : 0.45);
}
