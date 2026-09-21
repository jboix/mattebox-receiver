import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// The app imports the library by name and gets its sources, so HMR works
// against source and no build is needed first. The engine, the core and the
// player come from npm. Pass `--base` for the subpath the hosted build is
// served from.
export default defineConfig({
  resolve: {
    alias: {
      '@mattebox/cast-receiver': fileURLToPath(
        new URL('../packages/cast-receiver/src/index.ts', import.meta.url),
      ),
    },
  },
  build: {
    // A first generation Chromecast runs an old Chromium. The hosted page is
    // lowered to the same target as the packages' default build.
    target: 'es2015',
  },
});
