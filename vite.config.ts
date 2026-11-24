import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // 상대 경로: 어떤 정적 호스팅 주소(하위 폴더 포함)에 올려도 동작
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: '홀덤펍 토너먼트 vs AI',
        short_name: '홀덤펍',
        lang: 'ko',
        display: 'standalone',
        background_color: '#0b1f17',
        theme_color: '#0b1f17',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
    }),
  ],
  worker: { format: 'es' },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60000,
  },
} as any);
