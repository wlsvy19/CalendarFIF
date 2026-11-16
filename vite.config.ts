import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { defineConfig, type PluginOption } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// 푸시 처리(public/push-sw.js, scripts/build-push.ts가 만든다)를 서비스 워커가 읽는다. 내용이 바뀌면 주소의 v가 바뀌어
// 서비스 워커 파일도 바뀌므로 아이폰이 새 처리를 받는다. 파일이 없으면(개발 서버) 붙이지 않는다.
const PUSH_SW = 'public/push-sw.js';
const pushImports = existsSync(PUSH_SW)
  ? [`push-sw.js?v=${createHash('sha256').update(readFileSync(PUSH_SW)).digest('hex').slice(0, 10)}`]
  : [];

// 설정의 맨 아래에 보일 앱 버전(src/web/version.ts).
const APP_VERSION = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version;

// PC 앱(desktop, desktop-emu 모드)은 앱 안의 파일을 읽으므로 서비스 워커와 매니페스트가 없다.
const DESKTOP_OUT: Record<string, string> = { desktop: 'dist-desktop', 'desktop-emu': 'dist-desktop-emu' };

// 첫 화면부터 투명하게 칠하도록 <html>에 desk 클래스를 미리 붙인다.
const deskClass: PluginOption = {
  name: 'desktop-html',
  transformIndexHtml: (html) => html.replace('<html lang="ko">', '<html lang="ko" class="desk">'),
};

const pwa = VitePWA({
  registerType: 'autoUpdate',
  injectRegister: 'auto',
  devOptions: { enabled: false },
  includeAssets: ['icons/apple-touch-icon.png'],
  manifest: {
    name: 'CalendarFIF',
    short_name: 'CalendarFIF',
    lang: 'ko',
    display: 'standalone',
    start_url: '/',
    theme_color: '#2550D0',
    background_color: '#2550D0',
    icons: [
      { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  },
  workbox: {
    globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'],
    // 트레이 그림은 PC 앱만 쓴다. 아이폰이 미리 받아 둘 필요가 없다.
    globIgnores: ['**/node_modules/**/*', 'icons/tray*.png'],
    navigateFallback: 'index.html',
    // Firebase가 쓰는 주소(/__/..., 예: 비밀번호 재설정 링크)에는 앱의 페이지로 답하지 않는다.
    navigateFallbackDenylist: [/^\/__\//],
    importScripts: pushImports,
    // registerType 'autoUpdate'에서는 새 서비스 워커가 설치되자마자 바로 넘겨받는다(skipWaiting, clientsClaim).
    // 이미 열려 있는 페이지는 읽어 둔 파일로 계속 돌고, 다음에 불러올 때부터 새 파일을 쓴다.
  },
});

export default defineConfig(({ mode }) => {
  const outDir = DESKTOP_OUT[mode];
  return {
    define: { __APP_VERSION__: JSON.stringify(APP_VERSION) },
    server: { port: 5173, strictPort: true },
    ...(outDir ? { build: { outDir } } : {}),
    plugins: [outDir ? deskClass : pwa],
  };
});
