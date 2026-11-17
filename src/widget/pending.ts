/**
 * 위젯에서 연 달력(Scriptable 안의 웹 화면)에서 고친 것 가운데 아직 서버에 올라가지 않은 것.
 * 웹 화면이 window.__calfifPending에 글(JSON)로 적어 두고(src/web/widgetBridge.ts), 달력을 띄운 스크립트가 그것을 읽어
 * 보관 파일의 pending 칸에 적는다(main.ts의 watchPending). 위젯은 서버에서 읽은 달 위에 이것을 얹어 그린다.
 * 이렇게 하면 고치고 바로 홈 화면으로 나와도, 위젯이 새로 그려질 때 서버에 아직 닿지 않은 것까지 보인다.
 */
import { isColor } from '../core/color';
import type { DayValue } from '../core/types';

/** 웹 화면이 window에 적어 두는 이름. src/web/widgetBridge.ts의 PENDING_GLOBAL과 같아야 한다. */
export const PENDING_GLOBAL = '__calfifPending';
/** 스크립트가 웹 화면에서 돌리는 식. 적어 둔 글이 없으면 빈 글이다. */
export const PENDING_JS = `String(window.${PENDING_GLOBAL} || "")`;

/** 하루의 값(웹 화면이 보여 주는 값)과 그것을 고친 시각. */
export type PendingDay = { monthId: string; day: string; text: string; color: string; editedAt: number };
/** 보관 파일의 pending 칸. uid는 웹 화면에 로그인한 계정, savedAt은 스크립트가 적은 시각이다. */
export type PendingState = { uid: string; savedAt: number; edits: PendingDay[] };

/**
 * 적어 둔 지 이보다 오래된 것은 얹지 않는다. 웹 화면을 다시 열면 그때의 것으로 바뀌므로, 오래 열지 않았을 때를 위한 것이다.
 * 짧게 둔다: 서버의 달 문서에는 지운 날의 흔적이 없어서, 올라간 뒤 다른 기기가 지운 날을 위젯이 가려내지 못한다(그날이 이 시간까지 남는다).
 */
export const PENDING_TTL_MS = 3_600_000;
const MAX_EDITS = 200;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function dayOf(v: unknown): PendingDay | null {
  if (!isObject(v)) return null;
  const { monthId, day, text, color, editedAt } = v;
  if (typeof monthId !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(monthId)) return null;
  if (typeof day !== 'string' || !/^(0[1-9]|[12][0-9]|3[01])$/.test(day)) return null;
  if (typeof text !== 'string' || typeof color !== 'string' || !isColor(color)) return null;
  if (typeof editedAt !== 'number' || !Number.isFinite(editedAt) || editedAt <= 0) return null;
  return { monthId, day, text, color, editedAt };
}

function editsOf(v: unknown): PendingDay[] | null {
  if (!Array.isArray(v) || v.length > MAX_EDITS) return null;
  const out: PendingDay[] = [];
  for (const item of v) {
    const day = dayOf(item);
    if (day) out.push(day);
  }
  return out;
}

/** 웹 화면이 적어 둔 글을 읽는다. 모양이 다르면 null(그때는 보관 파일을 건드리지 않는다). */
export function parsePendingMessage(text: string): { uid: string; edits: PendingDay[] } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(parsed) || parsed.v !== 1 || typeof parsed.uid !== 'string' || parsed.uid === '') return null;
  const edits = editsOf(parsed.edits);
  return edits ? { uid: parsed.uid, edits } : null;
}

/** 보관 파일의 pending 칸을 읽는다. 없거나 모양이 다르면 null. */
export function pendingStateOf(v: unknown): PendingState | null {
  if (!isObject(v) || typeof v.uid !== 'string' || v.uid === '') return null;
  if (typeof v.savedAt !== 'number' || !Number.isFinite(v.savedAt)) return null;
  const edits = editsOf(v.edits);
  return edits ? { uid: v.uid, savedAt: v.savedAt, edits } : null;
}

/**
 * 서버가 따라잡은 편집(서버의 그날 고친 시각이 같거나 더 새롭다)을 뺀 것을 돌려준다. 뺀 것이 없으면 받은 것 그대로다.
 * 서버에서 달을 읽을 때마다 이렇게 지워 둔다: 한 번 올라간 편집이 남아 있으면, 그 뒤 다른 기기가 그날을 지웠을 때
 * (서버에 흔적이 없다) 아직 올라가지 않은 것으로 보여 다시 얹힌다.
 */
