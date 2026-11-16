import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { packager } from '@electron/packager';
import { bundleProblem, guardDecision, hasTopLevelKoffiRequire, inUsePaths, staleReleases, swapDir } from './pack-check';
import { stageManifest } from './pack-manifest';

// 사용법: tsx scripts/pack-desktop.ts [--emu | --install | --clean]
// 기본은 실제 프로젝트용이다. build/pack-out/에 꾸린 뒤 release/CalendarFIF-win32-x64/에 바꿔 넣는다.
// 버전 폴더(release/0.6.0/ 같은 것)는 만들지 않는다(사용자가 정했다: release 바로 아래에 CalendarFIF-win32-x64 하나만).
// 자리가 늘 같으므로 Windows 시작 프로그램도 그대로 맞는다.
// release의 앱이 실행 중이면 바꿔 넣지 않고 멈춘다. 꾸린 것은 build/pack-out/에 남으니 앱을 끄고 --install로 바꿔 넣는다.
// 바꿔 넣은 뒤 예전 방식의 버전 폴더를 지운다. 실행 중이거나 Windows 시작 프로그램이 가리키는 것은 남긴다.
// --emu는 에뮬레이터용(build/release-emu/)이다. --clean은 꾸리지 않고 버전 폴더 정리만 한다.
const emu = process.argv.includes('--emu');
const cleanOnly = process.argv.includes('--clean');
const installOnly = process.argv.includes('--install');
const root = resolve('.');
const APP_DIR = 'CalendarFIF-win32-x64';
const STAGED_OUT = 'build/pack-out';
const releaseDir = resolve(root, 'release');
const target = resolve(releaseDir, APP_DIR);
const readJson = (path: string) => JSON.parse(readFileSync(resolve(root, path), 'utf8')) as { version: string; dependencies?: Record<string, string> };

// 쓰이고 있는 실행 파일을 줄마다 하나씩 낸다: 실행 중인 앱의 경로(읽지 못하면 '?')와, Windows 시작 프로그램에 적힌 명령('RUN:'을 붙인다).
const IN_USE_PS =
  "Get-Process CalendarFIF -ErrorAction SilentlyContinue | ForEach-Object { if ($_.Path) { $_.Path } else { '?' } }; " +
  "$run = Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -ErrorAction SilentlyContinue; " +
  "if ($run) { $run.PSObject.Properties | Where-Object { $_.Value -is [string] -and $_.Value -like '*CalendarFIF.exe*' } | ForEach-Object { 'RUN:' + $_.Value } }; exit 0";
const hasPackagedApp = (dir: string): boolean => existsSync(resolve(dir, 'CalendarFIF.exe')) || existsSync(resolve(dir, 'CalendarFIF-win32-x64', 'CalendarFIF.exe'));

/** release에 keep 폴더만 남긴다. 실행 중이거나 Windows 시작 프로그램이 가리키는 옛 버전은 남기고 알린다. 확인하지 못하면 아무것도 지우지 않는다. */
function removeOldReleases(keep: string): void {
  if (!existsSync(resolve(releaseDir, keep))) {
    console.log(`release/${keep}이 없어서 옛 버전을 지우지 않았다.`);
    return;
  }
  const entries = readdirSync(releaseDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({ name: e.name, hasApp: hasPackagedApp(resolve(releaseDir, e.name)) }));
  const inUse = inUsePaths(spawnSync('powershell', ['-NoProfile', '-Command', IN_USE_PS], { encoding: 'utf8', timeout: 30000 }));
  if (inUse === null) {
    console.log('실행 중인 앱과 Windows 시작 프로그램을 확인하지 못해서 옛 버전을 지우지 않았다.');
    return;
  }
  const { remove, busy } = staleReleases(entries, keep, inUse, releaseDir);
  for (const name of remove) {
    rmSync(resolve(releaseDir, name), { recursive: true, force: true });
    console.log(`옛 버전을 지웠다: release/${name}`);
  }
  for (const name of busy) {
    console.log(`옛 버전 release/${name}은 실행 중이거나 Windows 시작 프로그램이 가리키고 있어서 남겨 두었다. 새 버전으로 바꿔 실행한 뒤 \`npm run desktop:clean\`을 돌리면 지워진다.`);
  }
  if (remove.length === 0 && busy.length === 0) console.log('지울 옛 버전이 없다.');
}

