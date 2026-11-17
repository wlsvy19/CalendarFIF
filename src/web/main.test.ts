import { signOut } from 'firebase/auth';
import { afterEach, expect, it, vi } from 'vitest';
import type { AccessDoc, AccessSnapshot } from './access';
import { FakeBridge } from './desktop/fakeBridge';

// 실패한 시험이 화면을 남겨 다음 시험의 셈을 흐리지 않게, 올린 화면은 끝날 때마다 내린다.
const mounted: Array<{ destroy(): void }> = [];
afterEach(() => {
  for (const app of mounted.splice(0)) app.destroy();
  vi.restoreAllMocks();
  localStorage.clear();
  history.replaceState(null, '', location.pathname + location.search);
  vi.unstubAllEnvs();
});

// 주소 맞추기와 달력 다시 그리기를 센다. 화면을 다시 올린 뒤 같은 것이 두 번 등록되지 않았는지 본다.
const counts = { routes: 0, redraws: 0 };
vi.mock('./router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./router')>();
  return {
    ...actual,
    parseHash: (hash: string) => {
      counts.routes += 1;
      return actual.parseHash(hash);
    },
  };
});
vi.mock('./ui/calendar', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./ui/calendar')>();
  return {
    ...actual,
    mountCalendar: (root: HTMLElement, deps: Parameters<typeof actual.mountCalendar>[1]) => {
      const onChange = deps.store.onChange.bind(deps.store);
      deps.store.onChange = (fn: () => void) =>
        onChange(() => {
          counts.redraws += 1;
          fn();
        });
      return actual.mountCalendar(root, deps);
    },
  };
});

// main.ts는 불러오는 순간 Firebase와 앱을 만들므로, 밖과 닿는 곳만 가짜로 바꾸고 PC 앱 모드로 불러온다.
vi.mock('./firebase', () => ({ initFirebase: () => ({ app: { options: {} }, auth: {}, db: {} }) }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: () => () => {}, signInWithEmailAndPassword: vi.fn(), signOut: vi.fn() }));
vi.mock('../sync/firestoreStore', () => ({
  FirestoreMonthStore: class {
    subscribeMonth(_month: string, listener: (doc: null) => void): () => void {
      listener(null);
      return () => {};
    }
  },
}));
const eventsFeed = vi.hoisted(() => ({ items: {} as Record<string, unknown> }));
vi.mock('../sync/firestoreEvents', () => ({
  FirestoreEventsSource: class {
    subscribe(onData: (items: Record<string, unknown>) => void): () => void {
      onData(eventsFeed.items);
      return () => {};
    }
    async write(pending: Record<string, unknown>): Promise<{ written: string[]; dropped: string[] }> {
      return { written: Object.keys(pending), dropped: [] };
    }
  },
}));
// 내 access 문서는 시험이 직접 보낸다. 관리자 표시 만들기는 늘 거부된다(관리자가 아닌 계정).
const access: { emit?: (s: AccessSnapshot) => void; fail?: (code: string) => void; subscribed: number } = { subscribed: 0 };
vi.mock('./accessStore', () => ({
  firestoreAccessSource: () => ({
    watch: (_uid: string, onSnap: (s: AccessSnapshot) => void, onError: (code: string) => void) => {
      access.subscribed += 1;
      access.emit = onSnap;
      access.fail = onError;
      return () => {
        if (access.emit !== onSnap) return;
        access.emit = undefined;
        access.fail = undefined;
      };
    },
    claimAdmin: () => Promise.reject({ code: 'permission-denied' }),
  }),
  firestoreUsersSource: () => ({
    watchAll: () => () => {},
    put: () => Promise.resolve(),
    setDisabled: () => Promise.resolve(),
    remove: () => Promise.resolve(),
  }),
}));
// 공휴일 자료 받기는 네트워크에 닿으므로 켜는 것만 기록한다. 시험이 onChange를 직접 부른다.
const feed: { starts: number; deps?: import('./holidayFeed').HolidayFeedDeps } = { starts: 0 };
// 푸시 알림: 가짜 Firestore로는 문서를 들을 수 없으므로 아무것도 오지 않는 것으로 바꾼다(푸시를 켜지 않은 기기).
vi.mock('./push', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./push')>()),
  firestorePushRemote: () => ({ watch: () => () => {}, saveDevice: async () => {}, removeDevice: async () => {} }),
  browserPushPlatform: () => ({ supported: false, standalone: false, ios: false, permission: () => 'default', requestPermission: async () => 'default', token: async () => '', dropToken: async () => {} }),
}));
vi.mock('./holidayFeed', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./holidayFeed')>()),
  startHolidayFeed: (deps: import('./holidayFeed').HolidayFeedDeps) => {
    feed.starts += 1;
    feed.deps = deps;
    return { stop() {} };
  },
}));
const captured: { mountMain?: (root: HTMLElement, session: { uid: string; email: string }) => { destroy(): void } } = {};
vi.mock('./app', () => ({
  createApp: (deps: { mountMain: typeof captured.mountMain }) => {
    captured.mountMain = deps.mountMain;
    return { destroy() {} };
  },
}));

