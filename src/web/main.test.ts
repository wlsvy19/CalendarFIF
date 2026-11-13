import { expect, it, vi } from 'vitest';
import { FakeBridge } from './desktop/fakeBridge';

// main.ts는 불러오는 순간 Firebase와 앱을 만들므로, 밖과 닿는 곳만 가짜로 바꾸고 PC 앱 모드로 불러온다.
vi.mock('./firebase', () => ({ initFirebase: () => ({ auth: {}, db: {} }) }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: () => () => {}, signInWithEmailAndPassword: vi.fn(), signOut: vi.fn() }));
vi.mock('../sync/firestoreStore', () => ({
  FirestoreMonthStore: class {
    subscribeMonth(_month: string, listener: (doc: null) => void): () => void {
      listener(null);
      return () => {};
    }
  },
}));
const captured: { mountMain?: (root: HTMLElement, session: { uid: string; email: string }) => { destroy(): void } } = {};
vi.mock('./app', () => ({
  createApp: (deps: { mountMain: typeof captured.mountMain }) => {
    captured.mountMain = deps.mountMain;
    return { destroy() {} };
  },
}));

it('앱 메뉴로 연 설정을 닫으면 편집 화면 없이 달력으로 돌아간다', async () => {
  vi.stubEnv('VITE_DESKTOP', '1');
  const bridge = new FakeBridge();
  (window as Window).calfifDesktop = bridge;
  await import('./main');
  const root = document.createElement('div');
  document.body.append(root);
  const app = captured.mountMain!(root, { uid: 'u', email: 'a@example.com' });
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
