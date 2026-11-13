import { join } from 'node:path';
import { Menu, Tray, nativeImage, type MenuItemConstructorOptions } from 'electron';
import { menuModel, type MenuAction, type MenuState } from './menu';

// 메뉴 모델을 Electron 메뉴 항목으로 바꾼다. 트레이와 제목 줄 메뉴가 함께 쓴다.
export function buildMenu(state: MenuState, where: 'tray' | 'title', run: (a: MenuAction) => void): Menu {
  const template: MenuItemConstructorOptions[] = menuModel(state, where).map((i) => {
    if ('separator' in i) return { type: 'separator' };
    return { label: i.label, type: i.checked === undefined ? 'normal' : 'checkbox', checked: i.checked, enabled: i.enabled ?? true, click: () => run(i.action) };
  });
  return Menu.buildFromTemplate(template);
}

let tray: Tray | null = null;
let menu: Menu | null = null;

export function createTray(rendererDir: string, state: () => MenuState, run: (a: MenuAction) => void, onLeftClick: () => void): void {
  const icon = nativeImage.createFromPath(join(rendererDir, 'icons', 'icon-192.png')).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('CalendarFIF');
  tray.on('click', onLeftClick);
  refreshTray(state, run);
}

// 상태가 바뀔 때마다 메뉴를 다시 만든다. 오른쪽 클릭은 이 메뉴를 연다.
export function refreshTray(state: () => MenuState, run: (a: MenuAction) => void): void {
  if (!tray || tray.isDestroyed()) return;
  menu = buildMenu(state(), 'tray', run);
  tray.setContextMenu(menu);
}

export const trayMenu = (): Menu | null => (tray && !tray.isDestroyed() ? menu : null);

// 끝날 때 없앤다. 그렇지 않으면 죽은 아이콘이 알림 영역에 남는다.
export function destroyTray(): void {
  if (tray && !tray.isDestroyed()) tray.destroy();
  tray = null;
  menu = null;
}
