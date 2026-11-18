import { isColor } from '../core/color';
import { parseOfficialHolidays, setOfficialHolidays, type OfficialYear } from '../core/holidays';
import type { DayValue } from '../core/types';
import { parseEventMap, type EventMap } from '../core/events';
import { clearAlarms, pendingStatus, scheduleAlarms, scheduleTest, type AlarmStatus, type TestResult } from './alarms';
import { isApiError, readEvents, readMonthDoc, readPushDoc, refreshSession, signIn, type Config, type Session } from './api';
import { pushCoversUntil } from '../push/doc';
import type { Host, ListWidgetLike } from './host';
import { POLL_JS, PROBE_JS, applyPending, countPending, parsePendingMessage, parsePoll, parseProbe, pendingCount, pendingStateOf, savedBetween, settlePending, webProbeOf, type PendingDay, type PendingState, type WebProbe } from './pending';
import { MAX_DRAWS, bridgeOf, drawsOf, leaveOf, statusText, type BridgeNote, type DrawNote, type LeaveNote } from './status';
import { withEventLines } from './eventLines';
import { ALIVE_MS, CREDIT_MS, SETTLE_MS, SHUT_MS, creditDraw, endsRun, pickReload, verdictOf, reloadCell, toProbe, triesOf, waitsForLeave, type ReloadHow, type ReloadTry, type ReloadWhy } from './reload';
import { makeWidget } from './render';
import { renderTree } from './renderTree';
import { buildScene, messageScene, type MonthData, type Scene } from './scene';
import { widgetSize, type Family, type Size } from './sizes';
import type { Theme } from './theme';
import { buildTree, messageTree, type Tree } from './tree';
import { checkForUpdate, readUpdateState, runWithUpdate, updateLine, versionKey } from './update';

const REFRESH_KEY = 'calendarfif.refreshToken';
const UID_KEY = 'calendarfif.uid';
const CACHE_FILE = 'calendarfif-cache.json';
const HOLIDAY_FILE = 'calendarfif-holidays.json';
const HOLIDAY_FRESH_MS = 24 * 3_600_000; // 받은 지 이만큼 안이면 다시 받지 않는다
const HOLIDAY_RETRY_MS = 6 * 3_600_000; // 받지 못하면 이만큼 지나야 다시 받는다(위젯은 자주 새로 그려진다)

/** 위젯에 놓을 것: 기본은 기본 부품의 나무, 위젯 매개변수에 image가 있으면 그림 장면. */
type View = { tree: Tree } | { scene: Scene };
/** force: 매개변수로 고정한 밝기(없으면 기본 부품의 색이 화면 밝기를 스스로 따른다). pictureTheme: 그림을 그릴 밝기(그림을 그릴 때만 묻는다). */
type Env = { family: Family; image: boolean; lunar: boolean; inapp: boolean; force: Theme | undefined; pictureTheme: () => Theme; size: Size; today: string };

const pad2 = (n: number): string => String(n).padStart(2, '0');
const localDate = (d: Date): string => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

function pickFamily(raw: string | null): Family {
  return raw === 'small' || raw === 'medium' ? raw : 'large';
}

/** 위젯 매개변수를 낱말로 나눈다(소문자, 공백과 쉼표로). */
function paramWords(host: Host): string[] {
  const raw = host.args.widgetParameter;
  return typeof raw === 'string' ? raw.toLowerCase().split(/[\s,]+/).filter((w) => w !== '') : [];
}

function systemIsDark(host: Host): boolean {
  try {
    return host.Device.isUsingDarkAppearance();
  } catch {
    return false; // 위젯 안에서는 이 질문이 지원되지 않아 던질 수 있다
  }
}

function makeEnv(host: Host, family: Family, now: Date): Env {
  const words = paramWords(host);
  const image = words.includes('image') || words.includes('그림');
  // 매개변수의 밝기가 먼저다. 없으면 그림은 그리는 순간의 기기 밝기를 쓰고, 기본 부품의 색은 화면 밝기를 스스로 따른다.
  const force: Theme | undefined = words.includes('dark') ? 'dark' : words.includes('light') ? 'light' : undefined;
  const pictureTheme = (): Theme => force ?? (systemIsDark(host) ? 'dark' : 'light');
  // 음력은 적는 것이 기본이고, 매개변수에 nolunar(또는 음력끔)가 있으면 적지 않는다.
  const lunar = !(words.includes('nolunar') || words.includes('음력끔'));
  // 위젯을 누르면 Safari에서 달력이 열리는 것이 기본이고, 매개변수에 inapp(또는 앱안)이 있으면 Scriptable 안에서 연다.
  const inapp = words.includes('inapp') || words.includes('앱안');
  return { family, image, lunar, inapp, force, pictureTheme, size: widgetSize(host.Device.screenSize(), family), today: localDate(now) };
}

function monthView(env: Env, month: MonthData, offline: boolean): View {
  const input = { family: env.family, size: env.size, today: env.today, month, offline, lunar: env.lunar };
  return env.image ? { scene: buildScene({ ...input, theme: env.pictureTheme() }) } : { tree: buildTree(input) };
}

/**
 * 위젯을 눌렀을 때 열 주소. 기본은 웹앱의 주소다(Scriptable을 거쳐 Safari에서 열린다).
 * 매개변수 inapp이면 이 스크립트를 다시 돌리는 주소를 준다. 그러면 Scriptable 안에서 달력을 연다(openCalendarInApp).
 * 스크립트의 이름을 모르면 웹앱의 주소로 둔다. 오류 위젯은 늘 웹앱의 주소다(그리다 깨진 스크립트를 다시 돌리지 않게).
 */
function tapUrl(host: Host, env: Env, cfg: Config): string {
  if (!env.inapp) return cfg.appUrl;
  try {
    const name = host.Script.name ? host.Script.name() : '';
    if (typeof name === 'string' && name !== '') return `scriptable:///run/${encodeURIComponent(name)}?open=calendar`;
  } catch {
    // 아래의 웹앱 주소로 둔다.
  }
  return cfg.appUrl;
}

type WebViewLike = {
  loadURL(url: string): Promise<unknown>;
  present(fullscreen?: boolean): Promise<unknown>;
  /** 웹 화면에서 식을 돌려 그 값을 받는다. */
  evaluateJavaScript?(javaScript: string, useCallback?: boolean): Promise<unknown>;
};
// Scriptable의 전역 WebView. 붙여 넣은 스크립트가 넘기는 이름에 없어서(0.9.0에서 굳었다) 전역에서 직접 가져온다. Scriptable 밖에는 없다.
declare const WebView: unknown;

/**
 * Scriptable의 WebView를 찾는다. 전역 이름으로 먼저 찾고(전역 객체의 속성이 아니어도 찾는다), 없으면 globalThis에서 찾는다.
 * 없으면 null.
 */
function findWebView(): (new () => WebViewLike) | null {
  try {
    if (typeof WebView === 'function') return WebView as new () => WebViewLike;
  } catch {
    // 아래에서 다시 찾는다.
  }
  try {
    const found = (globalThis as { WebView?: unknown }).WebView;
    return typeof found === 'function' ? (found as new () => WebViewLike) : null;
  } catch {
    return null;
  }
}

// Scriptable의 전역 Safari. WebView처럼 붙여 넣은 스크립트가 넘기는 이름에 없어서 전역에서 직접 가져온다.
declare const Safari: unknown;

/** Scriptable의 Safari.open을 찾는다(http가 아닌 주소는 그 주소를 맡은 앱으로 간다). 없으면 null. */
function findOpenUrl(): ((url: string) => unknown) | null {
  const pick = (found: unknown): ((url: string) => unknown) | null => {
    const safari = found as { open?: unknown } | null | undefined;
    return safari && typeof safari.open === 'function' ? (url) => (safari.open as (u: string) => unknown)(url) : null;
  };
  try {
    if (typeof Safari !== 'undefined') {
      const open = pick(Safari);
      if (open) return open;
    }
  } catch {
    // 아래에서 다시 찾는다.
  }
  try {
    return pick((globalThis as { Safari?: unknown }).Safari);
  } catch {
    return null;
  }
}

/** 이 스크립트를 다시 돌리되 아무것도 하지 않고 바로 끝내게 하는 주소(reload.ts의 ping). 스크립트 이름을 모르면 빈 글. */
function pingUrl(host: Host): string {
  try {
    const name = host.Script.name ? host.Script.name() : '';
    // open=calendar: 0.9.1부터의 붙여 넣은 스크립트는 이 값이 있으면 새 버전 확인을 실행 뒤로 미룬다(바로 끝나게).
    return typeof name === 'string' && name !== '' ? `scriptable:///run/${encodeURIComponent(name)}?open=calendar&ping=1` : '';
  } catch {
    return '';
  }
}

/** 이 스크립트를 다시 돌려 달력을 새로 띄우게 하는 주소(reload.ts의 reopen). 스크립트 이름을 모르면 빈 글. */
function reopenUrl(host: Host): string {
  try {
    const name = host.Script.name ? host.Script.name() : '';
    return typeof name === 'string' && name !== '' ? `scriptable:///run/${encodeURIComponent(name)}?open=calendar&again=1` : '';
  } catch {
    return '';
  }
}

/**
 * 위젯을 새로 그리게 할 만한 일을 한다(reload.ts). finish는 여기서 하지 않는다(부른 쪽이 스크립트를 끝낸다).
 * 했으면 빈 글, 하지 못했으면 그 까닭. 던지지 않는다.
 */
