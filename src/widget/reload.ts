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
 * - finish: 저장하자마자, 달력을 띄운 채 스크립트를 끝낸다. 한 번 열어 한 번만 된다(끝난 뒤에는 그 달력을 지켜보는 것이 없다).
 * - nudge: 달력을 띄워 둔 스크립트가 저장할 때마다 ping과 같은 일을 한다(이 스크립트를 주소로 한 번 더 돌려 바로 끝낸다).
 *   달력과 그것을 지켜보는 스크립트는 그대로 두고, 화면 앞에서 스크립트 하나가 끝나는 일만 만든다. 되면 한 번 열어 고칠 때마다 반영된다.
 *   ping은 메뉴에서 시험했을 때 메뉴가 닫히거나 스크립트가 멈춰 쓰지 않는 것으로 가려졌다. 그러나 메뉴(알림 상자)와 달력(웹 화면)은 다르다:
 *   2026-11-17에 닫지 않은 달력이 여럿 겹쳐 있었고 닫기를 누를 때마다 위젯이 그려졌다(스크립트를 새로 돌려도 앞의 달력과 스크립트는 남는다).
 *   그려지는지 3.5초 지켜보고, 안 그려지면 전처럼 스크립트를 끝낸다(finish). 그래서 듣지 않아도 첫 저장은 반영된다.
 *   2026-11-18 사용자의 아이폰(0.9.20): 달력에서 nudge를 하면 Scriptable이 떠 있던 달력을 닫는다("저장 누르면 자동으로 Close가 되서 달력이 닫아지고
 *   Scriptable 화면나와"). 스크립트를 주소로 돌리면 Scriptable은 띄워 둔 것을 닫는다. 그래서 nudge는 쓰지 않는다.
 * - reopen: 저장할 때마다 finish를 하면서(스크립트를 바로 끝낸다: 위젯이 그려진다고 확인된 길), 그 직전에 이 스크립트를 주소로 다시 돌리게 해 둔다.
 *   스크립트가 끝난 뒤 Scriptable이 그 주소를 받아 새로 돌리면 앞의 달력을 닫고 새 달력을 띄운다. 새 실행이 계속 지켜보므로 고칠 때마다 반영된다.
 *   0.9.21은 주소로 다시 돌리게 하고 앞의 스크립트가 닫히기를 기다렸는데, Scriptable이 앞의 스크립트를 정상으로 끝내지 않고 멈춘 것으로 보인다(위젯이
 *   그려지지 않았다: 2026-11-18 사용자). 그래서 끝내는 것을 먼저, 그것도 같은 차례 안에서 한다(주소를 받는 것은 그 뒤다).
 *   두 번 잇달아 안 그려지면 finish만 한다(달력은 다시 뜨지 않는다).
 * - leave: 저장한 뒤에도 계속 지켜보다가, 달력에서 나가려는 순간(웹 화면이 초점을 잃는다: 홈으로 미는 손짓이 시작될 때)에 스크립트를 끝낸다.
 *   한 번 열어 여러 번 고친 것이 모두 반영된다. finish로는 첫 저장만 반영돼서, 넣었다가 다시 지운 배경이 위젯에 남았다(2026-11-18 사용자).
 *   초점을 잃는 것이 앱이 뒤로 물러나기 전에 오는지, 그때 한 것을 iOS가 듣는지는 아이폰에서 해 봐야 안다. 두 번 잇달아 안 그려지면 finish로 돌아간다.
 * 앞의 셋은 메뉴를 띄워 둔 동안 시험한다(달력을 쓰는 중에 시험하다 스크립트가 멈추면 그때 고친 것이 위젯에 가지 않는다).
 */

export type ReloadHow = 'setWidget' | 'ping' | 'complete' | 'finish' | 'leave' | 'nudge' | 'reopen';
/** 스크립트를 끝내는 방법인가(끝낸 뒤에는 지켜보는 것이 없다). */
export const endsRun = (how: ReloadHow): boolean => how === 'finish' || how === 'leave' || how === 'reopen';
/** 달력을 띄운 채 여러 번 쓸 수 있는 방법. 앞의 것부터 시험하고 쓴다. */
export const REPEATABLE: readonly ReloadHow[] = ['setWidget', 'ping', 'complete'];
/** probe: 메뉴에서 시험했다. save: 달력에서 저장했을 때 썼다. leave: 홈 화면으로 나간 뒤에 썼다(뒤로 물러난 뒤라 판정에 넣지 않는다). */
export type ReloadWhy = 'probe' | 'save' | 'leave';
/**
 * 한 번 해 본 기록. at: 한 때. got: 그 뒤에 시작한 위젯 그림의 시각(없으면 0. 위젯이 그리면서 적는다).
 * alive: 하고 나서도 스크립트가 돌고 있었다(메뉴에서 시험한 것에만 적는다).
 * void: 지켜보는 중에 메뉴나 달력을 닫았다. 닫으면 스크립트가 끝나고 그것이 위젯을 그리게 하므로, 그 뒤의 그림은 이 시도의 것으로 치지 않는다.
 * away: 지켜보는 중에 화면이 가려졌거나(홈 화면으로 나갔다) 앱이 멈춰 있었다. 그 뒤에 그려지면 이 시도의 것이지만(나가기 전, 화면 앞에 있을 때 한 것이다),
 *   그려지지 않았다고 바로 안 되는 것으로 치지는 않는다.
 * shut: 하자마자 메뉴가 닫혔다(그 방법이 띄운 것을 닫는 것일 수 있다). err: 하지 못한 까닭.
 */
export type ReloadTry = { how: ReloadHow; why: ReloadWhy; at: number; got: number; alive: boolean; void: boolean; away: boolean; shut: boolean; err: string };
/** works: 그려졌다. fails: 그려지지 않았다. bad: 스크립트가 멈추거나 띄운 것이 닫혔다(쓰지 않는다). unknown: 아직 모른다. */
export type Verdict = 'works' | 'fails' | 'bad' | 'unknown';

/** 판정을 처음부터 다시 하게 하려면 올린다(보관 파일의 기록을 버린다). */
export const RELOAD_EPOCH = 1;
export const MAX_TRIES = 40;
/** 방법마다 판정에 들어가는 기록을 이만큼은 남긴다(다른 기록에 밀려 나가지 않게). */
export const KEEP_PER_HOW = 6;
/** 한 뒤 이 안에 시작한 위젯 그림을 그 시도의 것으로 본다(ping은 새 실행이 새 버전을 확인하고 끝난 뒤에야 그려진다). */
export const CREDIT_MS = 5000;
/** 이만큼 지나도 그림이 없으면 그려지지 않은 것으로 본다(위젯은 다 그린 뒤에 적으므로 CREDIT_MS보다 길다). */
export const SETTLE_MS = 10_000;
/** 하고 나서 이만큼 뒤에도 돌고 있으면 스크립트가 멈추지 않은 것이다. */
export const ALIVE_MS = 1200;
/** 하고 나서 이 안에 메뉴가 닫히면 그 방법이 닫은 것일 수 있다. */
export const SHUT_MS = 1500;
/** 나가서 지켜보지 못했고 그림도 없는 일이 이만큼 잇달으면, 되던 방법도 모르는 것으로 돌린다(다시 시험한다). */
export const AWAY_LIMIT = 3;
/** 안 되는 것으로 가려진 지 이만큼 지나면 모르는 것으로 돌려 한 번 더 해 본다. */
export const RETRY_AFTER_MS = 3 * 24 * 3_600_000;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const HOWS: readonly string[] = ['setWidget', 'ping', 'complete', 'finish', 'leave', 'nudge', 'reopen'];
const WHYS: readonly string[] = ['probe', 'save', 'leave'];

/** 판정에 끝내 들어가지 않을 기록인가(닫아서 무효가 됐다, 나간 뒤에 했다). 하자마자 메뉴가 닫힌 것은 판정에 들어간다. */
const spent = (t: ReloadTry): boolean => (t.void && !t.shut) || t.why === 'leave';

/**
 * 마흔 개까지만 남긴다. 방법마다 판정에 들어가는 마지막 기록 여섯 개는 꼭 남기고, 남는 자리는 가장 나중의 것들로 채운다.
 * 옛 것부터만 버리면 판정의 근거(메뉴에서 시험한 기록)가 저장할 때마다 쌓이는 기록에 밀려 나가, 같은 시험을 되풀이하게 된다.
 */
function trim(tries: ReloadTry[]): ReloadTry[] {
  if (tries.length <= MAX_TRIES) return tries;
  const keep = new Set<number>();
  const perHow = new Map<ReloadHow, number>();
  for (let i = tries.length - 1; i >= 0; i -= 1) {
    const t = tries[i];
    const count = perHow.get(t.how) ?? 0;
    if (spent(t) || count >= KEEP_PER_HOW) continue;
    keep.add(i);
    perHow.set(t.how, count + 1);
  }
  for (let i = tries.length - 1; i >= 0 && keep.size < MAX_TRIES; i -= 1) keep.add(i);
  return tries.filter((_, i) => keep.has(i));
}

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
  return trim(out);
}