const bridge = new FakeBridge();
async function loadMain(): Promise<NonNullable<typeof captured.mountMain>> {
  vi.stubEnv('VITE_DESKTOP', '1');
  vi.stubEnv('VITE_HOLIDAY_URL', 'https://example.com/holidays.json');
  (window as Window).calfifDesktop = bridge;
  await import('./main');
  return captured.mountMain!;
}
const lastInteractive = () => bridge.calls.filter((c) => c[0] === 'setInteractive').at(-1);
const server = (doc: AccessDoc | null): AccessSnapshot => ({ doc, fromCache: false, hasPendingWrites: false });
const accessDoc = (extra: Partial<AccessDoc> = {}): AccessDoc => ({ email: 'a@example.com', role: 'user', disabled: false, createdAt: 1, ...extra });

it('앱 메뉴로 연 설정을 닫으면 편집 화면 없이 달력으로 돌아간다', async () => {
  const mountMain = await loadMain();
  const root = document.createElement('div');
  document.body.append(root);
  const app = mountMain(root, { uid: 'u', email: 'a@example.com' });
  const sheets = () => root.querySelectorAll('.sheet');

  root.querySelector('.cell')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  await vi.waitFor(() => expect(root.querySelector('.sheet:not(.settings)')).not.toBeNull());
  expect(bridge.calls.filter((c) => c[0] === 'setInteractive').at(-1)).toEqual(['setInteractive', true]);

  bridge.emit({ type: 'openSettings' });
  await vi.waitFor(() => expect(root.querySelector('.sheet.settings')).not.toBeNull());
  expect(root.querySelector('.sheet:not(.settings)')).toBeNull();

  root.querySelector<HTMLElement>('.sheet.settings .textbtn.end')!.click();
  await vi.waitFor(() => expect(sheets()).toHaveLength(0));
  await new Promise((r) => setTimeout(r, 50)); // 주소 바뀜이 뒤늦게 편집 화면을 다시 열지 않는지 본다
  expect([sheets().length, location.hash, bridge.calls.filter((c) => c[0] === 'setInteractive').at(-1)]).toEqual([0, '', ['setInteractive', false]]);
  app.destroy();
  vi.unstubAllEnvs();
});

it('허가가 없거나 중지되면 달력 대신 안내를 보이고, 다시 허용되면 달력을 다시 올린다', async () => {
  const mountMain = await loadMain();
  const root = document.createElement('div');
  document.body.append(root);
  const app = mountMain(root, { uid: 'u', email: 'a@example.com' });
  const text = () => root.querySelector('.blocked-text')?.textContent;

  // 달력은 확인을 기다리지 않고 바로 뜬다.
  expect(root.querySelector('.calendar')).not.toBeNull();
  access.emit!(server(accessDoc({ disabled: true })));
  expect(root.querySelector('.calendar')).toBeNull();
  expect(text()).toBe('관리자가 이 계정의 사용을 중지했습니다.');
  expect(root.querySelector('.blocked-email')!.textContent).toBe('a@example.com');
  expect(lastInteractive()).toEqual(['setInteractive', true]);

  // 허가가 지워지면 안내의 문구만 바뀐다.
  access.emit!(server(null));
  await vi.waitFor(() => expect(text()).toBe('이 계정은 사용 허가를 받지 않았습니다. 관리자에게 문의하세요.'));
  expect(root.querySelectorAll('.blocked-text')).toHaveLength(1);

  access.emit!(server(accessDoc()));
  expect(root.querySelector('.blocked-text')).toBeNull();
  expect(root.querySelectorAll('.calendar')).toHaveLength(1);
  expect(lastInteractive()).toEqual(['setInteractive', false]);

  app.destroy();
  expect(access.emit).toBeUndefined();
  expect(root.querySelector('.calendar')).toBeNull();
  vi.unstubAllEnvs();
});

it('#users는 관리자로 확인된 뒤에 사용자 관리를 열고, 보통 사용자는 달력으로 돌려보낸다', async () => {
  const mountMain = await loadMain();
  const root = document.createElement('div');
  document.body.append(root);

  location.hash = 'users';
  const admin = mountMain(root, { uid: 'u', email: 'a@example.com' });
  await new Promise((r) => setTimeout(r, 20));
  expect(root.querySelector('.sheet.users')).toBeNull(); // 확인 중에는 열지 않는다
  access.emit!(server(accessDoc({ role: 'admin' })));
  expect(root.querySelector('.sheet.users')).not.toBeNull();
  expect(lastInteractive()).toEqual(['setInteractive', true]);
  root.querySelector<HTMLElement>('.sheet.users .textbtn.end')!.click();
  await vi.waitFor(() => expect(root.querySelector('.sheet.users')).toBeNull());
  expect(location.hash).toBe('');
  expect(lastInteractive()).toEqual(['setInteractive', false]);
  admin.destroy();

  location.hash = 'users';
  const user = mountMain(root, { uid: 'u', email: 'a@example.com' });
  access.emit!(server(accessDoc()));
  expect(root.querySelector('.sheet.users')).toBeNull();
  expect(location.hash).toBe('');
  expect(root.querySelector('.calendar')).not.toBeNull();
  user.destroy();
  vi.unstubAllEnvs();
});

