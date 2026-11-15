// 푸시 알림 문서(users/{uid}/data/push)의 모양. 웹앱이 기기를 적고, 알림 보내는 스크립트(Apps Script)가 읽고 상태를 적는다.
//
// devices: 알림을 받는 기기. 열쇠는 기기마다 만든 이름(영문과 숫자 20자), 값은 FCM 등록 토큰과 이름표와 적은 때.
// testAt: 웹앱의 "시험 알림 보내기"를 누른 때(밀리초). 보내는 쪽이 보면 시험 알림을 보낸다.
// sender: 보내는 쪽만 적는다. at은 마지막으로 이 문서를 확인한 때, testAt은 마지막으로 처리한 시험 요청, error는 마지막 문제.

export const MAX_DEVICES = 5;
export const DEVICE_ID_PATTERN = /^[A-Za-z0-9]{20}$/;

export type PushDevice = { token: string; label: string; at: number };
export type SenderStatus = { at: number; testAt: number; error: string };
export type PushDoc = { devices: Record<string, PushDevice>; testAt: number; sender: SenderStatus | null };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** 보통 값(Firestore SDK의 data() 또는 REST 값을 푼 것)을 문서로. 틀린 기기는 버린다. */
export function parsePushDoc(raw: unknown): PushDoc {
  const o = isObject(raw) ? raw : {};
  const devices: Record<string, PushDevice> = {};
  if (isObject(o.devices)) {
    for (const [id, d] of Object.entries(o.devices)) {
      if (!DEVICE_ID_PATTERN.test(id) || !isObject(d)) continue;
      const token = str(d.token);
      if (token === '' || token.length > 4096) continue;
      devices[id] = { token, label: str(d.label).slice(0, 40), at: num(d.at) };
    }
  }
  const s = isObject(o.sender) ? o.sender : null;
  return {
    devices,
    testAt: num(o.testAt),
    sender: s ? { at: num(s.at), testAt: num(s.testAt), error: str(s.error).slice(0, 500) } : null,
  };
}

/** 기기마다 한 번 만들어 이 브라우저에 두는 이름. */
export function newDeviceId(random: () => number = Math.random): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  // 첫 글자는 영문자다(숫자로 시작하는 이름은 Firestore의 필드 경로에서 따로 감싸야 한다).
  let out = chars[Math.floor(random() * 52) % 52];
  for (let i = 1; i < 20; i += 1) out += chars[Math.floor(random() * chars.length) % chars.length];
  return out;
}

/** 보내는 쪽이 이보다 오래 확인하지 않았으면 멈춘 것으로 본다. */
export const SENDER_STALE_MS = 15 * 60_000;

export function senderAlive(doc: PushDoc | null, now: number): boolean {
  return !!doc?.sender && doc.sender.at > 0 && now - doc.sender.at < SENDER_STALE_MS && doc.sender.error === '';
}

/** 아이폰 홈 화면 앱에서 켠 기기의 이름표. */
export const IOS_LABEL = '아이폰';

/**
 * 그 계정의 아이폰 알림을 푸시가 맡고 있는가: 아이폰에서 켠 기기가 있고 알림 서버가 살아 있다.
 * 그렇지 않으면(알림 서버를 아직 만들지 않았거나 멈췄다, PC 브라우저에서만 켰다) 위젯이 예전처럼 Scriptable 알림을 예약한다.
 */
export function pushCoversIphone(doc: PushDoc | null, now: number): boolean {
  return pushCoversUntil(doc) > now;
}

/**
 * 푸시가 아이폰 알림을 언제까지 맡는다고 볼 수 있는가(밀리초, 맡지 않으면 0). 알림 서버의 마지막 확인에서 15분 뒤까지다.
 * 보내기 문제 가운데 권한 문제(FCM 401, 403)만 맡지 않는 것으로 본다. 다른 기기로 보내다 난 잠깐의 문제로 위젯이 같은 알림을 또 예약하지 않게.
 */
export function pushCoversUntil(doc: PushDoc | null): number {
  if (!doc?.sender || doc.sender.at <= 0 || /^FCM 40[13]/.test(doc.sender.error)) return 0;
  if (!Object.values(doc.devices).some((d) => d.label === IOS_LABEL)) return 0;
  return doc.sender.at + SENDER_STALE_MS;
}