/** 보관 파일에 적을 모양. */
export const reloadCell = (tries: ReloadTry[]): { epoch: number; tries: ReloadTry[] } => ({ epoch: RELOAD_EPOCH, tries: trim(tries) });

/**
 * drawAt에 시작한 위젯 그림을 그것을 부른 시도에 적는다: 그 앞 CREDIT_MS 안에 한 것 가운데 가장 나중의 것.
 * 닫아서 무효가 된 것(void)과 하지 못한 것은 건너뛴다. 그 시도에 이미 그림이 적혀 있으면 아무 데도 적지 않는다. 적었으면 새 목록, 적을 데가 없으면 null.
 */
export function creditDraw(tries: ReloadTry[], drawAt: number): ReloadTry[] | null {
  for (let i = tries.length - 1; i >= 0; i -= 1) {
    const t = tries[i];
    if (t.at > drawAt) continue;
    if (drawAt - t.at > CREDIT_MS) return null;
    if (t.void || t.err !== '') continue;
    // 이미 그림이 적힌 시도 뒤에 또 그려졌다: 같은 것이 부른 그림이다(위젯은 한 번에 두 번 잇달아 그려지기도 한다). 더 앞의 시도에 적지 않는다.
    if (t.got > 0) return null;
    return tries.map((x, j) => (j === i ? { ...x, got: drawAt } : x));
  }
  return null;
}

