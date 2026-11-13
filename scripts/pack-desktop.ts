import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { packager } from '@electron/packager';
import { stageManifest } from './pack-manifest';

// 사용법: tsx scripts/pack-desktop.ts [--emu]
// 기본은 실제 프로젝트용(release/), --emu는 에뮬레이터용(build/release-emu/)이다.
const emu = process.argv.includes('--emu');
const root = resolve('.');
const readJson = (path: string) => JSON.parse(readFileSync(resolve(root, path), 'utf8')) as { version: string; dependencies?: Record<string, string> };

const build = (extra: NodeJS.ProcessEnv, cliArgs: string[]) => {
  const r = spawnSync('npx', ['vite', 'build', ...cliArgs], { stdio: 'inherit', shell: true, cwd: root, env: { ...process.env, ...extra } });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

const emuBuild = emu ? '1' : '0';
build({}, ['--mode', emu ? 'desktop-emu' : 'desktop']);
build({ CALFIF_EMU_BUILD: emuBuild }, ['-c', 'vite.desktop.config.ts']);
build({ CALFIF_EMU_BUILD: emuBuild, VITE_DESKTOP_ENTRY: 'preload' }, ['-c', 'vite.desktop.config.ts']);

const stage = resolve(root, 'build/pack-stage');
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
writeFileSync(resolve(stage, 'package.json'), JSON.stringify(stageManifest(readJson('package.json'), readJson('node_modules/koffi/package.json').version), null, 2));
cpSync(resolve(root, 'build/desktop'), resolve(stage, 'desktop'), { recursive: true });
cpSync(resolve(root, emu ? 'dist-desktop-emu' : 'dist-desktop'), resolve(stage, 'dist-desktop'), { recursive: true });
// koffi의 실행 파일(.node)은 플랫폼별 패키지에 들어 있다.
for (const dir of ['koffi', '@koromix/koffi-win32-x64']) cpSync(resolve(root, 'node_modules', dir), resolve(stage, 'node_modules', dir), { recursive: true });

const out = emu ? 'build/release-emu' : 'release';
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
