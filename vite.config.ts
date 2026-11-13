import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  server: { port: 5173, strictPort: true },
  plugins: [
    VitePWA({
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
        // registerType 'autoUpdate'에서는 새 서비스 워커가 설치되자마자 바로 넘겨받는다(skipWaiting, clientsClaim).
        // 이미 열려 있는 페이지는 읽어 둔 파일로 계속 돌고, 다음에 불러올 때부터 새 파일을 쓴다.
      },
    }),
  ],
});
