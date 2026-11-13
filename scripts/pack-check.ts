// 꾸린 화면 묶음이 고른 변형과 맞는지 본다. 127.0.0.1은 실제 묶음에도 막아 둔 에뮬레이터 갈래로 들어 있으므로 보지 않는다.
export function bundleProblem(emu: boolean, bundleText: string): string | null {
  const has = bundleText.includes('demo-calfif');
  if (!emu && has) return '실제 프로젝트용 꾸리기인데 화면 묶음에 에뮬레이터 프로젝트 ID(demo-calfif)가 들어 있다. .env.local이 비었거나 화면을 에뮬레이터 모드로 빌드한 것이 아닌지 본다.';
  if (emu && !has) return '에뮬레이터용 꾸리기인데 화면 묶음에 에뮬레이터 프로젝트 ID(demo-calfif)가 없다. 화면을 desktop-emu 모드로 빌드했는지 본다.';
  return null;
}
