/**
 * Scriptable의 메뉴에 적는 상태. 아이폰에서 위젯과 달력 화면이 실제로 무엇을 했는지 볼 길이 이것뿐이다
 * (PC에서는 아이폰의 위젯을 볼 수 없다). 위젯과 달력을 띄운 스크립트가 보관 파일에 적어 두고, 메뉴가 읽어 보여 준다.
 */
import type { PendingState, WebProbe } from './pending';
import { REPEATABLE, outcomeOf, verdictOf, type ReloadHow, type ReloadTry, type Verdict } from './reload';

/** 위젯을 한 번 그린 기록. v: 그린 코드의 버전. src: 달을 어디서 읽었나. over: 얹은(아직 올라가지 않은) 편집 수. next: 다시 그려 달라고 청한 때. */
export type DrawNote = { at: number; v: string; src: string; over: number; next: number };
/** 달력을 띄운 스크립트가 웹 화면에서 식을 돌린 결과. ok, fail: 성공과 실패의 수. lastError: 마지막 실패의 까닭. */
export type BridgeNote = { at: number; ok: number; fail: number; lastOkAt: number; lastError: string };
/** 위젯에서 연 달력에서 나간 때와 길. closed: 닫기를 눌렀다. left: 닫지 않고 홈 화면으로 나갔다(달력과 스크립트는 그대로 남는다). */
export type LeaveNote = { at: number; how: 'closed' | 'left' };
/** update.ts의 상태 가운데 메뉴에 적을 것. */
export type UpdateNote = { version: string; unfinished: Record<string, number>; skipUntil: Record<string, number>; note: string; libNote: string };

export const MAX_DRAWS = 8;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** 보관 파일의 draws 칸을 읽는다(새 것이 뒤). 모양이 다른 것은 버린다. */
export function drawsOf(v: unknown): DrawNote[] {
  if (!Array.isArray(v)) return [];
  const out: DrawNote[] = [];
  for (const d of v) {
    if (isObject(d) && num(d.at) > 0) out.push({ at: num(d.at), v: str(d.v), src: str(d.src), over: num(d.over), next: num(d.next) });
  }
  return out.slice(-MAX_DRAWS);
}

/** 보관 파일의 bridge 칸을 읽는다. 없으면 null. */
export function bridgeOf(v: unknown): BridgeNote | null {
  if (!isObject(v) || num(v.at) <= 0) return null;
  return { at: num(v.at), ok: num(v.ok), fail: num(v.fail), lastOkAt: num(v.lastOkAt), lastError: str(v.lastError) };
}

/** 보관 파일의 leave 칸을 읽는다. 없으면 null. */
export function leaveOf(v: unknown): LeaveNote | null {
  if (!isObject(v) || num(v.at) <= 0 || (v.how !== 'closed' && v.how !== 'left')) return null;
  return { at: num(v.at), how: v.how };
}

