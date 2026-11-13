import { expect, it, vi } from 'vitest';
import type { AccessDoc, AccessSnapshot } from './access';
import { FakeBridge } from './desktop/fakeBridge';

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
const access: { emit?: (s: AccessSnapshot) => void } = {};
vi.mock('./accessStore', () => ({
  firestoreAccessSource: () => ({
    watch: (_uid: string, onSnap: (s: AccessSnapshot) => void) => {
      access.emit = onSnap;
      return () => {
        access.emit = undefined;
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
