import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import icon from "astro-icon";
import AstroPWA from '@vite-pwa/astro';

// https://astro.build/config
export default defineConfig({
  integrations: [
    icon(),
    AstroPWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Medicert Portal',
        short_name: 'Medicert',
        description: 'Medicert Profesyonel Yönetim Sistemi',
        theme_color: '#6366f1',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        lang: 'tr',
        icons: [
          { src: 'pwa-64x64.png',           sizes: '64x64',   type: 'image/png' },
          { src: 'favicon.svg',             sizes: 'any',     type: 'image/svg+xml' },
          { src: 'pwa-192x192.png',          sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png',          sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell ve statik dosyaları önbelleğe al
        globPatterns: ['**/*.{css,js,html,svg,png,ico,woff,woff2}'],
        // API çağrıları önbelleklenmez — IndexedDB zaten hallediyor
        navigateFallback: '/offline',
        navigateFallbackDenylist: [/^\/api\//, /^\/cdn-cgi\//],
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'pages-cache',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 * 24 * 7, // 1 week
              },
              networkTimeoutSeconds: 5,
            },
          },
          {
            urlPattern: /^\/api\/.*/i,
            handler: 'NetworkOnly',
          },
          {
            urlPattern: /^\/cdn-cgi\/.*/i,
            handler: 'NetworkOnly',
          },
        ],
      },
      devOptions: {
        enabled: false, // Dev'de SW'yi devre dışı bırak — sorun çıkarır
      },
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