// 화면을 올리고(끝나면 afterEach가 내린다) 편집 화면과 안내를 다루는 도우미를 돌려준다.
// 날짜 주소로 연 편집 화면은 닫으면 주소를 비운다.
async function start(uid: string) {
  const mountMain = await loadMain();
  const root = document.createElement('div');
  document.body.append(root);
  const app = mountMain(root, { uid, email: 'a@example.com' });
  mounted.push(app);
  const editor = () => root.querySelector<HTMLElement>('.sheet:not(.settings):not(.users)');
  const notice = () => root.querySelector('.blocked-text')?.textContent ?? null;
  const button = (label: string) => [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === label)!;
  const openEditor = async (dateKey: string, text: string) => {
    location.hash = dateKey;
    await vi.waitFor(() => expect(editor()).not.toBeNull());
    editor()!.querySelector('textarea')!.value = text;
  };
  return { root, app, editor, notice, button, openEditor };
}
const tick = () => new Promise((r) => setTimeout(r, 20));

it('편집 화면이 열린 동안 중지되면 편집 화면을 두고, 저장한 뒤에 안내로 바꾼다(저장한 편집은 대기열에 남는다)', async () => {
  const { root, app, editor, notice, openEditor } = await start('hold-save');
  access.emit!(server(accessDoc()));
  await openEditor('2026-11-03', '편집 중인 메모');

  access.emit!(server(accessDoc({ disabled: true })));
  await tick();
  expect([editor() !== null, notice(), root.querySelector('.calendar') !== null]).toEqual([true, null, true]);
  expect(editor()!.querySelector('textarea')!.value).toBe('편집 중인 메모');
  expect(lastInteractive()).toEqual(['setInteractive', true]);

  editor()!.querySelector<HTMLElement>('.textbtn.end')!.click(); // 저장
  await vi.waitFor(() => expect(notice()).toBe('관리자가 이 계정의 사용을 중지했습니다.'));
  expect([editor(), root.querySelector('.calendar')]).toEqual([null, null]);
  expect(localStorage.getItem('calfif.outbox.hold-save')).toContain('편집 중인 메모');
  expect(lastInteractive()).toEqual(['setInteractive', true]); // 안내의 로그아웃 단추를 누를 수 있다
  app.destroy();
  expect(lastInteractive()).toEqual(['setInteractive', false]);
});

it('편집 화면이 열린 동안 허가가 없어지면 취소한 뒤에 안내로 바꾼다', async () => {
  const { root, editor, notice, openEditor } = await start('hold-cancel');
  access.emit!(server(accessDoc()));
  await openEditor('2026-11-03', '적다 만 메모');

  access.emit!(server(null)); // 허가가 지워졌다(관리자 표시 만들기는 거부된다)
  await tick();
  expect([editor() !== null, notice()]).toEqual([true, null]);

  editor()!.querySelector<HTMLElement>('.textbtn.start')!.click(); // 취소
  await vi.waitFor(() => expect(notice()).toBe('이 계정은 사용 허가를 받지 않았습니다. 관리자에게 문의하세요.'));
  expect([editor(), root.querySelector('.calendar')]).toEqual([null, null]);
  expect(localStorage.getItem('calfif.outbox.hold-cancel')).toBeNull();
});

it('편집 화면이 닫히기 전에 다시 허용되면 아무것도 바꾸지 않는다', async () => {
  const { root, editor, notice, openEditor } = await start('hold-back');
  access.emit!(server(accessDoc()));
  await openEditor('2026-11-03', '그대로 둘 메모');
  const calendarBefore = root.querySelector('.calendar');

  access.emit!(server(accessDoc({ disabled: true })));
  access.emit!(server(accessDoc()));
  await tick();
  expect(editor()!.querySelector('textarea')!.value).toBe('그대로 둘 메모');
  editor()!.querySelector<HTMLElement>('.textbtn.start')!.click();
  await vi.waitFor(() => expect(editor()).toBeNull());
  await tick();
  expect([notice(), root.querySelector('.calendar') === calendarBefore]).toEqual([null, true]);
});

