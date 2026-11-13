import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  updatePassword,
  type Auth,
} from 'firebase/auth';
import { MIN_PASSWORD, codeOf, normalizeEmail } from './users';

export type PasswordFailure = 'wrong-current' | 'weak' | 'same' | 'network' | 'throttled' | 'unknown';
export type PasswordResult = { ok: true } | { ok: false; reason: PasswordFailure; code: string };
export type PasswordDeps = {
  /** 지금 비밀번호로 다시 확인한다. 실패는 { code }를 던진다. */
  reauthenticate(current: string): Promise<void>;
  update(next: string): Promise<void>;
};

function failure(code: string): PasswordResult {
  const reason: PasswordFailure =
    code === 'auth/invalid-credential' || code === 'auth/wrong-password' ? 'wrong-current'
    : code === 'auth/weak-password' ? 'weak'
    : code === 'auth/too-many-requests' ? 'throttled'
    : code === 'auth/network-request-failed' ? 'network'
    : 'unknown';
  return { ok: false, reason, code };
}

export async function changePassword(deps: PasswordDeps, current: string, next: string): Promise<PasswordResult> {
  if (next.length < MIN_PASSWORD) return { ok: false, reason: 'weak', code: 'weak-password' };
  if (next === current) return { ok: false, reason: 'same', code: 'same-password' };
  try {
    await deps.reauthenticate(current);
    await deps.update(next);
  } catch (e) {
    return failure(codeOf(e));
  }
  return { ok: true };
}

export function passwordMessage(result: PasswordResult): string {
  if (result.ok) return '비밀번호를 바꿨습니다.';
  switch (result.reason) {
    case 'wrong-current': return '지금 비밀번호가 맞지 않습니다.';
    case 'weak': return '새 비밀번호는 8자 이상이어야 합니다.';
    case 'same': return '새 비밀번호가 지금 것과 같습니다.';
    case 'network': return '네트워크에 연결할 수 없습니다.';
    case 'throttled': return '시도가 너무 많습니다. 잠시 뒤 다시 해 주세요.';
    case 'unknown': return `바꾸지 못했습니다. (${result.code})`;
  }
}

/** Firebase Auth에 연결한 PasswordDeps. */
export function firebasePasswordDeps(auth: Auth): PasswordDeps {
  const me = () => {
    const user = auth.currentUser;
    if (!user || !user.email) throw { code: 'auth/no-current-user' };
    return { user, email: user.email };
  };
  return {
    async reauthenticate(current) {
      const { user, email } = me();
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(email, current));
    },
    async update(next) {
      await updatePassword(me().user, next);
    },
  };
}

/** 비밀번호 재설정 메일을 보낸다(한국어 양식). 실패는 { code }를 던진다. */
export async function sendReset(auth: Auth, email: string): Promise<void> {
  auth.languageCode = 'ko';
  try {
    await sendPasswordResetEmail(auth, normalizeEmail(email));
  } catch (e) {
    throw { code: codeOf(e) };
  }
}
