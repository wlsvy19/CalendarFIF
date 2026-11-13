import type { AccessDoc } from './access';

export type UserRow = AccessDoc & { uid: string };
export type UsersSource = {
  watchAll(onRows: (rows: UserRow[]) => void, onError: (code: string) => void): () => void; // 이메일 순
  put(uid: string, doc: AccessDoc): Promise<void>;
  setDisabled(uid: string, disabled: boolean): Promise<void>;
  remove(uid: string): Promise<void>;
};
export type AccountMaker = {
  /** 새 로그인 계정을 만들고 uid를 돌려준다. 지금 로그인은 바뀌지 않는다. 실패는 { code }를 던진다. */
  create(email: string, password: string): Promise<string>;
  /** 이미 있는 계정에 그 비밀번호로 로그인해 uid를 돌려준다. 지금 로그인은 바뀌지 않는다. */
  lookup(email: string, password: string): Promise<string>;
};
export type AddFailure = 'invalid-email' | 'weak-password' | 'exists-wrong-password' | 'network' | 'denied' | 'unknown';
export type AddResult = { ok: true; uid: string; existed: boolean } | { ok: false; reason: AddFailure; code: string };

export const MIN_PASSWORD = 8;

/** 앞뒤 공백을 떼고 소문자로. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** 던져진 값에서 오류 코드를 꺼낸다. */
export function codeOf(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === 'string' && code !== '' ? code : 'unknown';
}

function failure(code: string): AddResult {
  const reason: AddFailure =
    code === 'auth/invalid-email' ? 'invalid-email'
    : code === 'auth/weak-password' ? 'weak-password'
    : code === 'auth/network-request-failed' || code === 'unavailable' ? 'network'
    : code === 'permission-denied' || code === 'auth/admin-restricted-operation' || code === 'auth/operation-not-allowed' ? 'denied'
    : 'unknown';
  return { ok: false, reason, code };
}

const WRONG_PASSWORD_CODES = ['auth/invalid-credential', 'auth/wrong-password', 'auth/user-disabled'];

export async function addUser(
  deps: { accounts: AccountMaker; users: UsersSource; now(): number },
  rawEmail: string,
  password: string,
): Promise<AddResult> {
  const email = normalizeEmail(rawEmail);
  if (!EMAIL_SHAPE.test(email)) return { ok: false, reason: 'invalid-email', code: 'invalid-email' };
  if (password.length < MIN_PASSWORD) return { ok: false, reason: 'weak-password', code: 'weak-password' };

  let uid: string;
  let existed = false;
  try {
    uid = await deps.accounts.create(email, password);
  } catch (e) {
    const code = codeOf(e);
    if (code !== 'auth/email-already-in-use') return failure(code);
    try {
      uid = await deps.accounts.lookup(email, password);
      existed = true;
    } catch (e2) {
      const code2 = codeOf(e2);
      if (WRONG_PASSWORD_CODES.includes(code2)) return { ok: false, reason: 'exists-wrong-password', code: code2 };
      return failure(code2);
    }
  }
  try {
    await deps.users.put(uid, { email, role: 'user', disabled: false, createdAt: deps.now() });
  } catch (e) {
    return failure(codeOf(e));
  }
  return { ok: true, uid, existed };
}

/** 화면에 보일 문구. */
export function addUserMessage(result: AddResult): string {
  if (result.ok) return result.existed ? '이미 있던 계정을 다시 등록했습니다.' : '추가했습니다.';
  switch (result.reason) {
    case 'invalid-email': return '이메일 주소를 확인하세요.';
    case 'weak-password': return '비밀번호는 8자 이상이어야 합니다.';
    case 'exists-wrong-password': return '이미 있는 이메일입니다. 그 계정의 비밀번호를 넣으면 다시 등록합니다.';
    case 'network': return '네트워크에 연결할 수 없습니다.';
    case 'denied': return '권한이 없어 추가하지 못했습니다.';
    case 'unknown': return `추가하지 못했습니다. (${result.code})`;
  }
}
