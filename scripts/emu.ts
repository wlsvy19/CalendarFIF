import { spawnSync } from 'node:child_process';
import { delimiter, resolve } from 'node:path';
import { findJdkBin } from './jdk';

function systemJavaMajor(): number | null {
  const r = spawnSync('java', ['-version'], { encoding: 'utf8' });
  if (r.error) return null;
  const m = /version "(\d+)/.exec(`${r.stderr}${r.stdout}`);
  return m ? Number(m[1]) : null;
}

const command = process.argv[2];
if (!command) {
  console.error('사용법: tsx scripts/emu.ts "<명령>"');
  process.exit(1);
}

const env = { ...process.env };
const major = systemJavaMajor();
if (major === null || major < 21) {
  const bin = findJdkBin(resolve('.tools'));
  if (!bin) {
    console.error('Java 21 이상이 없다. 먼저 `npx tsx scripts/jdk.ts`를 실행하라.');
    process.exit(1);
  }
  const pathKey = Object.keys(env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
  env[pathKey] = `${bin}${delimiter}${env[pathKey] ?? ''}`;
}

const r = spawnSync(
  'npx',
  ['firebase', 'emulators:exec', '--only', 'firestore,auth', '--project', 'demo-calfif', `"${command.replaceAll('"', '\\"')}"`],
  { stdio: 'inherit', env, shell: true },
);
process.exit(r.status ?? 1);
