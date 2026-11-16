import { afterEach, expect, it, vi } from 'vitest';
import type { PushView } from '../push';
import { pushSection } from './pushSection';

afterEach(() => { document.body.replaceChildren(); });

function mount(view: PushView, viaWidget = false) {
  let current = view;
  const listeners = new Set<() => void>();
  const client = {
    view: () => current,
    onChange: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); },
    enable: vi.fn(async () => undefined),
    disable: vi.fn(async () => undefined),
  };
  const section = pushSection({ client, viaWidget });
  document.body.append(section.el);
  const sw = section.el.querySelector<HTMLInputElement>('input.switch')!;
  const note = section.el.querySelector<HTMLElement>('.push-message')!;
  return { section, client, sw, note, set: (v: PushView) => { current = v; for (const fn of listeners) fn(); } };
}

const view = (mode: PushView['mode'], more: Partial<PushView> = {}): PushView => ({ mode, doc: null, busy: false, message: '', ...more });

it('스위치 하나와 이름만 있고, 시험 단추나 알림 서버 안내는 없다', () => {
  const m = mount(view('off'));
  expect(m.section.el.querySelector('.field-label')!.textContent).toBe('알림');
  expect(m.section.el.querySelector('.pref-name')!.textContent).toBe('알림 받기');
  expect(m.section.el.querySelectorAll('button, details, ol, textarea')).toHaveLength(0);
  expect(m.sw.checked).toBe(false);
  expect(m.sw.disabled).toBe(false);
  expect(m.note.hidden).toBe(true);
  m.section.destroy();
});

/** 끝나는 때를 시험이 정하는 약속. */
function later() {
  let done = (): void => {};
  const promise = new Promise<undefined>((resolve) => { done = () => resolve(undefined); });
  return { promise, done };
}

it('켜면 enable, 끄면 disable을 부르고, 끝날 때까지(권한 질문이 떠 있는 동안도) 누른 대로 둔 채 막는다', async () => {
  const m = mount(view('off'));
  const on = later();
  m.client.enable.mockReturnValueOnce(on.promise);
  m.sw.click();
  expect(m.client.enable).toHaveBeenCalledTimes(1);
  // 아이폰의 권한 질문이 떠 있는 동안: 클라이언트는 아직 바쁘다고 하지 않지만 스위치는 막혀 있다.
  expect([m.sw.checked, m.sw.disabled]).toEqual([true, true]);
  m.sw.click();
  expect(m.client.enable).toHaveBeenCalledTimes(1);
  expect(m.client.disable).not.toHaveBeenCalled();
  m.set(view('on'));
  on.done();
  await vi.waitFor(() => expect([m.sw.checked, m.sw.disabled]).toEqual([true, false]));
  m.sw.click();
  expect(m.client.disable).toHaveBeenCalledTimes(1);
  m.set(view('off'));
  await vi.waitFor(() => expect([m.sw.checked, m.sw.disabled]).toEqual([false, false]));
  m.section.destroy();
});

it('켜지 못하면 스위치를 되돌리고 까닭만 한 줄 보이며, 다시 누르면 그 까닭을 지운다', async () => {
  const m = mount(view('off'));
  m.sw.click();
  m.set(view('off', { message: '알림을 켜지 못했습니다: 연결 안 됨' }));
  await vi.waitFor(() => expect(m.sw.checked).toBe(false));
  expect([m.note.hidden, m.note.textContent]).toEqual([false, '알림을 켜지 못했습니다: 연결 안 됨']);
  const again = later();
  m.client.enable.mockReturnValueOnce(again.promise);
  m.sw.click();
  expect(m.note.hidden).toBe(true);
  again.done();
  m.section.destroy();
});

it('켤 수 없는 화면이면 스위치를 막고 까닭을 짧게 적는다', () => {
  for (const [mode, text] of [['install', '홈 화면'], ['unsupported', '쓸 수 없습니다'], ['denied', '아이폰 설정']] as const) {
    const m = mount(view(mode));
    expect(m.sw.disabled).toBe(true);
    expect(m.sw.checked).toBe(false);
    expect(m.note.textContent).toContain(text);
    m.section.destroy();
  }
});

it('위젯에서 연 화면(Scriptable 안)이면 홈 화면 앱에서 켠 대로 알림이 온다고 적는다. 다른 까닭은 그대로다', () => {
  const m = mount(view('install'), true);
  expect([m.sw.disabled, m.note.textContent]).toEqual([true, '위젯에서 연 화면이라 여기서는 켜고 끌 수 없습니다. 알림은 홈 화면 CalendarFIF 앱에서 켠 대로 옵니다.']);
  m.section.destroy();
  const denied = mount(view('denied'), true);
  expect(denied.note.textContent).toContain('아이폰 설정');
  denied.section.destroy();
});

it('닫으면 더 듣지 않는다', () => {
  const m = mount(view('off'));
  m.section.destroy();
  m.set(view('on'));
  expect(m.sw.checked).toBe(false);
});
