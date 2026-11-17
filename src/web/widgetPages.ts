/**
 * 위젯에서 연 화면(Scriptable 안의 웹 화면)이 여럿 남지 않게 한다.
 * Scriptable의 웹 화면은 사용자가 닫기를 눌러야 닫힌다. 닫지 않고 홈 화면으로 나갔다가 위젯을 다시 누르면 새 웹 화면이 그 위에 뜨고,
 * 앞의 것은 가려진 채 살아 있다(서버에 붙어 있고, 앱이 다시 앞으로 올 때마다 Firebase SDK가 오류를 적는다. Scriptable은 그것을 모아
 * 다음 스크립트가 끝날 때 "Errors Logged" 상자로 띄운다: 2026-11-17 사용자의 아이폰).
 * 그래서 새 화면이 뜨면서 알리고, 그 알림을 들은 앞의 화면은 스크립트가 없는 안내 쪽(closed.html)으로 바뀐다.
 * 알리는 길은 둘이다(둘 다 같은 저장소를 쓰는 다른 화면에 닿는다): BroadcastChannel과 localStorage의 storage 이벤트.
 */

export const PAGES_CHANNEL = 'calfif-widget-pages';
export const PAGES_KEY = 'calfif.widgetPage';
/** 앞의 화면이 바뀌어 갈 쪽. 앱의 주소를 기준으로 한다. */
export const CLOSED_PAGE = 'closed.html';
/** 이 문서가 이미 알렸음을 window에 적어 두는 이름. */
const PAGE_MARK = '__calfifPage';

type Hello = { id: string; at: number };
type ChannelLike = { postMessage(data: unknown): void; onmessage: ((event: { data: unknown }) => void) | null };
export type PagesEnv = {
  /** 이 화면의 번호와 뜬 시각. */
  id: string;
  at: number;
  /** 없으면 그 길은 쓰지 않는다. */
  channel: ChannelLike | null;
  storage: { setItem(key: string, value: string): void } | null;
  /** storage 이벤트를 듣는다. */
  onStorage(listener: (event: { key: string | null; newValue: string | null }) => void): void;
  /** 더 나중에 뜬 화면이 있다: 이 화면을 안내 쪽으로 바꾼다. */
  retire(): void;
};

function helloOf(v: unknown): Hello | null {
  let parsed: unknown = v;
  if (typeof v === 'string') {
    try {
      parsed = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { id, at } = parsed as { id?: unknown; at?: unknown };
  return typeof id === 'string' && id !== '' && typeof at === 'number' && Number.isFinite(at) ? { id, at } : null;
}

/**
 * 이 화면이 떴음을 알리고, 더 나중에 뜬 화면의 알림을 들으면 retire를 한 번 부른다.
 * 자기 알림과 더 먼저 뜬 화면의 알림에는 움직이지 않는다. 어느 길이 막혀 있어도 던지지 않는다.
 */
export function announcePage(env: PagesEnv): void {
  let retired = false;
  const heard = (v: unknown): void => {
    const other = helloOf(v);
    if (retired || !other || other.id === env.id || other.at < env.at) return;
    retired = true;
    try {
      env.retire();
    } catch {
      // 바꾸지 못하면 그대로 남는다.
    }
  };
  try {
    if (env.channel) env.channel.onmessage = (event) => heard(event.data);
  } catch {
    // 이 길은 쓰지 않는다.
  }
  try {
    env.onStorage((event) => {
      if (event.key === PAGES_KEY) heard(event.newValue);
    });
  } catch {
    // 이 길은 쓰지 않는다.
  }
  const hello: Hello = { id: env.id, at: env.at };
  try {
    env.channel?.postMessage(hello);
  } catch {
    // 이 길은 쓰지 않는다.
  }
  try {
    env.storage?.setItem(PAGES_KEY, JSON.stringify(hello));
  } catch {
    // 이 길은 쓰지 않는다.
  }
}

/** 브라우저의 것들로 announcePage를 건다. */
export function announceWidgetPage(win: Window = window): void {
  // 한 문서에서는 한 번만 건다. 같은 문서에서 두 번 걸리면(개발 서버가 코드를 갈아 끼울 때, 시험) 뒤의 것을 새 화면으로 알고 스스로 물러난다.
  const marks = win as unknown as Record<string, unknown>;
  if (marks[PAGE_MARK] !== undefined) return;
  const at = Date.now();
  const id = `${at}-${Math.random().toString(36).slice(2, 10)}`;
  marks[PAGE_MARK] = id;
  let channel: ChannelLike | null = null;
  try {
    if (typeof BroadcastChannel === 'function') channel = new BroadcastChannel(PAGES_CHANNEL) as unknown as ChannelLike;
  } catch {
    channel = null;
  }
  let storage: PagesEnv['storage'] = null;
  try {
    storage = win.localStorage;
  } catch {
    storage = null;
  }
  announcePage({
    id, at, channel, storage,
    onStorage: (listener) => win.addEventListener('storage', (event) => listener({ key: event.key, newValue: event.newValue })),
    retire: () => win.location.replace(new URL(CLOSED_PAGE, win.document.baseURI).href),
  });
}
