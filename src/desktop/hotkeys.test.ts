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