function doReload(host: Host, how: ReloadHow): string {
  try {
    if (how === 'setWidget') host.Script.setWidget(new host.ListWidget());
    else if (how === 'complete') host.Script.complete();
    else if (how === 'ping' || how === 'nudge' || how === 'reopen') {
      const open = findOpenUrl();
      if (!open) return 'Safari.open이 없다';
      const url = how === 'reopen' ? reopenUrl(host) : pingUrl(host);
      if (url === '') return '스크립트 이름을 모른다';
      void Promise.resolve(open(url)).catch(() => {});
    }
    return '';
  } catch (e) {
    return e instanceof Error && e.message !== '' ? e.message : '알 수 없는 오류';
  }
}

/** 이 실행이 한 시도들을 보관 파일의 reload 칸에 적고 지켜본다(reload.ts). 어느 것도 던지지 않는다. */
type ReloadLog = {
  /** 보관 파일의 시도들(다른 실행이 한 것까지). */
  tries(): ReloadTry[];
  /** how를 하고 적는다. 방금 한 것을 아직 지켜보는 중이면(finish가 아닐 때) 하기만 하고 따로 적지 않는다. */
  fire(how: ReloadHow, why: ReloadWhy): void;
  /** 주기적으로 부른다. visible: 띄운 것이 화면에 보이는가. 가려졌거나 멈췄다 깨어났으면 지켜보던 것에 그렇다고 적고(away), 메뉴에서 시험한 것에는 살아 있음을 적는다. */
  tick(visible: boolean): void;
  /** 실행이 끝난다(또는 달력이 닫혔다). 아직 그림이 적힐 수 있는 것을 무효로 한다: 끝나는 것이 위젯을 그리게 한다. menu: 메뉴가 닫혀서 끝난다(방금 한 ping, complete가 닫은 것일 수 있다고 적는다). */
  end(menu: boolean): void;
  /** at에 한 시도에 그림이 적혔는가. */
  credited(at: number): boolean;
  /** 마지막으로 적은 시도의 시각(없으면 0). */
  lastAt(): number;
  /** at에 한 시도에 하지 못한 까닭을 적는다(안 그려진 것으로 판정에 들어가고, 그 뒤의 그림이 그 시도에 적히지 않는다). */
  fail(at: number, why: string): void;
};

const TICK_GAP_MS = 2500; // 이보다 오래 불리지 않았으면 앱이 멈춰 있었다

function reloadLog(host: Host, now: () => Date): ReloadLog {
  const mine: number[] = [];
  let lastTick = 0;
  const read = (): ReloadTry[] => {
    try {
      return triesOf(cacheObject(host)?.reload);
    } catch {
      return [];
    }
  };
  /** 이 실행이 한 시도들을 고쳐 적는다. change가 null을 주면 그대로 둔다. */
  const amend = (change: (t: ReloadTry) => ReloadTry | null): void => {
    try {
      if (mine.length === 0) return;
      let changed = false;
      const next = read().map((t) => {
        if (!mine.includes(t.at)) return t;
        const fixed = change(t);
        if (!fixed) return t;
        changed = true;
        return fixed;
      });
      if (changed) updateCache(host, { reload: reloadCell(next) });
    } catch {
      // 적지 못하면 그 시도는 판정에 들어가지 않거나 한 번 더 해 보게 된다.
    }
  };
  /** 아직 그림이 적힐 수 있는 시도인가. */
  const fresh = (t: ReloadTry, at: number): boolean => !endsRun(t.how) && t.got === 0 && !t.void && t.err === '' && at - t.at < CREDIT_MS;
  return {
    tries: read,
    fire(how, why) {
      try {
        const tries = read();
        let at = now().getTime();
        const busy = !endsRun(how) && tries.some((t) => mine.includes(t.at) && t.got === 0 && !t.void && t.err === '' && at - t.at < CREDIT_MS);
        if (busy) {
          doReload(host, how);
          return;
        }
        while (tries.some((t) => t.at === at)) at += 1;
        // 하기 전에 적는다: 하다가 스크립트가 멈춰도 했다는 것은 남는다.
        mine.push(at);
        updateCache(host, { reload: reloadCell([...tries, { how, why, at, got: 0, alive: endsRun(how), void: why === 'leave', away: false, shut: false, err: '' }]) });
        // 끝내는 방법은 부른 쪽이 스크립트를 끝낸다. reopen은 그 앞에 주소를 열어 둔다(끝난 뒤에 새 실행이 달력을 다시 띄운다).
        const err = endsRun(how) && how !== 'reopen' ? '' : doReload(host, how);
        if (err !== '') amend((t) => (t.at === at ? { ...t, err } : null));
      } catch {
        // 그대로 둔다.
      }
    },
    tick(visible) {
      const at = now().getTime();
      const gap = lastTick > 0 && at - lastTick > TICK_GAP_MS;
      const before = lastTick;
      lastTick = at;
      amend((t) => {
        // 살아 있음은 메뉴에서 시험한 것에만 적는다(달력에서 저장할 때 한 것에는 쓰이지 않는다. 위젯도 같은 파일을 통째로 고쳐 쓰므로 적는 일을 줄인다).
        // 늦게 적으면 안 된다: 시험하는 중에 홈 화면으로 나가 앱이 꺼지면, 살아 있었는데도 스크립트가 멈춘 것으로 남는다.
        const alive = t.alive || (t.why === 'probe' && at - t.at >= ALIVE_MS);
        // 멈춰 있었거나 가려졌다: 그려지지 않았더라도 바로 안 되는 것으로 칠 수 없다(그려지면 위젯이 적는다).
        const lost = !t.away && (gap ? fresh(t, before) : !visible && fresh(t, at));
        return alive !== t.alive || lost ? { ...t, alive, away: t.away || lost } : null;
      });
    },
    end(menu) {
      const at = now().getTime();
      amend((t) => {
        const alive = t.alive || (t.why === 'probe' && at - t.at >= ALIVE_MS);
        const cut = fresh(t, at);
        const shut = cut && menu && (t.how === 'ping' || t.how === 'complete') && at - t.at < SHUT_MS;
        return alive !== t.alive || cut ? { ...t, alive, void: t.void || cut, shut: t.shut || shut } : null;
      });
    },
    credited(at) {
      return read().some((t) => t.at === at && t.got > 0);
    },
    lastAt() {
      return mine.length === 0 ? 0 : mine[mine.length - 1];
    },
    fail(at, why) {
      amend((t) => (t.at === at && t.err === '' && t.got === 0 ? { ...t, err: why } : null));
    },
  };
}

/** 메뉴를 띄워 둔 동안 방법 하나를 해 보고 다음 것으로 넘어가기까지 기다리는 시간, 그리고 지켜보는 간격. */
const PROBE_WAIT_MS = CREDIT_MS;
const PROBE_TICK_MS = 300;

/**
 * 메뉴를 띄워 둔 동안, 위젯을 바로 새로 그리게 하는 방법들을 차례로 해 본다(reload.ts). 그려진 방법은 한 번 더 해 보고, 두 번 다 그려지면 멈춘다.
 * 결과는 위젯이 그리면서 보관 파일에 적고, 다음에 메뉴를 열면 상태에 보인다. 돌려주는 함수는 시험을 멈춘다(메뉴가 닫힐 때 부른다).
 */
function probeReload(host: Host, now: () => Date, plan: ReloadHow[]): () => void {
  if (plan.length === 0) return () => {};
  const log = reloadLog(host, now);
  const queue = [...plan];
  let stopped = false;
  let timer: { invalidate(): void } | undefined;
  let current: ReloadHow | null = null;
  let fires = 0; // 지금 방법을 몇 번 했나
  let firedAt = 0;
  let found = false; // 두 번 다 그려진 방법이 있다
  const fire = (how: ReloadHow): void => {
    log.fire(how, 'probe');
    firedAt = log.lastAt();
  };
  const step = (): void => {
    if (stopped) return;
    try {
      log.tick(true);
      const at = now().getTime();
      if (current && !found && at - firedAt >= PROBE_WAIT_MS) {
        // 5초를 다 지켜보고 정한다. 그려졌으면 한 번 더 해 본다(다른 까닭으로 그려진 것일 수 있다). 두 번 다 그려지면 더 시험하지 않는다.
        // 그려지자마자 다시 하지 않는 까닭: 위젯은 한 번에 두 번 잇달아(1~2초 사이) 그려지기도 해서, 그 둘째 그림이 다시 한 것의 것으로 적힌다.
        if (!log.credited(firedAt)) current = null; // 안 그려졌다: 다음 것
        else if (fires < 2) {
          fires += 1;
          fire(current);
        } else found = true;
      }
      if (!current && !found && queue.length > 0) {
        current = queue.shift() ?? null;
        if (current) {
          fires = 1;
          fire(current);
        }
      }
      // 더 할 것이 없어도 마지막 것을 지켜보는 동안은 돈다(살아 있음을 적는다).
      if ((found || (!current && queue.length === 0)) && at - firedAt >= SETTLE_MS) return;
      timer = host.Timer.schedule(PROBE_TICK_MS, false, step);
    } catch {
      // 타이머가 없으면 시험하지 않는다.
    }
  };
  try {
    timer = host.Timer.schedule(PROBE_TICK_MS, false, step);
  } catch {
    return () => {};
  }
  return () => {
    if (stopped) return;
    stopped = true;
    try {
      timer?.invalidate();
    } catch {
      // 그대로 둔다.
    }
    log.end(true);
  };
}

/**
 * 웹앱 주소에 via=widget과 t=(지금 시각)를 붙인다.
 * t: 열 때마다 주소가 달라져, Scriptable의 웹 화면이 받아 둔 옛 첫 화면을 쓰지 않고 서버에서 새로 받는다
 * (2026-11-17: 배포한 뒤에도 위젯에서 연 달력만 옛 버전이었다. 그 화면에는 새 버전을 스스로 받는 서비스 워커가 없다).
 */
