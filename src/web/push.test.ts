import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PushDevice, PushDoc } from '../push/doc';
import { DEVICE_KEY, PushClient, TEST_WAIT_MS, type PushPlatform, type PushRemote } from './push';
import { senderIdFromAppId } from './firebase';

afterEach(() => { vi.useRealTimers(); });

const memoryStore = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
};

function setup(opts: { platform?: Partial<PushPlatform>; doc?: PushDoc; deviceId?: string } = {}) {
  let perm: 'default' | 'granted' | 'denied' = 'default';
  const platform: PushPlatform = {
    supported: true, standalone: true, ios: true,
    permission: () => perm,
    requestPermission: vi.fn(async () => { perm = 'granted'; return perm; }),
    token: vi.fn(async () => 'tok-new'),
    dropToken: vi.fn(async () => undefined),
    ...opts.platform,
  };
  let push: (d: PushDoc) => void = () => {};
  let current: PushDoc = opts.doc ?? { devices: {}, testAt: 0, sender: null };
  const remote: PushRemote = {
    watch: (onDoc) => { push = onDoc; onDoc(current); return () => {}; },
    saveDevice: vi.fn(async (id: string, d: PushDevice) => { current = { ...current, devices: { ...current.devices, [id]: d } }; push(current); }),
    removeDevice: vi.fn(async (id: string) => { const { [id]: _gone, ...rest } = current.devices; current = { ...current, devices: rest }; push(current); }),
    requestTest: vi.fn(async (at: number) => { current = { ...current, testAt: at }; push(current); }),
  };
  const storage = memoryStore();
  if (opts.deviceId) storage.setItem(DEVICE_KEY, opts.deviceId);
  const client = new PushClient({ platform, remote, storage, now: () => 1_000_000, label: '아이폰' });
  return { client, platform, remote, storage, setPerm: (p: typeof perm) => { perm = p; }, setDoc: (d: PushDoc) => { current = d; push(d); } };
}

