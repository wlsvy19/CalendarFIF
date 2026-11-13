import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import './styles.css';
import './desktop.css';
import { createApp, type Session } from './app';
import { screenFor, usersRoute, watchAccess, type AccessState, type MainScreen } from './access';
import { firestoreAccessSource, firestoreUsersSource } from './accessStore';
import { firebaseAccountMaker } from './accountMaker';
import { initFirebase } from './firebase';
import { changePassword, firebasePasswordDeps, passwordMessage, sendReset } from './password';
import { addUser, addUserMessage } from './users';
import { CalendarStore } from './state';
import { startAutoFlush } from './autoFlush';
import { deviceLabel } from './device';
import { loadAppearance, saveAppearance, applyAppearance, type Appearance } from './appearance';
import type { SettingsPage } from '../desktop/api';
import { getBridge } from './desktop/bridge';
import { mountAdjust } from './desktop/adjust';
import { mountDesktopSettings } from './desktop/settingsPages';
import { mountCellMenu } from './desktop/cellMenu';
import { Interactivity } from './desktop/interactive';
import { playDoneTone } from './desktop/tone';
import { mountBlocked, type BlockedKind } from './ui/blocked';
import { mountCalendar } from './ui/calendar';
import { mountEditor } from './ui/editor';
import { mountSettings } from './ui/settings';
import { mountUsers } from './ui/users';
import { isBusy, reloadOnUpdate } from './update';
import { parseHash } from './router';
import { openStorage } from './storage';
import { splitDateKey, todayKey } from '../core/dates';
import { EMPTY_DAY } from '../core/types';
import { FirestoreMonthStore } from '../sync/firestoreStore';
import { Outbox } from '../sync/outbox';
import { SyncEngine } from '../sync/engine';

const { app, auth, db } = initFirebase(import.meta.env);
// 사용자 추가는 두 번째 앱 인스턴스에서 계정을 만든다. 지금 로그인은 바뀌지 않는다.
const accounts = firebaseAccountMaker(app.options, {
  emulatorAuthUrl: import.meta.env.VITE_USE_EMULATOR === '1' ? 'http://127.0.0.1:9095' : undefined,
});

// PC 앱(데스크톱 빌드)에서만 켠다. 웹앱은 이 값들을 쓰지 않는다.
const DESKTOP = import.meta.env.VITE_DESKTOP === '1';
const bridge = DESKTOP ? getBridge() : null;
const interactivity = new Interactivity((on) => bridge?.setInteractive(on));
// 로그인 뒤 화면이 열려 있는 동안 메인 프로세스의 명령을 받는 동작들. 로그인 전에는 null이라 명령을 무시한다.
// 저장되지 않아 이 페이지의 메모리에만 있는 편집이 있는가. mountMain이 로그인 중에만 채운다(새 버전으로 다시 읽기를 미룰지 정한다).
let unsavedOnlyInMemory: () => boolean = () => false;
let deskActions: { goToday(): void; openSettings(page?: SettingsPage): void; signOut(): void } | null = null;

type CalendarScreen = { destroy(): void; accessChanged(): void };

