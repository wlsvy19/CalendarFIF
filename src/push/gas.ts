import { parseEventsDocument, decodeValue } from '../widget/api';
import { parsePushDoc, type PushDoc } from './doc';
import { fcmMessage, planSends, type Outgoing, type UserData } from './plan';

// 알림 보내는 스크립트: 사용자의 Google Apps Script에서 1분마다 돈다(시간 기반 트리거).
// Firestore의 알림 문서와 푸시 문서를 서비스 계정으로 읽고, 시각이 된 알림을 FCM으로 아이폰에 보낸다.
// Apps Script의 전역들은 GasHost로 받아서 시험에서는 가짜를 넘긴다.

export type GasResponse = { getResponseCode(): number; getContentText(): string };
export type GasRequest = { url: string; method?: string; contentType?: string; headers?: Record<string, string>; payload?: unknown; muteHttpExceptions?: boolean };
export type GasHost = {
  UrlFetchApp: {
    fetch(url: string, params?: Omit<GasRequest, 'url'>): GasResponse;
    fetchAll(requests: GasRequest[]): GasResponse[];
  };
  PropertiesService: { getScriptProperties(): { getProperty(key: string): string | null; setProperty(key: string, value: string): unknown } };
  CacheService: { getScriptCache(): { get(key: string): string | null; put(key: string, value: string, seconds: number): void; remove(key: string): void } };
  LockService: { getScriptLock(): { tryLock(ms: number): boolean; releaseLock(): void } };
  Utilities: {
    computeRsaSha256Signature(input: string, key: string): number[];
    base64EncodeWebSafe(data: string | number[]): string;
    sleep(ms: number): void;
  };
  ScriptApp: {
    getProjectTriggers(): Array<{ getHandlerFunction(): string }>;
    deleteTrigger(trigger: unknown): void;
    newTrigger(name: string): { timeBased(): { everyMinutes(n: number): { create(): unknown } } };
  };
  Session: { getScriptTimeZone(): string };
  Logger: { log(message: string): void };
  now(): number;
};

export const TIME_ZONE = 'Asia/Seoul';
export const KEY_PROPERTY = 'SERVICE_ACCOUNT';
const START_PROPERTY = 'startedAt';
const SENT_PROPERTY = 'sent';
const TOKEN_CACHE = 'calfif.token';
const USERS_CACHE = 'calfif.users';
const SCOPES = 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/firebase.messaging';
/** 이번 실행이 맡는 앞쪽: 다음 실행(1분 뒤) 전에 울릴 것은 그 시각까지 기다렸다 보낸다. */
export const LOOKAHEAD_MS = 60_000;
/** 실행이 멈췄다 다시 돌면 이만큼 지난 것까지만 보낸다(오래된 알림을 한꺼번에 울리지 않는다). */
export const CATCH_UP_MS = 10 * 60_000;
/** 이보다 오래 확인을 적지 않았으면 sender.at을 새로 적는다(웹앱이 보내는 쪽이 살아 있는지 본다). */
export const HEARTBEAT_MS = 5 * 60_000;
/** 이보다 먼저 울릴 것만 이번 실행에서 기다렸다 보낸다. 나머지는 다음 실행(1분 뒤)이 맡는다. 기다리는 시간도 Apps Script의 하루 실행 시간(90분)에 들어가서다. */
export const SLEEP_MAX_MS = 30_000;
/** 맡았지만 끝내지 못한 것(실행이 도중에 죽었다)은 이만큼 지나면 다시 맡을 수 있다. */
export const CLAIM_TTL_MS = 3 * 60_000;
/** 스크립트 속성 값 하나의 한도(9KB)보다 조금 작게. 넘으면 오래된 기록부터 버린다. */
const SENT_MAX_CHARS = 8_500;
const USERS_TTL_S = 600;
const TOKEN_TTL_S = 3000;

export class SenderError extends Error {}