describe('PushClient', () => {
  it('아이폰의 Safari 탭이면 홈 화면 앱에서 켜라고, 막혔으면 막혔다고', () => {
    expect(setup({ platform: { standalone: false, supported: false } }).client.view().mode).toBe('install');
    expect(setup({ platform: { ios: false, supported: false } }).client.view().mode).toBe('unsupported');
    const d = setup();
    d.setPerm('denied');
    expect(d.client.view().mode).toBe('denied');
  });

  it('켜면 권한을 먼저 묻고 토큰을 받아 이 기기 이름으로 적는다', async () => {
    const s = setup();
    s.client.start();
    expect(s.client.view().mode).toBe('off');
    await s.client.enable();
    expect(s.platform.requestPermission).toHaveBeenCalledTimes(1);
    const id = s.storage.getItem(DEVICE_KEY)!;
    expect(id).toMatch(/^[A-Za-z0-9]{20}$/);
    expect(s.remote.saveDevice).toHaveBeenCalledWith(id, { token: 'tok-new', label: '아이폰', at: 1_000_000 });
    expect(s.client.view().mode).toBe('on');
    expect(s.client.view().message).toContain('켰습니다');
  });

  it('허용하지 않으면 적지 않는다', async () => {
    const s = setup({ platform: { requestPermission: vi.fn(async () => 'denied' as const) } });
    await s.client.enable();
    expect(s.remote.saveDevice).not.toHaveBeenCalled();
    expect(s.client.view().message).toContain('허용하지 않았습니다');
  });

  it('토큰을 받지 못하면 그 까닭을 보인다', async () => {
    const s = setup({ platform: { token: vi.fn(async () => { throw new Error('FCM 등록 실패'); }) } });
    await s.client.enable();
    expect(s.client.view().message).toBe('알림을 켜지 못했습니다: FCM 등록 실패');
    expect(s.client.view().busy).toBe(false);
  });

  it('기기가 다섯이 넘지 않게 가장 오래된 것을 뺀다', async () => {
    const devices: Record<string, PushDevice> = {};
    for (let i = 0; i < 5; i += 1) devices[`D${String(i).padStart(19, '0')}`] = { token: `t${i}`, label: '', at: 10 + i };
    const s = setup({ doc: { devices, testAt: 0, sender: null } });
    s.client.start();
    await s.client.enable();
    expect(s.remote.removeDevice).toHaveBeenCalledWith('D0000000000000000000');
    expect(Object.keys((s.client.view().doc as PushDoc).devices)).toHaveLength(5);
  });

  it('끄면 문서에서 빼고 이 기기의 이름과 토큰을 지운다', async () => {
    const s = setup({ deviceId: 'AAAAAAAAAAAAAAAAAAAA', doc: { devices: { AAAAAAAAAAAAAAAAAAAA: { token: 't', label: '', at: 1 } }, testAt: 0, sender: null } });
    s.setPerm('granted');
    s.client.start();
    expect(s.client.view().mode).toBe('on');
    await s.client.disable();
    expect(s.remote.removeDevice).toHaveBeenCalledWith('AAAAAAAAAAAAAAAAAAAA');
    expect(s.storage.getItem(DEVICE_KEY)).toBeNull();
    expect(s.platform.dropToken).toHaveBeenCalled();
    expect(s.client.view().mode).toBe('off');
  });

  it('열 때 켜져 있으면 바뀐 토큰을 새로 적고, 서버가 지운 기기도 다시 적는다', async () => {
    const s = setup({ deviceId: 'AAAAAAAAAAAAAAAAAAAA', doc: { devices: { AAAAAAAAAAAAAAAAAAAA: { token: 'tok-old', label: '', at: 999_999 } }, testAt: 0, sender: null } });
    s.setPerm('granted');
    s.client.start();
    await vi.waitFor(() => expect(s.remote.saveDevice).toHaveBeenCalledWith('AAAAAAAAAAAAAAAAAAAA', { token: 'tok-new', label: '아이폰', at: 1_000_000 }));
    const gone = setup({ deviceId: 'AAAAAAAAAAAAAAAAAAAA' });
    gone.setPerm('granted');
    gone.client.start();
    await vi.waitFor(() => expect(gone.remote.saveDevice).toHaveBeenCalledTimes(1));
  });

  it('시험 알림: 부탁하고, 보낸 기록이 오면 알리고, 오지 않으면 2분 반 뒤에 알림 서버를 보라고 한다', async () => {
    vi.useFakeTimers();
    const s = setup({ deviceId: 'AAAAAAAAAAAAAAAAAAAA', doc: { devices: { AAAAAAAAAAAAAAAAAAAA: { token: 'tok-new', label: '', at: 1_000_000 } }, testAt: 0, sender: null } });
    s.setPerm('granted');
    s.client.start();
    await s.client.test();
    expect(s.remote.requestTest).toHaveBeenCalledWith(1_000_000);
    expect(s.client.view().message).toContain('1분 안에');
    s.setDoc({ ...(s.client.view().doc as PushDoc), sender: { at: 1_000_050, testAt: 1_000_000, error: '' } });
    expect(s.client.view().message).toContain('시험 알림을 보냈습니다');
    await s.client.test();
    vi.advanceTimersByTime(TEST_WAIT_MS);
    expect(s.client.view().message).toContain('응답하지 않습니다');
  });

  it('푸시가 켜져 있고 알림 서버가 살아 있을 때만 화면 안 알림을 맡는다', () => {
    const doc = (senderAt: number): PushDoc => ({ devices: { AAAAAAAAAAAAAAAAAAAA: { token: 't', label: '', at: 1 } }, testAt: 0, sender: { at: senderAt, testAt: 0, error: '' } });
    const alive = setup({ deviceId: 'AAAAAAAAAAAAAAAAAAAA', doc: doc(1_000_000 - 60_000) });
    alive.setPerm('granted');
    alive.client.start();
    expect(alive.client.handlesAlarms()).toBe(true);
    const stale = setup({ deviceId: 'AAAAAAAAAAAAAAAAAAAA', doc: doc(1_000_000 - 20 * 60_000) });
    stale.setPerm('granted');
    stale.client.start();
    expect(stale.client.handlesAlarms()).toBe(false);
  });
});

it('앱 ID에서 FCM의 보내는 쪽 번호를 꺼낸다', () => {
  expect(senderIdFromAppId('1:123456789:web:abcdef')).toBe('123456789');
  expect(senderIdFromAppId('demo')).toBeUndefined();
  expect(senderIdFromAppId(undefined)).toBeUndefined();
});
