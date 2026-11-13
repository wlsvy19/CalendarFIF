import { isColor } from '../core/color';
import type { DayValue } from '../core/types';
import { isApiError, readMonth, refreshSession, signIn, type Config } from './api';
import type { Host } from './host';
import { makeWidget } from './render';
import { buildScene, messageScene, type MonthData, type Scene } from './scene';
import { widgetSize, type Family, type Size } from './sizes';
import type { Theme } from './theme';

const REFRESH_KEY = 'calendarfif.refreshToken';
const UID_KEY = 'calendarfif.uid';
const CACHE_FILE = 'calendarfif-cache.json';

type Env = { family: Family; theme: Theme; size: Size; today: string };

const pad2 = (n: number): string => String(n).padStart(2, '0');
const localDate = (d: Date): string => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

function pickFamily(raw: string | null): Family {
  return raw === 'small' || raw === 'medium' ? raw : 'large';
}

function makeEnv(host: Host, family: Family, now: Date): Env {
  const param = typeof host.args.widgetParameter === 'string' ? host.args.widgetParameter.trim().toLowerCase() : '';
  const theme: Theme = param === 'light' || param === 'dark' ? param : host.Device.isUsingDarkAppearance() ? 'dark' : 'light';
  return { family, theme, size: widgetSize(host.Device.screenSize(), family), today: localDate(now) };
}

// 보관해 둔 달: 네트워크가 안 될 때 마지막으로 읽은 것을 그린다.
const cachePath = (host: Host): string => {
  const fm = host.FileManager.local();
  return fm.joinPath(fm.documentsDirectory(), CACHE_FILE);
};

function writeCache(host: Host, data: MonthData, now: Date): void {
  try {
    host.FileManager.local().writeString(cachePath(host), JSON.stringify({ monthId: data.monthId, days: data.days, savedAt: now.getTime() }));
  } catch {
    // 보관하지 못해도 위젯은 그린다.
  }
}

function readCache(host: Host, monthId: string): MonthData | null {
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
      const day = v as Partial<DayValue> | null;
      if (day && typeof day.text === 'string' && typeof day.color === 'string' && isColor(day.color)) out[key] = { text: day.text, color: day.color };
    }
    return { monthId, days: out };
  } catch {
    return null;
  }
}

function clearLogin(host: Host): void {
  for (const key of [REFRESH_KEY, UID_KEY]) if (host.Keychain.contains(key)) host.Keychain.remove(key);
}

function clearAll(host: Host): void {
  clearLogin(host);
  const fm = host.FileManager.local();
  const path = cachePath(host);
  if (fm.fileExists(path)) fm.remove(path);
}

function storeLogin(host: Host, refreshToken: string, uid: string): void {
  host.Keychain.set(REFRESH_KEY, refreshToken);
  host.Keychain.set(UID_KEY, uid);
}

const message = (env: Env, title: string, lines: string[]): Scene => messageScene({ theme: env.theme, size: env.size, title, lines });
const loginHint = (env: Env): Scene => message(env, '로그인이 필요합니다', ['Scriptable 앱에서', '이 스크립트를 한 번 실행해', '로그인하세요.']);

/** 이번 달 장면을 만든다. 읽지 못하는 까닭이 있으면 그 까닭을 알리는 장면을 돌려준다. */
async function load(host: Host, cfg: Config, env: Env, now: Date): Promise<Scene> {
  const token = host.Keychain.contains(REFRESH_KEY) ? host.Keychain.get(REFRESH_KEY) : '';
  if (token === '') return loginHint(env);
  const monthId = env.today.slice(0, 7);
  const fromCache = (): Scene => {
    const cached = readCache(host, monthId);
    return cached
      ? buildScene({ family: env.family, theme: env.theme, size: env.size, today: env.today, month: cached, offline: true })
      : message(env, '불러오지 못했습니다', ['네트워크를 확인하세요.']);
  };
  try {
    const session = await refreshSession(host, cfg, token);
    if (session.refreshToken !== token) storeLogin(host, session.refreshToken, session.uid);
    const days = await readMonth(host, cfg, session, monthId);
    const month: MonthData = { monthId, days };
    writeCache(host, month, now);
    return buildScene({ family: env.family, theme: env.theme, size: env.size, today: env.today, month, offline: false });
  } catch (e) {
    if (!isApiError(e)) throw e;
    if (e.kind === 'network') return fromCache();
    if (e.kind === 'denied') return message(env, '권한이 없습니다', ['관리자에게 문의하세요.']);
    if (e.kind === 'rejected') {
      clearLogin(host);
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
    alert.addTextField('이메일', email);
    alert.addSecureTextField('비밀번호');
    alert.addAction('로그인');
    alert.addCancelAction('취소');
    if ((await alert.presentAlert()) !== 0) return false;
    email = alert.textFieldValue(0).trim();
    const password = alert.textFieldValue(1);
    try {
      const session = await signIn(host, cfg, email, password);
      storeLogin(host, session.refreshToken, session.uid);
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

async function runInApp(host: Host, cfg: Config, now: () => Date): Promise<void> {
  const show = async (): Promise<void> => {
    const at = now();
    const scene = await load(host, cfg, makeEnv(host, 'large', at), at);
    await makeWidget(host, scene, cfg.appUrl, at).presentLarge();
  };
  if (!host.Keychain.contains(REFRESH_KEY)) {
    if (await askLogin(host, cfg)) await show();
    return;
  }
  const menu = new host.Alert();
  menu.title = 'CalendarFIF 위젯';
  menu.addAction('미리 보기');
  menu.addAction('로그아웃');
  menu.addCancelAction('닫기');
  const choice = await menu.presentAlert();
  if (choice === 0) await show();
  else if (choice === 1) {
    clearAll(host);
    await notify(host, 'CalendarFIF 위젯', '로그아웃했습니다.');
  }
}

const errorLines = (e: unknown): string[] => {
  const text = e instanceof Error ? e.message : isApiError(e) ? e.code : String(e);
  const chars = Array.from(text);
  const lines: string[] = [];
  for (let i = 0; i < chars.length && lines.length < 3; i += 28) lines.push(chars.slice(i, i + 28).join(''));
  return lines;
};

export async function run(host: Host, cfg: Config, now: () => Date = () => new Date()): Promise<void> {
  const inApp = host.config.runsInApp;
  try {
    if (inApp) {
      await runInApp(host, cfg, now);
    } else {
      const at = now();
      const env = makeEnv(host, pickFamily(host.config.widgetFamily), at);
      host.Script.setWidget(makeWidget(host, await load(host, cfg, env, at), cfg.appUrl, at));
    }
  } catch (e) {
    // 위젯은 어떤 경우에도 하나는 만들어 둔다.
    const at = now();
    const env = makeEnv(host, inApp ? 'large' : pickFamily(host.config.widgetFamily), at);
    const widget = makeWidget(host, message(env, '오류', errorLines(e)), cfg.appUrl, at);
    if (inApp) await widget.presentLarge();
    else host.Script.setWidget(widget);
  }
}
