import { defineConfig } from 'vite';

// Electron 메인 프로세스와 preload를 build/desktop/ 에 각각 한 파일(cjs)로 묶는다.
// sandbox preload는 electron 말고는 require하지 못하므로 둘을 따로 빌드한다(VITE_DESKTOP_ENTRY=preload).
// 바탕화면 아이콘 자리를 읽는 따로 도는 프로세스(utilityProcess)도 따로 빌드한다(VITE_DESKTOP_ENTRY=iconWorker).
const ENTRIES = ['main', 'preload', 'iconWorker'];
const entry = ENTRIES.includes(process.env.VITE_DESKTOP_ENTRY ?? '') ? process.env.VITE_DESKTOP_ENTRY! : 'main';

export default defineConfig({
  publicDir: false,
  build: {
    ssr: `src/desktop/${entry}.ts`,
    outDir: 'build/desktop',
    emptyOutDir: entry === 'main',
    target: 'node22',
    minify: false,
    rolldownOptions: { output: { format: 'cjs', entryFileNames: `${entry}.cjs` } },
  },
  // 에뮬레이터용으로 꾸릴 때(CALFIF_EMU_BUILD=1)만 true. 이 앱은 환경과 상관없이 자동 실행을 걸지 않는다.
  define: { __CALFIF_EMU_BUILD__: JSON.stringify(process.env.CALFIF_EMU_BUILD === '1') },
  ssr: { external: ['electron', 'koffi'] },
});
