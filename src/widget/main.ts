import { isColor } from '../core/color';
import { parseOfficialHolidays, setOfficialHolidays, type OfficialYear } from '../core/holidays';
import type { DayValue } from '../core/types';
import { parseEventMap, type EventMap } from '../core/events';
import { clearAlarms, pendingStatus, scheduleAlarms, scheduleTest, type AlarmStatus, type TestResult } from './alarms';
import { isApiError, readEvents, readMonth, readPushDeviceCount, refreshSession, signIn, type Config, type Session } from './api';
import type { Host, ListWidgetLike } from './host';
import { makeWidget } from './render';
import { renderTree } from './renderTree';
import { buildScene, messageScene, type MonthData, type Scene } from './scene';
import { widgetSize, type Family, type Size } from './sizes';
import type { Theme } from './theme';
import { buildTree, messageTree, type Tree } from './tree';

const REFRESH_KEY = 'calendarfif.refreshToken';
const UID_KEY = 'calendarfif.uid';
const CACHE_FILE = 'calendarfif-cache.json';
const HOLIDAY_FILE = 'calendarfif-holidays.json';
const HOLIDAY_FRESH_MS = 24 * 3_600_000; // 받은 지 이만큼 안이면 다시 받지 않는다
const HOLIDAY_RETRY_MS = 6 * 3_600_000; // 받지 못하면 이만큼 지나야 다시 받는다(위젯은 자주 새로 그려진다)

/** 위젯에 놓을 것: 기본은 기본 부품의 나무, 위젯 매개변수에 image가 있으면 그림 장면. */
type View = { tree: Tree } | { scene: Scene };
/** force: 매개변수로 고정한 밝기(없으면 기본 부품의 색이 화면 밝기를 스스로 따른다). pictureTheme: 그림을 그릴 밝기(그림을 그릴 때만 묻는다). */
type Env = { family: Family; image: boolean; lunar: boolean; force: Theme | undefined; pictureTheme: () => Theme; size: Size; today: string };

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
  return { family, image, lunar, force, pictureTheme, size: widgetSize(host.Device.screenSize(), family), today: localDate(now) };
}

function monthView(env: Env, month: MonthData, offline: boolean): View {
  const input = { family: env.family, size: env.size, today: env.today, month, offline, lunar: env.lunar };
  return env.image ? { scene: buildScene({ ...input, theme: env.pictureTheme() }) } : { tree: buildTree(input) };
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

function writeCache(host: Host, data: MonthData, now: Date): void {
  updateCache(host, { monthId: data.monthId, days: data.days, savedAt: now.getTime() });
}

/** 마지막으로 읽은 "푸시 알림을 쓰는가". 읽은 적이 없으면 false. */
function readCachedPushOn(host: Host): boolean {
  try {
    const fm = host.FileManager.local();
    const path = cachePath(host);
    if (!fm.fileExists(path)) return false;
    const parsed = JSON.parse(fm.readString(path)) as { pushOn?: unknown } | null;
    return parsed?.pushOn === true;
  } catch {
    return false;
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
 * 푸시 알림을 켠 기기가 있어 예약하지 않고 예약해 둔 것을 지웠다.
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
    // 푸시 알림을 켠 기기가 있으면 알림은 푸시로 간다. 위젯이 예약하면 같은 알림이 두 번 오므로 예약하지 않고 지운다.
    // 읽지 못하면 마지막으로 읽은 것을 따른다.
    let pushOn = readCachedPushOn(host);
    if (session) {
      try {
        pushOn = (await readPushDeviceCount(host, cfg, session)) > 0;
        updateCache(host, { pushOn });
      } catch {
        // 보관한 값을 쓴다.
      }
    }
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
  const token = host.Keychain.contains(REFRESH_KEY) ? host.Keychain.get(REFRESH_KEY) : '';
  if (token === '') return loginHint(env);
  const monthId = env.today.slice(0, 7);
  // 공휴일 자료는 달을 읽는 동안 함께 받고, 달을 그리기 전에 기다린다. 이 약속은 거절되지 않는다.
  const holidays = prepareHolidays(host, cfg, now);
  const drawMonth = async (month: MonthData, offline: boolean): Promise<View> => {
    await holidays;
    return monthView(env, month, offline);
  };
  const fromCache = async (code: string | null): Promise<View> => {
    const cached = readCache(host, monthId);
    if (cached) return drawMonth(cached, true);
    return code === null
      ? message(env, '불러오지 못했습니다', ['네트워크를 확인하세요.'])
      : message(env, '불러오지 못했습니다', ['잠시 뒤 다시 시도합니다.', `(${Array.from(code).slice(0, 40).join('')})`]);
  };
  try {
    const session = await refreshSession(host, cfg, token);
    if (session.refreshToken !== token) storeLogin(host, session.refreshToken, session.uid);
    const days = await readMonth(host, cfg, session, monthId);
    const month: MonthData = { monthId, days };
    writeCache(host, month, now);
    // 던지지 않는다. 알림 기능이 멈춰 끝나지 않아도 5초 뒤에는 그린다(예약은 다음 실행에 다시 한다).
    if (!alarmsDone) await waitAtMost(host, syncAlarms(host, cfg, session, now), ALARM_SYNC_WAIT_MS, SYNC_UNKNOWN);
    return await drawMonth(month, false);
  } catch (e) {
    if (!isApiError(e)) throw e;
    if (e.kind === 'network') return fromCache(null);
    if (e.kind === 'failed') return fromCache(e.code);
    if (e.kind === 'denied') return message(env, '권한이 없습니다', ['관리자에게 문의하세요.']);
    if (e.kind === 'rejected') {
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
  menu.message = alarmReport(result, status);
  menu.addAction('미리 보기');
  menu.addAction('시험 알림 (1분 뒤)');
  menu.addAction('로그아웃');
  menu.addCancelAction('닫기');
  const choice = await menu.presentAlert();
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

export async function run(host: Host, cfg: Config, now: () => Date = () => new Date()): Promise<void> {
  const inApp = host.config.runsInApp;
  try {
    if (inApp) {
      await runInApp(host, cfg, now);
    } else {
      const at = now();
      const env = makeEnv(host, pickFamily(host.config.widgetFamily), at);
      host.Script.setWidget(toWidget(host, env, await load(host, cfg, env, at), cfg.appUrl, at));
    }
  } catch (e) {
    await deliverError(host, cfg, now, e);
  }
}