it('비밀번호 칸에 적은 글이 있는 동안 중지되면 설정을 두고, 취소한 뒤에 안내로 바꾼다', async () => {
  const { root, notice, button } = await start('hold-pw');
  access.emit!(server(accessDoc()));
  location.hash = 'settings';
  await vi.waitFor(() => expect(root.querySelector('.sheet.settings')).not.toBeNull());
  button('비밀번호 변경').click();
  const current = root.querySelector<HTMLInputElement>('input[name="current"]')!;
  current.value = 'old-pass';
  current.dispatchEvent(new Event('input', { bubbles: true }));

  access.emit!(server(accessDoc({ disabled: true })));
  await tick();
  expect([root.querySelector('.sheet.settings') !== null, notice()]).toEqual([true, null]);
  expect(current.value).toBe('old-pass');

  button('취소').click();
  await vi.waitFor(() => expect(notice()).toBe('관리자가 이 계정의 사용을 중지했습니다.'));
  expect(root.querySelector('.sheet.settings')).toBeNull();
});

it('저장할 수 없는 브라우저에서도 안내 전에 저장한 편집이 달력이 돌아온 뒤 대기 중으로 남는다', async () => {
  vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
    throw new Error('storage blocked');
  });
  const { root, editor, notice, openEditor } = await start('memory');
  access.emit!(server(accessDoc()));
  await openEditor('2026-11-03', '메모리에만 있는 편집');
  editor()!.querySelector<HTMLElement>('.textbtn.end')!.click();
  await vi.waitFor(() => expect(editor()).toBeNull());

  access.emit!(server(accessDoc({ disabled: true })));
  await vi.waitFor(() => expect(notice()).not.toBeNull());
  access.emit!(server(accessDoc()));
  expect(root.querySelector('.calendar')).not.toBeNull();
  location.hash = 'settings';
  await vi.waitFor(() => expect(root.querySelector('.settings-pending')?.textContent).toBe('대기 중인 편집 1건'));
});

it('안내를 거쳐 달력이 돌아와도 주소 바뀜 한 번에 주소 맞추기 한 번, 저장소 바뀜 한 번에 다시 그리기 한 번이다', async () => {
  const { root } = await start('twice');
  for (let i = 0; i < 2; i += 1) {
    access.emit!(server(accessDoc({ disabled: true })));
    access.emit!(server(accessDoc()));
  }
  expect(root.querySelectorAll('.calendar')).toHaveLength(1);
  await tick();

  counts.routes = 0;
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  expect(counts.routes).toBe(1);
  counts.redraws = 0;
  window.dispatchEvent(new StorageEvent('storage', { key: null }));
  expect(counts.redraws).toBe(1);
});

it('공휴일 자료 받기는 로그인 전에 한 번만 켜고, 새 자료가 오면 열려 있는 달력을 다시 그린다', async () => {
  await loadMain();
  expect(feed.starts).toBe(1); // 페이지를 불러올 때 한 번(로그인 전)
  expect(feed.deps!.url).toBe('https://example.com/holidays.json'); // VITE_HOLIDAY_URL
  feed.deps!.onChange(); // 달력이 없을 때는 아무것도 하지 않는다

  const first = await start('feed-a');
  counts.redraws = 0;
  feed.deps!.onChange();
  expect(counts.redraws).toBe(1);

  // 안내를 거쳐 달력을 다시 올려도 한 번만 다시 그린다.
  access.emit!(server(accessDoc({ disabled: true })));
  access.emit!(server(accessDoc()));
  expect(first.root.querySelectorAll('.calendar')).toHaveLength(1);
  counts.redraws = 0;
  feed.deps!.onChange();
  expect(counts.redraws).toBe(1);

  first.app.destroy();
  counts.redraws = 0;
  feed.deps!.onChange();
  expect(counts.redraws).toBe(0);
  expect(feed.starts).toBe(1); // 다시 로그인해도 새로 켜지 않는다
});

it('접근 상태를 <html data-access>에 적고, 로그아웃하면 지운다', async () => {
  const html = document.documentElement;
  const { app } = await start('data');
  expect(html.dataset.access).toBe('checking');
  access.emit!(server(accessDoc({ role: 'admin' })));
  expect(html.dataset.access).toBe('admin');
  access.emit!(server(accessDoc({ disabled: true })));
  expect(html.dataset.access).toBe('blocked');
  access.emit!(server(null));
  await vi.waitFor(() => expect(html.dataset.access).toBe('none'));
  access.emit!(server(accessDoc()));
  expect(html.dataset.access).toBe('user');
  app.destroy();
  expect(html.dataset.access).toBeUndefined();
});

it('내 허가 문서를 지켜보다 거부돼도 허가 없음 안내를 띄우지 않는다(규칙 배포 직후)', async () => {
  const html = document.documentElement;
  const { root, notice } = await start('watch-denied');
  access.fail!('permission-denied');
  await tick();
  expect([notice(), root.querySelector('.calendar') !== null, html.dataset.access]).toEqual([null, true, 'checking']);
});

