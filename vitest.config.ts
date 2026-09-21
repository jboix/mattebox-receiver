import { playwright } from '@vitest/browser-playwright';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { alias } from './vitest.alias.js';

type Browser = 'chromium' | 'firefox' | 'webkit';

/**
 * The HLS fixture is playlists alone. A missing segment is a fatal error
 * within milliseconds, and the receiver goes idle on one, so the segment
 * requests are held open instead: the session stays in its ready phase for
 * as long as a test looks at it, and the engine aborts them on unload.
 */
function holdSegments(): Plugin {
  return {
    name: 'hold-segments',
    configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        if (/\/fixtures\/hls\/.*\.(mp4|m4s|vtt)(\?|$)/.test(request.url ?? '')) return;
        next();
      });
    },
  };
}

/**
 * The browser tier in one browser. Each browser is a project of its own so
 * it can carry a `groupOrder`: Vitest runs the projects of one order together
 * and the orders in sequence, so the three browsers run one after another
 * rather than side by side. `--project='browser*'` selects all three.
 */
function browserProject(browser: Browser, order: number) {
  return {
    plugins: [holdSegments()],
    resolve: { alias },
    // The tests import the engine and the preset. Named here so Vite bundles
    // them before the first test, rather than finding them during it and
    // reloading the page.
    optimizeDeps: {
      include: ['mattebox', 'mattebox/presets/full', '@mattebox/player-core'],
    },
    test: {
      name: browser,
      include: ['packages/*/test/browser/**/*.test.ts'],
      setupFiles: ['./test/browser/setup.ts'],
      sequence: { groupOrder: order },
      browser: {
        enabled: true,
        headless: true,
        provider: playwright(),
        instances: [{ browser, name: `browser (${browser})` }],
      },
    },
  };
}

export default defineConfig({
  resolve: { alias },
  test: {
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**'],
      // v8 cannot instrument Firefox or WebKit; coverage measures the node tier.
      exclude: ['packages/cast-receiver/src/index.ts', 'packages/cast-receiver/src/types.ts'],
      // json-summary and json feed the PR coverage comment. No thresholds.
      reporter: ['text', 'json-summary', 'json'],
    },
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'node',
          environment: 'node',
          include: ['packages/*/test/node/**/*.test.ts'],
        },
      },
      browserProject('chromium', 1),
      browserProject('firefox', 2),
      browserProject('webkit', 3),
    ],
  },
});
