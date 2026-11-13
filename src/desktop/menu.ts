export type MenuState = { hidden: boolean; contentHidden: boolean; alwaysOnTop: boolean; startWithWindows: boolean | null; canStartWithWindows: boolean };
export type MenuAction = 'toggleHidden' | 'toggleContent' | 'toggleOnTop' | 'adjust' | 'settings' | 'toggleStart' | 'about' | 'quit' | 'today' | 'signOut';
export type MenuItemModel = { label: string; action: MenuAction; checked?: boolean; enabled?: boolean } | { separator: true };

const SEP: MenuItemModel = { separator: true };

// 트레이 메뉴와 제목 줄 메뉴의 항목. 문구는 설계 9절 그대로다.
export function menuModel(state: MenuState, where: 'tray' | 'title'): MenuItemModel[] {
  const title = where === 'title';
  return [
    ...(title ? [{ label: '오늘로', action: 'today' } as MenuItemModel, SEP] : []),
    { label: state.hidden ? '캘린더 보이기' : '캘린더 숨기기', action: 'toggleHidden' },
    { label: state.contentHidden ? '내용 보이기' : '내용 숨기기', action: 'toggleContent' },
    { label: '맨 위에 보기', action: 'toggleOnTop', checked: state.alwaysOnTop },
    SEP,
    { label: '위치 및 크기', action: 'adjust' },
    { label: '설정', action: 'settings' },
    { label: 'Windows 시작 시 실행', action: 'toggleStart', checked: state.startWithWindows === true, enabled: state.canStartWithWindows },
    SEP,
    { label: '제품 정보', action: 'about' },
    ...(title ? [{ label: '로그아웃', action: 'signOut' } as MenuItemModel] : []),
    { label: '닫기', action: 'quit' },
  ];
}
