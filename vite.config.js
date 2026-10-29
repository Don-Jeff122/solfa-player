import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  // Relative so the built app works from any subpath, including GitHub Pages.
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      manifest: {
        name: 'Solfa Piano',
        short_name: 'Solfa',
        description:
          'Type tonic solfa and hear it played on a piano. Supports keys, parts (bass/tenor/alto/soprano), durations, WAV recording and offline score scanning.',
        theme_color: '#0b1122',
        background_color: '#0b1122',
        display: 'standalone',
        scope: './',
        start_url: './',
        icons: [
          { src: 'icons/pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'icons/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Precache the app shell and the bundled OCR assets so the whole app
        // (including the sheet scanner) works with no network connection.
        globPatterns: [
          '**/*.{js,mjs,css,html,svg,png,ico,wasm,gz,traineddata}',
        ],
        // tesseract-core-lstm.wasm.js is ~3.8 MB and eng.traineddata.gz ~2.9 MB.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        cleanupOutdatedCaches: true,
      },
    }),
  ],
})
