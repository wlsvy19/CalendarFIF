import { afterEach, expect, it, vi } from 'vitest';
import type { PushDoc } from '../../push/doc';
import type { PushView } from '../push';
import { SERVER_STEPS, pushSection, serverText } from './pushSection';

afterEach(() => { document.body.replaceChildren(); });

const NOW = 10_000_000;
const docWith = (sender: PushDoc['sender']): PushDoc => ({ devices: { AAAAAAAAAAAAAAAAAAAA: { token: 't', label: '', at: 1 } }, testAt: 0, sender });

function mount(view: PushView, load: () => Promise<string> = async () => '// 스크립트') {
  let current = view;
  const listeners = new Set<() => void>();
  const client = {
    view: () => current,
    onChange: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); },
    enable: vi.fn(async () => undefined),
    disable: vi.fn(async () => undefined),
    test: vi.fn(async () => undefined),
  };
  const copy = vi.fn(async () => undefined);
  const section = pushSection({ client, loadScript: load, copy, now: () => NOW });
  document.body.append(section.el);
  const shown = (sel: string) => !section.el.querySelector<HTMLElement>(sel)!.hidden;
  return { section, client, copy, shown, set: (v: PushView) => { current = v; for (const fn of listeners) fn(); } };
}

it('켜기 전에는 켜기 단추만, 켠 뒤에는 시험과 끄기를 보인다', () => {
  const m = mount({ mode: 'off', doc: null, busy: false, message: '' });
  expect(m.shown('.push-enable')).toBe(true);
  expect(m.shown('.push-test')).toBe(false);
  m.section.el.querySelector<HTMLElement>('.push-enable')!.click();
  expect(m.client.enable).toHaveBeenCalled();
  m.set({ mode: 'on', doc: docWith({ at: NOW - 30_000, testAt: 0, error: '' }), busy: false, message: '켰습니다.' });
  expect(m.shown('.push-enable')).toBe(false);
  expect(m.shown('.push-test')).toBe(true);
  expect(m.shown('.push-disable')).toBe(true);
  expect(m.section.el.querySelector('.push-server')!.textContent).toBe('알림 서버: 방금 확인했습니다.');
  expect(m.section.el.querySelector('.push-message')!.textContent).toBe('켰습니다.');
  m.section.el.querySelector<HTMLElement>('.push-test')!.click();
  expect(m.client.test).toHaveBeenCalled();
  m.section.destroy();
});

it('Safari 탭이면 홈 화면 앱에서 켜라고 하고 단추를 보이지 않는다', () => {
  const m = mount({ mode: 'install', doc: null, busy: false, message: '' });
  expect(m.section.el.querySelector('.push-state')!.textContent).toContain('홈 화면');
  expect(m.shown('.push-enable')).toBe(false);
  m.section.destroy();
});

it('알림 서버 스크립트를 미리 읽어 두었다가 복사한다', async () => {
  const m = mount({ mode: 'off', doc: null, busy: false, message: '' });
  const btn = m.section.el.querySelector<HTMLButtonElement>('.push-copy')!;
  await vi.waitFor(() => expect(btn.disabled).toBe(false));
  btn.click();
  expect(m.copy).toHaveBeenCalledWith('// 스크립트');
  await vi.waitFor(() => expect(m.section.el.querySelector('.push-copy-status')!.textContent).toContain('복사했습니다'));
  expect([...m.section.el.querySelectorAll('.push-steps li')].map((li) => li.textContent)).toEqual(SERVER_STEPS);
  m.section.destroy();
});

it('알림 서버의 상태 글', () => {
  expect(serverText(null, NOW)).toBe('');
  expect(serverText({ devices: {}, testAt: 0, sender: null }, NOW)).toBe('');
  expect(serverText(docWith(null), NOW)).toContain('아직 연결되지 않았습니다');
  expect(serverText(docWith({ at: NOW - 5 * 60_000, testAt: 0, error: '' }), NOW)).toBe('알림 서버: 5분 전에 확인했습니다.');
  expect(serverText(docWith({ at: NOW - 20 * 60_000, testAt: 0, error: '' }), NOW)).toContain('20분 동안 확인하지 않았습니다');
  expect(serverText(docWith({ at: NOW, testAt: 0, error: 'FCM 403: denied' }), NOW)).toBe('알림 서버 문제: FCM 403: denied');
});
