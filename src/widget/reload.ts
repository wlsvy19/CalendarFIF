/**
 * 위젯을 바로 새로 그리게 하는 방법 찾기.
 *
 * 아이폰에서 안 것(2026-11-17, 사용자가 보낸 메뉴의 기록): iOS는 위젯이 청한 간격을 따르지 않고(16~22분씩 그리지 않았다),
 * Scriptable이 화면 앞에 있을 때 스크립트가 끝나면(달력의 닫기) 위젯이 그 초에 그려진다. 뒤로 물러난 뒤에 스크립트를 끝내면 그려지지 않는다
 * (0.9.12가 그렇게 했다). 그래서 고친 것을 위젯에 바로 보이려면 저장하는 순간, 아직 화면 앞에 있을 때 새로 그리게 해야 한다.
 *
 * Scriptable에는 "위젯을 새로 그려라"는 기능이 없고 무엇이 그리게 하는지도 문서에 없다. 그래서 될 만한 방법을 아이폰에서 해 보고,
 * 그 뒤에 위젯이 실제로 그려졌는지를 보관 파일의 기록으로 가려 쓴다. 방법:
 * - setWidget: 앱 안에서 Script.setWidget을 부른다(달력은 그대로 떠 있다).
 * - ping: 이 스크립트를 주소로 한 번 더 돌려 바로 끝낸다(달력은 그대로 떠 있다). 앱 안에서 스크립트 하나가 끝나는 일을 만든다.
 * - complete: Script.complete()를 부른다(달력은 그대로 떠 있다).
 * - finish: 달력을 띄운 채 스크립트를 끝낸다. 한 번 열어 한 번만 된다(끝난 뒤에는 그 달력을 지켜보는 것이 없다).
 * 앞의 셋은 메뉴를 띄워 둔 동안 시험한다(달력을 쓰는 중에 시험하다 스크립트가 멈추면 그때 고친 것이 위젯에 가지 않는다).
 */

export type ReloadHow = 'setWidget' | 'ping' | 'complete' | 'finish';
/** 달력을 띄운 채 여러 번 쓸 수 있는 방법. 앞의 것부터 시험하고 쓴다. */
export const REPEATABLE: readonly ReloadHow[] = ['setWidget', 'ping', 'complete'];
/** probe: 메뉴에서 시험했다. save: 달력에서 저장했을 때 썼다. leave: 홈 화면으로 나간 뒤에 썼다(뒤로 물러난 뒤라 판정에 넣지 않는다). */
export type ReloadWhy = 'probe' | 'save' | 'leave';
/**
 * 한 번 해 본 기록. at: 한 때. got: 그 뒤에 시작한 위젯 그림의 시각(없으면 0. 위젯이 그리면서 적는다).
 * alive: 하고 나서도 스크립트가 돌고 있었다.
 * void: 지켜보는 중에 메뉴나 달력을 닫았다. 닫으면 스크립트가 끝나고 그것이 위젯을 그리게 하므로, 그 뒤의 그림은 이 시도의 것으로 치지 않는다.
 * away: 지켜보는 중에 화면이 가려졌거나(홈 화면으로 나갔다) 앱이 멈춰 있었다. 그 뒤에 그려지면 이 시도의 것이지만(나가기 전, 화면 앞에 있을 때 한 것이다),
 *   그려지지 않았다고 안 되는 것으로 치지는 않는다.
 * shut: 하자마자 메뉴가 닫혔다(그 방법이 띄운 것을 닫는 것일 수 있다). err: 하지 못한 까닭.
 */
export type ReloadTry = { how: ReloadHow; why: ReloadWhy; at: number; got: number; alive: boolean; void: boolean; away: boolean; shut: boolean; err: string };
/** works: 그려졌다. fails: 그려지지 않았다. bad: 스크립트가 멈추거나 띄운 것이 닫혔다(쓰지 않는다). unknown: 아직 모른다. */
export type Verdict = 'works' | 'fails' | 'bad' | 'unknown';

