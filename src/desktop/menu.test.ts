import { expect, it } from 'vitest';
import { menuModel, type MenuItemModel, type MenuState } from './menu';

const state: MenuState = { hidden: false, contentHidden: false, alwaysOnTop: false, startWithWindows: true, canStartWithWindows: true };
const labels = (items: MenuItemModel[]) => items.map((i) => ('separator' in i ? '-' : i.label));
it('트레이 메뉴', () => {
  expect(labels(menuModel(state, 'tray'))).toEqual(['캘린더 숨기기', '내용 숨기기', '맨 위에 보기', '-', '위치 및 크기', '설정', 'Windows 시작 시 실행', '-', '제품 정보', '닫기']);
  const items = menuModel({ hidden: true, contentHidden: true, alwaysOnTop: true, startWithWindows: null, canStartWithWindows: false }, 'tray');
  expect(labels(items).slice(0, 2)).toEqual(['캘린더 보이기', '내용 보이기']);
  expect(items[2]).toMatchObject({ action: 'toggleOnTop', checked: true });
  expect(items.find((i) => 'action' in i && i.action === 'toggleStart')).toMatchObject({ checked: false, enabled: false });
});
it('제목 줄 메뉴에는 오늘로와 로그아웃이 더 있다', () => {
  expect(labels(menuModel(state, 'title'))).toEqual(['오늘로', '-', '캘린더 숨기기', '내용 숨기기', '맨 위에 보기', '-', '위치 및 크기', '설정', 'Windows 시작 시 실행', '-', '제품 정보', '로그아웃', '닫기']);
});
