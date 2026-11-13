import { defineConfig } from 'vite';

// Electron 메인 프로세스와 preload를 build/desktop/ 에 각각 한 파일(cjs)로 묶는다.
// sandbox preload는 electron 말고는 require하지 못하므로 둘을 따로 빌드한다(VITE_DESKTOP_ENTRY=preload).
const entry = process.env.VITE_DESKTOP_ENTRY === 'preload' ? 'preload' : 'main';

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
  ssr: { external: ['electron', 'koffi'] },
});