// 켜진 것이 없으면 Get-Process가 (조용히) 실패해 종료 코드가 1이 되므로 끝에 exit 0을 둔다. 그러지 않으면 "확인하지 못했다"로 멈춘다.
const runningApps = () =>
  spawnSync('powershell', ['-NoProfile', '-Command', "Get-Process CalendarFIF -ErrorAction SilentlyContinue | ForEach-Object { if ($_.Path) { $_.Path } else { '?' } }; exit 0"], { encoding: 'utf8', timeout: 30000 });

// 막 만든 파일을 백신이 잠깐 쥐고 있으면 폴더 옮기기가 실패할 수 있어 몇 번 다시 한다.
function renameRetry(from: string, to: string): void {
  for (let i = 0; ; i += 1) {
    try {
      renameSync(from, to);
      return;
    } catch (e) {
      if (i >= 4) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
    }
  }
}

/** build/pack-out에 꾸린 앱을 release/CalendarFIF-win32-x64에 바꿔 넣고 옛 버전 폴더를 지운다. 그 자리의 앱이 실행 중이면 멈춘다. */
function install(): void {
  const staged = resolve(root, STAGED_OUT, APP_DIR);
  if (!existsSync(resolve(staged, 'CalendarFIF.exe'))) {
    console.error(`바꿔 넣을 앱이 없다: ${staged}. 먼저 npm run desktop:pack을 돌린다.`);
    process.exit(1);
  }
  const decision = guardDecision(runningApps(), target);
  if (!decision.ok) {
    console.error(`${decision.message}\n꾸린 앱은 ${staged}에 있다. 앱을 끄고 npm run desktop:install을 돌리면 바꿔 넣는다.`);
    process.exit(1);
  }
  mkdirSync(releaseDir, { recursive: true });
  const aside = resolve(root, 'build/pack-replaced');
  rmSync(aside, { recursive: true, force: true });
  const problem = swapDir({ exists: existsSync, rename: renameRetry, remove: (p) => rmSync(p, { recursive: true, force: true }) }, staged, target, aside);
  if (problem) {
    console.error(problem);
    process.exit(1);
  }
  console.log(`바꿔 넣었다: ${resolve(target, 'CalendarFIF.exe')}`);
  removeOldReleases(APP_DIR);
}

if (cleanOnly) {
  removeOldReleases(APP_DIR);
  process.exit(0);
}
if (installOnly) {
  install();
  process.exit(0);
}

const build = (extra: NodeJS.ProcessEnv, cliArgs: string[]) => {
  const r = spawnSync('npx', ['vite', 'build', ...cliArgs], { stdio: 'inherit', shell: true, cwd: root, env: { ...process.env, ...extra } });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

const out = emu ? 'build/release-emu' : STAGED_OUT;
// 꾸리는 곳(build/pack-out)의 앱이 켜져 있으면 지우다 멈춘다. 켜져 있거나 확인하지 못하면 아무것도 하지 않고 멈춘다.
// 위치를 읽지 못한 프로세스는 '?'로 알린다. release의 앱은 꾸리는 동안 켜져 있어도 된다(바꿔 넣을 때 본다).
const ensureNotRunning = (): void => {
  if (emu) return;
  const decision = guardDecision(runningApps(), resolve(root, out));
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
  // 실행 파일의 아이콘. npx tsx scripts/make-icons.ts가 만든다.
  icon: resolve(root, 'public/favicon.ico'),
  platform: 'win32',
  arch: 'x64',
  electronVersion: readJson('node_modules/electron/package.json').version,
  overwrite: true,
  prune: false,
  asar: false,
});
console.log(`꾸렸다: ${made.join(', ')}`);
if (!emu) install();
