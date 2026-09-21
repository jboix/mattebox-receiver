import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// The playground's page, built to static files the CLI serves. Relative
// asset paths, so the page works wherever the server puts it.
export default defineConfig({
  root: fileURLToPath(new URL('./ui', import.meta.url)),
  base: './',
  build: {
    outDir: fileURLToPath(new URL('./dist/ui', import.meta.url)),
    emptyOutDir: true,
    target: 'es2022',
  },
});
