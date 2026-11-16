import type { FirebaseApp } from 'firebase/app';
import { FieldPath, deleteField, doc, onSnapshot, setDoc, updateDoc, type Firestore } from 'firebase/firestore';
import { MAX_DEVICES, newDeviceId, parsePushDoc, senderAlive, type PushDevice, type PushDoc } from '../push/doc';
import type { KeyValueStore } from '../sync/outbox';

// 아이폰 푸시 알림: 이 기기를 FCM에 등록하고 users/{uid}/data/push에 적는다. 알림은 Apps Script의 알림 보내는 스크립트가 보낸다.
// 아이폰은 홈 화면에 추가한 앱에서만 푸시를 받는다(Safari 탭에서는 켤 수 없다).

export const DEVICE_KEY = 'calfif.pushDevice';
/** 토큰을 이보다 오래 적지 않았으면 열 때 다시 적는다(FCM은 오래 쓰지 않은 토큰을 지운다). */
const REFRESH_MS = 7 * 86_400_000;
const TOKEN_WAIT_MS = 20_000;
/** 서버에 쓰기를 기다리는 가장 긴 시간. 넘으면 단추를 풀고 연결되면 올라간다고 알린다(쓰기는 기기에 남아 연결되면 올라간다). */
const WRITE_WAIT_MS = 15_000;
const SLOW = '연결이 느립니다. 연결되면 저장됩니다. 잠시 뒤 다시 확인해 주세요.';

type Permission = 'default' | 'granted' | 'denied';

export type PushPlatform = {
  /** 이 브라우저가 푸시를 받을 수 있는가(서비스 워커, PushManager, Notification). */
  supported: boolean;
  /** 홈 화면 앱으로 열렸는가. */
  standalone: boolean;
  ios: boolean;
  permission(): Permission;
  requestPermission(): Promise<Permission>;
  /** FCM 등록 토큰. */
  token(): Promise<string>;
  dropToken(): Promise<void>;
};

export type PushRemote = {
  watch(onDoc: (doc: PushDoc) => void, onError: (e: unknown) => void): () => void;
  saveDevice(id: string, device: PushDevice): Promise<void>;
  removeDevice(id: string): Promise<void>;
};

/** install: 아이폰의 Safari 탭이라 홈 화면 앱에서 켜야 한다. off: 켤 수 있다. on: 이 기기로 온다. */
export type PushMode = 'unsupported' | 'install' | 'denied' | 'off' | 'on';
/** message는 켜지 못했거나 끄지 못했을 때의 까닭이다(잘 되면 빈 글). */
export type PushView = { mode: PushMode; doc: PushDoc | null; busy: boolean; message: string };

const errorText = (e: unknown): string => (e instanceof Error ? e.message : typeof e === 'string' ? e : '알 수 없는 오류');

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(message)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e: unknown) => { clearTimeout(t); reject(e); },
    );
  });
}

export class PushClient {
  private doc: PushDoc | null = null;
  private busy = false;
  private message = '';
  private listeners = new Set<() => void>();
  private refreshed = false;

  constructor(private readonly deps: { platform: PushPlatform; remote: PushRemote; storage: KeyValueStore; now: () => number; label: string }) {}