export function settlePending(monthId: string, times: Record<string, number>, state: PendingState): PendingState {
  const edits = state.edits.filter((e) => e.monthId !== monthId || (times[e.day] ?? 0) < e.editedAt);
  return edits.length === state.edits.length ? state : { ...state, edits };
}

/**
 * 서버에서 읽은 달(days) 위에 아직 올라가지 않은 편집을 얹은 것을 돌려준다. days는 바꾸지 않는다.
 * times는 서버가 가진 날짜별 고친 시각이다. 서버의 것이 같거나 더 새로우면(올라갔거나 다른 기기가 그 뒤에 고쳤다) 서버의 것을 둔다.
 * 다른 계정의 것, 너무 오래된 것, 다른 달의 것은 얹지 않는다.
 */
export function applyPending(
  monthId: string,
  days: Record<string, DayValue>,
  times: Record<string, number>,
  state: PendingState | null,
  uid: string,
  nowMs: number,
): Record<string, DayValue> {
  if (!state || state.uid !== uid || nowMs - state.savedAt > PENDING_TTL_MS) return days;
  const out: Record<string, DayValue> = { ...days };
  for (const e of state.edits) {
    if (e.monthId !== monthId) continue;
    if ((times[e.day] ?? 0) >= e.editedAt) continue;
    if (e.text === '' && e.color === '') delete out[e.day];
    else out[e.day] = { text: e.text, color: e.color };
  }
  return out;
}

/**
 * 웹 화면의 상태를 묻는 식. 달력을 띄운 스크립트가 가끔 돌려 Scriptable의 메뉴에 한 줄로 적는다(아이폰에서 무엇이 도는지 볼 길이 그것뿐이다).
 * app: 웹앱의 버전(웹앱이 window.__calfifApp에 적는다. 0.9.8까지의 웹앱은 적지 않아 빈 글이다).
 * sw: 서비스 워커가 이 화면을 맡고 있는가(맡고 있으면 첫 화면이 받아 둔 것에서 나온다).
 * bridge: 웹앱이 올리지 못한 편집을 적어 두는가(위젯에서 연 화면인 것을 알고 로그인했을 때만 적는다).
 */
export const PROBE_JS = `JSON.stringify({ app: String(window.__calfifApp || ""), sw: !!(navigator.serviceWorker && navigator.serviceWorker.controller), bridge: typeof window.${PENDING_GLOBAL} === "string" })`;

/** 보관 파일의 web 칸. at은 스크립트가 적은 시각이다. */
export type WebProbe = { at: number; app: string; sw: boolean; bridge: boolean };

/** 웹 화면이 답한 글을 읽는다. 모양이 다르면 null. */
export function parseProbe(text: string): { app: string; sw: boolean; bridge: boolean } | null {
  try {
    const v: unknown = JSON.parse(text);
    if (!isObject(v) || typeof v.app !== 'string' || typeof v.sw !== 'boolean' || typeof v.bridge !== 'boolean') return null;
    return { app: v.app.slice(0, 40), sw: v.sw, bridge: v.bridge };
  } catch {
    return null;
  }
}

/** 보관 파일의 web 칸을 읽는다. 없거나 모양이 다르면 null. */
export function webProbeOf(v: unknown): WebProbe | null {
  if (!isObject(v) || typeof v.at !== 'number' || !Number.isFinite(v.at) || typeof v.app !== 'string' || typeof v.sw !== 'boolean' || typeof v.bridge !== 'boolean') return null;
  return { at: v.at, app: v.app, sw: v.sw, bridge: v.bridge };
}

/** Scriptable의 메뉴에 적을 한 줄. 열어 본 적이 없으면 빈 글. */
export function probeLine(p: WebProbe | null): string {
  if (!p) return '';
  const d = new Date(p.at);
  const two = (n: number): string => String(n).padStart(2, '0');
  const when = `${d.getMonth() + 1}월 ${d.getDate()}일 ${two(d.getHours())}:${two(d.getMinutes())}`;
  const app = p.app === '' ? '웹앱 버전 모름(0.9.8 이하)' : `웹앱 ${p.app}`;
  return `위젯에서 연 달력(${when} 확인): ${app}, 서비스 워커 ${p.sw ? '있음' : '없음'}, 위젯에 넘기기 ${p.bridge ? '켜짐' : '꺼짐'}`;
}
