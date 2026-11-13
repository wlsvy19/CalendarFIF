const MODIFIERS = ['Ctrl', 'Alt', 'Shift'] as const;
const KEY = /^(?:[A-Z]|[0-9]|F(?:[1-9]|1[0-9]|2[0-4]))$/;

// 전역 단축키를 `Ctrl+Alt+H` 모양으로 적는다. 등록할 수 없거나 쓰면 안 되는 조합은 null이다.
export function normalizeAccelerator(raw: string): string | null {
  const parts = raw.split('+').map((p) => p.trim().toUpperCase());
  const mods = new Set<string>();
  let key: string | null = null;
  for (const part of parts) {
    const mod = MODIFIERS.find((m) => m.toUpperCase() === part);
    if (mod) {
      if (mods.has(mod)) return null;
      mods.add(mod);
    } else if (key === null && KEY.test(part)) {
      key = part;
    } else {
      return null; // 키가 둘이거나, 모르는 이름(Super, Win, Meta 포함)이거나, 빈 칸
    }
  }
  if (key === null || !(mods.has('Ctrl') || mods.has('Alt'))) return null;
  if (mods.has('Alt') && key === 'F4') return null;
  return [...MODIFIERS.filter((m) => mods.has(m)), key].join('+');
}

// 눌린 키(KeyboardEvent)에서 단축키를 만든다. 수식키만 눌렸거나 Windows 키가 섞이면 null이다.
export function acceleratorFromKey(e: { ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean; code: string }): string | null {
  if (e.metaKey) return null;
  const m = /^Key([A-Z])$/.exec(e.code) ?? /^Digit([0-9])$/.exec(e.code) ?? /^(F[0-9]{1,2})$/.exec(e.code);
  if (!m) return null;
  const parts = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', m[1]].filter(Boolean) as string[];
  return normalizeAccelerator(parts.join('+'));
}
