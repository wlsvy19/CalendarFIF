// 꾸린 화면 묶음이 고른 변형과 맞는지 본다. 127.0.0.1은 실제 묶음에도 막아 둔 에뮬레이터 갈래로 들어 있으므로 보지 않는다.
export function bundleProblem(emu: boolean, bundleText: string): string | null {
  const has = bundleText.includes('demo-calfif');
  if (!emu && has) return '실제 프로젝트용 꾸리기인데 화면 묶음에 에뮬레이터 프로젝트 ID(demo-calfif)가 들어 있다. 화면을 desktop 모드가 아닌 에뮬레이터 모드로 빌드했거나 에뮬레이터 설정이 실제 묶음에 섞인 것이다.';
  if (emu && !has) return '에뮬레이터용 꾸리기인데 화면 묶음에 에뮬레이터 프로젝트 ID(demo-calfif)가 없다. 화면을 desktop-emu 모드로 빌드했는지 본다.';
  return null;
}

// 메인 묶음의 맨 위(들여쓰기 없는 줄)에 koffi를 읽는 require가 있는지 본다. 있으면 koffi.node가 없는 PC에서 앱이 whenReady 전에 죽는다.
export function hasTopLevelKoffiRequire(mainBundleText: string): boolean {
  return /^\S.*require\(["']koffi["']\)/m.test(mainBundleText);
}

// 실행 중인 CalendarFIF.exe의 경로 가운데 dir 안에 있는 것이 있는지 본다(대소문자 무시, 폴더 이름이 겹치기만 하는 것은 제외).
export function runningInside(paths: string[], dir: string): boolean {
  const norm = (p: string) => p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
  const prefix = `${norm(dir)}\\`;
  return paths.some((p) => norm(p).startsWith(prefix));
}

/** 시작 프로그램에 적힌 명령에서 실행 파일의 경로만 뽑는다: `"C:\...\CalendarFIF.exe" --hidden`에서 따옴표 안의 것. 읽을 수 없으면 null. */
export function startupTarget(command: string): string | null {
  const m = /^\s*"([^"]+)"/.exec(command) ?? /^\s*(\S.*?\.exe)(?=\s|$)/i.exec(command);
  return m ? m[1] : null;
}

/**
 * 지금 쓰이고 있는 실행 파일의 경로들: 실행 중인 CalendarFIF와, Windows 시작 프로그램이 가리키는 것(PowerShell이 'RUN:'을 붙여 준 줄).
 * 확인하지 못했으면 null이다. 위치를 읽지 못한 프로세스('?')나 읽을 수 없는 시작 프로그램 명령이 있어도 null이다.
 */
export function inUsePaths(ps: { error?: unknown; status: number | null; stdout: string | null }): string[] | null {
  if (ps.error || ps.status !== 0 || ps.stdout === null) return null;
  const paths: string[] = [];
  for (const line of ps.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    if (line === '?') return null;
    if (!line.startsWith('RUN:')) {
      paths.push(line);
      continue;
    }
    const target = startupTarget(line.slice(4));
    if (target === null) return null;
    paths.push(target);
  }
  return paths;
}

/**
 * release 폴더에 새 버전만 남기려고 지울 옛 버전 폴더를 고른다. keep은 남길 폴더의 이름, inUse는 쓰이고 있는 실행 파일의 경로들이다.
 * 꾸린 앱이 든 폴더만 본다. 쓰이고 있는 옛 버전은 지우지 않고 busy로 돌려준다(끄지 않은 앱의 폴더를 지우면 앱이 깨지고,
 * 시작 프로그램이 가리키는 폴더를 지우면 다음 Windows 로그인 때 달력이 뜨지 않는다).
 */
export function staleReleases(entries: { name: string; hasApp: boolean }[], keep: string, inUse: string[], releaseDir: string): { remove: string[]; busy: string[] } {
  const base = releaseDir.replace(/[\\/]+$/, '');
  const old = entries.filter((e) => e.hasApp && e.name !== keep).map((e) => e.name);
  const busy = old.filter((name) => runningInside(inUse, `${base}\\${name}`));
  return { remove: old.filter((name) => !busy.includes(name)), busy };
}

export type SwapFs = { exists(p: string): boolean; rename(from: string, to: string): void; remove(p: string): void };

/**
 * 꾸린 앱 폴더(staged)를 release의 정해진 자리(target)에 넣는다. 있던 target은 aside로 옮겨 두었다가 넣고 나면 지운다.
 * 새 것을 넣지 못하면 옮겨 둔 것을 되돌린다(쓰던 앱이 없어지지 않게). 넣었으면 null, 못 넣었으면 까닭을 돌려준다.
 */
export function swapDir(fs: SwapFs, staged: string, target: string, aside: string): string | null {
  const had = fs.exists(target);
  if (had) {
    try {
      fs.rename(target, aside);
    } catch (e) {
      return `쓰던 앱 폴더를 옮기지 못해 바꿔 넣지 않았다(앱이나 탐색기가 그 폴더를 쓰고 있을 수 있다): ${String(e)}`;
    }
  }
  try {
    fs.rename(staged, target);
  } catch (e) {
    if (!had) return `새 앱을 넣지 못했다: ${String(e)}`;
    try {
      fs.rename(aside, target);
    } catch {
      return `새 앱을 넣지 못했고 쓰던 앱도 되돌리지 못했다. 쓰던 앱은 ${aside}에 있다: ${String(e)}`;
    }
    return `새 앱을 넣지 못했다(쓰던 앱은 그대로다): ${String(e)}`;
  }
  if (had) {
    try {
      fs.remove(aside);
    } catch {
      // 다음 꾸리기가 지운다.
    }
  }
  return null;
}

export type GuardDecision = { ok: true } | { ok: false; message: string };

// 꾸리기 전에 실행 중인 앱을 본 결과(PowerShell 실행 결과)로 계속할지 정한다. 확인하지 못했으면 멈춘다(열린 채로 지우지 않기 위해).
// 위치를 읽지 못한 CalendarFIF(다른 사용자의 프로세스)는 줄이 '?'로 온다. 실행 중인 것이 없으면 종료 코드 0에 출력이 없다.
export function guardDecision(ps: { error?: unknown; status: number | null; stdout: string | null }, dir: string): GuardDecision {
  if (ps.error || ps.status !== 0 || ps.stdout === null) return { ok: false, message: '실행 중인 앱을 확인하지 못했습니다. 꾸리기를 멈춥니다.' };
  const lines = ps.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.includes('?')) return { ok: false, message: '실행 중인 CalendarFIF의 위치를 알 수 없습니다. 앱을 끄고 다시 실행하세요.' };
  if (runningInside(lines, dir)) return { ok: false, message: `그 폴더의 앱이 실행 중입니다. 앱을 끄고 다시 실행하세요: ${dir}` };
  return { ok: true };
}