// 달력 화면: 달력, 편집, 설정, 사용자 관리와 그 동기화. 접근 상태가 막힘이 되면 통째로 내려간다.
function mountCalendarScreen(root: HTMLElement, session: Session, getAccess: () => AccessState): CalendarScreen {
  const editedBy = deviceLabel(navigator.userAgent);
  const source = new FirestoreMonthStore(db, session.uid);
  const storage = openStorage();
  let appearance: Appearance | undefined = DESKTOP ? loadAppearance(storage.store) : undefined;
  if (appearance) applyAppearance(document.documentElement, appearance);
  const outbox = new Outbox(storage.store, session.uid);
  const engine = new SyncEngine({ store: source, outbox, editedBy });
  const store = new CalendarStore({
    source,
    outbox,
    editedBy,
    initialMonth: splitDateKey(todayKey())!.monthId,
  });
  const stopAutoFlush = startAutoFlush(engine, window, document);
  const offStatus = engine.subscribe(() => store.refresh());
  // 트랜잭션은 SDK의 로컬 캐시를 거치지 않으므로, 올린 값을 다음 스냅숏이 올 때까지 화면에 남긴다.
  const offCommit = engine.onCommit((monthId, changes) => store.noteCommitted(monthId, changes));
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith('calfif.outbox.')) store.refresh();
  };
  window.addEventListener('storage', onStorage);
  let pushedByApp = false;
  let editor: { dateKey: string; handle: { destroy(): void } } | null = null;
  let waiting: { dateKey: string; off(): void; timer: ReturnType<typeof setTimeout> } | null = null;

  const closeEditor = (): void => {
    waiting?.off();
    if (waiting) clearTimeout(waiting.timer);
    waiting = null;
    editor?.handle.destroy();
    editor = null;
    interactivity.end('editor');
  };
  let settings: { destroy(): void; showPage?(page: SettingsPage): void } | null = null;
  const closeSettings = (): void => {
    settings?.destroy();
    settings = null;
    interactivity.end('settings');
  };
  const signOutNow = (): void => {
    closeSettings();
    history.replaceState(null, '', location.pathname + location.search); // 다시 로그인했을 때 설정이 열리지 않게 한다
    void signOut(auth);
  };
  let settingsPage: SettingsPage | undefined;
  // 설정에서 바꾼 모양은 바로 달력과 <html>에 반영하고 이 기기에 저장한다. 저장하지 못하면 false(값은 화면에 그대로 둔다).
  const changeAppearance = (next: Appearance): boolean => {
    appearance = next;
    applyAppearance(document.documentElement, next);
    calendar.setAppearance(next);
    try {
      saveAppearance(storage.store, next);
      return storage.persistent;
    } catch {
      return false;
    }
  };
  const changeMyPassword = async (current: string, next: string): Promise<{ ok: boolean; message: string }> => {
    const result = await changePassword(firebasePasswordDeps(auth), current, next);
    return { ok: result.ok, message: passwordMessage(result) };
  };
  // 설정 자리를 사용자 관리로 바꾼다(기록을 하나 더 쌓지 않는다). 그래서 사용자 관리를 닫으면 설정이 아니라 달력으로 돌아간다.
  const manageUsers = (): void => location.replace('#users');
  const openSettings = (): void => {
    const account = {
      email: session.email,
      pending: engine.status().pending,
      storageOk: storage.persistent && outbox.persistent,
      corruptFound: outbox.corruptDetected,
      onSignOut: signOutNow,
      onChangePassword: changeMyPassword,
      // 관리자인지는 설정을 여는 순간의 접근 상태로 정한다.
      onManageUsers: getAccess() === 'admin' ? manageUsers : undefined,
    };
    const onClose = (): void => {
      closeSettings(); // 주소가 바뀌기를 기다리지 않고 바로 닫는다
      backToCalendar();
    };
    settings = appearance
      ? mountDesktopSettings(root, { appearance, onAppearance: changeAppearance, bridge, account, page: settingsPage, onClose })
      : mountSettings(root, { ...account, onClose });
    settingsPage = undefined;
    interactivity.begin('settings');
  };
  const backToCalendar = (): void => {
    if (pushedByApp) history.back();
    else location.hash = '';
  };
  const openEditor = (dateKey: string): void => {
    const { monthId, day } = splitDateKey(dateKey)!;
    // 편집 화면이 처음 보여 준 값이 base다. 서버 문서를 따로 읽지 않는다.
    const base = store.days(monthId)[day] ?? EMPTY_DAY;
    const handle = mountEditor(root, {
      dateKey,
      value: base,
      onSave: (next) => {
        closeEditor(); // 주소가 바뀌기를 기다리지 않고 바로 닫는다
        engine.saveEdit(monthId, day, base, next);
        store.refresh();
        if (appearance?.doneTone === 'short') playDoneTone();
        backToCalendar();
      },
      onCancel: () => {
        closeEditor();
        backToCalendar();
      },
    }, DESKTOP ? { focusText: true } : undefined);
    editor = { dateKey, handle };
    interactivity.begin('editor');
  };
  let users: { destroy(): void } | null = null;
  const closeUsers = (): void => {
    users?.destroy();
    users = null;
    interactivity.end('users');
  };
  // #users: 관리자로 확인되면 연다. 보통 사용자면 기록을 남기지 않고 달력으로 돌아간다. 확인 중이면 accessChanged가 다시 부른다.
  const showUsers = (): void => {
    const action = usersRoute(getAccess());
    if (action === 'leave') {
      closeUsers();
      pushedByApp = false;
      history.replaceState(null, '', location.pathname + location.search);
      return;
    }
    if (action !== 'open' || users) return;
    const source = firestoreUsersSource(db);
    users = mountUsers(root, {
      watch: source.watchAll,
      onAdd: async (email, password) => {
        const result = await addUser({ accounts, users: source, now: Date.now }, email, password);
        return { ok: result.ok, message: addUserMessage(result) };
      },
      onSetDisabled: source.setDisabled,
      onRemove: source.remove,
      onReset: (email) => sendReset(auth, email),
      onClose: () => {
        closeUsers(); // 주소가 바뀌기를 기다리지 않고 바로 닫는다
        backToCalendar();
      },
    });
    interactivity.begin('users');
  };
  const syncRoute = (): void => {
    const route = parseHash(location.hash);
    if (route.name !== 'users') closeUsers();
    if (route.name === 'settings') {
      closeEditor();
      if (!settings) openSettings();
      return;
    }
    closeSettings();
    if (route.name === 'users') {
      closeEditor();
      showUsers();
      return;
    }
    if (route.name !== 'day') {
      pushedByApp = false;
      closeEditor();
      return;
    }
    if (editor?.dateKey === route.dateKey || waiting?.dateKey === route.dateKey) return;
    closeEditor();
    const { monthId } = splitDateKey(route.dateKey)!;
    calendar.showMonth(monthId);
    store.refresh();
    if (store.isLoaded(monthId)) {
      openEditor(route.dateKey);
      return;
    }
    // 서버 답이 오기 전에 열면 빈 값을 보여 주게 되므로 답을 기다린다. 오프라인이면 4초 뒤에 연다.
    const dateKey = route.dateKey;
    const start = (): void => {
      if (waiting?.dateKey !== dateKey) return;
      closeEditor();
      openEditor(dateKey);
    };
    const off = store.onChange(() => {
      if (store.isLoaded(monthId)) start();
    });
    waiting = { dateKey, off, timer: setTimeout(start, 4000) };
  };
  window.addEventListener('hashchange', syncRoute);

  const openDay = (dateKey: string): void => {
    pushedByApp = true;
    location.hash = dateKey;
  };
  let cellMenu: { destroy(): void } | null = null;
  const closeCellMenu = (): void => {
    cellMenu?.destroy();
    cellMenu = null;
  };
  const openCellMenu = (dateKey: string, at: { x: number; y: number }): void => {
    closeCellMenu();
    const { monthId, day } = splitDateKey(dateKey)!;
    cellMenu = mountCellMenu(root, {
      dateKey,
      at,
      onEdit: () => openDay(dateKey),
      onColor: (color) => {
        const base = store.days(monthId)[day] ?? EMPTY_DAY;
        engine.saveEdit(monthId, day, base, { text: base.text, color });
        store.refresh();
      },
      onToday: () => calendar.goToday(),
      onClose: closeCellMenu,
    });
  };
  const calendar = mountCalendar(root, {
    store,
    status: engine,
    today: () => todayKey(),
    onOpenDay: openDay,
    onOpenSettings: () => {
      pushedByApp = true;
      location.hash = 'settings';
    },
    appearance,
    desktop: DESKTOP ? { onDayMenu: openCellMenu, onOpenMenu: (at) => bridge?.showMenu(at) } : undefined,
  });
  // 앱 메뉴의 명령으로 여는 설정은 열려 있던 편집 화면을 먼저 닫고, 닫으면 늘 달력으로 간다(앞 기록의 날짜 주소로 돌아가지 않는다).
  const openSettingsFromCommand = (page?: SettingsPage): void => {
    closeEditor();
    pushedByApp = false;
    if (settings) {
      if (page) settings.showPage?.(page); // 이미 열려 있으면 쪽만 옮긴다
      return;
    }
    settingsPage = page;
    location.hash = 'settings';
  };
  if (DESKTOP) {
    deskActions = {
      goToday: () => calendar.goToday(),
      openSettings: openSettingsFromCommand,
      // 보내지 못한 편집이 남아 있으면 로그아웃으로 잃지 않도록 설정 화면(대기 건수 안내)을 연다.
      signOut: () => (engine.status().pending === 0 ? signOutNow() : openSettingsFromCommand('account')),
    };
  }
  unsavedOnlyInMemory = () => !(storage.persistent && outbox.persistent) && engine.status().pending > 0;
  syncRoute();
  return {
    accessChanged() {
      if (parseHash(location.hash).name === 'users') showUsers();
    },
    destroy() {
      unsavedOnlyInMemory = () => false;
      deskActions = null;
      closeCellMenu();
      window.removeEventListener('hashchange', syncRoute);
      closeEditor();
      closeSettings();
      closeUsers();
      calendar.destroy();
      window.removeEventListener('storage', onStorage);
      offStatus();
      offCommit();
      stopAutoFlush();
      store.destroy();
    },
  };
}

