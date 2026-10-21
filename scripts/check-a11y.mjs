// axe-core over the playground's page, for the WCAG 2.0, 2.1 and 2.2 rules
// at levels A and AA, in the light and the dark scheme: as it loads, with the
// content dialog open, and on the dialog's SRG SSR tab. The playground runs
// over this repository's app, as `npm run playground` does. The receiver
// page in its frame is not checked here: the app's E2E tests check it in
// three browsers. Needs `npm run build`. Chromium runs it.
import { fileURLToPath } from 'node:url';
import axe from 'axe-core';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { startPlayground } from '../packages/cast-playground/dist/node/server.js';
import { fail } from './lib/fail.mjs';

/** Every WCAG A and AA rule up to WCAG 2.2. */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** A port clear of `npm run playground`'s 8010; the proxy takes the next one. */
const PORT = 8030;

/** The states to check, each a step from the page as it loads. */
const STATES = [
  ['as it loads', async () => {}],
  ['content dialog', (page) => page.click('#open-content')],
  [
    'SRG SSR tab',
    async (page) => {
      await page.click('#open-content');
      await page.click('[role="tab"][data-route="srgssr"]');
    },
  ],
];

/** The broken rules of the page now, one line per element. */
async function problemsOf(page) {
  await page.addScriptTag({ content: axe.source });
  const result = await page.evaluate(
    (tags) =>
      // The frame is the receiver page, checked by its own tests.
      window.axe.run(document, { runOnly: { type: 'tag', values: tags }, iframes: false }),
    TAGS,
  );
  return result.violations.flatMap((violation) =>
    violation.nodes.map((node) => {
      const summary = node.failureSummary?.split('\n').slice(1).join(' ').trim() ?? '';
      return `${violation.id} (${violation.impact}) ${node.target.join(' ')}: ${summary}`;
    }),
  );
}

const app = await createServer({
  root: fileURLToPath(new URL('../app', import.meta.url)),
  logLevel: 'error',
  server: { port: 5183, strictPort: false },
});
await app.listen();
const playground = await startPlayground({
  receiver: app.resolvedUrls?.local[0] ?? 'http://localhost:5183/',
  port: PORT,
});
const browser = await chromium.launch();
const failures = [];
try {
  for (const scheme of ['light', 'dark']) {
    for (const [name, open] of STATES) {
      const context = await browser.newContext({
        colorScheme: scheme,
        viewport: { width: 1280, height: 800 },
      });
      const page = await context.newPage();
      await page.goto(playground.url, { waitUntil: 'load' });
      await page.waitForTimeout(1000);
      await open(page);
      await page.waitForTimeout(300);
      for (const problem of await problemsOf(page)) {
        failures.push(`[${scheme}] ${name}: ${problem}`);
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
  await Promise.all([playground.close(), app.close()]);
}

if (failures.length > 0) fail(`${failures.length} accessibility problems.`, failures);
console.log('The playground passes axe-core in every state and both schemes.');
