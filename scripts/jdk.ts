import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const JDK_URL = 'https://aka.ms/download-jdk/microsoft-jdk-21-windows-x64.zip';

export function findJdkBin(toolsDir: string): string | null {
  const root = join(toolsDir, 'jdk-21');
  if (!existsSync(root)) return null;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const bin = join(root, entry.name, 'bin');
    if (existsSync(join(bin, 'java.exe')) || existsSync(join(bin, 'java'))) return bin;
  }
  return null;
}

function run(cmd: string, args: string[], cwd?: string): void {
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd });
  if (r.status !== 0) throw new Error(`${cmd} 실행 실패 (종료 코드 ${r.status})`);
}

function install(toolsDir: string): string {
  const existing = findJdkBin(toolsDir);
  if (existing) return existing;
  const zip = join(toolsDir, 'jdk-21.zip');
  mkdirSync(join(toolsDir, 'jdk-21'), { recursive: true });
  run('curl', ['-sS', '-L', '--fail', '--ssl-no-revoke', '-o', zip, JDK_URL]);
  // Git Bash의 GNU tar는 zip을 못 푼다. Windows 기본 tar(bsdtar)를 경로로 지정한다.
  const tar = process.env.SystemRoot ? join(process.env.SystemRoot, 'System32', 'tar.exe') : 'tar';
  run(tar, ['-xf', 'jdk-21.zip', '-C', 'jdk-21'], toolsDir);
  rmSync(zip, { force: true });
  const bin = findJdkBin(toolsDir);
  if (!bin) throw new Error('JDK를 푼 뒤에도 java 실행 파일을 찾지 못했다');
  return bin;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const bin = install(resolve('.tools'));
  console.log(`JDK bin: ${bin}`);
  run(join(bin, 'java'), ['-version']);
}
