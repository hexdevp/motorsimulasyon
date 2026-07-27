import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Build ciktisi tek bir HTML dosyasidir (dist/index.html).
// Arkadasina o dosyayi gonderirsin, cift tiklayip acar; kurulum/internet gerekmez.
export default defineConfig({
  base: './',
  plugins: [react(), viteSingleFile()],
  build: {
    target: 'es2020',
    assetsInlineLimit: 100 * 1024 * 1024,
    chunkSizeWarningLimit: 10000,
  },
});
