import { defineConfig, type PluginOption } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

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
    navigateFallback: 'index.html',
    // Firebase가 쓰는 주소(/__/..., 예: 비밀번호 재설정 링크)에는 앱의 페이지로 답하지 않는다.
    navigateFallbackDenylist: [/^\/__\//],
    // registerType 'autoUpdate'에서는 새 서비스 워커가 설치되자마자 바로 넘겨받는다(skipWaiting, clientsClaim).
    // 이미 열려 있는 페이지는 읽어 둔 파일로 계속 돌고, 다음에 불러올 때부터 새 파일을 쓴다.
  },
});

export default defineConfig(({ mode }) => {
  const outDir = DESKTOP_OUT[mode];
  return {
    server: { port: 5173, strictPort: true },
    ...(outDir ? { build: { outDir } } : {}),
    plugins: [outDir ? deskClass : pwa],
  };
});
