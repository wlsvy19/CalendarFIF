import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { hasTopLevelKoffiRequire } from './pack-check';

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
  if (hasTopLevelKoffiRequire(readFileSync(resolve(root, 'build/desktop/main.cjs'), 'utf8'))) {
    console.error('main.cjs가 맨 위에서 koffi를 읽는다. koffi.node를 못 읽는 PC에서 앱이 시작 전에 죽는다');
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
    rmSync(resolve(base, 'e2e-result.json'), { force: true });
  }
  mkdirSync(base, { recursive: true });
}

const statusDir = resolve(root, 'build/desktop-smoke');
const readStatus = (name: string): Record<string, unknown> | null => {
  try {
    return JSON.parse(readFileSync(resolve(statusDir, name), 'utf8')) as Record<string, unknown>;
  } catch {
    return null; // 앱이 쓰는 중이거나 아직 없다
  }
};
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function pollFor(test: () => boolean | Promise<boolean>, ms: number, every: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await test()) return true;
    await wait(every);
  }
  return false;
}

type Measured = { remoteToDesktopMs: number | null; desktopToRemoteMs: number | null };
type DayDoc = { fields?: { days?: { mapValue?: { fields?: Record<string, { mapValue?: { fields?: { color?: { stringValue?: string } } } }> } } } };
// 에뮬레이터의 REST로 오늘 칸만 바꾸고(아이폰의 편집을 흉내 낸다), PC 앱의 편집이 올라오는 것도 같은 길로 본다.
const FIRESTORE = 'http://127.0.0.1:8085/v1/projects/demo-calfif/databases/(default)/documents';
const OWNER = { authorization: 'Bearer owner', 'content-type': 'application/json' };
async function driveE2e(): Promise<Measured> {
  const none: Measured = { remoteToDesktopMs: null, desktopToRemoteMs: null };
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const doc = `${FIRESTORE}/users/owner-test-uid/months/${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  const day = pad(now.getDate());
  if (!(await pollFor(() => readStatus('e2e.json')?.phase === 'ready', 40000, 100))) return none;
  const fields = { text: { stringValue: '원격 시험 메모' }, color: { stringValue: '' }, editedAt: { integerValue: String(Date.now()) }, editedBy: { stringValue: 'iphone' } };
  const mask = encodeURIComponent('days.`' + day + '`');
  const wroteAt = Date.now();
  const put = await fetch(`${doc}?updateMask.fieldPaths=${mask}`, {
    method: 'PATCH', headers: OWNER, body: JSON.stringify({ fields: { days: { mapValue: { fields: { [day]: { mapValue: { fields } } } } } } }),
  });
  if (!put.ok) throw new Error(`에뮬레이터에 쓰지 못했다: ${put.status}`);
  const seen = await pollFor(() => readStatus('e2e.json')?.remoteSeen === true, 20000, 50);
  const seenAt = Date.now();
  if (!seen) return none;
  const colored = await pollFor(async () => {
    const body = (await (await fetch(doc, { headers: OWNER })).json()) as DayDoc;
    return body.fields?.days?.mapValue?.fields?.[day]?.mapValue?.fields?.color?.stringValue === 'F12424';
  }, 30000, 100);
  return { remoteToDesktopMs: seenAt - wroteAt, desktopToRemoteMs: colored ? Date.now() - seenAt : null };
}

const writeResult = (r: Record<string, unknown>) => writeFileSync(resolve(statusDir, 'e2e-result.json'), JSON.stringify(r, null, 2));
const within = (ms: number | null) => ms !== null && ms < 5000;
const measured: Promise<Measured> | null =
  smoke && scenario === 'e2e'
    ? driveE2e()
        .catch((e) => {
          console.error(String(e));
          return { remoteToDesktopMs: null, desktopToRemoteMs: null };
        })
        .then((m) => {
          // 앱은 이 파일이 생길 때까지 기다렸다가 끝난다. loginItemCalls는 앱이 끝난 뒤 채운다.
          writeResult({ ...m, loginItemCalls: null, ok: within(m.remoteToDesktopMs) && within(m.desktopToRemoteMs) });
          return m;
        })
    : null;

const child = spawn(exe, launchArgs, { cwd: root, env, stdio: 'inherit' });
const timer = smoke
  ? setTimeout(() => {
      console.error('90초가 지나 끝낸다');
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    }, 90000)
  : null;
child.on('exit', async (code) => {
  if (timer) clearTimeout(timer);
  if (!smoke) process.exit(code ?? 0);
  const file = resolve(root, 'build/desktop-smoke', `${scenario}.json`);
  if (!existsSync(file)) {
    console.error(`상태 파일이 없다: ${file}`);
    process.exit(1);
  }
  const text = readFileSync(file, 'utf8');
  console.log(text);
  const status = JSON.parse(text) as { failures?: string[]; loginItemCalls?: number };
  let ok = !!status.failures && status.failures.length === 0;
  if (measured) {
    const m = await measured;
    const final = { ...m, loginItemCalls: status.loginItemCalls ?? null, ok: within(m.remoteToDesktopMs) && within(m.desktopToRemoteMs) };
    writeResult(final);
    console.log(JSON.stringify(final, null, 2));
    ok = ok && final.ok;
  }
  process.exit(ok ? 0 : 1);
});