type ServiceAccount = { project_id: string; client_email: string; private_key: string; token_uri: string };
type Ctx = { host: GasHost; sa: ServiceAccount; token: string };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** 스크립트 속성 SERVICE_ACCOUNT의 서비스 계정 키(JSON). 없거나 틀렸으면 고칠 방법을 담아 던진다. */
export function readServiceAccount(host: GasHost): ServiceAccount {
  const raw = host.PropertiesService.getScriptProperties().getProperty(KEY_PROPERTY);
  if (!raw) throw new SenderError(`스크립트 속성 ${KEY_PROPERTY}가 없습니다. 프로젝트 설정 → 스크립트 속성에 서비스 계정 키(JSON 파일 내용 전체)를 넣으세요.`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new SenderError(`스크립트 속성 ${KEY_PROPERTY}의 값이 JSON이 아닙니다. 내려받은 키 파일의 내용을 처음({)부터 끝(})까지 모두 넣으세요.`);
  }
  const o = isObject(parsed) ? parsed : {};
  const sa = {
    project_id: typeof o.project_id === 'string' ? o.project_id : '',
    client_email: typeof o.client_email === 'string' ? o.client_email : '',
    private_key: typeof o.private_key === 'string' ? o.private_key : '',
    token_uri: typeof o.token_uri === 'string' && o.token_uri.startsWith('https://') ? o.token_uri : 'https://oauth2.googleapis.com/token',
  };
  if (!sa.project_id || !sa.client_email || !sa.private_key.includes('PRIVATE KEY')) {
    throw new SenderError(`스크립트 속성 ${KEY_PROPERTY}에 서비스 계정 키가 아닌 것이 들어 있습니다. Firebase 콘솔 → 프로젝트 설정 → 서비스 계정 → "새 비공개 키 생성"으로 받은 파일의 내용을 넣으세요.`);
  }
  return sa;
}

const b64 = (host: GasHost, s: string | number[]): string => host.Utilities.base64EncodeWebSafe(s).replace(/=+$/, '');

