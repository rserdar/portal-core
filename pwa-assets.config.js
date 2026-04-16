import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

export default defineConfig({
  head: {
    inputs: ['public/favicon.svg'],
  },
  preset: minimal2023Preset,
  images: ['public/favicon.svg'],
});
