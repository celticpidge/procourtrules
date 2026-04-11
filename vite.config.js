import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: false, // using public/manifest.json
      workbox: {
        globPatterns: ['**/*.{js,css,html,json,png,svg,ico}'],
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