function withVia(appUrl: string, at: Date): string {
  // 글로 만든다. Scriptable에는 브라우저의 URL이 없다: 0.9.8까지는 new URL로 만들다가 오류가 나서 아무것도 붙지 않은 주소를 열었다
  // (PC의 시험에서는 URL이 있어 드러나지 않았다. 빌드의 webApiProblems가 다시 들어오지 않게 막는다).
  const hashAt = appUrl.indexOf('#');
  const head = hashAt < 0 ? appUrl : appUrl.slice(0, hashAt);
  const hash = hashAt < 0 ? '' : appUrl.slice(hashAt);
  return `${head}${head.includes('?') ? '&' : '?'}via=widget&t=${at.getTime()}${hash}`;
}

/**
 * 가려진 달력이 바뀌어 갈 안내 쪽의 주소(웹앱의 closed.html. src/web/widgetPages.ts의 CLOSED_PAGE와 같아야 한다). 주소가 https가 아니면 빈 글.
 * 글로 만든다(Scriptable에는 브라우저의 URL이 없다).
 */
function closedPageUrl(appUrl: string): string {
  if (!/^https:\/\//i.test(appUrl ?? '')) return '';
  const cut = appUrl.search(/[?#]/);
  const head = cut < 0 ? appUrl : appUrl.slice(0, cut);
  // 주소에 경로가 없으면(https://이름) 뒤에 /를 붙이고, 있으면 마지막 / 까지를 쓴다.
  const dir = head.indexOf('/', 'https://'.length) < 0 ? `${head}/` : head.slice(0, head.lastIndexOf('/') + 1);
  return `${dir}closed.html`;
}

/** 띄운 웹 화면에서 아직 올리지 못한 편집을 읽는 간격과, 한 번 읽는 데 기다리는 시간. */
const PENDING_POLL_MS = 300;
/** 저장한 것이 있어 달력에서 나가는 순간을 기다리는 동안의 읽는 간격. 나가려는 것을 앱이 뒤로 물러나기 전에 알아채야 한다. */
const LEAVING_POLL_MS = 100;
const PENDING_READ_WAIT_MS = 1500;
/** 웹 화면의 상태(PROBE_JS)는 이만큼 읽을 때마다 한 번 묻는다(3초쯤). */
const PROBE_EVERY = 10;
/** 불러오기가 끝났다는 답이 이만큼 지나도 없으면 그냥 읽기 시작한다. */
const WATCH_LATE_START_MS = 4000;

/**
 * 띄운 웹 화면이 적어 두는 "아직 서버에 올리지 못한 편집"을 닫힐 때까지 되풀이해 읽어 보관 파일에 적는다(pending.ts).
 * 위젯은 그것을 서버에서 읽은 달 위에 얹으므로, 고치고 바로 홈 화면으로 나와도 위젯이 새로 그려질 때 고친 것이 보인다.
 * 돌려주는 함수는 읽기를 멈추고 마지막으로 두 번 더 읽는다(바로, 그리고 0.3초 뒤: 화면이 닫히면서 저장해 둔 것까지 받는다).
 * 읽지 못해도 던지지 않는다.
 */
/**
 * work를 ms까지만 기다린다. 타이머를 걸지 못하면 기다리지 않는다: 달력을 닫은 뒤 스크립트가 끝나지 않는 것보다
 * 올리지 못한 편집을 읽지 못하는 것이 낫다(waitAtMost는 타이머가 없으면 끝까지 기다린다).
 */
async function boundedWait<T>(host: Host, work: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: { invalidate(): void } | undefined;
  const late = new Promise<T>((resolve) => {
    try {
      timer = host.Timer.schedule(ms, false, () => resolve(fallback));
    } catch {
      resolve(fallback);
    }
  });
  try {
    return await Promise.race([work, late]);
  } finally {
    try {
      timer?.invalidate();
    } catch {
      // 그대로 둔다.
    }
  }
}

/** 달력이 떠 있는 동안 그 시각을 보관 파일의 activeAt에 적는 간격. */
const ACTIVE_BEAT_MS = 5000;

/**
 * 위젯에서 연 달력이 화면에 떠 있는 동안 그 시각을 보관 파일의 activeAt에 적어 둔다(바로 한 번, 그 뒤 5초마다).
 * 앱이 뒤로 가면 타이머가 멈추므로 마지막으로 적힌 시각이 달력에서 나간 때쯤이다. 메뉴의 상태에 보인다.
 * 돌려주는 함수는 한 번 더 적고 멈춘다(quiet이면 적지 않고 멈춘다). 던지지 않는다.
 */
function keepActive(host: Host, now: () => Date): (quiet?: boolean) => void {
  let stopped = false;
  let timer: { invalidate(): void } | undefined;
  const beat = (): void => updateCache(host, { activeAt: now().getTime() });
  const loop = (): void => {
    if (stopped) return;
    beat();
    try {
      timer = host.Timer.schedule(ACTIVE_BEAT_MS, false, loop);
    } catch {
      // 타이머가 없으면 열 때와 닫을 때만 적는다.
    }
  };
  loop();
  return (quiet = false) => {
    stopped = true;
    try {
      timer?.invalidate();
    } catch {
      // 그대로 둔다.
    }
    if (!quiet) beat();
  };
}

/**
 * 달력을 지켜보는 쪽이 알려 주는 것들.
 * changed: 웹 화면에서 저장이 있었다(pending.ts의 savedBetween. 처음 읽은 것과 서버에 올라가기만 한 것은 알리지 않는다). visible: 그때 화면이 보이는가.
 * left: 보이던 화면이 가려졌다(앱이 뒤로 갔다). 다시 보였다가 가려지면 또 부른다.
 * tick: 읽을 때마다. away: 화면에서 나가려는 중이다(창이 초점을 잃었다). pace: 다음에 읽기까지 기다릴 시간(ms).
 * check: 3초쯤마다 묻는다. true를 주면 더 지켜보지 않는다(위젯을 다시 눌러 새 달력이 떴다).
 */
type WatchHooks = { changed(visible: boolean): void; left(): void; tick(visible: boolean, away: boolean): void; check(): boolean; pace(): number };

/** 돌려주는 함수의 fast: 마지막 읽기를 건너뛰고 바로 멈춘다. quiet: 멈추면서 보관 파일에 적지 않는다(새 달력이 적는 칸을 덮어쓰지 않게). */
function watchPending(host: Host, view: WebViewLike, now: () => Date, hooks: WatchHooks): (fast?: boolean, quiet?: boolean) => Promise<void> {
  if (typeof view.evaluateJavaScript !== 'function') return async () => {};
  let seenVisible = false;
  let leftTold = false;
  let last = '';
  let lastSeen: { edits: PendingDay[]; n: number } | null = null;
  let lastProbe = '';
  let reads = 0;
  let stopped = false;
  let timer: { invalidate(): void } | undefined;
  // 웹 화면에서 식을 돌린 결과를 세어 보관 파일의 bridge 칸에 적는다(메뉴의 상태에 보인다).
  const tally = { ok: 0, fail: 0, lastOkAt: 0, lastError: '' };
  const failed = (why: unknown): void => {
    tally.fail += 1;
    tally.lastError = why instanceof Error && why.message !== '' ? why.message : typeof why === 'string' ? why : '알 수 없는 오류';
  };
  const noteBridge = (): void => {
    const bridge: BridgeNote = { at: now().getTime(), ...tally };
    updateCache(host, { bridge });
  };
  // 웹 화면의 상태를 물어 보관 파일의 web 칸에 적는다. Scriptable의 메뉴에 한 줄로 보인다(아이폰에서 무엇이 도는지 볼 길이 그것뿐이다).
  const probe = async (): Promise<void> => {
    try {
      const got = await boundedWait<unknown>(host, Promise.resolve(view.evaluateJavaScript!(PROBE_JS, false)), PENDING_READ_WAIT_MS, null);
      if (typeof got !== 'string' || got === lastProbe) return;
      const seen = parseProbe(got);
      if (!seen) return;
      lastProbe = got;
      const web: WebProbe = { at: now().getTime(), ...seen };
      updateCache(host, { web });
    } catch {
      // 다음에 다시 묻는다.
    }
  };
  const read = async (): Promise<void> => {
    const turn = reads;
    reads += 1;
    if (turn % PROBE_EVERY === 0) {
      // 새 달력이 떴으면 여기서 그만둔다: 이 달력의 상태를 더 적지 않는다(새 달력이 적는 칸이다).
      if (hooks.check()) return;
      await probe();
      noteBridge();
    }
    try {
      // 화면이 아직 없거나 닫힌 뒤에는 답이 오지 않을 수 있어 기다리는 시간을 둔다.
      const answer = await boundedWait<unknown>(host, Promise.resolve(view.evaluateJavaScript!(POLL_JS, false)), PENDING_READ_WAIT_MS, null);
      const poll = typeof answer === 'string' ? parsePoll(answer) : null;
      if (!poll) {
        failed(answer === null ? '답이 없다(1.5초)' : typeof answer === 'string' ? '모양이 다른 답' : `글이 아닌 답(${typeof answer})`);
        return;
      }
      tally.ok += 1;
      tally.lastOkAt = now().getTime();
      const got = poll.pending;
      let changed = false;
      if (got !== '' && got !== last) {
        const message = parsePendingMessage(got);
        if (message) {
          const seen = { edits: message.edits, n: pendingCount(got) };
          // 처음 읽은 것은 저장이 아니다. 편집이 서버에 올라가 목록에서 빠지기만 한 것도 저장이 아니다.
          changed = lastSeen !== null && savedBetween(lastSeen, seen);
          lastSeen = seen;
          last = got;
          const pending: PendingState = { uid: message.uid, savedAt: now().getTime(), edits: message.edits };
          updateCache(host, { pending });
        }
      }
      if (poll.visible) {
        seenVisible = true;
        leftTold = false;
      }
      hooks.tick(poll.visible, poll.away);
      // 저장했다: 올리지 못한 편집은 방금 위에서 보관 파일에 적었다.
      if (changed) hooks.changed(poll.visible);
      // 보이던 화면이 가려졌다: 사용자가 홈 화면으로 나갔다.
      if (poll.hidden && seenVisible && !leftTold) {
        leftTold = true;
        hooks.left();
      }
    } catch (e) {
      failed(e); // 다음에 다시 읽는다.
    }
  };
  const loop = (): void => {
    if (stopped) return; // 멈춘 뒤에 울린 타이머
    void read().then(() => {
      if (stopped) return;
      try {
        timer = host.Timer.schedule(hooks.pace(), false, loop);
      } catch {
        // 타이머가 없으면 닫힐 때 한 번만 더 읽는다.
      }
    });
  };
  loop();
  return async (fast = false, quiet = false) => {
    stopped = true;
    try {
      timer?.invalidate();
    } catch {
      // 그대로 둔다.
    }
    if (!fast) {
      await read();
      await boundedWait<null>(host, new Promise<null>(() => {}), PENDING_POLL_MS, null);
      await read();
      await probe();
    }
    if (!quiet) noteBridge();
  };
}

/**
 * 0.9.1부터의 붙여 넣은 스크립트는 달력을 여는 실행이 끝난 뒤에 새 버전을 확인한다(update.ts의 runWithUpdate, 네트워크 요청).
 * 달력을 띄운 채 스크립트를 끝낼 때는 바로 끝나야 하므로(위젯을 새로 그리게 하는 것이 그때다) 그 요청이 바로 실패하게 해 둔다.
 * 새 버전은 달력을 띄워 둔 동안 이미 확인했다(openCalendarInApp). 던지지 않는다.
 */
function skipLateUpdateCheck(host: Host): void {
  try {
    const refuse = (): Promise<never> => Promise.reject(new Error('스크립트를 바로 끝내려고 확인을 건너뛰었다(달력을 띄운 동안 확인했다)'));
    (host as { Request: unknown }).Request = class {
      method = 'GET';
      headers: Record<string, string> = {};
      body = '';
      timeoutInterval = 0;
      response = null;
      loadJSON(): Promise<unknown> {
        return refuse();
      }
      loadString(): Promise<string> {
        return refuse();
      }
    };
  } catch {
    // 바꾸지 못하면 그 확인이 그대로 돈다.
  }
}

/**
 * Scriptable 안의 웹 화면(WebView)에 달력을 띄운다. 닫을 때까지 기다린다. 띄웠으면 빈 글, 띄우지 못하면 그 까닭을 준다.
 * 달력에서 저장하면 그 순간 위젯을 새로 그리게 한다(reload.ts): Scriptable이 화면 앞에 있을 때 한 것만 iOS가 듣는다
 * (2026-11-17 사용자의 아이폰: 달력을 닫은 그 초에는 위젯이 그려졌고, 홈 화면으로 나간 뒤에 스크립트를 끝낸 0.9.12에서는 그려지지 않았다).
 * 되는 것으로 가려진 방법이 있으면 그것을 하고 달력을 계속 지켜본다. 없으면 달력을 띄운 채 스크립트를 끝낸다(그 달력은 그대로 남는다):
 * 저장한 뒤에도 지켜보다가 달력에서 나가려는 순간에 끝내고(leave), 그것이 안 되는 것으로 가려졌으면 저장하자마자 끝낸다(finish).
 * 닫지 않고 홈 화면으로 나가도 스크립트는 끝내지 않는다(앱 전환으로 돌아와 고쳐도 지켜보게). 위젯을 다시 눌러 새 달력이 뜨면 앞의 것은 더 지켜보지 않는다.
 * 불러오기가 끝나기를 기다리지 않고 바로 띄운다: 기다리는 동안 Scriptable의 화면이 보이지 않게, 그리고 느린 연결에서 멈춰 있지 않게.
 */
async function openCalendarInApp(host: Host, cfg: Config, now: () => Date): Promise<string> {
  try {
    const Ctor = findWebView();
    if (!Ctor) return 'Scriptable의 WebView를 찾지 못했다';
    const view = new Ctor();
    // ?via=widget: 웹앱이 위젯에서 연 화면인 것을 안다(알림 받기를 여기서 켤 수 없는 까닭을 달리 적는다).
    // 올리지 못한 편집은 불러오기가 끝난 뒤부터 읽는다(불러오는 중에 웹 화면에서 식을 돌리지 않는다). 끝나기 전에 닫히면 읽지 않는다.
    // 불러오기가 끝났다는 답이 오지 않는 때를 위해 4초 뒤에는 읽기 시작한다.
    let closed = false;
    let stopWatching: (fast?: boolean, quiet?: boolean) => Promise<void> = async () => {};
    let watching = false;
    // saved: 저장한 것을 위젯에 보이려고 스크립트를 끝낸다. over: 위젯을 다시 눌러 새 달력이 떴다(더 지켜보지 않는다).
    let quit: (how: 'saved' | 'over') => void = () => {};
    const early = new Promise<'saved' | 'over'>((resolve) => {
      quit = resolve;
    });
    // 이 달력의 번호(연 시각). 위젯을 다시 누르면 새 실행이 더 큰 번호를 적는다. 그러면 이 실행은 가려진 달력을 더 지켜보지 않는다.
    const session = now().getTime();
    updateCache(host, { session });
    const log = reloadLog(host, now);
    let unsent = false; // 저장했는데 아직 위젯을 새로 그리게 하지 않았다
    // 저장한 것이 있고, 달력에서 나가는 순간에 스크립트를 끝내려고 기다리는 중이다(reload.ts의 leave).
    // 저장하자마자 끝내면 그 뒤에 이어서 고친 것을 보지 못한다(넣었다가 다시 지운 배경이 위젯에 남았다).
    let waiting = false;
    const finishNow = (why: 'save' | 'leave'): void => {
      log.fire('finish', why);
      quit('saved');
    };
    const request = (why: 'save' | 'leave'): void => {
      unsent = false;
      const tries = log.tries();
      const at = now().getTime();
      const how = pickReload(tries, at);
      if (how && how !== 'finish') {
        log.fire(how, why);
        return;
      }
      // 저장할 때마다 반영하는 길(reload.ts의 reopen): 이 스크립트를 주소로 다시 돌리게 해 두고 바로 끝낸다(finish와 같이 위젯이 그려진다).
      // 끝난 뒤 Scriptable이 새로 돌리면서 달력을 다시 띄우고, 새 실행이 지켜본다. 화면 앞에서 저장했을 때만 한다.
      // 주소를 열 수 없거나, 두 번 잇달아 안 그려졌거나, 끝내기까지 안 되는 것으로 가려졌으면 하지 않는다.
      if (why === 'save' && how === 'finish' && findOpenUrl() && reopenUrl(host) !== '' && verdictOf('reopen', tries, at) !== 'fails') {
        log.fire('reopen', 'save');
        if (log.tries().some((t) => t.at === log.lastAt() && t.how === 'reopen' && t.err !== '')) {
          finishNow(why); // 주소를 열지 못했다: 그냥 끝낸다
          return;
        }
        quit('saved');
        return;
      }
      if (!how) return;
      if (why === 'save' && waitsForLeave(tries, at)) {
        waiting = true;
        return;
      }
      finishNow(why);
    };
    // 닫힌 뒤의 마지막 읽기에서는 아무것도 하지 않는다: 닫히면 스크립트가 끝나고 그것이 위젯을 그리게 한다.
    // (닫힌 웹 화면은 가려졌다고 답할 수 있다. 그것을 홈 화면으로 나간 것으로 적으면 끝나면서 그려진 것이 방금 한 시도의 것으로 적힌다.)
    const hooks: WatchHooks = {
      changed: (visible) => {
        if (closed) return;
        if (visible) request('save');
        else unsent = true;
      },
      left: () => {
        if (closed) return;
        const note: LeaveNote = { at: now().getTime(), how: 'left' };
        updateCache(host, { leave: note });
        // 편집 화면을 연 채 나가면 웹앱이 그때 저장한다. 뒤로 물러난 뒤라 듣지 않을 수 있지만 청해 둔다.
        if (unsent) request('leave');
      },
      tick: (visible, away) => {
        if (closed) return;
        log.tick(visible);
        // 저장한 것이 있는데 달력에서 나가려 한다(초점을 잃었다. 그것을 알아채지 못했으면 가려졌을 때): 지금 끝낸다.
        if (waiting && (away || !visible)) {
          waiting = false;
          log.fire('leave', 'save');
          quit('saved');
        }
      },
      pace: () => (waiting ? LEAVING_POLL_MS : PENDING_POLL_MS),
      check: () => {
        if (closed) return false;
        const other = cacheObject(host)?.session;
        if (typeof other !== 'number' || other <= session) return false;
        quit('over');
        return true;
      },
    };
    const startWatching = (): void => {
      if (closed || watching) return;
      watching = true;
      stopWatching = watchPending(host, view, now, hooks);
    };
    let lateStart: { invalidate(): void } | undefined;
    try {
      lateStart = host.Timer.schedule(WATCH_LATE_START_MS, false, startWatching);
    } catch {
      // 타이머가 없으면 불러오기가 끝날 때만 시작한다.
    }
    void Promise.resolve(view.loadURL(withVia(cfg.appUrl, now())))
      .then(startWatching)
      .catch(() => {
        // 불러오지 못하면 빈 화면이 남는다. 닫으면 끝난다.
      });
    const stopActive = keepActive(host, now);
    let how: 'closed' | 'saved' | 'over' = 'closed';
    let shown: Promise<'closed'> = Promise.resolve('closed');
    try {
      shown = Promise.resolve(view.present(true)).then(() => 'closed' as const);
      shown.catch(() => {}); // 먼저 끝낸 뒤에 거절돼도 잡지 않은 오류가 되지 않게
      // 달력을 띄워 둔 동안 새 위젯 코드가 있는지 확인해 받아 둔다(던지지 않는다). 달력을 닫지 않고 홈 화면으로 나가는 일이 흔해서,
      // 닫힌 뒤의 확인(update.ts의 runWithUpdate)에만 맡기면 새 코드는 위젯이 세 시간에 한 번 확인할 때에야 온다.
      if (versionKey(cfg.version) && /^https:\/\//i.test(cfg.appUrl ?? '')) void checkForUpdate(host, cfg, now());
      how = await Promise.race([shown, early]);
    } finally {
      closed = true;
      try {
        lateStart?.invalidate();
      } catch {
        // 그대로 둔다.
      }
      stopActive(how === 'over'); // 새 달력이 떴으면 그쪽이 적는 것을 덮어쓰지 않는다
      await stopWatching(how !== 'closed', how === 'over');
      log.end(false);
    }
    if (how === 'over') {
      // 가려진 이 달력을 스크립트가 없는 안내 쪽으로 바꾼다: 남은 웹앱이 서버에 붙어 있거나 오류를 적지 않게(웹앱도 스스로 그렇게 한다: src/web/widgetPages.ts).
      try {
        const page = closedPageUrl(cfg.appUrl);
        if (page !== '') void Promise.resolve(view.loadURL(page)).catch(() => {});
      } catch {
        // 바꾸지 못하면 그대로 남는다.
      }
      // 새 달력이 떠 있는 동안에는 이 스크립트를 끝내지 않는다(끝나는 것이 새 달력을 건드리는지 모른다).
      // 가려진 이 달력이 닫힐 때 끝난다. 닫히지 않으면 0.9.11까지처럼 끝나지 않은 채 남는다.
      await shown.catch(() => 'closed' as const);
      return '';
    }
    if (how === 'closed') {
      const note: LeaveNote = { at: now().getTime(), how };
      updateCache(host, { leave: note });
    } else skipLateUpdateCheck(host); // 달력을 띄운 채 끝낸다: 붙여 넣은 스크립트의 마지막 확인을 기다리지 않는다
    return '';
  } catch (e) {
    return e instanceof Error && e.message !== '' ? e.message : '알 수 없는 오류';
  }
}

const toWidget = (host: Host, env: Env, view: View, appUrl: string, now: Date): ListWidgetLike =>
  'tree' in view ? renderTree(host, view.tree, appUrl, now, env.force) : makeWidget(host, view.scene, appUrl, now);

// 보관해 둔 달: 네트워크가 안 될 때 마지막으로 읽은 것을 그린다.
const cachePath = (host: Host): string => {
  const fm = host.FileManager.local();
  return fm.joinPath(fm.documentsDirectory(), CACHE_FILE);
};

/** 보관 파일에 칸을 덮어쓴다. 다른 칸(달과 알림)은 그대로 둔다. 보관하지 못해도 위젯은 그린다. */
function updateCache(host: Host, patch: Record<string, unknown>): void {
  try {
    const fm = host.FileManager.local();
    const path = cachePath(host);
    let current: Record<string, unknown> = {};
    try {
      const parsed: unknown = fm.fileExists(path) ? JSON.parse(fm.readString(path)) : null;
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) current = parsed as Record<string, unknown>;
    } catch {
      // 깨진 보관본은 새로 쓴다.
    }
    fm.writeString(path, JSON.stringify({ ...current, ...patch }));
  } catch {
    // 보관하지 못해도 위젯은 그린다.
  }
}

/** times: 서버가 가진 날짜별 고친 시각. 보관해 둔 달 위에 올리지 못한 편집을 얹을 때 쓴다. */
function writeCache(host: Host, data: MonthData, times: Record<string, number>, now: Date): void {
  updateCache(host, { monthId: data.monthId, days: data.days, times, savedAt: now.getTime() });
}

/** 보관 파일을 통째로 읽는다. 없거나 깨졌으면 null. */
function cacheObject(host: Host): Record<string, unknown> | null {
  try {
    const fm = host.FileManager.local();
    const path = cachePath(host);
    if (!fm.fileExists(path)) return null;
    const parsed: unknown = JSON.parse(fm.readString(path));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** 보관해 둔 달의 날짜별 고친 시각. 그 달의 것이 없으면 빈 것. */
function readCachedTimes(host: Host, monthId: string): Record<string, number> {
  const cache = cacheObject(host);
  const out: Record<string, number> = {};
  if (!cache || cache.monthId !== monthId || typeof cache.times !== 'object' || cache.times === null) return out;
  for (const [key, v] of Object.entries(cache.times)) if (typeof v === 'number' && Number.isFinite(v)) out[key] = v;
  return out;
}

/**
 * 서버에서 읽은(또는 보관해 둔) 달 위에, 위젯에서 연 달력이 아직 올리지 못한 편집을 얹는다(pending.ts).
 * 보관 파일의 달은 서버의 것 그대로 둔다. 얹지 못하면 받은 달을 그대로 준다.
 * fromServer: times가 방금 서버에서 읽은 것이다. 그때는 서버가 따라잡은 편집을 보관 파일에서 지운다(settlePending).
 */
/** 이번 실행에서 달을 어디서 읽었고(src) 올라가지 않은 편집을 몇 건 얹었는지(over). 위젯을 그린 기록에 적는다. */
const loadNote = { src: 'none', over: 0 };

function withPending(host: Host, month: MonthData, times: Record<string, number>, now: Date, fromServer: boolean): MonthData {
  loadNote.src = fromServer ? 'server' : 'cache';
  loadNote.over = 0;
  try {
    let state = pendingStateOf(cacheObject(host)?.pending);
    if (!state) return month;
    if (fromServer) {
      const settled = settlePending(month.monthId, times, state, now.getTime());
      if (settled !== state) updateCache(host, { pending: settled });
      state = settled;
    }
    const uid = host.Keychain.contains(UID_KEY) ? host.Keychain.get(UID_KEY) : '';
    loadNote.over = countPending(month.monthId, times, state, uid, now.getTime());
    return { monthId: month.monthId, days: applyPending(month.monthId, month.days, times, state, uid, now.getTime()) };
  } catch {
    return month;
  }
}

/** 마지막으로 읽은 "푸시가 아이폰 알림을 언제까지 맡는가"(밀리초). 읽은 적이 없으면 0. */
function readCachedPushUntil(host: Host): number {
  try {
    const fm = host.FileManager.local();
    const path = cachePath(host);
    if (!fm.fileExists(path)) return 0;
    const parsed = JSON.parse(fm.readString(path)) as { pushUntil?: unknown } | null;
    return typeof parsed?.pushUntil === 'number' ? parsed.pushUntil : 0;
  } catch {
    return 0;
  }
}

/** 마지막으로 읽어 보관해 둔 알림 항목들. 없거나 깨졌으면 빈 것. */
function readCachedEvents(host: Host): EventMap {
  try {
    const fm = host.FileManager.local();
    const path = cachePath(host);
    if (!fm.fileExists(path)) return {};
    const parsed = JSON.parse(fm.readString(path)) as { events?: unknown } | null;
    return parseEventMap(parsed?.events);
  } catch {
    return {};
  }
}

/**
 * 알림 예약의 결과. scheduled: 예약된 수(알 수 없으면 null).
 * source: 서버의 알림 문서로 했다 / 서버를 읽지 못해 보관본으로 했다 / 읽을 권한이 없어 지웠다 / 알림 기능이 제때 끝나지 않았다 /
 * 아이폰의 푸시 알림이 알림을 맡고 있어(아이폰에서 켰고 알림 서버가 살아 있다) 예약하지 않고 예약해 둔 것을 지웠다.
 */
export type SyncResult = { scheduled: number | null; source: 'server' | 'cache' | 'denied' | 'stuck' | 'push' };
const SYNC_UNKNOWN: SyncResult = { scheduled: null, source: 'cache' };

/**
 * 알림 문서를 읽어(못 읽으면 보관해 둔 것으로) 아이폰 알림을 예약한다. notifyCapMs를 주면 아이폰 알림 기능(예약)만 그만큼 기다린다(네트워크는 제 시간 제한을 따른다).
 * 어떤 문제가 나도 던지지 않는다. 알림 글은 예약한 알림과 이 보관 파일에만 남긴다.
 */
async function syncAlarms(host: Host, cfg: Config, session: Session | null, now: Date, notifyCapMs?: number): Promise<SyncResult> {
  try {
    let items: EventMap | null = null;
    if (session) {
      try {
        items = await readEvents(host, cfg, session);
        updateCache(host, { events: items });
      } catch (e) {
        items = null;
        if (isApiError(e) && e.kind === 'denied') {
          // 읽을 권한이 없다: 보관해 둔 알림도 예약해 둔 알림도 남기지 않는다.
          await dropAlarmData(host);
          return { scheduled: 0, source: 'denied' };
        }
      }
    }
    // 아이폰에서 푸시 알림을 켰고 알림 서버가 살아 있으면 알림은 푸시로 간다. 위젯이 예약하면 같은 알림이 두 번 오므로 예약하지 않고 지운다.
    // 알림 서버가 없거나 멈췄으면 예전처럼 예약한다. 읽지 못하면 마지막으로 읽은 것을 따른다.
    let pushUntil = readCachedPushUntil(host);
    if (session) {
      try {
        pushUntil = pushCoversUntil(await readPushDoc(host, cfg, session));
        updateCache(host, { pushUntil });
      } catch {
        // 보관한 값을 쓴다(그 시각이 지났으면 예전처럼 예약한다).
      }
    }
    const pushOn = pushUntil > now.getTime();
    if (pushOn) {
      const cleared = clearAlarms(host).then(() => true);
      const done = notifyCapMs === undefined ? await cleared : await waitAtMost(host, cleared, notifyCapMs, false);
      return done ? { scheduled: 0, source: 'push' } : { scheduled: null, source: 'stuck' };
    }
    const source = items !== null ? 'server' : 'cache';
    const work = scheduleAlarms(host, items ?? readCachedEvents(host), now, cfg.appUrl).then((scheduled) => ({ scheduled }));
    const done = notifyCapMs === undefined ? await work : await waitAtMost(host, work, notifyCapMs, null);
    return done === null ? { scheduled: null, source: 'stuck' } : { scheduled: done.scheduled, source };
  } catch {
    return SYNC_UNKNOWN;
  }
}

export function readCache(host: Host, monthId: string): MonthData | null {
  try {
    const fm = host.FileManager.local();
    const path = cachePath(host);
    if (!fm.fileExists(path)) return null;
    const parsed: unknown = JSON.parse(fm.readString(path));
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { monthId: id, days } = parsed as { monthId?: unknown; days?: unknown };
    if (id !== monthId || typeof days !== 'object' || days === null) return null;
    const out: Record<string, DayValue> = {};
    for (const [key, v] of Object.entries(days)) {
      if (!/^(0[1-9]|[12][0-9]|3[01])$/.test(key)) continue;
      const day = v as Partial<DayValue> | null;
      if (day && typeof day.text === 'string' && typeof day.color === 'string' && isColor(day.color)) out[key] = { text: day.text, color: day.color };
    }
    return { monthId, days: out };
  } catch {
    return null;
  }
}

type SavedHolidays = { fetchedAt: number; attemptedAt: number; data: Record<string, OfficialYear> | null };

/** 보관해 둔 공휴일 자료. 없거나 깨졌으면 빈 것. */
function readHolidays(host: Host, path: string): SavedHolidays {
  try {
    const fm = host.FileManager.local();
    if (!fm.fileExists(path)) return { fetchedAt: 0, attemptedAt: 0, data: null };
    const v = JSON.parse(fm.readString(path)) as { fetchedAt?: unknown; attemptedAt?: unknown; data?: unknown } | null;
    const data = parseOfficialHolidays(v?.data);
    return {
      fetchedAt: data && typeof v?.fetchedAt === 'number' ? v.fetchedAt : 0,
      attemptedAt: typeof v?.attemptedAt === 'number' ? v.attemptedAt : 0,
      data,
    };
  } catch {
    return { fetchedAt: 0, attemptedAt: 0, data: null };
  }
}

const within = (now: number, at: number, ms: number): boolean => at > 0 && now - at >= 0 && now - at < ms;

/** 공휴일 자료 파일을 받는다. 받지 못하거나 잘못된 파일이면 null. */
async function fetchHolidays(host: Host, url: string): Promise<Record<string, OfficialYear> | null> {
  try {
    const req = new host.Request(url);
    req.method = 'GET';
    req.timeoutInterval = 10;
    const json = await req.loadJSON();
    const status = req.response?.statusCode;
    if (status !== undefined && (status < 200 || status >= 300)) return null;
    return parseOfficialHolidays(json);
  } catch {
    return null;
  }
}

/**
 * 공휴일 자료(웹앱이 채운 holidayUrl)를 달력에 더한다. 보관해 둔 것을 먼저 쓰고, 없거나 받은 지 24시간이 지났으면 받는다.
 * 받지 못하면 시도한 때를 적고 6시간이 지나야 다시 묻는다. 어떤 문제가 나도 던지지 않는다(그러면 지금처럼 계산한 공휴일로 그린다).
 */
async function prepareHolidays(host: Host, cfg: Config, now: Date): Promise<void> {
  try {
    const fm = host.FileManager.local();
    const path = fm.joinPath(fm.documentsDirectory(), HOLIDAY_FILE);
    const saved = readHolidays(host, path);
    setOfficialHolidays(saved.data);
    const url = cfg.holidayUrl ?? '';
    if (!/^https?:\/\//i.test(url)) return; // 비었거나 채워지지 않은 자리 표시
    const t = now.getTime();
    if (saved.data && within(t, saved.fetchedAt, HOLIDAY_FRESH_MS)) return;
    if (within(t, saved.attemptedAt, HOLIDAY_RETRY_MS)) return;
    const data = await fetchHolidays(host, url);
    const next: SavedHolidays = data ? { fetchedAt: t, attemptedAt: t, data } : { ...saved, attemptedAt: t };
    try {
      fm.writeString(path, JSON.stringify({ fetchedAt: next.fetchedAt, attemptedAt: next.attemptedAt, data: next.data ? { version: 1, years: next.data } : null }));
    } catch {
      // 보관하지 못해도 이번에는 쓴다.
    }
    if (data) setOfficialHolidays(data);
  } catch {
    // 공휴일 자료가 없어도 위젯은 그린다.
  }
}

/** 보관 파일의 알림 항목과 예약해 둔 알림을 지운다. 던지지 않는다. */
async function dropAlarmData(host: Host): Promise<void> {
  try {
    const fm = host.FileManager.local();
    const path = cachePath(host);
    if (fm.fileExists(path)) {
      const parsed: unknown = JSON.parse(fm.readString(path));
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        delete (parsed as Record<string, unknown>).events;
        fm.writeString(path, JSON.stringify(parsed));
      }
    }
  } catch {
    // 깨진 보관본이면 그대로 둔다(알림 글을 읽을 수 없다).
  }
  await clearAlarms(host);
}

async function clearLogin(host: Host): Promise<void> {
  for (const key of [REFRESH_KEY, UID_KEY]) if (host.Keychain.contains(key)) host.Keychain.remove(key);
  await dropAlarmData(host); // 로그인이 없으면 알림 글도 남기지 않는다
}

async function clearAll(host: Host): Promise<void> {
  await clearLogin(host);
  const fm = host.FileManager.local();
  const path = cachePath(host);
  if (fm.fileExists(path)) fm.remove(path);
}

function storeLogin(host: Host, refreshToken: string, uid: string): void {
  host.Keychain.set(REFRESH_KEY, refreshToken);
  host.Keychain.set(UID_KEY, uid);
}

const message = (env: Env, title: string, lines: string[]): View =>
  env.image ? { scene: messageScene({ theme: env.pictureTheme(), size: env.size, title, lines }) } : { tree: messageTree({ title, lines }) };
const loginHint = (env: Env): View => message(env, '로그인이 필요합니다', ['Scriptable 앱에서', '이 스크립트를 한 번 실행해', '로그인하세요.']);

/** 그리기 전에 알림 예약을 기다리는 가장 긴 시간. Scriptable의 알림 기능이 멈춰도(던지지 않고) 위젯은 그린다. */
const ALARM_SYNC_WAIT_MS = 5000;

/**
 * work를 ms까지만 기다린다. 늦으면 fallback으로 끝낸다(work는 뒤에서 이어질 수 있다). 타이머를 걸지 못하면 끝까지 기다린다.
 * 던지지 않는 work에만 쓴다.
 */
async function waitAtMost<T>(host: Host, work: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: { invalidate(): void } | undefined;
  const late = new Promise<T>((resolve) => {
    try {
      timer = host.Timer.schedule(ms, false, () => resolve(fallback));
    } catch {
      // 타이머가 없으면 work를 끝까지 기다린다.
    }
  });
  try {
    return await Promise.race([work, late]);
  } finally {
    try {
      timer?.invalidate();
    } catch {
      // 이미 끝난 타이머
    }
  }
}

/** 이번 달 위젯에 놓을 것을 만든다. 읽지 못하는 까닭이 있으면 그 까닭을 알리는 것을 돌려준다. */
/** alarmsDone: 이 실행에서 알림을 이미 예약했으면 다시 하지 않는다(앱). */
async function load(host: Host, cfg: Config, env: Env, now: Date, alarmsDone = false): Promise<View> {
  loadNote.src = 'none';
  loadNote.over = 0;
  const token = host.Keychain.contains(REFRESH_KEY) ? host.Keychain.get(REFRESH_KEY) : '';
  if (token === '') {
    loadNote.src = 'login';
    return loginHint(env);
  }
  const monthId = env.today.slice(0, 7);
  // 공휴일 자료는 달을 읽는 동안 함께 받고, 달을 그리기 전에 기다린다. 이 약속은 거절되지 않는다.
  const holidays = prepareHolidays(host, cfg, now);
  const drawMonth = async (month: MonthData, offline: boolean): Promise<View> => {
    await holidays;
    // 그날의 알림과 카운트다운을 메모 앞줄로 끼워 넣는다(eventLines.ts). 알림 문서는 바로 앞에서 읽어 보관 파일에 적어 두었다(syncAlarms).
    // 읽지 못했으면 마지막으로 읽은 것을 쓴다. 끼워 넣지 못해도 달은 그린다.
    let shown = month;
    try {
      shown = withEventLines(month, readCachedEvents(host));
    } catch {
      shown = month;
    }
    return monthView(env, shown, offline);
  };
  const fromCache = async (code: string | null): Promise<View> => {
    const cached = readCache(host, monthId);
    if (cached) return drawMonth(withPending(host, cached, readCachedTimes(host, monthId), now, false), true);
    return code === null
      ? message(env, '불러오지 못했습니다', ['네트워크를 확인하세요.'])
      : message(env, '불러오지 못했습니다', ['잠시 뒤 다시 시도합니다.', `(${Array.from(code).slice(0, 40).join('')})`]);
  };
  try {
    const session = await refreshSession(host, cfg, token);
    if (session.refreshToken !== token) storeLogin(host, session.refreshToken, session.uid);
    const doc = await readMonthDoc(host, cfg, session, monthId);
    const month: MonthData = { monthId, days: doc.days };
    writeCache(host, month, doc.times, now);
    // 던지지 않는다. 알림 기능이 멈춰 끝나지 않아도 5초 뒤에는 그린다(예약은 다음 실행에 다시 한다).
    if (!alarmsDone) await waitAtMost(host, syncAlarms(host, cfg, session, now), ALARM_SYNC_WAIT_MS, SYNC_UNKNOWN);
    return await drawMonth(withPending(host, month, doc.times, now, true), false);
  } catch (e) {
    if (!isApiError(e)) throw e;
    if (e.kind === 'network') return fromCache(null);
    if (e.kind === 'failed') return fromCache(e.code);
    if (e.kind === 'denied') {
      loadNote.src = 'denied';
      return message(env, '권한이 없습니다', ['관리자에게 문의하세요.']);
    }
    if (e.kind === 'rejected') {
      loadNote.src = 'login';
      await clearLogin(host);
      return loginHint(env);
    }
    throw e;
  }
}

const SIGN_IN_FAILURE = (code: string, kind: string): string =>
  kind === 'credentials' ? '이메일 또는 비밀번호가 맞지 않습니다.'
    : kind === 'throttled' ? '시도가 너무 많습니다. 잠시 뒤 다시 해 주세요.'
      : kind === 'network' ? '네트워크에 연결할 수 없습니다.'
        : `로그인하지 못했습니다. (${code})`;

/** 로그인을 물어 저장한다. 취소하면 false. */
async function askLogin(host: Host, cfg: Config): Promise<boolean> {
  let email = '';
  for (;;) {
    const alert = new host.Alert();
    alert.title = '로그인';
    alert.message = 'CalendarFIF에 쓰는 이메일과 비밀번호를 넣으세요. 비밀번호는 저장하지 않습니다.';
    const emailField = alert.addTextField('이메일', email);
    try {
      emailField?.setEmailAddressKeyboard?.();
    } catch {
      // 오래된 Scriptable: 보통 키보드로 적는다.
    }
    alert.addSecureTextField('비밀번호');
    alert.addAction('로그인');
    alert.addCancelAction('취소');
    if ((await alert.presentAlert()) !== 0) return false;
    email = alert.textFieldValue(0).trim();
    const password = alert.textFieldValue(1);
    try {
      const session = await signIn(host, cfg, email, password);
      storeLogin(host, session.refreshToken, session.uid);
      try {
        const fm = host.FileManager.local();
        if (fm.fileExists(cachePath(host))) fm.remove(cachePath(host)); // 다른 계정의 것일 수 있다
      } catch {
        // 지우지 못해도 로그인은 저장됐다.
      }
      return true;
    } catch (e) {
      if (!isApiError(e)) throw e;
      const failure = new host.Alert();
      failure.title = '로그인';
      failure.message = SIGN_IN_FAILURE(e.code, e.kind);
      failure.addAction('확인');
      await failure.presentAlert();
    }
  }
}

async function notify(host: Host, title: string, text: string): Promise<void> {
  const alert = new host.Alert();
  alert.title = title;
  alert.message = text;
  alert.addAction('확인');
  await alert.presentAlert();
}

/** 앱에서 열었을 때: 저장된 로그인으로 알림을 읽어 예약한다(안 되면 보관본으로). 로그인이 안 된 것은 여기서 다루지 않는다. 던지지 않는다. */
async function scheduleFromSaved(host: Host, cfg: Config, now: Date): Promise<SyncResult> {
  let session: Session | null = null;
  try {
    session = await refreshSession(host, cfg, host.Keychain.get(REFRESH_KEY));
    storeLogin(host, session.refreshToken, session.uid);
  } catch {
    session = null; // 거절과 연결 문제는 미리 보기가 다룬다
  }
  return syncAlarms(host, cfg, session, now, APP_ALARM_WAIT_MS);
}

/** 앱에서 아이폰 알림 기능(예약, 다시 읽기)을 기다리는 가장 긴 시간. 그 기능이 멈춰도 메뉴는 뜬다. 네트워크는 여기에 들지 않는다. */
const APP_ALARM_WAIT_MS = 15_000;
const PERMISSION_HINT = "아이폰 설정 → 앱 → Scriptable → 알림에서 '알림 허용'과 '잠금 화면'을 켜 주세요.";
const LOCK_HINT = "잠금 화면에 뜨지 않으면 설정 → 앱 → Scriptable → 알림의 '잠금 화면', 집중 모드, 알림 요약을 확인하세요.";
const dateText = (d: Date): string => `${d.getMonth() + 1}월 ${d.getDate()}일`;

/** 예약한 뒤 아이폰에 남은 수. 예약하지 못했으면 null, 다시 읽지 못했으면 예약한 수. */
const verifiedCount = (scheduled: number | null, status: AlarmStatus | null): number | null =>
  scheduled === null ? null : status ? status.count : scheduled;

/** 예약 결과를 사람이 읽을 글로. result는 예약한 결과, status는 그 뒤에 아이폰에서 다시 읽은 것(못 읽었으면 null). */
export function alarmReport(result: SyncResult, status: AlarmStatus | null): string {
  const { scheduled, source } = result;
  if (source === 'stuck') return '아이폰 알림 예약이 제때 끝나지 않았습니다. 잠시 뒤 다시 실행해 주세요.';
  if (source === 'denied') return '이 계정은 알림을 읽을 권한이 없어 예약한 알림을 지웠습니다. 관리자에게 문의하세요.';
  if (source === 'push') return '아이폰 알림은 CalendarFIF 홈 화면 앱의 푸시 알림으로 옵니다. 위젯은 알림을 예약하지 않습니다(같은 알림이 두 번 오지 않게).';
  if (scheduled === null) return `알림을 예약하지 못했습니다. ${PERMISSION_HINT}`;
  const lines: string[] = [];
  const count = status ? status.count : scheduled;
  if (status && status.count === 0 && scheduled > 0) {
    // 예약은 오류 없이 끝났는데 남지 않았다: 아이폰이 Scriptable의 알림을 받지 않는다.
    lines.push(`알림을 예약했지만 아이폰에 남지 않았습니다. ${PERMISSION_HINT}`);
  } else if (count === 0) {
    lines.push('앞으로 7일 안에 울릴 알림이 없습니다.');
  } else {
    lines.push(status ? `예약된 알림 ${count}개` : `알림 ${count}개를 예약했습니다.`);
    if (status && status.count < scheduled) lines.push(`예약한 ${scheduled}개 중 ${status.count}개만 아이폰에 남았습니다.`);
    if (status?.next) lines.push(`다음: ${dateText(status.next.at)} · ${status.next.body}`);
  }
  if (source === 'cache') lines.push('서버에서 알림을 읽지 못해 마지막으로 받아 둔 것으로 예약했습니다. 방금 만든 알림은 빠졌을 수 있습니다.');
  return lines.join('\n');
}

/** 시험 알림의 결과 글. stuck: 아이폰 알림 기능이 제때 끝나지 않았다. */
const TEST_REPORT: Record<TestResult | 'stuck', string> = {
  ok: `1분 뒤에 시험 알림이 옵니다. 지금 화면을 잠그고 기다려 보세요.\n${LOCK_HINT}`,
  missing: `시험 알림을 예약하지 못했습니다. ${PERMISSION_HINT}`,
  unknown: `시험 알림을 예약했지만 남았는지 확인하지 못했습니다. 화면을 잠그고 1분 기다려 보세요.\n${LOCK_HINT}`,
  stuck: '시험 알림 예약이 제때 끝나지 않았습니다. 잠시 뒤 다시 해 보세요.',
};

async function runInApp(host: Host, cfg: Config, now: () => Date): Promise<void> {
  let askedAgain = false;
  let alarmsDone = false; // 메뉴 앞에서 예약했으면 미리 보기에서 다시 하지 않는다
  // 앱이 열려 있을 때 바로 보이는 알림은 iOS가 띄우지 않을 수 있어 결과는 상자로 보인다.
  const scheduleOnly = host.args.queryParameters?.schedule === '1';
  // 위젯을 눌러서 왔다(매개변수 inapp): 메뉴 대신 달력을 Scriptable 안에서 연다. 열지 못하면 아래의 메뉴로 가고, 메뉴에 까닭을 적는다.
  // 두 길로 온다: 위젯의 누르는 주소(open=calendar)로 오거나, 위젯 편집의 "When Interacting"을 "Run Script"로 둔 위젯에서 온다
  // (그때는 위젯의 매개변수가 같이 온다. Scriptable의 목록에서 돌리면 매개변수가 없다).
  // 위젯을 새로 그리게 하려고 돌린 빈 실행이다(reload.ts의 ping): 아무것도 하지 않고 바로 끝낸다.
  if (host.args.queryParameters?.ping === '1') {
    skipLateUpdateCheck(host);
    return;
  }
  const words = paramWords(host);
  let calendarProblem = '';
  if (host.args.queryParameters?.open === 'calendar' || words.includes('inapp') || words.includes('앱안')) {
    calendarProblem = await openCalendarInApp(host, cfg, now);
    if (calendarProblem === '') return;
  }
  const show = async (): Promise<void> => {
    const at = now();
    const env = makeEnv(host, 'large', at);
    const skip = alarmsDone;
    alarmsDone = false;
    const view = await load(host, cfg, env, at, skip);
    // 저장된 로그인이 방금 거절돼 지워졌다: 이미 Scriptable 안이므로 안내 대신 바로 다시 묻는다(한 실행에 한 번).
    if (!askedAgain && !host.Keychain.contains(REFRESH_KEY)) {
      askedAgain = true;
      if (await askLogin(host, cfg)) await show();
      return;
    }
    await toWidget(host, env, view, cfg.appUrl, at).presentLarge();
  };
  if (!host.Keychain.contains(REFRESH_KEY)) {
    // 로그인하지 않았으면 메뉴가 뜨지 않는다. 달력을 열지 못한 까닭은 여기서 따로 알린다.
    if (calendarProblem !== '') await notify(host, 'CalendarFIF 위젯', `달력을 Scriptable 안에서 열지 못했습니다: ${calendarProblem}`);
    if (scheduleOnly) {
      // 예약만 하러 왔다(웹앱의 'Scriptable 열기'): 로그인 창 대신 안내만 한다.
      await notify(host, 'CalendarFIF 알림 예약', 'CalendarFIF 위젯에 먼저 로그인하세요. Scriptable에서 CalendarFIF를 실행하면 로그인 창이 나옵니다.');
      return;
    }
    if (await askLogin(host, cfg)) await show();
    return;
  }
  const result = await scheduleFromSaved(host, cfg, now());
  const status = result.scheduled === null ? null : await waitAtMost(host, pendingStatus(host), APP_ALARM_WAIT_MS, null);
  alarmsDone = true;
  if (scheduleOnly) {
    // 알림 예약만 하고 끝낸다(웹앱의 'Scriptable 열기'가 이 주소로 연다).
    await notify(host, 'CalendarFIF 알림 예약', alarmReport(result, status));
    return;
  }
  const menu = new host.Alert();
  const base = cfg.version ? `CalendarFIF 위젯 ${cfg.version}` : 'CalendarFIF 위젯';
  const count = verifiedCount(result.scheduled, status);
  menu.title = result.source === 'push' ? `${base} · 푸시 알림 사용 중` : count === null ? base : `${base} · 알림 ${count}개 예약됨`;
  const calendarLine = calendarProblem === '' ? '' : `달력을 Scriptable 안에서 열지 못했습니다: ${calendarProblem}`;
  // 위젯과 위젯에서 연 달력이 실제로 한 일(status.ts). 아이폰에서 무엇이 도는지 볼 길이 이것뿐이다.
  // 위젯을 바로 새로 그리게 하는 방법을 아직 가리지 못했으면 메뉴를 띄워 둔 동안 해 본다(reload.ts).
  // 위젯이 그린 기록이 없으면 하지 않는다(홈 화면에 위젯이 없거나 아직 그려진 적이 없어 결과를 가릴 수 없다).
  const seen = cacheObject(host);
  const plan = drawsOf(seen?.draws).length === 0 ? [] : toProbe(triesOf(seen?.reload), now().getTime());
  const probeLine = plan.length === 0 ? '' : '위젯을 바로 새로 그리는 방법을 시험하는 중입니다. 이 창을 20초쯤 뒤에 닫아 주세요(결과는 다음에 열 때 아래 상태에 나옵니다).';
  menu.message = [alarmReport(result, status), updateLine(host, cfg), probeLine, statusOf(host, now()), calendarLine].filter((t) => t !== '').join('\n\n');
  menu.addAction('미리 보기');
  menu.addAction('시험 알림 (1분 뒤)');
  menu.addAction('로그아웃');
  menu.addCancelAction('닫기');
  const stopProbing = probeReload(host, now, plan);
  let choice: number;
  try {
    choice = await menu.presentAlert();
  } finally {
    stopProbing();
  }
  if (choice === 0) await show();
  else if (choice === 1) {
    const test = await waitAtMost<TestResult | 'stuck'>(host, scheduleTest(host, now()), APP_ALARM_WAIT_MS, 'stuck');
    await notify(host, 'CalendarFIF 시험 알림', TEST_REPORT[test]);
  } else if (choice === 2) {
    await clearAll(host);
    await notify(host, 'CalendarFIF 위젯', '로그아웃했습니다.');
  }
}

/** 오류 내용을 28자씩 5줄까지, 버전을 알면 마지막 줄에 (버전). */
function errorLines(e: unknown, version: string | undefined): string[] {
  const lines: string[] = [];
  try {
    const text = e instanceof Error ? e.message : isApiError(e) ? e.code : String(e);
    const chars = Array.from(text);
    for (let i = 0; i < chars.length && lines.length < 5; i += 28) lines.push(chars.slice(i, i + 28).join(''));
  } catch {
    // 내용을 읽지 못해도 '오류'와 버전은 보인다.
  }
  if (version) lines.push(`(${version})`);
  return lines;
}

/** 오류 위젯을 지금 방식으로 그리고, 안 되면 다른 방식으로 그린다. 둘 다 안 되면(환경을 못 만들어도) null. */
function drawnErrorWidget(host: Host, cfg: Config, now: () => Date, lines: string[]): ListWidgetLike | null {
  let at: Date;
  let env: Env;
  try {
    at = now();
    env = makeEnv(host, host.config.runsInApp ? 'large' : pickFamily(host.config.widgetFamily), at);
  } catch {
    return null;
  }
  try {
    return toWidget(host, env, message(env, '오류', lines), cfg.appUrl, at);
  } catch {
    // 기본 부품이 깨졌으면 그림으로, 그림이 깨졌으면 기본 부품으로 그린다.
  }
  try {
    return env.image
      ? renderTree(host, messageTree({ title: '오류', lines }), cfg.appUrl, at, env.force)
      : makeWidget(host, messageScene({ theme: env.pictureTheme(), size: env.size, title: '오류', lines }), cfg.appUrl, at);
  } catch {
    return null;
  }
}

/** 글자만 있는 위젯: '오류'와 오류 줄. 하나씩 따로 넣어 들어가는 것은 다 넣는다. */
function bareErrorWidget(host: Host, cfg: Config, lines: string[]): ListWidgetLike {
  const widget = new host.ListWidget();
  try {
    widget.url = cfg.appUrl;
  } catch {
    // 주소가 안 들어가도 위젯은 둔다.
  }
  for (const line of ['오류', ...lines]) {
    try {
      widget.addText(line);
    } catch {
      // 글자가 안 들어가도 위젯은 둔다.
    }
  }
  return widget;
}

/** 마지막 수단: 오류 내용을 보이는 위젯을 둔다. 절대 던지지 않는다. */
async function deliverError(host: Host, cfg: Config, now: () => Date, error: unknown): Promise<void> {
  try {
    const lines = errorLines(error, cfg.version);
    const widget = drawnErrorWidget(host, cfg, now, lines) ?? bareErrorWidget(host, cfg, lines);
    if (host.config.runsInApp) await widget.presentLarge();
    else host.Script.setWidget(widget);
  } catch {
    // 더 할 수 있는 일이 없다.
  }
}

/** 위젯을 그린 기록을 보관 파일의 draws 칸에 더한다(마지막 여덟 번). 메뉴의 상태에 보인다. 던지지 않는다. */
function noteDraw(host: Host, note: DrawNote): void {
  try {
    const cache = cacheObject(host);
    const patch: Record<string, unknown> = { draws: [...drawsOf(cache?.draws), note].slice(-MAX_DRAWS) };
    // 이 그림을 부른 시도가 있으면 거기에 적는다(reload.ts): 어느 방법이 위젯을 새로 그리게 하는지 이것으로 가린다.
    const credited = creditDraw(triesOf(cache?.reload), note.at);
    if (credited) patch.reload = reloadCell(credited);
    updateCache(host, patch);
  } catch {
    // 적지 못해도 위젯은 이미 두었다.
  }
}

/** 메뉴에 적을 상태 글(status.ts). 읽지 못하면 빈 글. */
function statusOf(host: Host, now: Date): string {
  try {
    const cache = cacheObject(host) ?? {};
    const activeAt = typeof cache.activeAt === 'number' && Number.isFinite(cache.activeAt) ? cache.activeAt : 0;
    const { version, unfinished, skipUntil, note, libNote } = readUpdateState(host);
    return statusText({
      now: now.getTime(), draws: drawsOf(cache.draws), web: webProbeOf(cache.web), activeAt, leave: leaveOf(cache.leave), pending: pendingStateOf(cache.pending), bridge: bridgeOf(cache.bridge),
      update: { version, unfinished, skipUntil, note, libNote }, reload: triesOf(cache.reload),
    });
  } catch {
    return '';
  }
}

/** 위젯의 시작. 받아 둔 새 코드가 있으면 그것에 넘기고(update.ts), 없으면 이 스크립트의 것으로 돈다. */
export async function run(host: Host, cfg: Config, now: () => Date = () => new Date()): Promise<void> {
  await runWithUpdate(host, cfg, now, () => runSelf(host, cfg, now));
}

async function runSelf(host: Host, cfg: Config, now: () => Date): Promise<void> {
  const inApp = host.config.runsInApp;
  try {
    if (inApp) {
      await runInApp(host, cfg, now);
    } else {
      const at = now();
      const env = makeEnv(host, pickFamily(host.config.widgetFamily), at);
      const widget = toWidget(host, env, await load(host, cfg, env, at), tapUrl(host, env, cfg), at);
      host.Script.setWidget(widget);
      noteDraw(host, { at: at.getTime(), v: cfg.version ?? '', src: loadNote.src, over: loadNote.over, next: widget.refreshAfterDate.getTime() });
    }
  } catch (e) {
    // 넘겨받은 실행이면 오류 위젯을 두지 않고 붙여 넣은 스크립트에 돌려준다. 그쪽이 자기 것으로 그리고 고친 버전을 찾는다(update.ts).
    if (cfg.handedOver) throw e;
    await deliverError(host, cfg, now, e);
  }
}