it('안내에는 올리지 못한 편집의 건수가 나오고, 로그아웃은 한 번 더 묻는다', async () => {
  const { root, editor, notice, button, openEditor } = await start('notice-pending');
  access.emit!(server(accessDoc()));
  await openEditor('2026-11-03', '올리지 못한 메모');
  editor()!.querySelector<HTMLElement>('.textbtn.end')!.click();
  await vi.waitFor(() => expect(editor()).toBeNull());
  access.emit!(server(accessDoc({ disabled: true })));
  await vi.waitFor(() => expect(notice()).toBe('관리자가 이 계정의 사용을 중지했습니다.'));
  expect(root.querySelector('.blocked-pending')!.textContent).toBe('아직 올리지 못한 편집이 1건 있습니다.');

  const calls = vi.mocked(signOut).mock.calls.length;
  button('로그아웃').click();
  expect(root.querySelector('.blocked-confirm')!.textContent).toBe('아직 올리지 못한 편집이 1건 있습니다. 로그아웃하면 이 기기에 남습니다.');
  expect(vi.mocked(signOut).mock.calls.length).toBe(calls);
  button('그래도 로그아웃').click();
  expect(vi.mocked(signOut).mock.calls.length).toBe(calls + 1);
});

it('안내의 다시 확인은 허가를 새로 확인하고, 허가가 있으면 달력으로 돌아간다', async () => {
  const { root, notice, button } = await start('notice-recheck');
  access.emit!(server(null)); // 허가 없음(관리자 표시 만들기는 거부된다)
  await vi.waitFor(() => expect(notice()).toBe('이 계정은 사용 허가를 받지 않았습니다. 관리자에게 문의하세요.'));
  expect(root.querySelector<HTMLElement>('.blocked-pending')!.hidden).toBe(true);
  const before = access.subscribed;
  button('다시 확인').click();
  expect(access.subscribed).toBe(before + 1);
  expect(button('확인하는 중').disabled).toBe(true);
  access.emit!(server(accessDoc())); // 그 사이 관리자가 추가했다
  expect([notice(), root.querySelectorAll('.calendar').length, lastInteractive()]).toEqual([null, 1, ['setInteractive', false]]);
});

it('PC 앱: 설정 → 사용자 관리 → 닫기를 거치면 창은 다시 입력을 받지 않는다', async () => {
  const { root, button } = await start('pc-users');
  access.emit!(server(accessDoc({ role: 'admin' })));
  bridge.emit({ type: 'openSettings', page: 'account' });
  await vi.waitFor(() => expect(root.querySelector('.sheet.settings')).not.toBeNull());
  expect(lastInteractive()).toEqual(['setInteractive', true]);

  button('사용자 관리').click();
  await vi.waitFor(() => expect(root.querySelector('.sheet.users')).not.toBeNull());
  await vi.waitFor(() => expect(root.querySelector('.sheet.settings')).toBeNull());
  expect(lastInteractive()).toEqual(['setInteractive', true]);
  expect(root.querySelector('.sheet.users .sheet-bar')!.classList.contains('drag-handle')).toBe(true);

  root.querySelector<HTMLElement>('.sheet.users .textbtn.end')!.click();
  await vi.waitFor(() => expect(root.querySelectorAll('.sheet')).toHaveLength(0));
  await tick();
  expect([location.hash, lastInteractive()]).toEqual(['', ['setInteractive', false]]);
});

it('PC 앱: 사용자 관리 상자를 옮긴 자리는 따로 기억하고 편집 화면에는 쓰지 않는다', async () => {
  const { root, editor, openEditor } = await start('pc-users-drag');
  access.emit!(server(accessDoc({ role: 'admin' })));
  const users = () => root.querySelector<HTMLElement>('.sheet.users');
  const offset = (el: HTMLElement) => el.style.getPropertyValue('--drag-x');
  const pointer = (el: Element, type: string, x: number) =>
    el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, button: 0, clientX: x, clientY: 0 }));

  location.hash = 'users';
  await vi.waitFor(() => expect(users()).not.toBeNull());
  const title = users()!.querySelector('.sheet-bar h3')!;
  pointer(title, 'pointerdown', 100);
  pointer(title, 'pointermove', 130);
  pointer(title, 'pointerup', 130);
  expect(offset(users()!)).toBe('30px');
  location.hash = '';
  await vi.waitFor(() => expect(users()).toBeNull());

  await openEditor('2026-11-03', '');
  expect(offset(editor()!)).toBe('0px');
  location.hash = '';
  await vi.waitFor(() => expect(editor()).toBeNull());

  location.hash = 'users';
  await vi.waitFor(() => expect(users()).not.toBeNull());
  expect(offset(users()!)).toBe('30px');
});

