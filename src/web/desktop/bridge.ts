import type { CalfifDesktop } from '../../desktop/api';

/** PC 앱의 preload가 내놓은 다리. 브라우저에서는 없으므로 null이다. */
export function getBridge(win: Window = window): CalfifDesktop | null {
  return win.calfifDesktop ?? null;
}
