import { isColor } from '../core/color';
import type { DayValue } from '../core/types';
import { isApiError, readMonth, refreshSession, signIn, type Config } from './api';
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

function writeCache(host: Host, data: MonthData, now: Date): void {
  try {
    host.FileManager.local().writeString(cachePath(host), JSON.stringify({ monthId: data.monthId, days: data.days, savedAt: now.getTime() }));
  } catch {
    // 보관하지 못해도 위젯은 그린다.
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

const message = (env: Env, title: string, lines: string[]): View =>
  env.image ? { scene: messageScene({ theme: env.pictureTheme(), size: env.size, title, lines }) } : { tree: messageTree({ title, lines }) };
const loginHint = (env: Env): View => message(env, '로그인이 필요합니다', ['Scriptable 앱에서', '이 스크립트를 한 번 실행해', '로그인하세요.']);

/** 이번 달 위젯에 놓을 것을 만든다. 읽지 못하는 까닭이 있으면 그 까닭을 알리는 것을 돌려준다. */
async function load(host: Host, cfg: Config, env: Env, now: Date): Promise<View> {
  const token = host.Keychain.contains(REFRESH_KEY) ? host.Keychain.get(REFRESH_KEY) : '';
  if (token === '') return loginHint(env);
  const monthId = env.today.slice(0, 7);
  const fromCache = (code: string | null): View => {
    const cached = readCache(host, monthId);
    if (cached) return monthView(env, cached, true);
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
    return monthView(env, month, false);
  } catch (e) {
    if (!isApiError(e)) throw e;
    if (e.kind === 'network') return fromCache(null);
    if (e.kind === 'failed') return fromCache(e.code);
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

async function runInApp(host: Host, cfg: Config, now: () => Date): Promise<void> {
  let askedAgain = false;
  const show = async (): Promise<void> => {
    const at = now();
    const env = makeEnv(host, 'large', at);
    const view = await load(host, cfg, env, at);
    // 저장된 로그인이 방금 거절돼 지워졌다: 이미 Scriptable 안이므로 안내 대신 바로 다시 묻는다(한 실행에 한 번).
    if (!askedAgain && !host.Keychain.contains(REFRESH_KEY)) {
      askedAgain = true;
      if (await askLogin(host, cfg)) await show();
      return;
    }
    await toWidget(host, env, view, cfg.appUrl, at).presentLarge();
  };
  if (!host.Keychain.contains(REFRESH_KEY)) {
    if (await askLogin(host, cfg)) await show();
    return;
  }
  const menu = new host.Alert();
  menu.title = cfg.version ? `CalendarFIF 위젯 ${cfg.version}` : 'CalendarFIF 위젯';
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
