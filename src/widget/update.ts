// 위젯 스크립트의 자동 업데이트.
//
// Scriptable에 붙여 넣은 스크립트는 스스로 바뀌지 않는다. 그래서 붙여 넣은 스크립트(바탕)가 웹앱의 주소에서 새 위젯 코드를 받아
// 아이폰에 보관해 두고, 보관한 것이 자기보다 새 것이면 그것에 실행을 넘긴다. 한 번 붙여 넣은 뒤로는 다시 붙여 넣지 않아도 된다.
//
// 이 파일의 코드는 붙여 넣은 스크립트 안에서 돈다. 붙여 넣은 뒤에는 고칠 수 없으므로(받아 온 쪽은 확인과 받기를 하지 않는다)
// 여기를 고치면 사용자가 다시 붙여 넣어야 한다. 될 수 있으면 건드리지 않는다.
//
//  - 받는 곳: <웹앱 주소>/widget/version.json(버전과 글자 수)과 /widget/calendarfif-widget-lib.js(위젯 코드, module.exports를 둔다).
//    웹앱과 같은 주소라서 웹앱을 믿는 만큼 믿는다. https 주소가 아니면 받지 않는다.
//  - 위젯으로 돌 때는 먼저 그리고 나서 확인한다. 받은 것은 다음에 그릴 때부터 쓴다.
//    Scriptable 앱 안에서 돌릴 때는 먼저 확인하고 바로 새 것으로 돈다.
//  - 확인은 세 시간에 한 번이고, 물은 지 30분 안에는 다시 묻지 않는다. 앱 안에서는 늘 확인한다.
//  - 새 것인지는 버전으로만 본다(번호가 크거나, 번호가 같으면 만든 날이 늦은 것). 옛 버전을 다시 배포해도 위젯은 되돌아가지 않는다.
//    잘못된 버전을 고칠 때는 늘 버전을 올려 배포한다.
//  - 업데이트 때문에 위젯이 깨지지 않게 한다. 아래의 경우에는 붙여 넣은 스크립트로 그리고, 다음 확인을 앞당긴다
//    (그래서 고친 것을 배포하면 다시 받아 간다):
//    받아 둔 코드를 읽지 못한다 → 받아 둔 것을 버린다. 같은 버전을 한 번 더 받아 보고, 또 못 읽으면 더 새 것이 나올 때까지 받지 않는다.
//    받아 둔 코드가 오류를 낸다 → 그 위젯은 한 시간 동안 넘기지 않는다.
//    받아 둔 코드로 넘긴 위젯 실행이 세 번 잇달아 끝나지 못한다(멈췄거나 아이폰이 껐다) → 그 위젯은 한 번 넘기지 않는다.
//    위젯마다(크기와 매개변수) 따로 세고, 앱 안의 실행도 따로 본다. 읽기 시작할 때부터 센다(받아 둔 코드는 읽을 때 맨 위가 돈다).
import type { Config } from './api';
import type { Host } from './host';

/** 받아 둔 위젯 코드의 이름. importModule은 이 이름으로 찾는다(파일은 이름 + '.js'). */
export const LIB_NAME = 'calendarfif-widget-lib';
export const UPDATE_FILE = 'calendarfif-update.json';
/** 위젯 코드 파일의 마지막 줄. 받다가 끊긴 파일을 가려낸다. */
export const LIB_END = '// CalendarFIF widget code end';
const CHECK_EVERY_MS = 3 * 3_600_000;
const RETRY_AFTER_MS = 30 * 60_000;
/** 받아 둔 코드가 오류를 내면 이만큼은 넘기지 않는다. */
export const SKIP_AFTER_ERROR_MS = 3_600_000;
/** 받아 둔 코드로 넘긴 위젯 실행이 이만큼 잇달아 끝나지 못하면 한 번은 붙여 넣은 것으로 돈다. */
export const MAX_UNFINISHED = 3;
/** 같은 버전을 이만큼 잇달아 읽지 못하면 더 새 것이 나올 때까지 받지 않는다. */
export const MAX_LOAD_FAILS = 2;
const MAX_KEYS = 20;
/** 앱 안의 실행을 가리키는 열쇠. 위젯의 열쇠(크기|매개변수)와 겹치지 않는다. */
const APP_KEY = 'app';