it('로그아웃하고 다른 계정으로 로그인하면 앞 계정의 접근 상태, 사용자 관리, 대기 건수가 보이지도 쓰이지도 않는다', async () => {
  const html = document.documentElement;
  const first = await start('first-acct');
  access.emit!(server(accessDoc({ role: 'admin' })));
  await first.openEditor('2026-11-03', '앞 계정의 메모');
  first.editor()!.querySelector<HTMLElement>('.textbtn.end')!.click();
  await vi.waitFor(() => expect(first.editor()).toBeNull());
  location.hash = 'users';
  await vi.waitFor(() => expect(first.root.querySelector('.sheet.users')).not.toBeNull());
  // 다른 기기에서 비밀번호를 바꿔 로그인이 풀린 것처럼, 주소가 #users로 남은 채 화면이 내려간다.
  first.app.destroy();
  first.root.remove();
  expect([html.dataset.access, location.hash]).toEqual([undefined, '#users']);

  const second = await start('second-acct');
  expect(html.dataset.access).toBe('checking');
  await tick();
  expect(second.root.querySelector('.sheet.users')).toBeNull(); // 아직 모르는 계정에는 열지 않는다
  access.emit!(server(accessDoc()));
  expect([html.dataset.access, location.hash, second.root.querySelector('.sheet.users')]).toEqual(['user', '', null]);

  location.hash = 'settings';
  await vi.waitFor(() => expect(second.root.querySelector('.settings-pending')?.textContent).toBe('대기 중인 편집 0건'));
  expect(second.button('사용자 관리')).toBeUndefined();
  second.root.querySelector<HTMLElement>('.sheet.settings .textbtn.end')!.click();
  await vi.waitFor(() => expect(second.root.querySelector('.sheet.settings')).toBeNull());

  // 메뉴의 로그아웃은 이 계정의 대기 건수(0)를 보고 바로 로그아웃한다.
  const calls = vi.mocked(signOut).mock.calls.length;
  bridge.emit({ type: 'signOut' });
  expect(vi.mocked(signOut).mock.calls.length).toBe(calls + 1);

  access.emit!(server(accessDoc({ disabled: true })));
  await vi.waitFor(() => expect(second.notice()).toBe('관리자가 이 계정의 사용을 중지했습니다.'));
  expect(second.root.querySelector<HTMLElement>('.blocked-pending')!.hidden).toBe(true);
  expect(localStorage.getItem('calfif.outbox.first-acct')).toContain('앞 계정의 메모');
});

it('확인 중에 연 설정에도 관리자로 확인되면 사용자 관리가 생기고(적던 비밀번호는 그대로), 누르면 열린다', async () => {
  const { root, button } = await start('late-admin');
  bridge.emit({ type: 'openSettings', page: 'account' });
  await vi.waitFor(() => expect(root.querySelector('.sheet.settings')).not.toBeNull());
  const sheet = root.querySelector('.sheet.settings');
  expect(button('사용자 관리')).toBeUndefined();
  button('비밀번호 변경').click();
  const current = root.querySelector<HTMLInputElement>('input[name="current"]')!;
  current.value = 'old-pass';
  current.dispatchEvent(new Event('input', { bubbles: true }));

  access.emit!(server(accessDoc({ role: 'admin' })));
  expect(root.querySelector('.sheet.settings')).toBe(sheet);
  expect([root.querySelector('input[name="current"]') === current, current.value]).toEqual([true, 'old-pass']);
  button('취소').click();
  button('사용자 관리').click();
  await vi.waitFor(() => expect(root.querySelector('.sheet.users')).not.toBeNull());
  expect(root.querySelector('.sheet.settings')).toBeNull();
});

it('확인 중에 연 설정은 사용자로 확인되면 사용자 관리를 보이지 않는다', async () => {
  const { root, button } = await start('late-user');
  location.hash = 'settings';
  await vi.waitFor(() => expect(root.querySelector('.sheet.settings')).not.toBeNull());
  access.emit!(server(accessDoc()));
  await tick();
  expect([root.querySelector('.sheet.settings') !== null, button('사용자 관리')]).toEqual([true, undefined]);
});

