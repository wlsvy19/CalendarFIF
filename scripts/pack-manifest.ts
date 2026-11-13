// 꾸린 앱 안에 들어가는 package.json. 화면과 메인은 이미 묶여 있어 koffi만 실행 때 읽는다.
export function stageManifest(rootPkg: { version?: string; dependencies?: Record<string, string> }, koffiVersion: string): Record<string, unknown> {
  return {
    name: 'calendarfif',
    productName: 'CalendarFIF',
    version: rootPkg.version ?? '0.0.0',
    private: true,
    main: 'desktop/main.cjs',
    dependencies: { koffi: koffiVersion },
  };
}
