import { dirname, join } from 'node:path';

export type Scenario = 'attach' | 'bounds' | 'tray' | 'settings' | 'e2e';
export type Runtime = { rendererDir: string; profileDir: string; statusDir: string | null; smoke: Scenario | null; emulator: boolean; manageLoginItem: boolean };

const SCENARIOS: readonly string[] = ['attach', 'bounds', 'tray', 'settings', 'e2e'];

// 환경 변수로 개발·시험 실행을 가른다. 꾸린 앱은 렌더러 폴더를 바꿀 수 없다.
export function resolveRuntime(p: { env: Record<string, string | undefined>; isPackaged: boolean; appPath: string; appData: string }): Runtime {
  const { env } = p;
  let smoke: Scenario | null = null;
  if (env.CALFIF_SMOKE) {
    const name = env.CALFIF_SMOKE === '1' ? 'attach' : env.CALFIF_SMOKE;
    if (!SCENARIOS.includes(name)) throw new Error(`CALFIF_SMOKE를 알 수 없다: ${env.CALFIF_SMOKE}`);
    smoke = name as Scenario;
  }
  if (smoke && !env.CALFIF_PROFILE_DIR) throw new Error('시험 실행에는 CALFIF_PROFILE_DIR이 필요하다');
  const bundled = join(p.appPath, 'dist-desktop');
  return {
    rendererDir: p.isPackaged ? bundled : env.CALFIF_RENDERER_DIR || bundled,
    profileDir: env.CALFIF_PROFILE_DIR || join(p.appData, 'CalendarFIF'),
    statusDir: smoke && env.CALFIF_PROFILE_DIR ? dirname(env.CALFIF_PROFILE_DIR) : null,
    smoke,
    emulator: env.CALFIF_EMU === '1',
    manageLoginItem: p.isPackaged && !smoke,
  };
}
