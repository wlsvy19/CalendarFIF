import { PALETTE } from '../../core/color';
import type { Point } from '../../desktop/api';

const EDGE_PX = 4;

/** 오른쪽·아래가 넘치면 창 끝에서 4px 안쪽으로 당기되, 4px보다 작게 하지 않는다. */
export function menuPosition(at: Point, size: { width: number; height: number }, view: { width: number; height: number }): Point {
  const pull = (pos: number, extent: number, limit: number): number => Math.max(EDGE_PX, Math.min(pos, limit - EDGE_PX - extent));
  return { x: pull(at.x, size.width, view.width), y: pull(at.y, size.height, view.height) };
}

export type CellMenuProps = { dateKey: string; at: Point; onEdit(): void; onColor(color: string): void; onToday(): void; onClose(): void };

/** 날짜 칸을 오른쪽 클릭하면 뜨는 메뉴. 편집, 배경색, 오늘로. Esc, 바깥 누르기, 창이 포커스를 잃으면 닫힌다. */
export function mountCellMenu(root: HTMLElement, props: CellMenuProps): { destroy(): void } {
  const menu = document.createElement('div');
  menu.className = 'cellmenu';
  menu.setAttribute('role', 'menu');
  menu.dataset.key = props.dateKey;
  const item = (action: string, label: string, run: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cellmenu-item';
    b.setAttribute('role', 'menuitem');
    b.dataset.action = action;
    b.textContent = label;
    b.addEventListener('click', run);
    return b;
  };
  const swatches = document.createElement('div');
  swatches.className = 'cellmenu-swatches';
  swatches.hidden = true;
  for (const c of ['', ...PALETTE]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = c === '' ? 'swatch none' : 'swatch';
    b.dataset.color = c;
    b.setAttribute('aria-label', c === '' ? '없음' : `#${c}`);
    b.title = c === '' ? '없음' : `#${c}`;
    if (c !== '') b.style.setProperty('--sw', `#${c}`);
    b.addEventListener('click', () => {
      props.onColor(c);
      props.onClose();
    });
    swatches.append(b);
  }
  const place = (): void => {
    const rect = menu.getBoundingClientRect();
    const pos = menuPosition(props.at, { width: rect.width, height: rect.height }, { width: window.innerWidth, height: window.innerHeight });
    menu.style.left = `${pos.x}px`;
    menu.style.top = `${pos.y}px`;
  };
  menu.append(
    item('edit', '편집', () => {
      props.onEdit();
      props.onClose();
    }),
    item('color', '배경색', () => {
      swatches.hidden = !swatches.hidden;
      place();
    }),
    swatches,
    item('today', '오늘로', () => {
      props.onToday();
      props.onClose();
    }),
  );

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') props.onClose();
  };
  const onPointer = (e: Event): void => {
    if (!menu.contains(e.target as Node)) props.onClose();
  };
  // 다른 창으로 옮겨 가면(창이 포커스를 잃으면) 닫는다.
  const onBlur = (): void => props.onClose();
  document.addEventListener('keydown', onKey);
  document.addEventListener('pointerdown', onPointer, true);
  window.addEventListener('blur', onBlur);
  root.append(menu);
  place();
  menu.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });

  return {
    destroy() {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('blur', onBlur);
      menu.remove();
    },
  };
}
