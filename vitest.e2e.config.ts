import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';
import { alias } from './vitest.alias.js';

type Browser = 'chromium' | 'firefox' | 'webkit';

/**
 * The app's page in one browser. The tests run inside the page, over the
 * app's sources through the same alias as the unit tiers, with no device and
 * no framework: the page's `?load` path.
 */
function browserProject(browser: Browser, order: number) {
  return {
    resolve: { alias },
    // Named here so Vite bundles them before the first test, rather than
    // finding them during it and reloading the page.
    optimizeDeps: {
      include: [
        'mattebox',
        'mattebox/presets/full',
        'mattebox/stages/thumbnails',
        '@mattebox/player-core',
      ],
    },
    test: {
      name: browser,
      include: ['test/e2e/**/*.test.ts'],
      setupFiles: ['./test/browser/setup.ts'],
      // The browsers run one after another, as under vitest.config.ts.
      sequence: { groupOrder: order },
      testTimeout: 30_000,
      hookTimeout: 30_000,
      retry: process.env.CI ? 2 : 0,
      browser: {
        enabled: true,
        headless: true,
        provider: playwright(),
        // A television's picture: 16:9.
        viewport: { width: 1280, height: 720 },
        // A failure is an attribute or a count; a picture of the page would not say which.
        screenshotFailures: false,
        instances: [{ browser }],
      },
    },
  };
}

// The app's page in three browsers: the markup is adopted, the wallpaper
// shows while nothing is loaded, and `?load` drives the player and writes the
// title. Playback on a device is the gate with no automation. The unit and
// browser tiers run under vitest.config.ts.
export default defineConfig({
  test: {
    projects: [
      browserProject('chromium', 1),
      browserProject('firefox', 2),
      browserProject('webkit', 3),
    ],
  },
});