const dueAlarm = () => {
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return {
    a1: {
      type: 'alarm', date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`, text: '약', done: false,
      repeat: { freq: 'none' }, time: `${pad(now.getHours())}:${pad(now.getMinutes())}`, advance: [0], editedAt: 1, editedBy: 'dev',
    },
  } as typeof eventsFeed.items;
};

it('PC 앱은 울린 알림을 알림 창으로 보내고 화면 안 알림 상자는 띄우지 않는다', async () => {
  eventsFeed.items = dueAlarm();
  const before = bridge.calls.length;
  try {
    const mountMain = await loadMain();
    const root = document.createElement('div');
    document.body.append(root);
    const app = mountMain(root, { uid: 'u', email: 'a@example.com' });
    const sent = bridge.calls.slice(before).filter((c) => c[0] === 'showAlarms');
    expect(sent).toHaveLength(1);
    expect(sent[0][1]).toEqual([{ time: (eventsFeed.items.a1 as { time: string }).time, text: '약', date: (eventsFeed.items.a1 as { date: string }).date, advance: 0 }]);
    expect(root.querySelector('.alarm-banner')).toBeNull();
    app.destroy();
  } finally {
    eventsFeed.items = {};
  }
});

// 아래는 웹앱 모드로 main을 다시 불러 시험한다. 앞의 PC 앱 시험들이 쓰는 모듈을 바꾸므로 이 파일의 끝에 둔다.
async function startWeb(uid: string) {
  vi.resetModules();
  vi.stubEnv('VITE_DESKTOP', '');
  delete (window as { calfifDesktop?: unknown }).calfifDesktop;
  await import('./main');
  const root = document.createElement('div');
  document.body.append(root);
  const app = captured.mountMain!(root, { uid, email: 'a@example.com' });
  mounted.push(app);
  const day = () => root.querySelector<HTMLElement>('.sheet:not(.settings):not(.users):not(.event-sheet)');
  const title = (dateKey: string) => {
    const [y, m, d] = dateKey.split('-').map(Number);
    return `${m}월 ${d}일 ${'일월화수목금토'[new Date(y, m - 1, d).getDay()]}요일`;
  };
  return { root, app, day, title };
}

it('웹앱: 편집 화면이 열린 동안 알림 상자의 줄을 누르면 고친 메모를 저장하고 그 날짜를 연다', async () => {
  eventsFeed.items = dueAlarm();
  try {
    const { root, day, title } = await startWeb('banner-save');
    access.emit!(server(accessDoc()));
    const due = (eventsFeed.items.a1 as { date: string }).date;
    expect(root.querySelector('.alarm-banner .alarm-item')).not.toBeNull();
    location.hash = '2000-01-03';
    await vi.waitFor(() => expect(day()?.querySelector('h3')?.textContent).toBe(title('2000-01-03')));
    day()!.querySelector('textarea')!.value = '적던 메모';
    root.querySelector<HTMLElement>('.alarm-banner .alarm-item')!.click();
    await vi.waitFor(() => expect(day()?.querySelector('h3')?.textContent).toBe(title(due)));
    expect(location.hash).toBe(`#${due}`);
    expect(root.querySelectorAll('.sheet')).toHaveLength(1);
    expect(localStorage.getItem('calfif.outbox.banner-save')).toContain('적던 메모');
    expect(root.querySelector('.alarm-banner')).toBeNull();
    await tick();
    expect(day()?.querySelector('h3')?.textContent).toBe(title(due)); // 늦게 오는 hashchange가 다시 닫지 않는다
  } finally {
    eventsFeed.items = {};
  }
});

it('웹앱: 고친 것이 없으면 알림 상자의 줄을 눌러 그냥 닫고 그 날짜를 연다', async () => {
  eventsFeed.items = dueAlarm();
  try {
    const { root, day, title } = await startWeb('banner-clean');
    access.emit!(server(accessDoc()));
    const due = (eventsFeed.items.a1 as { date: string }).date;
    location.hash = '2000-01-03';
    await vi.waitFor(() => expect(day()?.querySelector('h3')?.textContent).toBe(title('2000-01-03')));
    root.querySelector<HTMLElement>('.alarm-banner .alarm-item')!.click();
    await vi.waitFor(() => expect(day()?.querySelector('h3')?.textContent).toBe(title(due)));
    expect(localStorage.getItem('calfif.outbox.banner-clean')).toBeNull();
  } finally {
    eventsFeed.items = {};
  }
});

it('웹앱: 알림 시트가 열려 있으면 알림 상자의 줄을 눌러도 옮기지 않고 그 줄만 치운다', async () => {
  eventsFeed.items = dueAlarm();
  try {
    const { root, day, title } = await startWeb('banner-sheet');
    access.emit!(server(accessDoc()));
    location.hash = '2000-01-03';
    await vi.waitFor(() => expect(day()?.querySelector('h3')?.textContent).toBe(title('2000-01-03')));
    day()!.querySelector('textarea')!.value = '적던 메모';
    day()!.querySelector<HTMLElement>('button.tool.alarm')!.click();
    const input = root.querySelector<HTMLTextAreaElement>('.event-sheet textarea.ev-text')!;
    input.value = '적던 알림';
    root.querySelector<HTMLElement>('.alarm-banner .alarm-item')!.click();
    await tick();
    expect(root.querySelector('.alarm-banner')).toBeNull();
    expect(location.hash).toBe('#2000-01-03');
    expect(root.querySelector<HTMLTextAreaElement>('.event-sheet textarea.ev-text')).toBe(input);
    expect(input.value).toBe('적던 알림');
    expect([day()?.querySelector('h3')?.textContent, day()?.querySelector('textarea')?.value]).toEqual([title('2000-01-03'), '적던 메모']);
    expect(localStorage.getItem('calfif.outbox.banner-sheet')).toBeNull();
  } finally {
    eventsFeed.items = {};
  }
});

it('웹앱은 화면을 내리면 울린 알림 상자도 함께 지워진다', async () => {
  eventsFeed.items = dueAlarm();
  try {
    vi.resetModules();
    vi.stubEnv('VITE_DESKTOP', '');
    delete (window as { calfifDesktop?: unknown }).calfifDesktop;
    await import('./main');
    const mountMain = captured.mountMain!;
    const root = document.createElement('div');
    document.body.append(root);
    const app = mountMain(root, { uid: 'u', email: 'a@example.com' });
    expect(root.querySelector('.alarm-banner')).not.toBeNull();
    access.emit!(server(accessDoc({ disabled: true })));
    expect(root.querySelector('.calendar')).toBeNull();
    expect(root.querySelector('.alarm-banner')).toBeNull();
    app.destroy();
  } finally {
    eventsFeed.items = {};
  }
});

