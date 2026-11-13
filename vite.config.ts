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
        // 새 버전은 열려 있는 탭을 건드리지 않고 다음에 열 때 적용한다.
        skipWaiting: false,
        clientsClaim: false,
      },
    }),
  ],
});
