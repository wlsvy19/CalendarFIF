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
/** 0.9.13~0.9.15의 웹 화면이 Firebase SDK의 경고와 오류를 적어 두던 이름. 0.9.16부터의 웹 화면은 적지 않는다(SDK의 기록을 끈다: src/web/widgetLog.ts). */
export const LOG_GLOBAL = '__calfifLog';
/**
 * 스크립트가 웹 화면에서 0.3초마다 돌리는 식. 글 세 개의 배열을 JSON으로 준다: 웹앱이 적어 둔 올리지 못한 편집(없으면 빈 글),
 * 화면이 보이는지(document.visibilityState: 앱이 뒤로 가면 hidden), 화면에서 나가려는 중인지("1"이면 나가는 중).
 * 나가려는 중: 창이 초점을 잃었거나(blur) 쪽이 숨겨졌다(pagehide, hidden). 홈으로 미는 손짓이 시작되면 앱이 뒤로 물러나기 전에
 * 먼저 초점을 잃는다고 보고 듣는다(처음 돌 때 듣는 것을 걸어 둔다). 다시 초점을 얻거나 보이면 되돌린다.
 */
export const POLL_JS = `(function(){var w=window;if(!w.__calfifWatch){var s=w.__calfifWatch={away:0};var off=function(){s.away=1;};var on=function(){s.away=0;};w.addEventListener("blur",off);w.addEventListener("pagehide",off);w.addEventListener("focus",on);w.addEventListener("pageshow",on);document.addEventListener("visibilitychange",function(){if(document.visibilityState==="hidden")off();else on();});}return JSON.stringify([String(w.${PENDING_GLOBAL}||""),String(document.visibilityState||""),w.__calfifWatch.away?"1":"0"]);})()`;

/** POLL_JS의 답을 읽는다. 모양이 다르면 null. */
export function parsePoll(text: string): { pending: string; hidden: boolean; visible: boolean; away: boolean } | null {
  try {
    const v: unknown = JSON.parse(text);
    if (!Array.isArray(v) || typeof v[0] !== 'string' || typeof v[1] !== 'string') return null;
    return { pending: v[0], hidden: v[1] === 'hidden', visible: v[1] === 'visible', away: v[2] === '1' };
  } catch {
    return null;
  }
}

/** 하루의 값(웹 화면이 보여 주는 값)과 그것을 고친 시각. */
export type PendingDay = { monthId: string; day: string; text: string; color: string; editedAt: number };
/** 보관 파일의 pending 칸. uid는 웹 화면에 로그인한 계정, savedAt은 스크립트가 적은 시각이다. */
export type PendingState = { uid: string; savedAt: number; edits: PendingDay[] };

/**
 * 적어 둔 지 이보다 오래된 것은 얹지 않는다. 웹 화면을 다시 열면 그때의 것으로 바뀌므로, 오래 열지 않았을 때를 위한 것이다.
 * 짧게 둔다: 서버의 달 문서에는 지운 날의 흔적이 없어서, 올라간 뒤 다른 기기가 지운 날을 위젯이 가려내지 못한다(그날이 이 시간까지 남는다).
 */
export const PENDING_TTL_MS = 3_600_000;
/**
 * 서버의 달에 그날이 없는데 적어 둔 지 이만큼 지난 편집은 버린다. 저장은 몇 초 안에 서버에 닿는다: 이만큼 지나도 서버에 그날이 없으면
 * 올라간 뒤에 지워진 것이다(지운 날은 서버에 흔적이 없다). 버리지 않으면 지운 배경이 위젯에 한 시간 동안 다시 얹힌다(2026-11-18 사용자의 아이폰:
 * 배경을 넣어 저장하면서 스크립트가 끝났고, 이어서 그 배경을 지운 것은 스크립트가 보지 못했다).
 */
export const ABSENT_DAY_TTL_MS = 20_000;
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

/** 웹 화면이 적어 둔 글의 n(편집 목록이 달라질 때마다 는다. src/web/widgetBridge.ts의 pendingTeller). 없으면 0(0.9.12까지의 웹앱). */
export function pendingCount(text: string): number {
  try {
    const parsed: unknown = JSON.parse(text);
    return isObject(parsed) && typeof parsed.n === 'number' && Number.isFinite(parsed.n) && parsed.n > 0 ? parsed.n : 0;
  } catch {
    return 0;
  }
}

