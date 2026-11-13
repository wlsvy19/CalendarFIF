import { expect, it, vi } from 'vitest';
import { isBusy, reloadOnUpdate, type UpdateDeps } from './update';

function setup(over: Partial<UpdateDeps> & { stored?: string | null } = {}) {
  let change: () => void = () => {};
  let tick: () => void = () => {};
  const stopped = vi.fn();
  const data = new Map<string, string>();
  if (over.stored != null) data.set('calfif.reloadedAt', over.stored);
  const reload = vi.fn();
  reloadOnUpdate({
    container: { controller: {}, addEventListener: (_t, fn) => (change = fn) },
    busy: () => false,
    reload,
    session: { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) },
    now: () => 100_000,
    every: (_ms, fn) => {
      tick = fn;
      return stopped;
    },
    ...over,
  });
  return { change: () => change(), tick: () => tick(), reload, data, stopped };
}

it('처음 설치라 controller가 없으면 나중에 controllerchange가 와도 다시 읽지 않는다', () => {
  const s = setup({ container: { controller: null, addEventListener: () => {} } });
  s.change();
  expect(s.reload).not.toHaveBeenCalled();
});
it('controller가 있으면 한 번 다시 읽고 시각을 적는다', () => {
  const s = setup();
  s.change();
  expect(s.reload).toHaveBeenCalledTimes(1);
  expect(s.data.get('calfif.reloadedAt')).toBe('100000');
});
it('바쁜 동안에는 기다렸다가 한가해지면 다시 읽고 확인을 멈춘다', () => {
  let busy = true;
  const s = setup({ busy: () => busy });
  s.change();
  s.tick();
  expect(s.reload).not.toHaveBeenCalled();
  busy = false;
  s.tick();
  expect(s.reload).toHaveBeenCalledTimes(1);
  expect(s.stopped).toHaveBeenCalled();
});
it('60초 안에 다시 읽었으면 또 읽지 않는다', () => {
  const s = setup({ stored: '60000' });
  s.change();
  expect(s.reload).not.toHaveBeenCalled();
});
it('60초가 지났으면 다시 읽는다', () => {
  const s = setup({ stored: '39999' });
  s.change();
  expect(s.reload).toHaveBeenCalledTimes(1);
});
it('sessionStorage가 오류를 내면 다시 읽지 않는다', () => {
  const boom = () => {
    throw new Error('blocked');
  };
  const s = setup({ session: { getItem: boom, setItem: boom } });
  s.change();
  expect(s.reload).not.toHaveBeenCalled();
});
it('쓰기만 오류를 내도 다시 읽지 않는다', () => {
  const s = setup({
    session: {
      getItem: () => null,
      setItem: () => {
        throw new Error('blocked');
      },
    },
  });
  s.change();
  expect(s.reload).not.toHaveBeenCalled();
});
it('기다리는 중에 controllerchange가 또 와도 다시 읽기는 한 번이다', () => {
  let busy = true;
  const s = setup({ busy: () => busy });
  s.change();
  s.change();
  busy = false;
  s.tick();
  s.tick();
  expect(s.reload).toHaveBeenCalledTimes(1);
});

it('isBusy: 시트, 입력칸, 글상자, 메모리에만 있는 편집은 바쁘고 단추는 아니다', () => {
  const html = document.documentElement;
  document.body.innerHTML = '<input id="i"><textarea id="t"></textarea><button id="b"></button>';
  const focus = (id: string) => (document.getElementById(id) as HTMLElement).focus();
  (document.activeElement as HTMLElement | null)?.blur();
  expect(isBusy(document, false)).toBe(false);
  focus('b');
  expect(isBusy(document, false)).toBe(false);
  focus('i');
  expect(isBusy(document, false)).toBe(true);
  focus('t');
  expect(isBusy(document, false)).toBe(true);
  focus('b');
  expect(isBusy(document, true)).toBe(true);
  html.classList.add('sheet-open');
  expect(isBusy(document, false)).toBe(true);
  html.classList.remove('sheet-open');
  document.body.innerHTML = '';
});
