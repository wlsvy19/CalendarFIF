// Windows 시작 시 실행: 꾸린 앱의 첫 실행(저장된 값이 없을 때)에서만 켜고 그 선택을 저장한다.
export function startupAction(p: { manage: boolean; saved: boolean | null }): { register: boolean | null; save: boolean | null } {
  if (!p.manage || p.saved !== null) return { register: null, save: null };
  return { register: true, save: true };
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