  /** 문서를 듣기 시작한다. 처음 문서가 오면 이 기기의 토큰을 한 번 새로 적는다. 멈추는 함수를 돌려준다. */
  start(): () => void {
    const stop = this.deps.remote.watch(
      (d) => {
        this.doc = d;
        this.emit();
        if (!this.refreshed) {
          this.refreshed = true;
          void this.refresh();
        }
      },
      () => {
        // 듣기가 끊겨도 마지막 문서로 보인다.
      },
    );
    return stop;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  private deviceId(): string | null {
    try {
      const v = this.deps.storage.getItem(DEVICE_KEY);
      return v && /^[A-Za-z0-9]{20}$/.test(v) ? v : null;
    } catch {
      return null;
    }
  }

  view(): PushView {
    const { platform } = this.deps;
    let mode: PushMode;
    if (platform.ios && !platform.standalone) mode = 'install';
    else if (!platform.supported) mode = 'unsupported';
    else if (platform.permission() === 'denied') mode = 'denied';
    else {
      const id = this.deviceId();
      mode = id && platform.permission() === 'granted' && this.doc?.devices[id] ? 'on' : 'off';
    }
    return { mode, doc: this.doc, busy: this.busy, message: this.message };
  }

  /** 이 기기가 푸시로 알림을 받고 보내는 쪽이 살아 있다. 그러면 화면 안 알림을 띄우지 않는다(같은 알림이 두 번 보이지 않게). */
  handlesAlarms(): boolean {
    return this.view().mode === 'on' && senderAlive(this.doc, this.deps.now());
  }

  private set(busy: boolean, message: string): void {
    this.busy = busy;
    this.message = message;
    this.emit();
  }

  /** 알림을 켠다. 누름 안에서 불러야 한다(아이폰은 누름 안에서만 권한을 묻는다). */
  async enable(): Promise<void> {
    if (this.busy) return;
    const { platform, remote, storage, now, label } = this.deps;
    // 권한 묻기가 첫 번째 기다림이어야 아이폰이 누름으로 본다.
    let permission: Permission;
    try {
      permission = await platform.requestPermission();
    } catch (e) {
      this.set(false, `알림을 켜지 못했습니다: ${errorText(e)}`);
      return;
    }
    if (permission !== 'granted') {
      this.set(false, permission === 'denied' ? '알림을 허용하지 않았습니다. 아이폰 설정 → 알림 → CalendarFIF에서 켤 수 있습니다.' : '알림을 허용하지 않았습니다.');
      return;
    }
    this.set(true, '');
    try {
      const token = await withTimeout(platform.token(), TOKEN_WAIT_MS, '등록이 제때 끝나지 않았습니다. 연결을 확인하고 다시 눌러 주세요.');
      let id = this.deviceId();
      if (!id) {
        id = newDeviceId();
        try {
          storage.setItem(DEVICE_KEY, id);
        } catch {
          // 저장하지 못하면 다음에 열 때 새 기기로 다시 적는다.
        }
      }
      // 같은 토큰이 다른 이름으로 적혀 있으면(이 기기의 이름을 잃었다) 지우고, 기기가 너무 많으면 가장 오래 적지 않은 것을 뺀다.
      const others = Object.entries(this.doc?.devices ?? {}).filter(([k]) => k !== id).sort((a, b) => a[1].at - b[1].at);
      const same = others.filter(([, d]) => d.token === token).map(([k]) => k);
      const rest = others.filter(([k]) => !same.includes(k));
      const drop = [...same, ...rest.slice(0, Math.max(0, rest.length - (MAX_DEVICES - 1))).map(([k]) => k)];
      await withTimeout((async () => {
        for (const old of drop) await remote.removeDevice(old);
        await remote.saveDevice(id, { token, label, at: now() });
      })(), WRITE_WAIT_MS, SLOW);
      this.set(false, '');
    } catch (e) {
      this.set(false, `알림을 켜지 못했습니다: ${errorText(e)}`);
    }
  }

  async disable(): Promise<void> {
    if (this.busy) return;
    const id = this.deviceId();
    this.set(true, '');
    // 이 기기의 이름과 토큰을 먼저 지운다. 서버 쓰기가 늦어도 다음에 열 때 다시 적지 않는다(쓰기는 연결되면 올라간다).
    try {
      this.deps.storage.removeItem(DEVICE_KEY);
    } catch {
      // 문서에서 빼면 알림은 오지 않는다.
    }
    await this.deps.platform.dropToken().catch(() => undefined);
    try {
      if (id) await withTimeout(this.deps.remote.removeDevice(id), WRITE_WAIT_MS, SLOW);
      this.set(false, '');
    } catch (e) {
      this.set(false, `끄지 못했습니다: ${errorText(e)}`);
    }
  }

  /** 열 때: 이 기기가 켜져 있으면 토큰을 새로 받아 바뀌었거나 오래됐으면 적는다. 서버가 지운(쓸 수 없게 된) 기기도 다시 적는다. */
  private async refresh(): Promise<void> {
    const { platform, remote, now, label } = this.deps;
    const id = this.deviceId();
    if (!id || !platform.supported || platform.permission() !== 'granted' || (platform.ios && !platform.standalone)) return;
    try {
      const token = await withTimeout(platform.token(), TOKEN_WAIT_MS, 'timeout');
      const current = this.doc?.devices[id];
      for (const [other, d] of Object.entries(this.doc?.devices ?? {})) if (other !== id && d.token === token) await remote.removeDevice(other);
      if (!current || current.token !== token || now() - current.at > REFRESH_MS) await remote.saveDevice(id, { token, label, at: now() });
    } catch {
      // 다음에 열 때 다시 한다.
    }
  }
}

export function firestorePushRemote(db: Firestore, uid: string): PushRemote {
  const ref = doc(db, 'users', uid, 'data', 'push');
  return {
    watch: (onDoc, onError) => onSnapshot(ref, (snap) => onDoc(parsePushDoc(snap.exists() ? snap.data() : {})), onError),
    saveDevice: (id, device) => setDoc(ref, { devices: { [id]: device } }, { merge: true }),
    removeDevice: (id) => updateDoc(ref, new FieldPath('devices', id), deleteField()).catch((e: unknown) => {
      // 문서가 없으면 지울 것도 없다.
      if ((e as { code?: string })?.code === 'not-found') return;
      throw e;
    }),
  };
}

export function browserPushPlatform(app: FirebaseApp, ios: boolean, vapidKey?: string): PushPlatform {
  const supported = typeof navigator !== 'undefined' && 'serviceWorker' in navigator && typeof window !== 'undefined' && 'PushManager' in window && 'Notification' in window;
  const standalone = typeof window !== 'undefined'
    && ((typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches) || (navigator as { standalone?: boolean }).standalone === true);
  const permission = (): Permission => (typeof Notification === 'undefined' ? 'default' : Notification.permission);
  return {
    supported,
    standalone,
    ios,
    permission,
    requestPermission: () => (typeof Notification === 'undefined' ? Promise.resolve<Permission>('denied') : Notification.requestPermission()),
    token: async () => {
      const { getMessaging, getToken, isSupported } = await import('firebase/messaging');
      if (!(await isSupported())) throw new Error('이 브라우저는 푸시 알림을 받을 수 없습니다.');
      const registration = await withTimeout(navigator.serviceWorker.ready, 10_000, '앱이 아직 준비되지 않았습니다. 앱을 완전히 닫았다가 다시 열어 주세요.');
      return getToken(getMessaging(app), { serviceWorkerRegistration: registration, ...(vapidKey ? { vapidKey } : {}) });
    },
    dropToken: async () => {
      const { deleteToken, getMessaging } = await import('firebase/messaging');
      await deleteToken(getMessaging(app));
    },
  };
}
