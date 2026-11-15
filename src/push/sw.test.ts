import { describe, expect, it, vi } from 'vitest';
import { installPushHandlers, noteFrom, type SwScope } from './sw';

describe('noteFrom', () => {
  it('data를 먼저 읽고 notification도 읽는다', () => {
    expect(noteFrom({ data: { title: '회의', body: '17:48 알림', url: '/#2026-11-15', tag: 'calfif:a' } })).toEqual({ title: '회의', body: '17:48 알림', url: '/#2026-11-15', tag: 'calfif:a' });
    expect(noteFrom({ notification: { title: '알림', body: '본문' } })).toEqual({ title: '알림', body: '본문', url: '/', tag: '' });
  });
  it('무엇이 와도 제목은 있고, 다른 사이트 주소는 열지 않는다', () => {
    expect(noteFrom(null).title).toBe('CalendarFIF 알림');
    expect(noteFrom({ data: { url: 'https://evil.example/' } }).url).toBe('/');
    expect(noteFrom({ data: { url: '//evil.example/' } }).url).toBe('/');
  });
});

function makeScope(clients: Array<{ url: string; focus?: () => Promise<unknown>; navigate?: (u: string) => Promise<unknown>; postMessage?: (m: unknown) => void }> = []) {
  const handlers: Record<string, (e: never) => void> = {};
  const shown: Array<{ title: string; options: Record<string, unknown> }> = [];
  const opened: string[] = [];
  const scope: SwScope = {
    location: { origin: 'https://app.example' },
    registration: { showNotification: async (title, options) => { shown.push({ title, options }); } },
    clients: { matchAll: async () => clients, openWindow: async (u) => { opened.push(u); } },
    addEventListener: ((type: string, fn: (e: never) => void) => { handlers[type] = fn; }) as SwScope['addEventListener'],
  };
  installPushHandlers(scope);
  return { handlers, shown, opened };
}

describe('installPushHandlers', () => {
  it('푸시가 오면 알림을 하나 띄운다(글이 JSON이 아니어도)', async () => {
    const s = makeScope();
    const waits: Promise<unknown>[] = [];
    s.handlers.push({ data: { json: () => ({ data: { title: '회의', body: '17:48 알림', url: '/#2026-11-15', tag: 't' } }), text: () => '' }, waitUntil: (p: Promise<unknown>) => waits.push(p) } as never);
    s.handlers.push({ data: { json: () => { throw new Error('x'); }, text: () => '그냥 글' }, waitUntil: (p: Promise<unknown>) => waits.push(p) } as never);
    s.handlers.push({ data: null, waitUntil: (p: Promise<unknown>) => waits.push(p) } as never);
    await Promise.all(waits);
    expect(s.shown.map((n) => [n.title, n.options.body, n.options.tag, n.options.data])).toEqual([
      ['회의', '17:48 알림', 't', { url: '/#2026-11-15' }],
      ['CalendarFIF 알림', '그냥 글', undefined, { url: '/' }],
      ['CalendarFIF 알림', '', undefined, { url: '/' }],
    ]);
  });

  it('알림을 누르면 열린 창을 앞으로 가져와 그 날짜로 옮기고, 없으면 새로 연다', async () => {
    const focus = vi.fn(async () => undefined);
    const navigate = vi.fn(async () => undefined);
    const open = makeScope([{ url: 'https://app.example/', focus, navigate }]);
    const close = vi.fn();
    let wait: Promise<unknown> = Promise.resolve();
    open.handlers.notificationclick({ notification: { close, data: { url: '/#2026-11-16' } }, waitUntil: (p: Promise<unknown>) => { wait = p; } } as never);
    await wait;
    expect(close).toHaveBeenCalled();
    expect(focus).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('https://app.example/#2026-11-16');
    // 창을 옮기지 못하면 웹앱에 날짜를 메시지로 알린다.
    const posted: unknown[] = [];
    const stuck = makeScope([{ url: 'https://app.example/', focus, navigate: async () => { throw new Error('not controlled'); }, postMessage: (m: unknown) => posted.push(m) } as never]);
    stuck.handlers.notificationclick({ notification: { close: vi.fn(), data: { url: '/#2026-11-17' } }, waitUntil: (p: Promise<unknown>) => { wait = p; } } as never);
    await wait;
    expect(posted).toEqual([{ type: 'calfif-open', hash: '#2026-11-17' }]);
    const none = makeScope([]);
    none.handlers.notificationclick({ notification: { close: vi.fn(), data: { url: 'https://evil.example/' } }, waitUntil: (p: Promise<unknown>) => { wait = p; } } as never);
    await wait;
    expect(none.opened).toEqual(['https://app.example/']);
  });
});
