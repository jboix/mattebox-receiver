// The playground from this repository's sources, in one command. Not
// published: an integrator runs the CLI.
//
//   npm run playground                          # over this repository's app, with hot reload
//   npm run playground -- <receiver url>        # over any receiver page
//   npm run playground -- <receiver url> --lan  # and reachable from the local network
//
// It builds the package only when a source is newer than the last build.
import { execFileSync } from 'node:child_process';
import { existsSync, globSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const HERE = fileURLToPath(new URL('.', import.meta.url));

function newest(patterns) {
  return Math.max(
    0,
    ...globSync(patterns, { cwd: HERE }).map((file) => statSync(`${HERE}${file}`).mtimeMs),
  );
}
const built = ['dist/node/server.js', 'dist/ui/index.html'];
const stale =
  !built.every((file) => existsSync(`${HERE}${file}`)) ||
  newest(['src/**', 'ui/**', 'vite.config.ts', 'tsconfig.build.json']) > newest(built);
if (stale) {
  console.log('  building @mattebox/cast-playground…');
  execFileSync('npm', ['run', 'build', '--silent'], {
    cwd: HERE,
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    port: { type: 'string', default: '8010' },
    host: { type: 'string', default: 'localhost' },
    lan: { type: 'boolean', default: false },
  },
});

let receiver = positionals[0];
let app = null;
if (receiver === undefined) {
  // This repository's app, from its dev server. The proxy reaches it on this machine.
  const { createServer } = await import('vite');
  app = await createServer({
    root: fileURLToPath(new URL('../../app', import.meta.url)),
    logLevel: 'error',
    server: { port: 5173, strictPort: false },
  });
  await app.listen();
  receiver = app.resolvedUrls?.local[0] ?? 'http://localhost:5173/';
}

const { startPlayground } = await import('./dist/node/server.js');
const playground = await startPlayground({
  receiver,
  port: Number(values.port),
  host: values.lan ? '0.0.0.0' : values.host,
});

console.log(`\n  Cast playground   ${playground.url}`);
console.log(
  `  receiver page     ${receiver}${app === null ? '' : ' (app/, hot reload through the proxy)'}`,
);
for (const url of playground.networkUrls) console.log(`  on the network    ${url}`);
console.log('');

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await Promise.all([playground.close(), app?.close()]);
    process.exit(0);
  });
}
