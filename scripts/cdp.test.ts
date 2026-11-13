import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COMMAND_TIMEOUT_MS, EDGE_PATHS, cdpOver, findEdge, parseEdgeProcesses, previewProfile } from './cdp';

it('있는 첫 경로를 돌려준다', () => {
  expect(findEdge((p) => p === EDGE_PATHS[1])).toBe(EDGE_PATHS[1]);
  expect(findEdge(() => true)).toBe(EDGE_PATHS[0]);
});
it('하나도 없으면 null이다', () => {
  expect(findEdge(() => false)).toBeNull();
});

it('내 PC의 주소는 실제 웹앱과 다른 프로필 폴더를 쓴다', () => {
  expect(previewProfile('https://example.web.app')).toBe('edge-profile-mobile');
  expect(previewProfile('http://localhost:5173/?autologin=1')).toBe('edge-profile-mobile-emu');
  expect(previewProfile('http://127.0.0.1:5173/')).toBe('edge-profile-mobile-emu');
  expect(previewProfile('주소 아님')).toBe('edge-profile-mobile');
});

describe('parseEdgeProcesses', () => {
  const dir = 'C:\\sw\\CalendarFIF\\.tools\\edge-profile-mobile';
  const main = (extra = '') => `"C:\\Edge\\msedge.exe" --remote-debugging-port=9380 --user-data-dir=${dir}${extra} --no-first-run --app=about:blank`;

  it('그 프로필 폴더로 뜬 브라우저 본체와 DevTools 포트를 찾는다', () => {
    const json = JSON.stringify([
      { ProcessId: 10, CommandLine: main() },
      { ProcessId: 11, CommandLine: `"C:\\Edge\\msedge.exe" --type=renderer --user-data-dir=${dir} --lang=ko` },
    ]);
    expect(parseEdgeProcesses(json, dir)).toEqual([{ pid: 10, port: 9380 }]);
  });
  it('프로세스가 하나면 배열이 아닌 객체로 와도 읽는다', () => {
    expect(parseEdgeProcesses(JSON.stringify({ ProcessId: 10, CommandLine: main() }), dir)).toEqual([{ pid: 10, port: 9380 }]);
  });
  it('이름이 이어지는 다른 프로필 폴더는 세지 않는다', () => {
    expect(parseEdgeProcesses(JSON.stringify([{ ProcessId: 10, CommandLine: main('-emu') }]), dir)).toEqual([]);
  });
  it('폴더 이름의 대소문자와 따옴표로 감싼 인자를 가리지 않는다', () => {
    const quoted = `"C:\\Edge\\msedge.exe" "--user-data-dir=${dir.toUpperCase()}" --no-first-run`;
    expect(parseEdgeProcesses(JSON.stringify([{ ProcessId: 12, CommandLine: quoted }]), dir)).toEqual([{ pid: 12, port: null }]);
  });
  it('출력이 비었거나 읽을 수 없으면 빈 목록이다', () => {
    expect(parseEdgeProcesses('', dir)).toEqual([]);
    expect(parseEdgeProcesses('오류', dir)).toEqual([]);
    expect(parseEdgeProcesses(JSON.stringify([{ ProcessId: 13, CommandLine: null }]), dir)).toEqual([]);
  });
});

describe('cdpOver', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  function socket() {
    const sent: Array<{ id: number; method: string; params: object }> = [];
    return { sent, send: (data: string) => sent.push(JSON.parse(data)), close: vi.fn() };
  }

  it('보낸 명령의 답을 id로 찾아 돌려주고, 오류 답은 명령 이름과 함께 던진다', async () => {
    const ws = socket();
    const { cdp, receive } = cdpOver(ws);
    const first = cdp.send('Page.navigate', { url: 'about:blank' });
    const second = cdp.send('Runtime.enable');
    expect(ws.sent.map((m) => [m.id, m.method])).toEqual([[1, 'Page.navigate'], [2, 'Runtime.enable']]);
    receive(JSON.stringify({ id: 2, error: { message: 'nope' } }));
    receive(JSON.stringify({ method: 'Page.loadEventFired', params: {} })); // 알림은 무시한다
    receive(JSON.stringify({ id: 1, result: { frameId: 'f' } }));
    await expect(first).resolves.toEqual({ frameId: 'f' });
    await expect(second).rejects.toThrow('Runtime.enable: nope');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('답이 오지 않는 명령은 정한 시간(기본 30초) 뒤에 명령 이름을 담아 실패한다', async () => {
    expect(COMMAND_TIMEOUT_MS).toBe(30000);
    const { cdp, receive } = cdpOver(socket());
    const hung = cdp.send('Runtime.evaluate', { expression: '1' });
    const caught = hung.catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(29999);
    expect(await Promise.race([caught, Promise.resolve('아직')])).toBe('아직');
    await vi.advanceTimersByTimeAsync(1);
    expect(String(await caught)).toContain('Runtime.evaluate');
    receive(JSON.stringify({ id: 1, result: {} })); // 늦은 답은 아무 일도 하지 않는다
    expect(vi.getTimerCount()).toBe(0);
  });

  it('evaluate도 같은 제한을 받고, 제한 시간은 바꿀 수 있다', async () => {
    const { cdp } = cdpOver(socket(), 500);
    const caught = cdp.evaluate('new Promise(() => {})').catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(500);
    expect(String(await caught)).toMatch(/Runtime\.evaluate.*500ms/);
  });

  it('evaluate는 값을 돌려주고 페이지의 예외는 던진다', async () => {
    const ws = socket();
    const { cdp, receive } = cdpOver(ws);
    const ok = cdp.evaluate<number>('1 + 1');
    receive(JSON.stringify({ id: 1, result: { result: { value: 2 } } }));
    await expect(ok).resolves.toBe(2);
    const bad = cdp.evaluate('boom()');
    receive(JSON.stringify({ id: 2, result: { exceptionDetails: { text: 'x', exception: { description: 'ReferenceError: boom' } } } }));
    await expect(bad).rejects.toThrow('ReferenceError: boom');
    cdp.close();
    expect(ws.close).toHaveBeenCalledTimes(1);
  });
});
