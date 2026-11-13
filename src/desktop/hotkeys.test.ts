import { expect, it, vi } from 'vitest';
import { HotkeyManager, type Registrar } from './hotkeys';

function fakeRegistrar(taken: string[] = []) {
  const registered = new Map<string, () => void>();
  const reg: Registrar = {
    register: (acc, fn) => { if (taken.includes(acc) || registered.has(acc)) return false; registered.set(acc, fn); return true; },
    unregister: (acc) => { registered.delete(acc); },
  };
  return { reg, registered };
}
const hk = (accelerator: string, enabled = true) => ({ accelerator, enabled });
const acts = () => ({ hide: vi.fn(), content: vi.fn() });

it('켠 단축키만 등록하고, 누르면 할 일을 부른다', () => {
  const { reg, registered } = fakeRegistrar();
  const actions = acts();
  expect(new HotkeyManager(reg).apply({ hideHotkey: hk('Ctrl+Alt+H'), contentHotkey: hk('Ctrl+Alt+F', false) }, actions)).toEqual({ hide: 'ok', content: 'off' });
  registered.get('Ctrl+Alt+H')!();
  expect(actions.hide).toHaveBeenCalledTimes(1);
});
it('다른 프로그램이 쓰면 taken, 이상하면 invalid이고 다른 하나는 그대로 동작한다', () => {
  const { reg, registered } = fakeRegistrar(['Ctrl+Alt+H']);
  const m = new HotkeyManager(reg);
  expect(m.apply({ hideHotkey: hk('Ctrl+Alt+H'), contentHotkey: hk('Ctrl+Alt+F') }, acts())).toEqual({ hide: 'taken', content: 'ok' });
  expect([...registered.keys()]).toEqual(['Ctrl+Alt+F']);
  expect(m.apply({ hideHotkey: hk('H'), contentHotkey: hk('Ctrl+Alt+F') }, acts())).toEqual({ hide: 'invalid', content: 'ok' });
});
it('다시 적용하면 앞서 등록한 것을 풀고, 두 단축키가 같으면 뒤의 것은 taken, 끝낼 때 모두 푼다', () => {
  const { reg, registered } = fakeRegistrar();
  const m = new HotkeyManager(reg);
  m.apply({ hideHotkey: hk('Ctrl+Alt+H'), contentHotkey: hk('Ctrl+Alt+F') }, acts());
  expect(m.apply({ hideHotkey: hk('Ctrl+Alt+J'), contentHotkey: hk('Ctrl+Alt+J') }, acts())).toEqual({ hide: 'ok', content: 'taken' });
  expect([...registered.keys()]).toEqual(['Ctrl+Alt+J']);
  m.dispose();
  expect(registered.size).toBe(0);
});
it('창이 입력을 받는 동안은 아무것도 등록하지 않고, 끝나면 그때의 설정으로 등록한다', () => {
  const { reg, registered } = fakeRegistrar();
  const m = new HotkeyManager(reg);
  const actions = acts();
  m.apply({ hideHotkey: hk('Ctrl+Alt+H'), contentHotkey: hk('Ctrl+Alt+F') }, actions);
  expect(registered.size).toBe(2);
  expect(m.setPaused(true)).toBeNull();
  expect(registered.size).toBe(0);
  expect(m.setPaused(true)).toBeNull();
  expect(m.setPaused(false)).toEqual({ hide: 'ok', content: 'ok' });
  expect([...registered.keys()].sort()).toEqual(['Ctrl+Alt+F', 'Ctrl+Alt+H']);
  registered.get('Ctrl+Alt+H')!();
  expect(actions.hide).toHaveBeenCalledTimes(1);
});
it('멈춘 동안 바꾼 설정은 바로 결과를 알려 주되 등록은 다시 켠 뒤에 한다', () => {
  const { reg, registered } = fakeRegistrar(['Ctrl+Alt+T']);
  const m = new HotkeyManager(reg);
  m.apply({ hideHotkey: hk('Ctrl+Alt+H'), contentHotkey: hk('Ctrl+Alt+F', false) }, acts());
  m.setPaused(true);
  expect(m.apply({ hideHotkey: hk('Ctrl+Alt+J'), contentHotkey: hk('Ctrl+Alt+F') }, acts())).toEqual({ hide: 'ok', content: 'ok' });
  expect(m.apply({ hideHotkey: hk('Ctrl+Alt+T'), contentHotkey: hk('Ctrl+Alt+T') }, acts())).toEqual({ hide: 'taken', content: 'taken' });
  expect(m.apply({ hideHotkey: hk('Ctrl+Alt+J'), contentHotkey: hk('Ctrl+Alt+J') }, acts())).toEqual({ hide: 'ok', content: 'taken' });
  expect(m.apply({ hideHotkey: hk('K'), contentHotkey: hk('Ctrl+Alt+F') }, acts())).toEqual({ hide: 'invalid', content: 'ok' });
  expect(registered.size).toBe(0);
  m.apply({ hideHotkey: hk('Ctrl+Alt+J'), contentHotkey: hk('Ctrl+Alt+F') }, acts());
  expect(m.setPaused(false)).toEqual({ hide: 'ok', content: 'ok' });
  expect([...registered.keys()].sort()).toEqual(['Ctrl+Alt+F', 'Ctrl+Alt+J']);
});
it('멈춘 채로 끝내면 등록된 것이 없다', () => {
  const { reg, registered } = fakeRegistrar();
  const m = new HotkeyManager(reg);
  m.apply({ hideHotkey: hk('Ctrl+Alt+H'), contentHotkey: hk('Ctrl+Alt+F') }, acts());
  m.setPaused(true);
  m.apply({ hideHotkey: hk('Ctrl+Alt+J'), contentHotkey: hk('Ctrl+Alt+F') }, acts());
  m.dispose();
  expect(registered.size).toBe(0);
});