/** 서비스 계정으로 접근 토큰을 받는다. 50분 동안 캐시에 둔다. */
export function accessToken(host: GasHost, sa: ServiceAccount): string {
  const cache = host.CacheService.getScriptCache();
  const cached = cache.get(TOKEN_CACHE);
  if (cached) return cached;
  const iat = Math.floor(host.now() / 1000);
  const input = `${b64(host, JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64(host, JSON.stringify({ iss: sa.client_email, scope: SCOPES, aud: sa.token_uri, iat, exp: iat + 3600 }))}`;
  let signature: string;
  try {
    signature = b64(host, host.Utilities.computeRsaSha256Signature(input, sa.private_key));
  } catch (e) {
    throw new SenderError(`서비스 계정 키로 서명하지 못했습니다. 키를 다시 넣으세요. (${e instanceof Error ? e.message : String(e)})`);
  }
  const res = host.UrlFetchApp.fetch(sa.token_uri, {
    method: 'post',
    payload: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${input}.${signature}` },
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  let token = '';
  try {
    const json: unknown = JSON.parse(res.getContentText());
    if (isObject(json) && typeof json.access_token === 'string') token = json.access_token;
  } catch {
    token = '';
  }
  if (code !== 200 || token === '') throw new SenderError(`서비스 계정으로 로그인하지 못했습니다(${code}). 키가 지워졌거나 틀렸을 수 있습니다: ${res.getContentText().slice(0, 300)}`);
  cache.put(TOKEN_CACHE, token, TOKEN_TTL_S);
  return token;
}

const docsBase = (sa: ServiceAccount): string => `https://firestore.googleapis.com/v1/projects/${sa.project_id}/databases/(default)/documents`;
const docName = (sa: ServiceAccount, path: string): string => `projects/${sa.project_id}/databases/(default)/documents/${path}`;
const auth = (ctx: Ctx): Record<string, string> => ({ Authorization: `Bearer ${ctx.token}` });

/** 토큰이 거절되면(401) 캐시에서 지워 다음 실행이 새로 받게 한다. */
function dropTokenOn401(ctx: Ctx, code: number): void {
  if (code !== 401) return;
  try {
    ctx.host.CacheService.getScriptCache().remove(TOKEN_CACHE);
  } catch {
    // 50분 뒤에는 저절로 지워진다.
  }
}

function failText(what: string, res: GasResponse): string {
  return `${what}(${res.getResponseCode()}): ${res.getContentText().slice(0, 300)}`;
}

/** 달력을 가진 사람들(users 아래에 문서가 있는 계정). 10분 동안 캐시에 둔다. */
export function listUsers(ctx: Ctx): string[] {
  const cache = ctx.host.CacheService.getScriptCache();
  const cached = cache.get(USERS_CACHE);
  if (cached) {
    try {
      const list: unknown = JSON.parse(cached);
      if (Array.isArray(list) && list.every((x) => typeof x === 'string')) return list as string[];
    } catch {
      // 다시 읽는다.
    }
  }
  const uids: string[] = [];
  let pageToken = '';
  for (let page = 0; page < 10; page += 1) {
    // showMissing: users/{uid} 문서 자체는 없고 아래 문서만 있는 계정도 나온다.
    const url = `${docsBase(ctx.sa)}/users?showMissing=true&pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const res = ctx.host.UrlFetchApp.fetch(url, { method: 'get', headers: auth(ctx), muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) {
      dropTokenOn401(ctx, res.getResponseCode());
      throw new SenderError(failText('사용자 목록을 읽지 못했습니다', res));
    }
    const json: unknown = JSON.parse(res.getContentText() || '{}');
    const docs = isObject(json) && Array.isArray(json.documents) ? json.documents : [];
    for (const d of docs) {
      const name = isObject(d) && typeof d.name === 'string' ? d.name : '';
      const uid = name.split('/').pop() ?? '';
      if (/^[A-Za-z0-9_-]{1,128}$/.test(uid)) uids.push(uid);
    }
    pageToken = isObject(json) && typeof json.nextPageToken === 'string' ? json.nextPageToken : '';
    if (!pageToken) break;
  }
  cache.put(USERS_CACHE, JSON.stringify(uids), USERS_TTL_S);
  return uids;
}

/** exists: 푸시 문서가 있다(없으면 상태를 적지 않는다). pushUpdateTime: 읽은 푸시 문서의 때(기기를 지울 때 그 사이에 바뀌지 않았는지 본다). */
export type SenderUser = UserData & { exists: boolean; pushUpdateTime: string };

/** 사람마다 알림 문서와 푸시 문서를 한 번에 읽는다. */
export function readUsers(ctx: Ctx, uids: string[]): SenderUser[] {
  if (uids.length === 0) return [];
  const names = uids.flatMap((uid) => [docName(ctx.sa, `users/${uid}/data/events`), docName(ctx.sa, `users/${uid}/data/push`)]);
  const res = ctx.host.UrlFetchApp.fetch(`${docsBase(ctx.sa)}:batchGet`, {
    method: 'post',
    contentType: 'application/json',
    headers: auth(ctx),
    payload: JSON.stringify({ documents: names }),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) {
    dropTokenOn401(ctx, res.getResponseCode());
    throw new SenderError(failText('알림 문서를 읽지 못했습니다', res));
  }
  const json: unknown = JSON.parse(res.getContentText() || '[]');
  const found = new Map<string, Record<string, unknown>>();
  for (const r of Array.isArray(json) ? json : []) {
    if (isObject(r) && isObject(r.found) && typeof r.found.name === 'string') found.set(r.found.name, r.found);
  }
  return uids.map((uid) => {
    const events = found.get(docName(ctx.sa, `users/${uid}/data/events`));
    const push = found.get(docName(ctx.sa, `users/${uid}/data/push`));
    const pushFields = push && isObject(push.fields) ? push.fields : null;
    return {
      uid,
      events: events ? parseEventsDocument(events) : {},
      push: parsePushDoc(pushFields ? decodeValue({ mapValue: { fields: pushFields } }) : {}),
      exists: push !== undefined,
      pushUpdateTime: push && typeof push.updateTime === 'string' ? push.updateTime : '',
    };
  });
}

export type SendResult = 'ok' | 'dead' | 'auth' | 'error';

/** FCM의 답을 가른다. dead: 그 기기의 토큰이 더는 쓸 수 없다(지운다). auth: 보내는 권한 문제. */
export function classify(code: number, text: string): SendResult {
  if (code === 200) return 'ok';
  if (code === 404 || /UNREGISTERED|SENDER_ID_MISMATCH/.test(text)) return 'dead';
  if (code === 400 && /registration token|INVALID_ARGUMENT/i.test(text) && !/message\.webpush|Invalid JSON/i.test(text)) return 'dead';
  if (code === 401 || code === 403) return 'auth';
  return 'error';
}

function fcmRequest(ctx: Ctx, body: unknown): GasRequest {
  return {
    url: `https://fcm.googleapis.com/v1/projects/${ctx.sa.project_id}/messages:send`,
    method: 'post',
    contentType: 'application/json',
    headers: auth(ctx),
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  };
}

/** 보낸 것을 기억하는 이름: 사람, 기기, 알림, 울릴 때(초, 36진수). 시각을 고친 알림은 새 이름이라 새 시각에 다시 보낸다. 짧게 줄여 스크립트 속성 한도 안에 둔다. */
export const sendKey = (s: Outgoing): string => `${s.uid.slice(0, 12)}|${s.deviceId.slice(0, 8)}|${s.tag}|${Math.round(s.at / 1000).toString(36)}`;

export type Delivery = { errors: string[]; dead: Set<string>; sent: number };

/**
 * 보낼 것들을 울릴 때마다 묶어 그때까지 기다렸다 보낸다. 사람마다 문제와 지울 기기를 모으고, 끝낸 것(보냈거나 토큰이 죽었다)의 이름을 done에 담는다.
 * 묶음 하나를 보내다 던져도(연결 끊김, 한도) 그 묶음은 문제로 적고 다음 묶음으로 간다. done에 없는 것은 부른 쪽이 다시 보낼 수 있게 푼다.
 */
export function deliver(ctx: Ctx, sends: Outgoing[], done: Set<string> = new Set()): { byUser: Map<string, Delivery>; done: Set<string> } {
  const out = new Map<string, Delivery>();
  const entry = (uid: string) => {
    let e = out.get(uid);
    if (!e) out.set(uid, (e = { errors: [], dead: new Set(), sent: 0 }));
    return e;
  };
  const groups = new Map<number, Outgoing[]>();
  for (const s of sends) groups.set(s.at, [...(groups.get(s.at) ?? []), s]);
  for (const at of [...groups.keys()].sort((a, b) => a - b)) {
    const group = groups.get(at)!;
    let responses: GasResponse[];
    try {
      const wait = at - ctx.host.now();
      if (wait > 0) ctx.host.Utilities.sleep(Math.min(wait, SLEEP_MAX_MS));
      responses = ctx.host.UrlFetchApp.fetchAll(group.map((s) => fcmRequest(ctx, fcmMessage(s))));
    } catch (e) {
      for (const s of group) entry(s.uid).errors.push(`보내지 못했습니다: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300));
      continue;
    }
    group.forEach((s, i) => {
      const res = responses[i];
      const code = res.getResponseCode();
      const text = res.getContentText();
      const kind = classify(code, text);
      const e = entry(s.uid);
      dropTokenOn401(ctx, code);
      if (kind === 'ok') {
        e.sent += 1;
        done.add(sendKey(s));
      } else if (kind === 'dead') {
        e.dead.add(s.deviceId);
        done.add(sendKey(s));
      } else {
        e.errors.push(`FCM ${code}: ${text.slice(0, 200)}`);
      }
    });
  }
  return { byUser: out, done };
}

/** 보냈거나 맡은 기록 하나. a: 울릴 때, c: 맡은 때, d: 끝냈으면 1. */
type Claim = { a: number; c: number; d: 0 | 1 };

/** 보낸(또는 맡은) 기록. 다시 볼 일이 없는 오래된 것과, 맡았지만 오래 끝내지 못한 것(실행이 죽었다)은 버린다. */
function readSent(host: GasHost, now: number): Map<string, Claim> {
  const out = new Map<string, Claim>();
  try {
    const raw: unknown = JSON.parse(host.PropertiesService.getScriptProperties().getProperty(SENT_PROPERTY) ?? '{}');
    if (isObject(raw)) {
      for (const [k, v] of Object.entries(raw)) {
        if (!isObject(v) || typeof v.a !== 'number' || typeof v.c !== 'number') continue;
        const claim: Claim = { a: v.a, c: v.c, d: v.d === 1 ? 1 : 0 };
        if (claim.a < now - CATCH_UP_MS - 2 * LOOKAHEAD_MS) continue;
        if (claim.d === 0 && now - claim.c > CLAIM_TTL_MS) continue;
        out.set(k, claim);
      }
    }
  } catch {
    // 깨졌으면 비운다(최악은 10분 안의 알림을 한 번 더 보내는 것).
  }
  return out;
}

/** 기록을 적는다. 한도를 넘으면 끝낸 것 가운데 울릴 때가 이른 것부터 버린다. */
export function writeSent(host: GasHost, sent: Map<string, Claim>): void {
  const entries = [...sent.entries()];
  let text = JSON.stringify(Object.fromEntries(entries));
  if (text.length > SENT_MAX_CHARS) {
    entries.sort((x, y) => y[1].d - x[1].d || x[1].a - y[1].a);
    while (entries.length > 0 && text.length > SENT_MAX_CHARS) {
      entries.shift();
      text = JSON.stringify(Object.fromEntries(entries));
    }
  }
  host.PropertiesService.getScriptProperties().setProperty(SENT_PROPERTY, text);
}

const intValue = (n: number) => ({ integerValue: String(Math.round(n)) });

/** 필드 경로의 한 칸. 영문자나 _로 시작하는 이름이 아니면 백틱으로 감싼다(숫자로 시작하는 기기 이름). */
export function fieldSegment(s: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(s)) return s;
  const BT = String.fromCharCode(96);
  const BS = String.fromCharCode(92);
  let escaped = '';
  for (const ch of s) escaped += ch === BT || ch === BS ? BS + ch : ch;
  return BT + escaped + BT;
}

/** 푸시 문서에 보내는 쪽의 상태를 적는다. 문서가 없으면 만들지 않는다. */
export function writeStatus(ctx: Ctx, uid: string, status: { at: number; testAt: number; error: string }): void {
  const url = `${docsBase(ctx.sa)}/users/${uid}/data/push?updateMask.fieldPaths=sender&currentDocument.exists=true`;
  const body = { fields: { sender: { mapValue: { fields: { at: intValue(status.at), testAt: intValue(status.testAt), error: { stringValue: status.error.slice(0, 500) } } } } } };
  const res = ctx.host.UrlFetchApp.fetch(url, { method: 'patch', contentType: 'application/json', headers: auth(ctx), payload: JSON.stringify(body), muteHttpExceptions: true });
  if (res.getResponseCode() !== 200 && res.getResponseCode() !== 404) ctx.host.Logger.log(failText(`${uid}의 상태를 적지 못했습니다`, res));
}

/** 쓸 수 없게 된 토큰의 기기를 지운다. 읽은 뒤에 문서가 바뀌었으면(그 기기가 새 토큰으로 다시 적었을 수 있다) 지우지 않고 다음 실행에 맡긴다. */
export function removeDevices(ctx: Ctx, uid: string, ids: string[], updateTime: string): void {
  if (ids.length === 0) return;
  const mask = ids.map((id) => `updateMask.fieldPaths=${encodeURIComponent(`devices.${fieldSegment(id)}`)}`).join('&');
  const precondition = updateTime ? `currentDocument.updateTime=${encodeURIComponent(updateTime)}` : 'currentDocument.exists=true';
  const url = `${docsBase(ctx.sa)}/users/${uid}/data/push?${mask}&${precondition}`;
  const res = ctx.host.UrlFetchApp.fetch(url, { method: 'patch', contentType: 'application/json', headers: auth(ctx), payload: JSON.stringify({ fields: {} }), muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) ctx.host.Logger.log(failText(`${uid}의 기기를 지우지 못했습니다(다음에 다시 봅니다)`, res));
}

function checkTimeZone(host: GasHost): void {
  const tz = host.Session.getScriptTimeZone();
  if (tz !== TIME_ZONE) throw new SenderError(`이 스크립트의 시간대가 ${tz}입니다. 프로젝트 설정(톱니바퀴) → 시간대를 "(GMT+09:00) 서울"로 바꾸세요. 그렇지 않으면 알림이 다른 시각에 울립니다.`);
}

function context(host: GasHost): Ctx {
  const sa = readServiceAccount(host);
  return { host, sa, token: accessToken(host, sa) };
}

export type TickReport = { from: number; to: number; users: number; sent: number; skipped?: string };

/**
 * 1분마다 부른다. [지금-10분, 지금+30초] 사이에 울릴 알림 가운데 아직 보내지 않은 것을 보낸다(앞으로 울릴 것은 그 시각까지 기다린다).
 * 보낼 것은 잠금 안에서 "맡음"으로 적은 뒤에 보내서 겹쳐 도는 실행이 같은 것을 두 번 보내지 않는다. 끝낸 것은 "끝냄"으로 바꾸고,
 * 끝내지 못한 것은 풀어서 다음 실행이 다시 한다. 실행이 도중에 죽어 풀지 못한 것도 3분 뒤에는 다시 맡을 수 있다.
 * 알림을 울릴 시각 바로 앞에 만들어도 다음 실행이 본다.
 */
export function tick(host: GasHost): TickReport {
  checkTimeZone(host);
  const ctx = context(host);
  const props = host.PropertiesService.getScriptProperties();
  const lock = host.LockService.getScriptLock();
  if (!lock.tryLock(30_000)) return { from: 0, to: 0, users: 0, sent: 0, skipped: 'lock' };
  let users: SenderUser[];
  let tests: Array<{ uid: string; testAt: number }>;
  let mine: Outgoing[];
  let from: number;
  let to: number;
  try {
    const now = host.now();
    from = Math.max(Number(props.getProperty(START_PROPERTY)) || 0, now - CATCH_UP_MS);
    to = now + LOOKAHEAD_MS;
    users = readUsers(ctx, listUsers(ctx));
    const planned = planSends(users, new Date(from), new Date(to), now);
    tests = planned.tests;
    const sent = readSent(host, now);
    mine = planned.sends.filter((s) => s.at <= now + SLEEP_MAX_MS && !sent.has(sendKey(s)));
    for (const s of mine) sent.set(sendKey(s), { a: s.at, c: now, d: 0 });
    writeSent(host, sent);
  } finally {
    lock.releaseLock();
  }
  let byUser = new Map<string, Delivery>();
  // deliver가 도중에 던져도 그때까지 끝낸 것은 여기에 남아 끝냄으로 적힌다.
  const done = new Set<string>();
  try {
    byUser = deliver(ctx, mine, done).byUser;
  } finally {
    // 끝낸 것은 끝냄으로, 나머지(보내지 못했거나 도중에 던졌다)는 풀어서 다음 실행이 다시 한다.
    if (mine.length > 0 && lock.tryLock(30_000)) {
      try {
        const sent = readSent(host, host.now());
        for (const s of mine) {
          const k = sendKey(s);
          if (done.has(k)) sent.set(k, { a: s.at, c: sent.get(k)?.c ?? host.now(), d: 1 });
          else sent.delete(k);
        }
        writeSent(host, sent);
      } finally {
        lock.releaseLock();
      }
    }
  }
  let count = 0;
  for (const u of users) {
    if (!u.exists || Object.keys(u.push.devices).length === 0) continue;
    const r = byUser.get(u.uid);
    count += r?.sent ?? 0;
    // 기기를 먼저 지운다(상태를 먼저 적으면 문서의 때가 바뀌어 지우기의 조건이 늘 어긋난다).
    if (r && r.dead.size > 0) removeDevices(ctx, u.uid, [...r.dead], u.pushUpdateTime);
    const test = tests.find((t) => t.uid === u.uid);
    const prev = u.push.sender;
    const next = { at: host.now(), testAt: test?.testAt ?? prev?.testAt ?? 0, error: r?.errors[0] ?? '' };
    const due = !prev || next.at - prev.at >= HEARTBEAT_MS || next.testAt !== prev.testAt || next.error !== prev.error;
    if (due) writeStatus(ctx, u.uid, next);
  }
  return { from, to, users: users.length, sent: count };
}

/** 처음 한 번 실행한다: 설정을 확인하고 1분마다 도는 트리거를 건다. 한 줄씩 로그에 남긴다. */
export function setup(host: GasHost): string[] {
  const lines: string[] = [];
  const say = (s: string): void => {
    lines.push(s);
    host.Logger.log(s);
  };
  try {
    checkTimeZone(host);
    say(`시간대: ${TIME_ZONE} (맞음)`);
    host.CacheService.getScriptCache().remove(TOKEN_CACHE);
    host.CacheService.getScriptCache().remove(USERS_CACHE);
    const ctx = context(host);
    say(`서비스 계정으로 로그인했습니다: ${ctx.sa.client_email}`);
    const users = readUsers(ctx, listUsers(ctx));
    const devices = users.reduce((n, u) => n + Object.keys(u.push.devices).length, 0);
    say(`달력 ${users.length}개를 읽었습니다. 알림을 받는 기기: ${devices}대`);
    // 없는 토큰으로 시험 삼아 보낸다(validate_only): 토큰이 틀렸다는 답이면 보내는 권한은 있다.
    const res = host.UrlFetchApp.fetch(`https://fcm.googleapis.com/v1/projects/${ctx.sa.project_id}/messages:send`, {
      method: 'post',
      contentType: 'application/json',
      headers: auth(ctx),
      payload: JSON.stringify({ validate_only: true, message: { token: 'calendarfif-setup-check', webpush: { data: { title: 'x' } } } }),
      muteHttpExceptions: true,
    });
    const kind = classify(res.getResponseCode(), res.getContentText());
    if (kind === 'auth' || kind === 'error') throw new SenderError(failText('FCM으로 보낼 수 없습니다. Firebase 콘솔 → 프로젝트 설정 → 클라우드 메시징에서 "Firebase Cloud Messaging API(V1)"이 사용 설정인지 보세요', res));
    say('FCM으로 보낼 수 있습니다.');
    for (const t of host.ScriptApp.getProjectTriggers()) {
      if (t.getHandlerFunction() === 'tick') host.ScriptApp.deleteTrigger(t);
    }
    host.ScriptApp.newTrigger('tick').timeBased().everyMinutes(1).create();
    host.PropertiesService.getScriptProperties().setProperty(START_PROPERTY, String(host.now()));
    say('설정이 끝났습니다. 이제 1분마다 알림을 확인해 보냅니다. 아이폰의 CalendarFIF 앱 → 설정 → 알림에서 "알림 받기"를 켜세요.');
  } catch (e) {
    say(`설정하지 못했습니다: ${e instanceof Error ? e.message : String(e)}`);
  }
  return lines;
}
