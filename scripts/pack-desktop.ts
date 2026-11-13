import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { packager } from '@electron/packager';
import { bundleProblem, guardDecision, hasTopLevelKoffiRequire } from './pack-check';
import { stageManifest } from './pack-manifest';

// 사용법: tsx scripts/pack-desktop.ts [--emu]
// 기본은 실제 프로젝트용(release/<버전>/), --emu는 에뮬레이터용(build/release-emu/)이다.
// 실제 꾸리기는 버전별 새 폴더에 만들고, 그 폴더의 앱이 실행 중이면 아무것도 지우지 않고 멈춘다.
const emu = process.argv.includes('--emu');
const root = resolve('.');
const readJson = (path: string) => JSON.parse(readFileSync(resolve(root, path), 'utf8')) as { version: string; dependencies?: Record<string, string> };

const build = (extra: NodeJS.ProcessEnv, cliArgs: string[]) => {
  const r = spawnSync('npx', ['vite', 'build', ...cliArgs], { stdio: 'inherit', shell: true, cwd: root, env: { ...process.env, ...extra } });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

const out = emu ? 'build/release-emu' : `release/${readJson('package.json').version}`;
// 쓰던 앱이 켜져 있는 폴더를 지우다 멈추면 설치가 깨진다. 켜져 있거나 확인하지 못하면 아무것도 하지 않고 멈춘다.
// 위치를 읽지 못한 프로세스는 '?'로 알린다.
const ensureNotRunning = (): void => {
  if (emu) return;
  const ps = spawnSync('powershell', ['-NoProfile', '-Command', "Get-Process CalendarFIF -ErrorAction SilentlyContinue | ForEach-Object { if ($_.Path) { $_.Path } else { '?' } }"], { encoding: 'utf8', timeout: 30000 });
  const decision = guardDecision(ps, resolve(root, out));
  if (!decision.ok) {
    console.error(decision.message);
    process.exit(1);
  }
};
ensureNotRunning();

const emuBuild = emu ? '1' : '0';
build({}, ['--mode', emu ? 'desktop-emu' : 'desktop']);
// 고른 변형과 화면 묶음이 맞아야 한다(실제 앱에 에뮬레이터 설정이 들어가거나 그 반대가 되지 않게).
const rendererDir = resolve(root, emu ? 'dist-desktop-emu' : 'dist-desktop');
const bundleText = readdirSync(resolve(rendererDir, 'assets'))
  .filter((name) => name.endsWith('.js'))
  .map((name) => readFileSync(resolve(rendererDir, 'assets', name), 'utf8'))
  .join('\n');
const problem = bundleProblem(emu, bundleText);
if (problem) {
  console.error(problem);
  process.exit(1);
}
build({ CALFIF_EMU_BUILD: emuBuild }, ['-c', 'vite.desktop.config.ts']);
build({ CALFIF_EMU_BUILD: emuBuild, VITE_DESKTOP_ENTRY: 'preload' }, ['-c', 'vite.desktop.config.ts']);

if (hasTopLevelKoffiRequire(readFileSync(resolve(root, 'build/desktop/main.cjs'), 'utf8'))) {
  console.error('main.cjs가 맨 위에서 koffi를 읽는다. koffi.node를 못 읽는 PC에서 앱이 시작 전에 죽는다');
  process.exit(1);
}

const stage = resolve(root, 'build/pack-stage');
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
writeFileSync(resolve(stage, 'package.json'), JSON.stringify(stageManifest(readJson('package.json'), readJson('node_modules/koffi/package.json').version), null, 2));
cpSync(resolve(root, 'build/desktop'), resolve(stage, 'desktop'), { recursive: true });
cpSync(rendererDir, resolve(stage, 'dist-desktop'), { recursive: true });
// koffi의 실행 파일(.node)은 플랫폼별 패키지에 들어 있다.
for (const dir of ['koffi', '@koromix/koffi-win32-x64']) cpSync(resolve(root, 'node_modules', dir), resolve(stage, 'node_modules', dir), { recursive: true });

ensureNotRunning(); // 빌드에 걸린 시간 동안 앱이 켜졌을 수 있다
const made = await packager({
  dir: stage,
  out: resolve(root, out),
  name: 'CalendarFIF',
  platform: 'win32',
  arch: 'x64',
  electronVersion: readJson('node_modules/electron/package.json').version,
  overwrite: true,
  prune: false,
  asar: false,
});
console.log(`꾸렸다: ${made.join(', ')}`);