/** 판정을 처음부터 다시 하게 하려면 올린다(보관 파일의 기록을 버린다). */
export const RELOAD_EPOCH = 1;
export const MAX_TRIES = 12;
/** 한 뒤 이 안에 시작한 위젯 그림을 그 시도의 것으로 본다(ping은 새 실행이 새 버전을 확인하고 끝난 뒤에야 그려진다). */
export const CREDIT_MS = 5000;
/** 이만큼 지나도 그림이 없으면 그려지지 않은 것으로 본다(위젯은 다 그린 뒤에 적으므로 CREDIT_MS보다 길다). */
export const SETTLE_MS = 10_000;
/** 하고 나서 이만큼 뒤에도 돌고 있으면 스크립트가 멈추지 않은 것이다. */
export const ALIVE_MS = 1200;
/** 하고 나서 이 안에 메뉴가 닫히면 그 방법이 닫은 것일 수 있다. */
export const SHUT_MS = 1500;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const HOWS: readonly string[] = ['setWidget', 'ping', 'complete', 'finish'];
const WHYS: readonly string[] = ['probe', 'save', 'leave'];

/** 보관 파일의 reload 칸({ epoch, tries })을 읽는다(옛 것이 앞). 판 번호가 다르거나 모양이 다른 것은 버린다. */
export function triesOf(v: unknown): ReloadTry[] {
  if (!isObject(v) || v.epoch !== RELOAD_EPOCH || !Array.isArray(v.tries)) return [];
  const out: ReloadTry[] = [];
  for (const t of v.tries) {
    if (!isObject(t) || typeof t.how !== 'string' || !HOWS.includes(t.how) || typeof t.why !== 'string' || !WHYS.includes(t.why)) continue;
    if (typeof t.at !== 'number' || !Number.isFinite(t.at) || t.at <= 0) continue;
    out.push({
      how: t.how as ReloadHow, why: t.why as ReloadWhy, at: t.at,
      got: typeof t.got === 'number' && Number.isFinite(t.got) && t.got > 0 ? t.got : 0,
      alive: t.alive === true, void: t.void === true, away: t.away === true, shut: t.shut === true, err: typeof t.err === 'string' ? t.err : '',
    });
  }
  return out.slice(-MAX_TRIES);
}

/** 판정에 끝내 들어가지 않을 기록인가(닫아서 무효가 됐다, 나간 뒤에 했다, 나가서 지켜보지 못했고 그림도 없다). */
const spent = (t: ReloadTry): boolean => t.void || t.why === 'leave' || (t.away && t.got === 0);

/**
 * 보관 파일에 적을 모양. 열두 개를 넘으면 판정에 들어가지 않을 것부터 버리고(마지막 둘은 방금 한 것이라 둔다), 그래도 넘으면 옛 것부터 버린다.
 * 저장하자마자 홈 화면으로 나가는 일이 흔해서, 옛 것부터만 버리면 판정의 근거(메뉴에서 시험해 그려진 기록)가 그런 기록에 밀려 나간다.
 */
export function reloadCell(tries: ReloadTry[]): { epoch: number; tries: ReloadTry[] } {
  const kept = [...tries];
  for (let i = 0; kept.length > MAX_TRIES && i < kept.length - 2; ) {
    if (spent(kept[i])) kept.splice(i, 1);
    else i += 1;
  }
  return { epoch: RELOAD_EPOCH, tries: kept.slice(-MAX_TRIES) };
}

/**
 * drawAt에 시작한 위젯 그림을 그것을 부른 시도에 적는다: 그 앞 CREDIT_MS 안에 한 것 가운데 가장 나중의 것.
 * 닫아서 무효가 된 것(void), 하지 못한 것, 이미 그림이 적힌 것에는 적지 않는다. 적었으면 새 목록, 적을 데가 없으면 null.
 */
