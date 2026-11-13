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