// 로그인 뒤: 달력 화면을 바로 올리고 내 access 문서를 지켜본다. 허가 없음이나 중지면 달력 화면을 내리고 안내를 보인다.
// 다시 허용되면 안내를 내리고 달력 화면을 새로 올린다(대기 중이던 편집은 저장소에 남아 있다가 다시 올라간다).
function mountMain(root: HTMLElement, session: Session): { destroy(): void } {
  let access: AccessState = 'checking';
  let shown: MainScreen = 'calendar';
  let screen: CalendarScreen | null = mountCalendarScreen(root, session, () => access);
  let notice: { setKind(kind: BlockedKind): void; destroy(): void } | null = null;
  const signOutFromNotice = (): void => {
    history.replaceState(null, '', location.pathname + location.search); // 다시 로그인했을 때 설정이 열리지 않게 한다
    void signOut(auth);
  };
  const stopWatch = watchAccess(firestoreAccessSource(db), session, (state) => {
    access = state;
    const next = screenFor(state, shown);
    if (next === 'calendar') {
      if (notice) {
        notice.destroy();
        notice = null;
        interactivity.end('blocked');
        screen = mountCalendarScreen(root, session, () => access);
      } else {
        screen?.accessChanged();
      }
    } else if (notice) {
      notice.setKind(next);
    } else {
      screen?.destroy();
      screen = null;
      notice = mountBlocked(root, { kind: next, email: session.email, onSignOut: signOutFromNotice });
      interactivity.begin('blocked'); // PC 앱에서 로그아웃 단추를 누를 수 있게 한다
    }
    shown = next;
  });
  return {
    destroy() {
      stopWatch();
      screen?.destroy();
      screen = null;
      notice?.destroy();
      notice = null;
      interactivity.end('blocked');
    },
  };
}