/**
 * version: 받아 둔 코드의 버전(없으면 빈 글). checkedAt: 마지막으로 확인을 마친 때(0이면 곧 다시 확인한다). triedAt: 마지막으로 물은 때.
 * unfinished: 위젯마다, 받아 둔 코드로 넘긴 실행 가운데 잇달아 끝나지 못한 수. skipUntil: 위젯마다(앱 안은 'app'), 이때까지는 넘기지 않는다.
 * badVersion과 loadFails: 읽지 못한 버전과 그것을 잇달아 읽지 못한 수.
 * note: 마지막 확인의 문제(확인이 되면 지운다). libNote: 받아 둔 코드의 문제(다른 새 것을 받으면 지운다).
 */
export type UpdateState = {
  version: string; checkedAt: number; triedAt: number;
  unfinished: Record<string, number>; skipUntil: Record<string, number>;
  badVersion: string; loadFails: number; note: string; libNote: string;
};
export type Lib = { version: string; run(host: Host, cfg: Config, now?: () => Date): Promise<void> };

const empty = (): UpdateState => ({ version: '', checkedAt: 0, triedAt: 0, unfinished: {}, skipUntil: {}, badVersion: '', loadFails: 0, note: '', libNote: '' });
const message = (e: unknown): string => {
  try {
    return e instanceof Error ? e.message : String(e);
  } catch {
    return '알 수 없는 오류';
  }
};
const within = (now: number, at: number, ms: number): boolean => at > 0 && now - at >= 0 && now - at < ms;
const fileOf = (host: Host, name: string): string => {
  const fm = host.FileManager.local();
  return fm.joinPath(fm.documentsDirectory(), name);
};
/** 위젯 하나를 가리키는 글: 크기와 매개변수. 같은 스크립트로 둔 위젯들을 따로 본다. */
function widgetKey(host: Host): string {
  try {
    const parameter = host.args.widgetParameter;
    return `${host.config.widgetFamily ?? ''}|${typeof parameter === 'string' ? parameter : ''}`;
  } catch {
    return '|';
  }
}

/** '0.9.0 (2026-11-16)'을 견줄 수 있는 수들로 바꾼다. 그런 꼴이 아니면 null. */
export function versionKey(text: string | undefined): number[] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)(?: \((\d{4})-(\d{2})-(\d{2})\))?$/.exec(text ?? '');
  return m ? [Number(m[1]), Number(m[2]), Number(m[3]), m[4] ? Number(`${m[4]}${m[5]}${m[6]}`) : 0] : null;
}

