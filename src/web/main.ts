import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import './styles.css';
import { createApp, type Session } from './app';
import { initFirebase } from './firebase';
import { CalendarStore } from './state';
import { startAutoFlush } from './autoFlush';
import { deviceLabel } from './device';
import { mountCalendar } from './ui/calendar';
import { mountEditor } from './ui/editor';
import { parseHash } from './router';
import { splitDateKey, todayKey } from '../core/dates';
import { EMPTY_DAY } from '../core/types';
import { FirestoreMonthStore } from '../sync/firestoreStore';
import { Outbox } from '../sync/outbox';
import { SyncEngine } from '../sync/engine';

const { auth, db } = initFirebase(import.meta.env);

function mountMain(root: HTMLElement, session: Session): { destroy(): void } {
  const editedBy = deviceLabel(navigator.userAgent);
  const source = new FirestoreMonthStore(db, session.uid);
  const outbox = new Outbox(localStorage, session.uid);
  const engine = new SyncEngine({ store: source, outbox, editedBy });
  const store = new CalendarStore({
    source,
    outbox,
    editedBy,
    initialMonth: splitDateKey(todayKey())!.monthId,
  });
  const stopAutoFlush = startAutoFlush(engine, window, document);
  const offStatus = engine.subscribe(() => store.refresh());
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
        engine.saveEdit(monthId, day, base, next);
        store.refresh();
        backToCalendar();
      },
      onCancel: backToCalendar,
    });
    editor = { dateKey, handle };
  };
  const syncRoute = (): void => {
    const route = parseHash(location.hash);
    if (route.name !== 'day') {
      pushedByApp = false;
      closeEditor();
      return;
    }
    if (editor?.dateKey === route.dateKey || waiting?.dateKey === route.dateKey) return;
    closeEditor();
    const { monthId } = splitDateKey(route.dateKey)!;
    store.show(monthId);
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

  const calendar = mountCalendar(root, {
    store,
    status: engine,
    today: () => todayKey(),
    onOpenDay: (dateKey) => {
      pushedByApp = true;
      location.hash = dateKey;
    },
    onOpenSettings: () => {
      location.hash = 'settings';
    },
  });
  syncRoute();
  return {
    destroy() {
      window.removeEventListener('hashchange', syncRoute);
      closeEditor();
      calendar.destroy();
      window.removeEventListener('storage', onStorage);
      offStatus();
      stopAutoFlush();
      store.destroy();
    },
  };
}

createApp({
  root: document.getElementById('app')!,
  onAuthChange: (listener) =>
    onAuthStateChanged(auth, (user) => {
      listener(user ? { uid: user.uid, email: user.email ?? '' } : null);
    }),
  signIn: async (email, password) => {
    await signInWithEmailAndPassword(auth, email, password);
  },
  signOut: () => signOut(auth),
  mountMain,
});

// 화면 확인용 자동 로그인. 에뮬레이터 모드에서만 동작하며, 그 밖에는 주소 인자를 무시한다.
if (import.meta.env.VITE_USE_EMULATOR === '1' && new URLSearchParams(location.search).get('autologin') === '1') {
  void signInWithEmailAndPassword(auth, 'test@example.com', 'test-password');
}
