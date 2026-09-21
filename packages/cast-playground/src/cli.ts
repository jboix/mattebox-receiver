#!/usr/bin/env node
/**
 * `npx @mattebox/cast-playground <receiver url>`: the playground over a
 * receiver page, local or hosted.
 */
import { parseArgs } from 'node:util';
import { startPlayground } from './server.js';

const USAGE = `
  cast-playground <receiver url> [--port 8010] [--host localhost] [--lan]

  Opens a receiver page under Google's real receiver framework, in a desktop
  browser, with the device's platform and one sender played by the page
  around it. The receiver page is not edited: it is served through a local
  proxy that puts the faked platform first in its head.

  <receiver url>   the page as a browser would open it, such as
                   http://localhost:5173/ or https://example.com/receiver/
  --port           the playground's port. The receiver's proxy takes the next. Default 8010
  --host           the address to listen on. Default localhost, which only this machine reaches
  --lan            listen on every interface, for the local network. The same as --host 0.0.0.0
`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    port: { type: 'string', default: '8010' },
    host: { type: 'string', default: 'localhost' },
    lan: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

const receiver = positionals[0];
if (values.help || receiver === undefined) {
  console.log(USAGE);
  process.exit(values.help ? 0 : 1);
}

let target: URL;
try {
  target = new URL(receiver);
} catch {
  console.error(
    `cast-playground: "${receiver}" is not a URL. Give the scheme too: http://localhost:5173/`,
  );
  process.exit(1);
}

try {
  const playground = await startPlayground({
    receiver: target.href,
    port: Number(values.port),
    host: values.lan ? '0.0.0.0' : values.host,
  });
  console.log(`\n  Cast playground   ${playground.url}`);
  console.log(`  receiver page     ${target.href}`);
  console.log(`  through           ${playground.receiverUrl}`);
  for (const url of playground.networkUrls) console.log(`  on the network    ${url}`);
  console.log('');
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => void playground.close().then(() => process.exit(0)));
  }
} catch (cause) {
  const error = cause as NodeJS.ErrnoException;
  console.error(
    error.code === 'EADDRINUSE'
      ? `cast-playground: port ${values.port} or the next one is taken. Try --port.`
      : `cast-playground: ${error.message}`,
  );
  process.exit(1);
}