/**
 * 한 번의 결과. hit: 그려졌다. miss: 화면 앞에서 다 지켜보고도 그려지지 않았다. hurt: 스크립트가 멈췄거나 하자마자 메뉴가 닫혔다.
 * away: 나가서 지켜보지 못했고 그림도 없다. open: 판정에 넣지 않는다(지켜보는 중이다, 닫아서 무효다, 나간 뒤에 한 것이다).
 */
export type Outcome = 'hit' | 'miss' | 'hurt' | 'away' | 'open';
export function outcomeOf(t: ReloadTry, now: number): Outcome {
  if (t.why === 'leave') return 'open';
  if (t.shut) return 'hurt';
  if (t.void) return 'open';
  if (t.err !== '') return 'miss';
  const settled = now - t.at >= SETTLE_MS;
  // 스크립트가 멈췄는지는 메뉴에서 시험한 것으로만 가린다(달력에서는 저장하자마자 홈 화면으로 나가는 일이 흔하다).
  if (t.why === 'probe' && !endsRun(t.how) && !t.alive) return settled ? 'hurt' : 'open';
  if (t.got > 0) return 'hit';
  if (!settled) return 'open';
  return t.away ? 'away' : 'miss';
}

/**
 * 그 방법이 되는지. 나중의 기록부터 본다.
 * - 여러 번 쓰는 방법은 잇달아 두 번 그려져야 되는 것으로 본다(메뉴에서는 그려지면 한 번 더 해 본다). 한 번은 다른 까닭으로 그려진 것일 수 있다.
 *   스크립트 끝내기는 한 번 그려지면 된다. 그 뒤에(나중에) 한 번 안 그려진 것은 넘어간다.
 * - 잇달아 두 번 안 그려졌으면 안 된다. 그려졌다 안 그려졌다 하는 것(안 그려진 것이 둘인데 잇달아 두 번 그려진 적이 없다)도 안 되는 것으로 본다.
 *   그려진 적 없이 한 번 안 그려졌으면 여러 번 쓰는 방법은 안 되는 것으로, 스크립트 끝내기는 모르는 것으로 둔다(마지막 수단이라 한 번 더 해 본다).
 * - 두 번 잇달아 스크립트가 멈추거나 메뉴가 닫혔으면 쓰지 않는다(한 번은 우연일 수 있어 다시 시험한다).
 * - 나가서 지켜보지 못했고 그림도 없는 일이 세 번 잇달았으면(그려진 기록을 만나기 전에) 모르는 것으로 돌린다: 되던 것이 안 되게 됐을 수 있다.
 *   그 사이에 안 그려진 기록이 있으면 안 되는 것으로 본다.
 * - 안 되는 것으로 가려진 지 사흘이 지나면 모르는 것으로 돌려 한 번 더 해 본다(잘못 가려진 채로 영영 남지 않게).
 */
