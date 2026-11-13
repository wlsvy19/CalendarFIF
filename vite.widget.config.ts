import { defineConfig } from 'vite';

// 위젯(Scriptable용)을 import가 없는 스크립트 하나(iife)로 묶는다. 머리말과 시작 줄은 scripts/build-widget.ts가 붙인다.
export default defineConfig({
  publicDir: false,
  build: {
    lib: { entry: 'src/widget/main.ts', formats: ['iife'], name: 'CalendarFIFWidget', fileName: () => 'widget.js' },
    outDir: 'build/widget',
    emptyOutDir: true,
    target: 'es2022',
    minify: false,
  },
});
