// Windows 시작 시 실행: 꾸린 앱의 첫 실행(저장된 값이 없을 때)에서만 켜고 그 선택을 저장한다.
export function startupAction(p: { manage: boolean; saved: boolean | null }): { register: boolean | null; save: boolean | null } {
  if (!p.manage || p.saved !== null) return { register: null, save: null };
  return { register: true, save: true };
}
