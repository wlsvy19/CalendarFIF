import { normalizeColor } from '../core/color';
import { parseEventMap, type EventMap } from '../core/events';
import { parsePushDoc, type PushDoc } from '../push/doc';
import type { DayValue } from '../core/types';
import type { Host } from './host';

export type Config = {
  projectId: string; apiKey: string; appUrl: string;
  /** 시험과 에뮬레이터용. 기본은 실제 주소다. */
  authBase?: string; // 기본 'https://identitytoolkit.googleapis.com'
  tokenBase?: string; // 기본 'https://securetoken.googleapis.com'
  firestoreBase?: string; // 기본 'https://firestore.googleapis.com'
  /** 스크립트의 버전과 만든 날짜(예: '0.4.0 (2026-11-14)'). 앱의 메뉴 제목과 오류 줄에 보인다. */
  version?: string;
  /** 붙여 넣은 스크립트가 받아 둔 새 코드에 실행을 넘겼다(update.ts). 넘겨받은 쪽은 다시 넘기지 않는다. */
  handedOver?: boolean;
  /** 넘겨받았을 때, 붙여 넣은 스크립트의 버전. */
  baseVersion?: string;
  /** 공휴일 자료 파일(holidays.json)의 주소. 비었으면 받지 않고 계산한 공휴일(과 받아 둔 것)만 쓴다. */
  holidayUrl?: string;
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

/** 서버에서 읽은 달: 날짜별 값과 날짜별 고친 시각(ms, 읽지 못한 날은 없다). */
export type MonthRead = { days: Record<string, DayValue>; times: Record<string, number> };

/** 그 달 문서의 날짜들. 문서가 없으면 빈 객체. */
export async function readMonth(host: Host, cfg: Config, session: Session, monthId: string): Promise<Record<string, DayValue>> {
  return (await readMonthDoc(host, cfg, session, monthId)).days;
}

/** 그 달 문서의 날짜들과 날짜별 고친 시각. 문서가 없으면 둘 다 빈 객체. */
export async function readMonthDoc(host: Host, cfg: Config, session: Session, monthId: string): Promise<MonthRead> {
  const base = cfg.firestoreBase ?? 'https://firestore.googleapis.com';
  const url = `${base}/v1/projects/${cfg.projectId}/databases/(default)/documents/users/${encodeURIComponent(session.uid)}/months/${monthId}`;
  const a = await send(host, url, 'GET', { Authorization: `Bearer ${session.idToken}` });
  if (a.status === 200) return { days: parseMonthDocument(a.json), times: parseMonthTimes(a.json) };
  if (a.status === 404) return { days: {}, times: {} };
  const code = errorCode(a);
  if (a.status === 403) throw { kind: 'denied', code } satisfies ApiError;
  throw { kind: isClientError(a.status) ? 'failed' : 'network', code } satisfies ApiError;
}

/** Firestore REST 문서(JSON)에서 날짜별 고친 시각(editedAt, ms)을 꺼낸다. 읽지 못한 날은 넣지 않는다. */
export function parseMonthTimes(json: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  const fieldsOf = (v: unknown): Record<string, unknown> | null => {
    if (!isObject(v) || !isObject(v.mapValue) || !isObject(v.mapValue.fields)) return null;
    return v.mapValue.fields;
  };
  const days = isObject(json) && isObject(json.fields) ? fieldsOf(json.fields.days) : null;
  if (!days) return out;
  for (const [key, value] of Object.entries(days)) {
    if (!/^(0[1-9]|[12][0-9]|3[01])$/.test(key)) continue;
    const at = fieldsOf(value)?.editedAt;
    if (!isObject(at)) continue;
    // Firestore는 정수를 글로, 소수를 숫자로 준다.
    const n = typeof at.integerValue === 'string' || typeof at.integerValue === 'number' ? Number(at.integerValue) : typeof at.doubleValue === 'number' ? at.doubleValue : NaN;
    if (Number.isFinite(n) && n > 0) out[key] = n;
  }
  return out;
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

/** 알림 문서(users/{uid}/data/events)의 항목들. 문서가 없으면 빈 객체. */
export async function readEvents(host: Host, cfg: Config, session: Session): Promise<EventMap> {
  const base = cfg.firestoreBase ?? 'https://firestore.googleapis.com';
  const url = `${base}/v1/projects/${cfg.projectId}/databases/(default)/documents/users/${encodeURIComponent(session.uid)}/data/events`;
  const a = await send(host, url, 'GET', { Authorization: `Bearer ${session.idToken}` });
  if (a.status === 200) return parseEventsDocument(a.json);
  if (a.status === 404) return {};
  const code = errorCode(a);
  if (a.status === 403) throw { kind: 'denied', code } satisfies ApiError;
  throw { kind: isClientError(a.status) ? 'failed' : 'network', code } satisfies ApiError;
}

/** 푸시 알림 문서(users/{uid}/data/push). 문서가 없으면 빈 문서. */
export async function readPushDoc(host: Host, cfg: Config, session: Session): Promise<PushDoc> {
  const base = cfg.firestoreBase ?? 'https://firestore.googleapis.com';
  const url = `${base}/v1/projects/${cfg.projectId}/databases/(default)/documents/users/${encodeURIComponent(session.uid)}/data/push`;
  const a = await send(host, url, 'GET', { Authorization: `Bearer ${session.idToken}` });
  if (a.status === 404) return parsePushDoc({});
  if (a.status === 200) {
    const fields = isObject(a.json) && isObject(a.json.fields) ? a.json.fields : {};
    return parsePushDoc(decodeValue({ mapValue: { fields } }));
  }
  const code = errorCode(a);
  if (a.status === 403) throw { kind: 'denied', code } satisfies ApiError;
  throw { kind: isClientError(a.status) ? 'failed' : 'network', code } satisfies ApiError;
}

/** Firestore REST의 값 하나를 보통 값으로 푼다. 모르는 모양은 undefined. */
export function decodeValue(v: unknown): unknown {
  if (!isObject(v)) return undefined;
  if (typeof v.stringValue === 'string') return v.stringValue;
  if (typeof v.booleanValue === 'boolean') return v.booleanValue;
  if ('nullValue' in v) return null;
  if (typeof v.integerValue === 'string' || typeof v.integerValue === 'number') return Number(v.integerValue);
  if (typeof v.doubleValue === 'number') return v.doubleValue;
  if (typeof v.timestampValue === 'string') return v.timestampValue;
  if (isObject(v.arrayValue)) return (Array.isArray(v.arrayValue.values) ? v.arrayValue.values : []).map(decodeValue);
  if (isObject(v.mapValue)) {
    const out: Record<string, unknown> = {};
    const fields = isObject(v.mapValue.fields) ? v.mapValue.fields : {};
    for (const [k, f] of Object.entries(fields)) out[k] = decodeValue(f);
    return out;
  }
  return undefined;
}

/** 알림 문서의 REST 값을 풀어 항목들을 만든다. 틀린 항목은 버린다. */
export function parseEventsDocument(doc: unknown): EventMap {
  if (!isObject(doc) || !isObject(doc.fields)) return {};
  return parseEventMap(decodeValue(doc.fields.items));
}
