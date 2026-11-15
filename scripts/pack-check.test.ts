import { expect, it } from 'vitest';
import { bundleProblem, guardDecision, hasTopLevelKoffiRequire, inUsePaths, runningInside, staleReleases, startupTarget, swapDir, type SwapFs } from './pack-check';

it('실제 프로젝트용 꾸리기에 에뮬레이터 프로젝트 ID가 있거나 에뮬레이터용에 없으면 문제를 알린다', () => {
  expect(bundleProblem(false, 'const id = "my-project"')).toBeNull();
  expect(bundleProblem(false, 'const id = "demo-calfif"')).toContain('demo-calfif');
  expect(bundleProblem(true, 'const id = "demo-calfif"')).toBeNull();
  expect(bundleProblem(true, 'const id = "my-project"')).toContain('demo-calfif');
});

it('메인 묶음 맨 위의 koffi require만 잡는다', () => {
  expect(hasTopLevelKoffiRequire('let koffi = require("koffi");\nkoffi = __toESM(koffi, 1);')).toBe(true);
  expect(hasTopLevelKoffiRequire('function loadUser32() {\n\tconst koffi = require("koffi");\n}')).toBe(false);
});

it('실행 중인 앱이 그 폴더 안에 있을 때만 알린다', () => {
  const dir = 'C:\\sw\\CalendarFIF\\release\\0.4.0';
  const exe = (folder: string) => `C:\\sw\\CalendarFIF\\release\\${folder}\\CalendarFIF-win32-x64\\CalendarFIF.exe`;
  expect(runningInside([exe('0.4.0')], dir)).toBe(true);
  expect(runningInside(['c:\\SW\\calendarfif\\RELEASE\\0.4.0\\CalendarFIF-win32-x64\\CalendarFIF.exe'], dir)).toBe(true);
  expect(runningInside([exe('0.4.0')], `${dir}\\`)).toBe(true);
  expect(runningInside([exe('0.4.00')], dir)).toBe(false);
  expect(runningInside([exe('0.4.0-old')], dir)).toBe(false);
  expect(runningInside(['C:\\sw\\CalendarFIF\\release\\CalendarFIF-win32-x64\\CalendarFIF.exe'], dir)).toBe(false);
  expect(runningInside([], dir)).toBe(false);
});

const DIR = 'C:\\sw\\CalendarFIF\\release\\0.4.0';
const EXE_IN = `${DIR}\\CalendarFIF-win32-x64\\CalendarFIF.exe`;
const EXE_OLD = 'C:\\sw\\CalendarFIF\\release\\CalendarFIF-win32-x64\\CalendarFIF.exe';

it('꾸리기 전 확인: 실행 중인 앱을 확인하지 못하면 멈춘다', () => {
  const stop = { ok: false, message: '실행 중인 앱을 확인하지 못했습니다. 꾸리기를 멈춥니다.' };
  expect(guardDecision({ error: new Error('spawn powershell ENOENT'), status: null, stdout: null }, DIR)).toEqual(stop);
  expect(guardDecision({ status: 1, stdout: '' }, DIR)).toEqual(stop);
  expect(guardDecision({ status: null, stdout: '' }, DIR)).toEqual(stop);
  expect(guardDecision({ status: 0, stdout: null }, DIR)).toEqual(stop);
});
it('꾸리기 전 확인: 그 폴더의 앱이 실행 중이면 멈추고, 다른 곳의 앱이나 없는 경우는 통과한다', () => {
  expect(guardDecision({ status: 0, stdout: `${EXE_IN}\r\n` }, DIR)).toEqual({ ok: false, message: `그 폴더의 앱이 실행 중입니다. 앱을 끄고 다시 실행하세요: ${DIR}` });
  expect(guardDecision({ status: 0, stdout: `${EXE_OLD}\r\n${EXE_OLD}\r\n` }, DIR)).toEqual({ ok: true });
  expect(guardDecision({ status: 0, stdout: '' }, DIR)).toEqual({ ok: true });
});
it('꾸리기 전 확인: 위치를 읽지 못한 CalendarFIF가 있으면 멈춘다', () => {
  expect(guardDecision({ status: 0, stdout: `${EXE_OLD}\r\n?\r\n` }, DIR)).toEqual({ ok: false, message: '실행 중인 CalendarFIF의 위치를 알 수 없습니다. 앱을 끄고 다시 실행하세요.' });
});

const RELEASE ='C:\\sw\\CalendarFIF\\release';
const exeIn = (folder: string) => `${RELEASE}\\${folder}\\CalendarFIF-win32-x64\\CalendarFIF.exe`;
const LEGACY_EXE = `${RELEASE}\\CalendarFIF-win32-x64\\CalendarFIF.exe`;
const FOLDERS = [
  { name: '0.4.0', hasApp: true },
  { name: '0.5.0', hasApp: true },
  { name: 'CalendarFIF-win32-x64', hasApp: true },
  { name: 'notes', hasApp: false },
];