export function verdictOf(how: ReloadHow, tries: ReloadTry[], now: number): Verdict {
  const need = endsRun(how) ? 1 : 2;
  let aways = 0;
  let misses = 0;
  let hurts = 0;
  let hits = 0;
  let prev: Outcome | null = null; // 바로 앞에 본(더 나중의) 판정 기록
  let newest = 0; // 가장 나중 판정 기록의 시각
  const fails = (): Verdict => (now - newest >= RETRY_AFTER_MS ? 'unknown' : 'fails');
  for (let i = tries.length - 1; i >= 0; i -= 1) {
    const t = tries[i];
    if (t.how !== how) continue;
    const outcome = outcomeOf(t, now);
    if (outcome === 'open') continue;
    if (outcome === 'away') {
      if (hits === 0) {
        aways += 1;
        if (aways >= AWAY_LIMIT) return misses > 0 ? fails() : 'unknown';
      }
      continue;
    }
    if (newest === 0) newest = t.at;
    if (outcome === 'hurt') {
      if (prev !== null && prev !== 'hurt') break; // 앞의 판정 뒤에 나온 옛 기록이다
      hurts += 1;
      prev = 'hurt';
      if (hurts >= 2) return 'bad';
      continue;
    }
    if (hurts > 0) return 'unknown'; // 한 번 멈췄다: 다시 시험한다
    if (outcome === 'hit') {
      hits += 1;
      if (need === 1 || prev === 'hit') return 'works';
      prev = 'hit';
      continue;
    }
    if (prev === 'miss') return fails();
    misses += 1;
    prev = 'miss';
  }
  if (hurts > 0) return 'unknown';
  if (misses >= 2) return fails();
  if (misses === 1 && hits === 0) return endsRun(how) ? 'unknown' : fails();
  return 'unknown';
}

/** 저장했을 때 쓸 방법: 되는 것으로 가려진 여러 번 쓰는 방법, 없으면 스크립트 끝내기(안 되는 것으로 가려졌으면 null). */
export function pickReload(tries: ReloadTry[], now: number): ReloadHow | null {
  for (const how of REPEATABLE) if (verdictOf(how, tries, now) === 'works') return how;
  return verdictOf('finish', tries, now) === 'fails' ? null : 'finish';
}

/**
 * 저장한 뒤에 스크립트를 끝내는 때를 나갈 때로 미룰 것인가(leave). 그려진 것으로 가려져 있을 때만 미룬다.
 * 0.9.18은 가려지기 전에도 미뤘는데, 사용자의 아이폰에서 첫 저장부터 반영되지 않았다(2026-11-18: 배경을 넣고 홈 화면으로 나갔는데 위젯이 그대로였다).
 * 나갈 때 끝내는 것이 듣지 않으면 한 번 저장한 것조차 반영되지 않는다. 그래서 확인되기 전에는 저장하자마자 끝낸다(finish).
 */
export function waitsForLeave(tries: ReloadTry[], now: number): boolean {
  return verdictOf('leave', tries, now) === 'works' && verdictOf('finish', tries, now) !== 'fails';
}

/** 메뉴에서 시험할 방법들(차례대로). 되는 것이 이미 있으면 없다. */
export function toProbe(tries: ReloadTry[], now: number): ReloadHow[] {
  const verdicts = REPEATABLE.map((how) => verdictOf(how, tries, now));
  if (verdicts.includes('works')) return [];
  return REPEATABLE.filter((_, i) => verdicts[i] === 'unknown');
}