const two = (n: number): string => String(n).padStart(2, '0');
/** 시:분:초. 오늘이 아니면 앞에 월/일을 붙인다. */
export function clock(at: number, now: number): string {
  const d = new Date(at);
  const n = new Date(now);
  const time = `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
  const sameDay = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  return sameDay ? time : `${d.getMonth() + 1}/${d.getDate()} ${time}`;
}

const SOURCES: Record<string, string> = {
  server: '서버에서 읽음', cache: '보관해 둔 것(오프라인)', login: '로그인 안내', none: '읽지 못함', denied: '권한 없음',
};

const span = (ms: number): string => (ms < 90_000 ? `${Math.round(ms / 1000)}초` : `${Math.round(ms / 60_000)}분`);

const VERDICTS: Record<Verdict, string> = { works: '됨', fails: '안 됨', bad: '쓰지 않음', unknown: '시험 전' };
const WHYS: Record<ReloadTry['why'], string> = { probe: '시험', save: '저장', leave: '나간 뒤' };
const SHOWN_TRIES = 5;

/** 한 번 해 본 것의 결과를 적는다. */
function tryResult(t: ReloadTry, now: number): string {
  if (t.err !== '') return `못 함(${t.err.slice(0, 40)})`;
  if (t.got > 0) return `${((t.got - t.at) / 1000).toFixed(1)}초 뒤 그림`;
  if (t.shut) return '바로 닫힘';
  if (t.void) return '닫아서 무효';
  if (t.away) return '나가서 지켜보지 못함';
  if (t.why === 'leave') return '그림 없음';
  const outcome = outcomeOf(t, now);
  if (outcome === 'open') return '지켜보는 중';
  return outcome === 'hurt' ? '스크립트가 멈춤' : '안 그려짐';
}

/** 위젯을 바로 새로 그리게 하는 방법의 판정과 마지막 시도들(reload.ts). 해 본 적이 없으면 빈 목록. */
export function reloadLines(tries: ReloadTry[], now: number): string[] {
  if (tries.length === 0) return [];
  const hows: ReloadHow[] = [...REPEATABLE, 'finish', 'leave', 'relaunch'];
  const lines = [`바로 그리기: ${hows.map((how) => `${how} ${VERDICTS[verdictOf(how, tries, now)]}`).join(' · ')}`];
  lines.push(`시도: ${tries.slice(-SHOWN_TRIES).map((t) => `${clock(t.at, now)} ${t.how}(${WHYS[t.why]}) ${tryResult(t, now)}`).join(' · ')}`);
  return lines;
}

/** 메뉴에 적을 상태 글(여러 줄). 적을 것이 하나도 없으면 빈 글. */
export function statusText(input: {
  now: number; draws: DrawNote[]; web: WebProbe | null; activeAt: number; leave?: LeaveNote | null; pending: PendingState | null; bridge: BridgeNote | null; update: UpdateNote;
  reload?: ReloadTry[];
}): string {
  const { now, draws, web, activeAt, pending, bridge, update } = input;
  const leave = input.leave ?? null;
  const lines: string[] = [];
  if (draws.length > 0) {
    lines.push(`위젯 그림: ${[...draws].reverse().map((d) => clock(d.at, now)).join(' · ')}`);
    const last = draws[draws.length - 1];
    lines.push(`마지막 그림: ${last.v === '' ? '버전 모름' : last.v}, ${SOURCES[last.src] ?? last.src}, 얹은 편집 ${last.over}건, 다음 요청 ${span(Math.max(0, last.next - last.at))} 뒤`);
  }
  if (web) lines.push(`달력 화면(${clock(web.at, now)}): ${web.app === '' ? '웹앱 버전 모름' : `웹앱 ${web.app}`}, 서비스 워커 ${web.sw ? '있음' : '없음'}, 넘기기 ${web.bridge ? '켜짐' : '꺼짐'}`);
  // 웹 화면이 남긴 Firebase SDK의 경고와 오류(Scriptable의 "Errors Logged" 상자에는 내용이 나오지 않는다).
  for (const l of web?.log ?? []) lines.push(`웹 화면 기록(${clock(l.at, now)}): ${[l.level, l.type, l.text].filter((t) => t !== '').join(' ')}`);
  if (activeAt > 0) lines.push(`달력이 떠 있던 마지막 때: ${clock(activeAt, now)}`);
  if (leave) lines.push(`달력에서 나감(${clock(leave.at, now)}): ${leave.how === 'left' ? '닫지 않고 홈 화면으로 나감' : '닫기를 눌러 닫음'}`);
  if (pending) lines.push(`넘겨받은 편집: ${pending.edits.length}건(${clock(pending.savedAt, now)})${pending.edits.length > 0 ? ` ${pending.edits.slice(0, 5).map((e) => `${e.monthId.slice(5)}-${e.day}`).join(', ')}` : ''}`);
  if (bridge) {
    const failed = bridge.fail > 0 ? `, 실패 ${bridge.fail}(마지막 실패: ${bridge.lastError === '' ? '까닭 모름' : bridge.lastError.slice(0, 120)})` : ', 실패 0';
    lines.push(`화면 읽기(${clock(bridge.at, now)}): 성공 ${bridge.ok}${bridge.lastOkAt > 0 ? `(마지막 ${clock(bridge.lastOkAt, now)})` : ''}${failed}`);
  }
  lines.push(...reloadLines(input.reload ?? [], now));
  const stuck = Object.entries(update.unfinished).filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}번`);
  const resting = Object.entries(update.skipUntil).filter(([, until]) => until > now).map(([k, until]) => `${k} ${clock(until, now)}까지`);
  const notes = [update.note, update.libNote].filter((t) => t !== '');
  if (update.version !== '' || stuck.length > 0 || resting.length > 0 || notes.length > 0) {
    lines.push(`업데이트: 받아 둔 ${update.version === '' ? '없음' : update.version}, 끝나지 못함 ${stuck.length === 0 ? '없음' : stuck.join(', ')}, 쉬는 중 ${resting.length === 0 ? '없음' : resting.join(', ')}${notes.length === 0 ? '' : `, ${notes.join(' / ')}`}`);
  }
  // 적을 것이 하나도 없으면(위젯도 달력도 아직 이 코드로 돈 적이 없다) 적지 않는다.
  if (lines.length === 0 && update.version === '') return '';
  // 다른 기록은 있는데 위젯을 그린 기록만 없다: 위젯이 이 코드로 그려진 적이 없다.
  if (draws.length === 0) lines.unshift('위젯 그림: 기록 없음(0.9.11보다 앞의 코드로 그려졌거나 아직 그려지지 않았다)');
  return ['— 상태 —', ...lines].join('\n');
}