it('새 버전만 남긴다: 쓰이지 않는 옛 버전 폴더를 모두 지울 것으로 고르고, 앱이 없는 폴더와 새 버전은 건드리지 않는다', () => {
  expect(staleReleases(FOLDERS, '0.5.0', [exeIn('0.5.0')], RELEASE)).toEqual({ remove: ['0.4.0', 'CalendarFIF-win32-x64'], busy: [] });
  // 새 버전은 쓰이고 있지 않아도 남는다.
  expect(staleReleases(FOLDERS, '0.5.0', [], RELEASE)).toEqual({ remove: ['0.4.0', 'CalendarFIF-win32-x64'], busy: [] });
});
it('버전 폴더 없이 꾸린 뒤에는 release/CalendarFIF-win32-x64만 남기고 버전 폴더를 지운다(쓰이는 것은 남긴다)', () => {
  expect(staleReleases(FOLDERS, 'CalendarFIF-win32-x64', [LEGACY_EXE], RELEASE)).toEqual({ remove: ['0.4.0', '0.5.0'], busy: [] });
  expect(staleReleases(FOLDERS, 'CalendarFIF-win32-x64', [LEGACY_EXE, exeIn('0.5.0')], RELEASE)).toEqual({ remove: ['0.4.0'], busy: ['0.5.0'] });
});
it('실행 중이거나 Windows 시작 프로그램이 가리키는 옛 버전은 지우지 않고 알린다', () => {
  expect(staleReleases(FOLDERS, '0.5.0', [LEGACY_EXE], RELEASE)).toEqual({ remove: ['0.4.0'], busy: ['CalendarFIF-win32-x64'] });
  expect(staleReleases(FOLDERS, '0.5.0', [exeIn('0.5.0'), exeIn('0.4.0').toLowerCase()], RELEASE)).toEqual({ remove: ['CalendarFIF-win32-x64'], busy: ['0.4.0'] });
});
it('쓰이는 실행 파일을 모은다: 실행 중인 앱의 경로와 시작 프로그램이 가리키는 경로(RUN: 줄)', () => {
  const stdout = `${exeIn('0.5.0')}\r\n${exeIn('0.5.0')}\r\nRUN:"${LEGACY_EXE}" --hidden\r\n`;
  expect(inUsePaths({ status: 0, stdout })).toEqual([exeIn('0.5.0'), exeIn('0.5.0'), LEGACY_EXE]);
  expect(inUsePaths({ status: 0, stdout: '' })).toEqual([]);
});
it('쓰이는 것을 확인하지 못하면 null이다(그때는 아무것도 지우지 않는다)', () => {
  expect(inUsePaths({ error: new Error('spawn powershell ENOENT'), status: null, stdout: null })).toBeNull();
  expect(inUsePaths({ status: 1, stdout: '' })).toBeNull();
  expect(inUsePaths({ status: 0, stdout: null })).toBeNull();
  // 위치를 읽지 못한 프로세스, 읽을 수 없는 시작 프로그램 명령
  expect(inUsePaths({ status: 0, stdout: `${exeIn('0.5.0')}\r\n?\r\n` })).toBeNull();
  expect(inUsePaths({ status: 0, stdout: 'RUN:\r\n' })).toBeNull();
});
it('시작 프로그램의 명령에서 실행 파일의 경로만 뽑는다', () => {
  expect(startupTarget(`"${LEGACY_EXE}"`)).toBe(LEGACY_EXE);
  expect(startupTarget(`"${exeIn('0.5.0')}" --hidden`)).toBe(exeIn('0.5.0'));
  expect(startupTarget(`${LEGACY_EXE} --hidden`)).toBe(LEGACY_EXE);
  expect(startupTarget('')).toBeNull();
});

function fakeFs(dirs: string[], fail: { rename?: (from: string, to: string) => boolean; remove?: boolean } = {}) {
  const set = new Set(dirs);
  const fs: SwapFs = {
    exists: (p) => set.has(p),
    rename: (from, to) => {
      if (fail.rename?.(from, to) || !set.has(from) || set.has(to)) throw new Error(`EPERM ${from}`);
      set.delete(from);
      set.add(to);
    },
    remove: (p) => {
      if (fail.remove) throw new Error('EBUSY');
      set.delete(p);
    },
  };
  return { fs, set };
}

it('꾸린 앱을 release의 정해진 자리에 바꿔 넣고, 쓰던 것은 옮겨 두었다가 지운다', () => {
  const f = fakeFs(['staged', 'target']);
  expect(swapDir(f.fs, 'staged', 'target', 'aside')).toBeNull();
  expect([...f.set]).toEqual(['target']);
  // 처음 넣을 때(쓰던 것이 없다)
  const first = fakeFs(['staged']);
  expect(swapDir(first.fs, 'staged', 'target', 'aside')).toBeNull();
  expect([...first.set]).toEqual(['target']);
  // 옮겨 둔 것을 지우지 못해도 넣은 것은 성공이다.
  const busyAside = fakeFs(['staged', 'target'], { remove: true });
  expect(swapDir(busyAside.fs, 'staged', 'target', 'aside')).toBeNull();
  expect([...busyAside.set].sort()).toEqual(['aside', 'target']);
});

it('쓰던 앱 폴더를 옮기지 못하면 아무것도 바꾸지 않고, 새 것을 넣지 못하면 쓰던 것을 되돌린다', () => {
  const locked = fakeFs(['staged', 'target'], { rename: (from) => from === 'target' });
  expect(swapDir(locked.fs, 'staged', 'target', 'aside')).toContain('쓰던 앱 폴더를 옮기지 못해');
  expect([...locked.set].sort()).toEqual(['staged', 'target']);
  const stuck = fakeFs(['staged', 'target'], { rename: (from) => from === 'staged' });
  expect(swapDir(stuck.fs, 'staged', 'target', 'aside')).toContain('쓰던 앱은 그대로다');
  expect([...stuck.set].sort()).toEqual(['staged', 'target']);
});
