// 웹앱 서비스 워커에 붙는 푸시 처리. 빌드가 public/push-sw.js로 묶고, 워크박스 서비스 워커가 importScripts로 읽는다.
// 아이폰은 받은 푸시마다 알림을 보여야 한다(보이지 않으면 푸시 권한을 거둔다). 그래서 무엇이 오든 알림 하나는 띄운다.

export type NoteSpec = { title: string; body: string; tag: string; url: string };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** FCM이 보낸 푸시의 글(JSON)을 알림으로. data(우리가 보내는 모양)를 먼저 보고, notification도 읽는다. */
export function noteFrom(payload: unknown): NoteSpec {
  const p = isObject(payload) ? payload : {};
  const data = isObject(p.data) ? p.data : {};
  const notification = isObject(p.notification) ? p.notification : {};
  const title = str(data.title) || str(notification.title) || 'CalendarFIF 알림';
  const body = str(data.body) || str(notification.body);
  const tag = str(data.tag) || str(notification.tag);
  // 웹앱 안의 경로만 연다(다른 사이트로 가지 않는다).
  const raw = str(data.url);
  const url = raw.startsWith('/') && !raw.startsWith('//') ? raw : '/';
  return { title, body, tag, url };
}

type ClientLike = { url: string; focus?(): Promise<unknown>; navigate?(url: string): Promise<unknown> };
type PushEventLike = { data: { json(): unknown; text(): string } | null; waitUntil(p: Promise<unknown>): void };
type ClickEventLike = { notification: { close(): void; data?: unknown }; waitUntil(p: Promise<unknown>): void };
export type SwScope = {
  location: { origin: string };
  registration: { showNotification(title: string, options: Record<string, unknown>): Promise<void> };
  clients: { matchAll(o: { type: 'window'; includeUncontrolled: boolean }): Promise<ClientLike[]>; openWindow(url: string): Promise<unknown> };
  addEventListener(type: 'push', fn: (e: PushEventLike) => void): void;
  addEventListener(type: 'notificationclick', fn: (e: ClickEventLike) => void): void;
};

function readPayload(e: PushEventLike): unknown {
  if (!e.data) return {};
  try {
    return e.data.json();
  } catch {
    try {
      return { data: { body: e.data.text() } };
    } catch {
      return {};
    }
  }
}

export function installPushHandlers(scope: SwScope): void {
  scope.addEventListener('push', (e) => {
    const note = noteFrom(readPayload(e));
    const options: Record<string, unknown> = { body: note.body, data: { url: note.url }, icon: '/icons/icon-192.png' };
    if (note.tag) options.tag = note.tag;
    e.waitUntil(scope.registration.showNotification(note.title, options));
  });
  scope.addEventListener('notificationclick', (e) => {
    e.notification.close();
    const data = isObject(e.notification.data) ? e.notification.data : {};
    const path = noteFrom({ data: { url: data.url } }).url;
    const target = new URL(path, scope.location.origin).href;
    e.waitUntil((async () => {
      // 열려 있는 웹앱이 있으면 그 창을 앞으로 가져와 그 날짜로 옮긴다. 없으면 새로 연다(홈 화면 앱으로 열린다).
      const all = await scope.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = all.find((c) => c.url.startsWith(scope.location.origin));
      if (open?.focus) {
        await open.focus();
        if (open.navigate && open.url !== target) {
          try {
            await open.navigate(target);
          } catch {
            // 옮기지 못해도 앞으로는 왔다.
          }
        }
        return;
      }
      await scope.clients.openWindow(target);
    })());
  });
}