/** a가 b보다 새 버전인가. 둘 중 하나라도 읽지 못하면 아니다. */
export function isNewer(a: string | undefined, b: string | undefined): boolean {
  const [ka, kb] = [versionKey(a), versionKey(b)];
  if (!ka || !kb) return false;
  for (let i = 0; i < ka.length; i += 1) if (ka[i] !== kb[i]) return ka[i] > kb[i];
  return false;
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
/** 열쇠마다 수를 적은 것을 읽는다. 0보다 큰 수만, 뒤쪽(새로 적은 쪽)의 MAX_KEYS개만 남긴다. */
function numMap(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (typeof v !== 'object' || v === null) return out;
  for (const [key, value] of Object.entries(v as Record<string, unknown>).filter(([, x]) => num(x) > 0).slice(-MAX_KEYS)) out[key] = num(value);
  return out;
}

export function readUpdateState(host: Host): UpdateState {
  try {
    const fm = host.FileManager.local();
    const path = fileOf(host, UPDATE_FILE);
    const raw: unknown = fm.fileExists(path) ? JSON.parse(fm.readString(path)) : null;
    if (typeof raw !== 'object' || raw === null) return empty();
    const r = raw as Record<string, unknown>;
    const text = (v: unknown): string => (typeof v === 'string' ? v : '');
    return {
      version: versionKey(text(r.version)) ? text(r.version) : '',
      checkedAt: num(r.checkedAt), triedAt: num(r.triedAt),
      unfinished: numMap(r.unfinished), skipUntil: numMap(r.skipUntil),
      badVersion: versionKey(text(r.badVersion)) ? text(r.badVersion) : '', loadFails: num(r.loadFails),
      note: text(r.note), libNote: text(r.libNote),
    };
  } catch {
    return empty();
  }
}

/** 적어 둔 것에 칸을 덮어쓴다(쓸 때마다 다시 읽는다). 적지 못해도 던지지 않는다. */
function patchState(host: Host, patch: Partial<UpdateState>): UpdateState {
  const next = { ...readUpdateState(host), ...patch };
  try {
    host.FileManager.local().writeString(fileOf(host, UPDATE_FILE), JSON.stringify(next));
  } catch {
    // 다음에 다시 한다.
  }
  return next;
}

/** 열쇠마다 적는 칸(unfinished, skipUntil)에서 이 열쇠의 수만 바꾼다. 0이면 지운다. 다른 열쇠는 그대로 둔다. */
function setKeyed(host: Host, field: 'unfinished' | 'skipUntil', key: string, value: number): void {
  const map = { ...readUpdateState(host)[field] };
  delete map[key];
  if (value > 0) map[key] = value; // 지웠다가 넣어 맨 뒤(새로 적은 쪽)에 둔다
  patchState(host, { [field]: map });
}

async function getText(host: Host, url: string, seconds: number): Promise<string> {
  const req = new host.Request(url);
  req.method = 'GET';
  req.timeoutInterval = seconds;
  const text = await req.loadString();
  const status = req.response?.statusCode;
  if (status !== undefined && (status < 200 || status >= 300)) throw new Error(`받지 못했다(${status})`);
  return text;
}

/**
 * 새 위젯 코드가 있는지 확인하고, 있으면 받아 보관한다. 던지지 않는다.
 * 위젯으로 돌 때는 확인한 지 세 시간이 안 됐거나 물은 지 30분이 안 됐으면 건너뛴다.
 */
export async function checkForUpdate(host: Host, cfg: Config, at: Date): Promise<UpdateState> {
  try {
    const state = readUpdateState(host);
    const t = at.getTime();
    if (!host.config.runsInApp && (within(t, state.triedAt, RETRY_AFTER_MS) || within(t, state.checkedAt, CHECK_EVERY_MS))) return state;
    // 묻기 전에 적어 둔다: 받다가 아이폰이 위젯을 꺼도 다음에 그릴 때마다 다시 받지 않게.
    patchState(host, { triedAt: t });
    try {
      const base = cfg.appUrl.replace(/\/+$/, '');
      const remote: unknown = JSON.parse(await getText(host, `${base}/widget/version.json?t=${t}`, 5));
      const { version, chars } = (typeof remote === 'object' && remote !== null ? remote : {}) as { version?: unknown; chars?: unknown };
      if (typeof version !== 'string' || !versionKey(version) || typeof chars !== 'number') throw new Error('버전 파일을 읽지 못했다');
      // 붙여 넣은 것과 받아 둔 것 가운데 새 쪽보다 더 새 것만 받는다. 거듭 읽지 못한 버전은 받지 않는다.
      const have = isNewer(state.version, cfg.version) ? state.version : cfg.version;
      const givenUp = version === state.badVersion && state.loadFails >= MAX_LOAD_FAILS;
      if (isNewer(version, have) && !givenUp) {
        const code = await getText(host, `${base}/widget/${LIB_NAME}.js?v=${encodeURIComponent(version)}`, 15);
        if (code.length !== chars || !code.trimEnd().endsWith(LIB_END)) throw new Error(`받은 ${version}이 온전하지 않다(${code.length}/${chars}자)`);
        host.FileManager.local().writeString(fileOf(host, `${LIB_NAME}.js`), code);
        // 다른 새 것이면 앞의 것에 대해 적어 둔 것을 지운다. 읽지 못했던 버전을 다시 받은 것이면 그 기록은 둔다.
        const again = version === state.badVersion;
        return patchState(host, { version, checkedAt: t, unfinished: {}, skipUntil: {}, note: '', ...(again ? {} : { badVersion: '', loadFails: 0, libNote: '' }) });
      }
      return patchState(host, { checkedAt: t, note: '' });
    } catch (e) {
      return patchState(host, { note: message(e) });
    }
  } catch {
    return empty();
  }
}

/**
 * 받아 둔 위젯 코드가 붙여 넣은 스크립트보다 새 것이면 읽어 온다. 없거나, 새 것이 아니면 null.
 * Scriptable의 importModule로 먼저 읽고, 안 되면 파일의 글을 함수로 만들어 읽는다.
 * 둘 다 안 되면 받아 둔 것을 버리고 null을 준다. 처음이면 다음 확인을 앞당겨 한 번 더 받아 본다.
 */
export function loadCachedLib(host: Host, cfg: Config): Lib | null {
  const state = readUpdateState(host);
  if (!isNewer(state.version, cfg.version)) return null;
  const good = (x: unknown): x is Lib => typeof x === 'object' && x !== null && typeof (x as Lib).run === 'function' && (x as Lib).version === state.version;
  const problems: string[] = [];
  try {
    const lib: unknown = host.importModule ? host.importModule(LIB_NAME) : undefined;
    if (good(lib)) return lib;
    problems.push('importModule이 다른 것을 주었다');
  } catch (e) {
    problems.push(`importModule: ${message(e)}`);
  }
  try {
    const module: { exports: unknown } = { exports: {} };
    new Function('module', host.FileManager.local().readString(fileOf(host, `${LIB_NAME}.js`)))(module);
    if (good(module.exports)) return module.exports;
    problems.push('파일이 다른 것을 주었다');
  } catch (e) {
    problems.push(`파일: ${message(e)}`);
  }
  const loadFails = (state.badVersion === state.version ? state.loadFails : 0) + 1;
  patchState(host, {
    version: '', badVersion: state.version, loadFails,
    ...(loadFails < MAX_LOAD_FAILS ? { checkedAt: 0 } : {}),
    libNote: `받아 둔 ${state.version}을 쓰지 못했다(${problems.join(', ')})`,
  });
  return null;
}

/**
 * 위젯을 돌린다. 받아 둔 새 코드가 있으면 그것에 넘기고, 없으면 self(붙여 넣은 스크립트의 것)로 돈다.
 * 넘겨받은 쪽(cfg.handedOver)은 다시 넘기지 않는다. 버전을 모르거나 웹앱 주소가 https가 아니면 업데이트 없이 돈다.
 */
export async function runWithUpdate(host: Host, cfg: Config, now: () => Date, self: () => Promise<void>): Promise<void> {
  if (cfg.handedOver || !versionKey(cfg.version) || !/^https:\/\//i.test(cfg.appUrl ?? '')) return self();
  const inApp = host.config.runsInApp;
  if (inApp) await checkForUpdate(host, cfg, now());
  let ran = false;
  try {
    const before = readUpdateState(host);
    const t = now().getTime();
    const key = inApp ? APP_KEY : widgetKey(host);
    const count = before.unfinished[key] ?? 0;
    const until = before.skipUntil[key] ?? 0;
    const resting = until > t && until - t <= SKIP_AFTER_ERROR_MS; // 시계가 뒤로 가도 한 시간을 넘겨 쉬지 않는다
    if (!isNewer(before.version, cfg.version) || resting) {
      // 넘길 것이 없거나, 이 위젯은 오류를 낸 뒤 쉬는 중이다.
    } else if (!inApp && count >= MAX_UNFINISHED) {
      setKeyed(host, 'unfinished', key, 0);
      patchState(host, { checkedAt: 0, libNote: `받아 둔 ${before.version}이 ${count}번 잇달아 끝나지 못해 붙여 넣은 것으로 돌았다` });
    } else {
      // 읽기 전에 적어 두고, 끝나면 지운다. 멈추거나 꺼지면 남아서 다음 실행이 안다.
      // 앱 안에서는 세지 않는다(메뉴를 띄운 채 나가는 일이 흔하다).
      if (!inApp) setKeyed(host, 'unfinished', key, count + 1);
      const lib = loadCachedLib(host, cfg);
      if (lib) {
        try {
          await lib.run(host, { ...cfg, version: lib.version, handedOver: true, baseVersion: cfg.version }, now);
          ran = true;
        } catch (e) {
          setKeyed(host, 'skipUntil', key, t + SKIP_AFTER_ERROR_MS);
          patchState(host, { checkedAt: 0, libNote: `받아 둔 ${lib.version}이 오류를 냈다: ${message(e)}` });
        }
      }
      if (!inApp) setKeyed(host, 'unfinished', key, 0);
    }
  } catch {
    // 업데이트 쪽의 어떤 문제도 위젯을 막지 않는다.
  }
  if (!ran) await self();
  if (!inApp) await checkForUpdate(host, cfg, now());
}

/** Scriptable 앱의 메뉴에 적을 한 줄. 버전을 모르면 빈 글. */
export function updateLine(host: Host, cfg: Config): string {
  if (!versionKey(cfg.version)) return '';
  if (cfg.handedOver) return `자동으로 받은 버전입니다(붙여 넣은 스크립트는 ${cfg.baseVersion ?? '알 수 없음'}).`;
  const { note, libNote } = readUpdateState(host);
  return ['새 버전이 나오면 스스로 받습니다.', note === '' ? '' : `마지막 확인: ${note}`, libNote].filter((x) => x !== '').join(' ');
}