it('웹앱: 위젯에서 연 화면은 아직 올리지 못한 편집을 window.__calfifPending에 적어 둔다. 보통 화면은 적지 않는다', async () => {
  const pendingText = (): unknown => (window as unknown as Record<string, unknown>).__calfifPending;
  const saveMemo = async (uid: string, text: string): Promise<void> => {
    const { day, title } = await startWeb(uid);
    access.emit!(server(accessDoc()));
    location.hash = '2000-01-03';
    await vi.waitFor(() => expect(day()?.querySelector('h3')?.textContent).toBe(title('2000-01-03')));
    day()!.querySelector('textarea')!.value = text;
    day()!.querySelector<HTMLElement>('.textbtn.end')!.click();
    await vi.waitFor(() => expect(day()).toBeNull());
  };
  try {
    await saveMemo('bridge-plain', '보통 화면의 메모');
    expect(pendingText()).toBeUndefined();

    sessionStorage.setItem('calfif.via', 'widget');
    await saveMemo('bridge-widget', '위젯에서 고친 메모');
    const message = JSON.parse(pendingText() as string) as { v: number; uid: string; edits: { monthId: string; day: string; text: string; color: string; editedAt: number }[] };
    expect([message.v, message.uid, message.edits.map((e) => [e.monthId, e.day, e.text, e.color])]).toEqual([1, 'bridge-widget', [['2000-01', '03', '위젯에서 고친 메모', '']]]);
    expect(message.edits[0].editedAt).toBeGreaterThan(0);
  } finally {
    sessionStorage.removeItem('calfif.via');
    delete (window as unknown as Record<string, unknown>).__calfifPending;
  }
});

it('웹앱: 위젯에서 연 화면은 올릴 것이 없으면 빈 목록을 적어 둔다(위젯이 앞에 받아 둔 것을 지운다)', async () => {
  sessionStorage.setItem('calfif.via', 'widget');
  try {
    await startWeb('bridge-empty');
    access.emit!(server(accessDoc()));
    await vi.waitFor(() => expect((window as unknown as Record<string, unknown>).__calfifPending).toBe('{"v":1,"uid":"bridge-empty","edits":[]}'));
  } finally {
    sessionStorage.removeItem('calfif.via');
    delete (window as unknown as Record<string, unknown>).__calfifPending;
  }
});

const setHidden = (state: 'hidden' | 'visible'): void => {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
};
const outboxOf = (uid: string): { day: string; base: { text: string }; next: { text: string } }[] => JSON.parse(localStorage.getItem(`calfif.outbox.${uid}`) ?? '[]');

it('웹앱: 편집 화면을 연 채 화면이 가려지면 고친 메모를 대기열에 넣고 편집 화면은 그대로 둔다. 그 뒤 취소하면 되돌린다', async () => {
  try {
    const { day, title } = await startWeb('keep-hidden');
    access.emit!(server(accessDoc()));
    location.hash = '2000-01-03';
    await vi.waitFor(() => expect(day()?.querySelector('h3')?.textContent).toBe(title('2000-01-03')));
    day()!.querySelector('textarea')!.value = '나가기 전에 적은 메모';
    setHidden('hidden');
    expect(outboxOf('keep-hidden').map((e) => [e.day, e.base.text, e.next.text])).toEqual([['03', '', '나가기 전에 적은 메모']]);
    expect(day()!.querySelector('textarea')!.value).toBe('나가기 전에 적은 메모');

    // 돌아와 더 적고 다시 나가면 앞의 것에 이어 붙는다(base가 앞에서 저장해 둔 값이다).
    setHidden('visible');
    day()!.querySelector('textarea')!.value = '나가기 전에 적은 메모\n한 줄 더';
    setHidden('hidden');
    expect(outboxOf('keep-hidden').map((e) => [e.day, e.base.text, e.next.text])).toEqual([['03', '', '나가기 전에 적은 메모\n한 줄 더']]);

    setHidden('visible');
    day()!.querySelector<HTMLElement>('.textbtn.start')!.click(); // 취소
    await vi.waitFor(() => expect(day()).toBeNull());
    expect(outboxOf('keep-hidden')).toEqual([]);
  } finally {
    setHidden('visible');
  }
});

it('PC 앱: 창이 가려져도 적던 메모를 저장하지 않는다', async () => {
  vi.resetModules();
  try {
    const { editor, openEditor } = await start('keep-desktop');
    access.emit!(server(accessDoc()));
    await openEditor('2026-11-03', '적는 중');
    setHidden('hidden');
    expect(localStorage.getItem('calfif.outbox.keep-desktop')).toBeNull();
    expect(editor()!.querySelector('textarea')!.value).toBe('적는 중');
  } finally {
    setHidden('visible');
  }
});