/**
 * 앞에 읽은 것(before)과 지금 읽은 것(after) 사이에 저장이 있었는가.
 * 목록에 새 편집(날짜와 고친 시각)이 생겼으면 저장이다. 편집이 서버에 올라가 목록에서 빠지기만 한 것은 저장이 아니다
 * (앞서 올리지 못해 남아 있던 편집이 달력을 열자마자 올라가는 일이 있다).
 * 읽는 사이에 저장하고 올라가 버리면 새 편집이 보이지 않는다. 그때는 n으로 안다: n은 목록이 달라질 때마다 하나씩 늘므로
 * (저장 +1, 올라감 +1), 는 만큼에서 줄어든 편집의 수를 빼고도 남으면 그 사이에 저장이 있었다.
 */
export function savedBetween(before: { edits: PendingDay[]; n: number }, after: { edits: PendingDay[]; n: number }): boolean {
  const key = (e: PendingDay): string => `${e.monthId}-${e.day}@${e.editedAt}`;
  const had = new Set(before.edits.map(key));
  if (after.edits.some((e) => !had.has(key(e)))) return true;
  return after.n - before.n + (after.edits.length - before.edits.length) > 0;
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
export function settlePending(monthId: string, times: Record<string, number>, state: PendingState, nowMs = 0): PendingState {
  const stale = nowMs - state.savedAt > ABSENT_DAY_TTL_MS;
  const edits = state.edits.filter((e) => {
    if (e.monthId !== monthId) return true;
    const at = times[e.day];
    // 서버에 그날이 없다: 방금 적은 것이면 아직 올라가는 중이고, 묵은 것이면 올라간 뒤에 지워진 것이다.
    if (at === undefined) return !stale;
    return at < e.editedAt;
  });
  return edits.length === state.edits.length ? state : { ...state, edits };
}

/** applyPending이 얹을 편집의 수(메뉴의 상태에 적는다). */
export function countPending(monthId: string, times: Record<string, number>, state: PendingState | null, uid: string, nowMs: number): number {
  if (!state || state.uid !== uid || nowMs - state.savedAt > PENDING_TTL_MS) return 0;
  return state.edits.filter((e) => e.monthId === monthId && (times[e.day] ?? 0) < e.editedAt).length;
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
 * 달력 화면에 무엇이 보이는가(PROBE_JS의 view). 2026-11-18 사용자: Close로 닫고 위젯을 다시 눌러 연 달력에 메모가 하나도 안 보였다.
 * PC의 Chromium에서는 재현되지 않아서, 아이폰에서 그때 화면의 상태를 적는다.
 * title: 머리의 년도와 월. cells: 날짜 칸 수. memos: 메모가 그려진 칸 수. sync: 동기화 표시의 상태와 글. up: 화면을 연 지 몇 초. login: 로그인 화면이다.
 * seed, server: 화면을 연 뒤 적어 둔 달(src/web/monthSeed.ts)과 서버의 첫 스냅숏을 받은 때(ms). 아직 없으면 -1, 그것을 적지 않는 웹앱이면 -2.
 */
export type WebView = { title: string; cells: number; memos: number; sync: string; up: number; login: boolean; seed: number; server: number };
const VIEW_JS = `(() => { const q = (s) => document.querySelector(s); const sync = q(".sync"); const t = (s) => ((q(s) || {}).textContent || "").trim(); return { title: (t(".year") + " " + t(".app-head .month")).trim(), cells: document.querySelectorAll(".cell").length, memos: document.querySelectorAll(".cell .memo").length, sync: sync ? ((sync.getAttribute("data-state") || "") + " " + t(".sync-text")).trim() : "", up: Math.round(performance.now() / 1000), login: !!q(".login"), seed: window.__calfifLoad ? window.__calfifLoad.seed : -2, server: window.__calfifLoad ? window.__calfifLoad.server : -2 }; })()`;

function viewOf(v: unknown): WebView | null {
  if (!isObject(v) || typeof v.title !== 'string' || typeof v.cells !== 'number' || typeof v.memos !== 'number') return null;
  return {
    title: v.title.slice(0, 20), cells: v.cells, memos: v.memos,
    sync: typeof v.sync === 'string' ? v.sync.slice(0, 40) : '', up: typeof v.up === 'number' && Number.isFinite(v.up) ? v.up : 0, login: v.login === true,
    seed: typeof v.seed === 'number' && Number.isFinite(v.seed) ? v.seed : -2, server: typeof v.server === 'number' && Number.isFinite(v.server) ? v.server : -2,
  };
}

/**
 * 웹 화면의 상태를 묻는 식. 달력을 띄운 스크립트가 가끔 돌려 Scriptable의 메뉴에 한 줄로 적는다(아이폰에서 무엇이 도는지 볼 길이 그것뿐이다).
 * app: 웹앱의 버전(웹앱이 window.__calfifApp에 적는다. 0.9.8까지의 웹앱은 적지 않아 빈 글이다).
 * sw: 서비스 워커가 이 화면을 맡고 있는가(맡고 있으면 첫 화면이 받아 둔 것에서 나온다).
 * bridge: 웹앱이 올리지 못한 편집을 적어 두는가(위젯에서 연 화면인 것을 알고 로그인했을 때만 적는다).
 * log: 웹앱이 적어 둔 Firebase SDK의 경고와 오류(0.9.13부터. Scriptable은 웹 화면의 console.error를 "Errors Logged" 상자로 띄우는데
 * 첫 인자만 보여 내용을 알 수 없었다. 웹앱이 그것을 콘솔 대신 여기에 적는다).
 */
export const PROBE_JS = `JSON.stringify({ app: String(window.__calfifApp || ""), sw: !!(navigator.serviceWorker && navigator.serviceWorker.controller), bridge: typeof window.${PENDING_GLOBAL} === "string", log: String(window.${LOG_GLOBAL} || ""), view: ${VIEW_JS} })`;

/** 웹 화면이 남긴 기록 한 줄(Firebase SDK의 경고와 오류. src/web/widgetLog.ts). */
export type WebLogLine = { at: number; level: string; type: string; text: string };
const MAX_LOG_LINES = 3;
const MAX_LOG_TEXT = 160;

/** 웹 화면이 적어 둔 기록(JSON 글이나 이미 읽은 배열)을 읽는다. 모양이 다른 줄은 버린다. 마지막 세 줄만 둔다. */
export function webLogOf(v: unknown): WebLogLine[] {
  let list: unknown = v;
  if (typeof v === 'string') {
    if (v === '') return [];
    try {
      list = JSON.parse(v);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  const out: WebLogLine[] = [];
  for (const l of list) {
    if (!isObject(l) || typeof l.at !== 'number' || !Number.isFinite(l.at) || typeof l.text !== 'string') continue;
    out.push({ at: l.at, level: typeof l.level === 'string' ? l.level.slice(0, 12) : '', type: typeof l.type === 'string' ? l.type.slice(0, 40) : '', text: l.text.slice(0, MAX_LOG_TEXT) });
  }
  return out.slice(-MAX_LOG_LINES);
}

/** 보관 파일의 web 칸. at은 스크립트가 적은 시각이다. log: 웹 화면이 남긴 기록(없으면 빈 목록). */
export type WebProbe = { at: number; app: string; sw: boolean; bridge: boolean; log: WebLogLine[]; view?: WebView | null };

/** 웹 화면이 답한 글을 읽는다. 모양이 다르면 null. */
export function parseProbe(text: string): { app: string; sw: boolean; bridge: boolean; log: WebLogLine[]; view: WebView | null } | null {
  try {
    const v: unknown = JSON.parse(text);
    if (!isObject(v) || typeof v.app !== 'string' || typeof v.sw !== 'boolean' || typeof v.bridge !== 'boolean') return null;
    return { app: v.app.slice(0, 40), sw: v.sw, bridge: v.bridge, log: webLogOf(v.log), view: viewOf(v.view) };
  } catch {
    return null;
  }
}

/** 보관 파일의 web 칸을 읽는다. 없거나 모양이 다르면 null. */
export function webProbeOf(v: unknown): WebProbe | null {
  if (!isObject(v) || typeof v.at !== 'number' || !Number.isFinite(v.at) || typeof v.app !== 'string' || typeof v.sw !== 'boolean' || typeof v.bridge !== 'boolean') return null;
  return { at: v.at, app: v.app, sw: v.sw, bridge: v.bridge, log: webLogOf(v.log), view: viewOf(v.view) };
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
