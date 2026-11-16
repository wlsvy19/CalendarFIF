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
  // 트레이용 작은 그림을 쓴다(tray.png와 화면 배율별 tray@1.25x, @1.5x, @2x.png를 Electron이 함께 읽는다).
  // 큰 그림을 16px로 줄이면 불꽃이 뭉개진다. 작은 그림이 없으면 예전처럼 큰 그림을 줄여 쓴다.
  const small = nativeImage.createFromPath(join(rendererDir, 'icons', 'tray.png'));
  const icon = small.isEmpty() ? nativeImage.createFromPath(join(rendererDir, 'icons', 'icon-192.png')).resize({ width: 16, height: 16 }) : small;
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
