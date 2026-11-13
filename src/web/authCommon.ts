// 로그인 계정을 다루는 곳(사용자 추가, 비밀번호 변경과 재설정, 허가 문서)이 함께 쓰는 값과 함수.

export const MIN_PASSWORD = 8;

/** 앞뒤 공백을 떼고 소문자로. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** 던져진 값에서 오류 코드를 꺼낸다. */
export function codeOf(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === 'string' && code !== '' ? code : 'unknown';
}
