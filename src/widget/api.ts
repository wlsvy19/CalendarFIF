import { normalizeColor } from '../core/color';
import type { DayValue } from '../core/types';
import type { Host } from './host';

export type Config = {
  projectId: string; apiKey: string; appUrl: string;
  /** 시험과 에뮬레이터용. 기본은 실제 주소다. */
  authBase?: string; // 기본 'https://identitytoolkit.googleapis.com'
  tokenBase?: string; // 기본 'https://securetoken.googleapis.com'
  firestoreBase?: string; // 기본 'https://firestore.googleapis.com'
};
export type Session = { idToken: string; refreshToken: string; uid: string };
export type ApiError = { kind: 'credentials' | 'throttled' | 'rejected' | 'denied' | 'network' | 'failed'; code: string };

const KINDS = ['credentials', 'throttled', 'rejected', 'denied', 'network', 'failed'];
export function isApiError(e: unknown): e is ApiError {
  return typeof e === 'object' && e !== null && KINDS.includes((e as ApiError).kind) && typeof (e as ApiError).code === 'string';
}

const CREDENTIAL_CODES = ['INVALID_LOGIN_CREDENTIALS', 'INVALID_PASSWORD', 'EMAIL_NOT_FOUND', 'INVALID_EMAIL', 'MISSING_PASSWORD', 'USER_DISABLED'];

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

type Answer = { status: number; json: unknown };

/** 요청 하나를 보낸다. 연결이 안 되거나 쓸 수 있는 답이 없으면 network 오류를 던진다. */
async function send(host: Host, url: string, method: string, headers: Record<string, string>, body?: string): Promise<Answer> {
  const req = new host.Request(url);
  req.method = method;
  req.headers = headers;
  if (body !== undefined) req.body = body;
  req.timeoutInterval = 10;
  let json: unknown;
  try {
    json = await req.loadJSON();
  } catch {
    throw { kind: 'network', code: 'network' } satisfies ApiError;
  }
  let status = req.response?.statusCode;
  if (status === undefined) {
    if (!isObject(json)) throw { kind: 'network', code: 'network' } satisfies ApiError;
    status = 'error' in json ? 400 : 200;
  }
  if (status >= 500 || status === 408 || status === 429) throw { kind: 'network', code: String(status) } satisfies ApiError;
  return { status, json };
}

/** 서버가 알려 준 오류 이름. 없으면 HTTP 상태. */
function errorCode(a: Answer): string {
  const error = isObject(a.json) ? a.json.error : undefined;
  if (isObject(error)) return str(error.message) || str(error.status) || String(a.status);
  return String(a.status);
}

const DEAD_TOKEN_CODES = ['TOKEN_EXPIRED', 'USER_DISABLED', 'USER_NOT_FOUND', 'INVALID_REFRESH_TOKEN', 'MISSING_REFRESH_TOKEN'];
const isClientError = (status: number): boolean => status >= 400 && status < 500;

function sessionFrom(json: unknown, keys: { id: string; refresh: string; uid: string }): Session {
  const o = isObject(json) ? json : {};
  const idToken = str(o[keys.id]);
  const refreshToken = str(o[keys.refresh]);
  const uid = str(o[keys.uid]);
  if (idToken === '' || refreshToken === '' || uid === '') throw { kind: 'network', code: 'bad-response' } satisfies ApiError;
  return { idToken, refreshToken, uid };
}

export async function signIn(host: Host, cfg: Config, email: string, password: string): Promise<Session> {
  const base = cfg.authBase ?? 'https://identitytoolkit.googleapis.com';
  const a = await send(host, `${base}/v1/accounts:signInWithPassword?key=${cfg.apiKey}`, 'POST', { 'Content-Type': 'application/json' }, JSON.stringify({ email, password, returnSecureToken: true }));
  if (a.status === 200) return sessionFrom(a.json, { id: 'idToken', refresh: 'refreshToken', uid: 'localId' });
  const code = errorCode(a);
  if (a.status === 400 && CREDENTIAL_CODES.some((c) => code.startsWith(c))) throw { kind: 'credentials', code } satisfies ApiError;
  if (a.status === 400 && code.startsWith('TOO_MANY_ATTEMPTS')) throw { kind: 'throttled', code } satisfies ApiError;
  throw { kind: isClientError(a.status) ? 'rejected' : 'network', code } satisfies ApiError;
}

export async function refreshSession(host: Host, cfg: Config, refreshToken: string): Promise<Session> {
  const base = cfg.tokenBase ?? 'https://securetoken.googleapis.com';
  const a = await send(host, `${base}/v1/token?key=${cfg.apiKey}`, 'POST', { 'Content-Type': 'application/x-www-form-urlencoded' }, `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`);
  if (a.status === 200) return sessionFrom(a.json, { id: 'id_token', refresh: 'refresh_token', uid: 'user_id' });
  const code = errorCode(a);
  if ([400, 401, 403].includes(a.status) && DEAD_TOKEN_CODES.some((c) => code.startsWith(c))) throw { kind: 'rejected', code } satisfies ApiError;
  throw { kind: isClientError(a.status) ? 'failed' : 'network', code } satisfies ApiError;
}

/** 그 달 문서의 날짜들. 문서가 없으면 빈 객체. */
export async function readMonth(host: Host, cfg: Config, session: Session, monthId: string): Promise<Record<string, DayValue>> {
  const base = cfg.firestoreBase ?? 'https://firestore.googleapis.com';
  const url = `${base}/v1/projects/${cfg.projectId}/databases/(default)/documents/users/${encodeURIComponent(session.uid)}/months/${monthId}`;
  const a = await send(host, url, 'GET', { Authorization: `Bearer ${session.idToken}` });
  if (a.status === 200) return parseMonthDocument(a.json);
  if (a.status === 404) return {};
  const code = errorCode(a);
  if (a.status === 403) throw { kind: 'denied', code } satisfies ApiError;
  throw { kind: isClientError(a.status) ? 'failed' : 'network', code } satisfies ApiError;
}

/** Firestore REST 문서(JSON)에서 날짜별 값을 꺼낸다. 모양이 다르면 그 날짜를 건너뛴다. */
export function parseMonthDocument(json: unknown): Record<string, DayValue> {
  const out: Record<string, DayValue> = {};
  const fieldsOf = (v: unknown): Record<string, unknown> | null => {
    if (!isObject(v) || !isObject(v.mapValue) || !isObject(v.mapValue.fields)) return null;
    return v.mapValue.fields;
  };
  const days = isObject(json) && isObject(json.fields) ? fieldsOf(json.fields.days) : null;
  if (!days) return out;
  for (const [key, value] of Object.entries(days)) {
    if (!/^(0[1-9]|[12][0-9]|3[01])$/.test(key)) continue;
    const f = fieldsOf(value);
    if (!f || !isObject(f.text) || typeof f.text.stringValue !== 'string') continue;
    const color = isObject(f.color) ? str(f.color.stringValue) : '';
    out[key] = { text: f.text.stringValue, color: normalizeColor(color) };
  }
  return out;
}