let adjust: { destroy(): void } | null = null;
bridge?.onCommand((c) => {
  switch (c.type) {
    case 'today':
      deskActions?.goToday();
      break;
    case 'openSettings':
      deskActions?.openSettings(c.page);
      break;
    case 'signOut':
      deskActions?.signOut();
      break;
    case 'contentHidden':
      document.documentElement.classList.toggle('content-hidden', c.hidden);
      break;
    case 'adjust':
      adjust?.destroy();
      adjust = c.active && bridge ? mountAdjust(document.body, bridge) : null;
      break;
  }
});

createApp({
  root: document.getElementById('app')!,
  onAuthChange: (listener) =>
    onAuthStateChanged(auth, (user) => {
      if (user) interactivity.end('login');
      else interactivity.begin('login');
      listener(user ? { uid: user.uid, email: user.email ?? '' } : null);
    }),
  signIn: async (email, password) => {
    await signInWithEmailAndPassword(auth, email, password);
  },
  signOut: () => signOut(auth),
  resetPassword: (email) => sendReset(auth, email),
  mountMain,
});

if (!DESKTOP) {
  // iOS는 페이지가 터치를 듣고 있어야 단추에 :active를 적용한다.
  document.addEventListener('touchstart', () => {}, { passive: true });
  if ('serviceWorker' in navigator) {
    reloadOnUpdate({
      container: navigator.serviceWorker,
      busy: () => isBusy(document, unsavedOnlyInMemory()),
      reload: () => location.reload(),
      // sessionStorage에 닿는 것만으로도 던질 수 있으므로, 쓸 때 닿게 해서 update.ts가 잡게 한다.
      session: { getItem: (k) => sessionStorage.getItem(k), setItem: (k, v) => sessionStorage.setItem(k, v) },
      now: () => Date.now(),
      every: (ms, fn) => {
        const id = setInterval(fn, ms);
        return () => clearInterval(id);
      },
    });
  }
}

// 화면 확인용 자동 로그인. 에뮬레이터 모드에서만 동작하며, 그 밖에는 주소 인자를 무시한다.
if (import.meta.env.VITE_USE_EMULATOR === '1' && new URLSearchParams(location.search).get('autologin') === '1') {
  void signInWithEmailAndPassword(auth, 'test@example.com', 'test-password');
}
