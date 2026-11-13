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
