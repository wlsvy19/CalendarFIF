// Windows 시작 시 실행. 꾸린 앱의 실제 실행에서만(manage) 정한다.
// 첫 실행(저장된 값이 없을 때)에는 켜고 그 선택을 저장한다. 켜 두었는데 시스템에 이 실행 파일로 걸려 있지 않으면
// (폴더를 옮겼거나 다시 꾸렸다) 지금 실행 파일로 다시 건다. 꺼 두었으면 건드리지 않는다.
// system은 시스템이 이 실행 파일을 시작 항목으로 알고 있는지다.
export function startupAction(p: { manage: boolean; saved: boolean | null; system: boolean | null }): { register: boolean | null; save: boolean | null } {
  const none = { register: null, save: null };
  if (!p.manage) return none;
  if (p.saved === null) return { register: true, save: true };
  if (p.saved && p.system === false) return { register: true, save: null };
  return none;
}

// Windows 시작 항목을 거는 함수는 던질 수 있다. 던지면 거짓(적용하지 못함)을 돌려준다.
export function tryLoginItem(set: (openAtLogin: boolean) => void, openAtLogin: boolean): boolean {
  try {
    set(openAtLogin);
    return true;
  } catch {
    return false;
  }
}