export function creditDraw(tries: ReloadTry[], drawAt: number): ReloadTry[] | null {
  for (let i = tries.length - 1; i >= 0; i -= 1) {
    const t = tries[i];
    if (t.at > drawAt) continue;
    if (drawAt - t.at > CREDIT_MS) return null;
    if (t.void || t.got > 0 || t.err !== '') continue;
    return tries.map((x, j) => (j === i ? { ...x, got: drawAt } : x));
  }
  return null;
}

type Outcome = 'hit' | 'miss' | 'hurt' | 'open';
/** 한 번의 결과. open: 아직 모른다(지켜보는 중이거나 끝까지 지켜보지 못했다). hurt: 스크립트가 멈췄거나 메뉴가 닫혔다. */
export function outcomeOf(t: ReloadTry, now: number): Outcome {
  if (t.why === 'leave') return 'open';
  if (t.shut) return 'hurt';
  if (t.void) return 'open';
  if (t.err !== '') return 'miss';
  const settled = now - t.at >= SETTLE_MS;
  // 스크립트가 멈췄는지는 메뉴에서 시험한 것으로만 가린다(달력에서는 저장하자마자 홈 화면으로 나가는 일이 흔하다).
  if (t.why === 'probe' && t.how !== 'finish' && !t.alive) return settled ? 'hurt' : 'open';
  if (t.got > 0) return 'hit';
  if (t.away) return 'open';
  return settled ? 'miss' : 'open';
}

/**
 * 그 방법이 되는지. 나중의 기록부터 본다.
 * 그려졌으면 된다(그 뒤에 한 번 안 그려진 것은 넘어간다). 두 번 잇달아 안 그려졌으면 안 된다. 그려진 적 없이 한 번 안 그려졌으면
 * 여러 번 쓰는 방법은 안 되는 것으로, 스크립트 끝내기는 모르는 것으로 둔다(마지막 수단이라 한 번 더 해 본다).
 * 두 번 잇달아 스크립트가 멈추거나 메뉴가 닫혔으면 쓰지 않는다(한 번은 우연일 수 있어 다시 시험한다).
 */
export function verdictOf(how: ReloadHow, tries: ReloadTry[], now: number): Verdict {
  let misses = 0;
  let hurts = 0;
  let first = true;
  for (let i = tries.length - 1; i >= 0; i -= 1) {
    const t = tries[i];
    if (t.how !== how) continue;
    const outcome = outcomeOf(t, now);
    if (outcome === 'open') continue;
    if (outcome === 'hurt') {
      if (!first && hurts === 0) break; // 앞의 판정 뒤에 나온 옛 기록이다
      hurts += 1;
      first = false;
      if (hurts >= 2) return 'bad';
      continue;
    }
    if (hurts > 0) return 'unknown'; // 한 번 멈췄다: 다시 시험한다
    first = false;
    if (outcome === 'hit') return misses <= 1 ? 'works' : 'fails';
    misses += 1;
    if (misses >= 2) return 'fails';
  }
  if (hurts > 0) return 'unknown';
  if (misses === 0) return 'unknown';
  return how === 'finish' ? 'unknown' : 'fails';
}

/** 저장했을 때 쓸 방법: 되는 것으로 가려진 여러 번 쓰는 방법, 없으면 스크립트 끝내기(안 되는 것으로 가려졌으면 null). */
export function pickReload(tries: ReloadTry[], now: number): ReloadHow | null {
  for (const how of REPEATABLE) if (verdictOf(how, tries, now) === 'works') return how;
  return verdictOf('finish', tries, now) === 'fails' ? null : 'finish';
}

/** 메뉴에서 시험할 방법들(차례대로). 되는 것이 이미 있으면 없다. */
export function toProbe(tries: ReloadTry[], now: number): ReloadHow[] {
  const verdicts = REPEATABLE.map((how) => verdictOf(how, tries, now));
  if (verdicts.includes('works')) return [];
  return REPEATABLE.filter((_, i) => verdicts[i] === 'unknown');
}
