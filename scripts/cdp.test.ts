import { describe, expect, it } from 'vitest';
import { EDGE_PATHS, findEdge, parseEdgeProcesses, previewProfile } from './cdp';

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
