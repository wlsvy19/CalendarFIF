import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

// 사용법: tsx scripts/desktop-run.ts [--emu] [--smoke] [--packaged <exe>]
const args = process.argv.slice(2);
const smoke = args.includes('--smoke');
const emu = args.includes('--emu') || smoke;
const packagedAt = args.indexOf('--packaged');
const packaged = packagedAt >= 0 ? resolve(args[packagedAt + 1] ?? '') : null;
const scenario = process.env.CALFIF_SMOKE || 'attach';

const root = resolve('.');
const build = (extra: NodeJS.ProcessEnv, cliArgs: string[]) => {
  const r = spawnSync('npx', ['vite', 'build', ...cliArgs], { stdio: 'inherit', shell: true, cwd: root, env: { ...process.env, ...extra } });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

const env: NodeJS.ProcessEnv = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
if (!smoke) delete env.CALFIF_SMOKE;
else env.CALFIF_SMOKE = scenario;

let exe: string;
let launchArgs: string[];
if (packaged) {
  exe = packaged;
  launchArgs = [];
} else {
  build({}, ['--mode', emu ? 'desktop-emu' : 'desktop']);
  build({}, ['-c', 'vite.desktop.config.ts']);
  build({ VITE_DESKTOP_ENTRY: 'preload' }, ['-c', 'vite.desktop.config.ts']);
  const preload = readFileSync(resolve(root, 'build/desktop/preload.cjs'), 'utf8');
  const stray = [...preload.matchAll(/require\(([^)]*)\)/g)].filter((m) => m[1] !== '"electron"');
  if (stray.length > 0) {
    console.error(`preload.cjs가 electron 말고 require를 한다: ${stray.map((m) => m[0]).join(', ')}`);
    process.exit(1);
  }
  exe = createRequire(import.meta.url)('electron') as string;
  launchArgs = ['.'];
  env.CALFIF_RENDERER_DIR = resolve(root, emu ? 'dist-desktop-emu' : 'dist-desktop');
}
if (emu) env.CALFIF_EMU = '1';
if (emu || smoke) {
  const base = resolve(root, smoke ? 'build/desktop-smoke' : 'build/desktop-emu');
  env.CALFIF_PROFILE_DIR = resolve(base, 'profile');
  if (smoke) {
    rmSync(env.CALFIF_PROFILE_DIR, { recursive: true, force: true });
    rmSync(resolve(base, `${scenario}.json`), { force: true });
  }
  mkdirSync(base, { recursive: true });
}

const child = spawn(exe, launchArgs, { cwd: root, env, stdio: 'inherit' });
const timer = smoke
  ? setTimeout(() => {
      console.error('90초가 지나 끝낸다');
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    }, 90000)
  : null;
child.on('exit', (code) => {
  if (timer) clearTimeout(timer);
  if (!smoke) process.exit(code ?? 0);
  const file = resolve(root, 'build/desktop-smoke', `${scenario}.json`);
  if (!existsSync(file)) {
    console.error(`상태 파일이 없다: ${file}`);
    process.exit(1);
  }
  const text = readFileSync(file, 'utf8');
  console.log(text);
  const status = JSON.parse(text) as { failures?: string[] };
  process.exit(status.failures && status.failures.length === 0 ? 0 : 1);
});
