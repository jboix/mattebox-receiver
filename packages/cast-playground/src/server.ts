/**
 * The playground's two servers.
 *
 * The page server gives out the playground's page, built to static files,
 * and `config.json`, which tells the page where its frame loads from.
 *
 * The receiver server is a proxy for the receiver page under test, on a port
 * of its own. It changes one thing: every HTML document gets the faked Cast
 * platform as the first script of its head, because the framework's script
 * opens its socket to the platform while the head is still being parsed. The
 * receiver page is not edited, and its own absolute paths keep working,
 * since the proxy has the whole of its origin. The two pages are on two
 * origins and talk through `postMessage`.
 *
 * No dependency: `node:http` and a pipe.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { createServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { connect as netConnect } from 'node:net';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, sep } from 'node:path';
import type { Duplex } from 'node:stream';
import { connect as tlsConnect } from 'node:tls';
import { fileURLToPath } from 'node:url';

/** Where the proxy serves the faked platform from. A path no receiver page has. */
export const PLATFORM_PATH = '/__cast-playground/platform.js';

export interface PlaygroundOptions {
  /** The receiver page under test, as a browser would open it. */
  readonly receiver: string;
  /** The page's port. The receiver's proxy takes the next one. Default 8010. */
  readonly port?: number;
  /**
   * The address to listen on. Default `localhost`, which only this machine
   * reaches. `0.0.0.0` listens on every interface, for the local network.
   */
  readonly host?: string;
}

export interface Playground {
  /** Where the playground's page is. */
  readonly url: string;
  /** Where the receiver page is, through the proxy. */
  readonly receiverUrl: string;
  /** Where the playground's page is for another machine, when the host is every interface. Empty otherwise. */
  readonly networkUrls: readonly string[];
  close(): Promise<void>;
}

// The package's root: two up from the built `dist/node`, one up from `src` under the tests.
const ROOT = new URL(import.meta.url.includes('/dist/node/') ? '../../' : '../', import.meta.url);
const UI = fileURLToPath(new URL('dist/ui/', ROOT));
const PLATFORM = fileURLToPath(new URL('platform.js', ROOT));

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

/** What a receiver page may say that would keep it out of a frame, or keep the platform's script out of it. */
const DROPPED_HEADERS = [
  'content-security-policy',
  'content-security-policy-report-only',
  'x-frame-options',
  'content-length',
  'content-encoding',
];

/**
 * The document, with the platform's script as the first thing its head
 * loads. A classic script with a `src`: it blocks the parser, so it has run
 * before the framework's script is reached. `data-parent` names the only
 * origin the script talks to.
 */
export function injectPlatform(html: string, parentOrigin: string): string {
  const tag = `<script src="${PLATFORM_PATH}" data-parent="${parentOrigin}"></script>`;
  const head = /<head[^>]*>/i.exec(html);
  if (head !== null) {
    const at = head.index + head[0].length;
    return `${html.slice(0, at)}\n${tag}${html.slice(at)}`;
  }
  // No head written: the parser makes one around the first script it meets.
  const doctype = /<!doctype[^>]*>/i.exec(html);
  const at = doctype === null ? 0 : doctype.index + doctype[0].length;
  return `${html.slice(0, at)}${tag}${html.slice(at)}`;
}

function sendFile(res: ServerResponse, file: string): void {
  res.writeHead(200, {
    'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
    'cache-control': 'no-store',
  });
  createReadStream(file).pipe(res);
}

function notFound(res: ServerResponse): void {
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('not found');
}

/**
 * The origin of one of the two servers, as the browser that asked names this
 * machine: `localhost` here, an address on the local network from another
 * machine. The two pages tell each other their origins, and the messages
 * between them are checked against those, so they have to be the ones the
 * browser is using.
 */
function originFor(req: IncomingMessage, port: number): string {
  const host = req.headers.host ?? 'localhost';
  // The name without its port. An IPv6 literal keeps its brackets.
  const name = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0];
  return `http://${name}:${port}`;
}

/** The page's server: static files under `dist/ui`, and the config. */
function pageServer(config: (req: IncomingMessage) => object): Server {
  return createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    if (path === '/config.json') {
      res.writeHead(200, { 'content-type': TYPES['.json'], 'cache-control': 'no-store' });
      res.end(JSON.stringify(config(req)));
      return;
    }
    const file = normalize(join(UI, path.endsWith('/') ? `${path}index.html` : path));
    // Nothing above the page's own directory.
    if (!file.startsWith(UI.endsWith(sep) ? UI : `${UI}${sep}`)) return notFound(res);
    if (!existsSync(file) || !statSync(file).isFile()) return notFound(res);
    sendFile(res, file);
  });
}

/** The receiver's server: the receiver page's origin, with the platform in every document. */
function receiverServer(
  upstream: URL,
  parentOrigin: (req: IncomingMessage) => string,
  self: (req: IncomingMessage) => string,
): Server {
  const secure = upstream.protocol === 'https:';

  function forward(req: IncomingMessage, res: ServerResponse): void {
    if (req.url?.split('?')[0] === PLATFORM_PATH) {
      sendFile(res, PLATFORM);
      return;
    }
    const send = secure ? httpsRequest : httpRequest;
    const out = send(
      new URL(req.url ?? '/', upstream),
      {
        method: req.method,
        // Uncompressed, so a document can be read. The host is the receiver's, which is what its server routes by.
        headers: { ...req.headers, host: upstream.host, 'accept-encoding': 'identity' },
      },
      (from) => {
        const headers = { ...from.headers };
        // A redirect inside the receiver's origin stays inside the proxy.
        if (typeof headers.location === 'string' && headers.location.startsWith(upstream.origin)) {
          headers.location = `${self(req)}${headers.location.slice(upstream.origin.length)}`;
        }
        if (!String(headers['content-type'] ?? '').includes('text/html')) {
          res.writeHead(from.statusCode ?? 502, headers);
          from.pipe(res);
          return;
        }
        const chunks: Buffer[] = [];
        from.on('data', (chunk: Buffer) => chunks.push(chunk));
        from.on('end', () => {
          for (const name of DROPPED_HEADERS) delete headers[name];
          const html = injectPlatform(Buffer.concat(chunks).toString('utf8'), parentOrigin(req));
          res.writeHead(from.statusCode ?? 502, headers);
          res.end(html);
        });
      },
    );
    out.on('error', (cause) => {
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(`The receiver page at ${upstream.origin} did not answer: ${cause.message}`);
    });
    req.pipe(out);
  }

  const server = createServer(forward);
  // A dev server's own WebSocket, hot reload for one, goes through untouched.
  // The Cast platform's socket never reaches here: the injected script keeps it in the page.
  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const port = Number(upstream.port) || (secure ? 443 : 80);
    const there = secure
      ? tlsConnect({ host: upstream.hostname, port, servername: upstream.hostname })
      : netConnect({ host: upstream.hostname, port });
    there.on('error', () => socket.destroy());
    socket.on('error', () => there.destroy());
    const lines = [`${req.method} ${req.url} HTTP/1.1`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const name = req.rawHeaders[i] ?? '';
      lines.push(
        `${name}: ${name.toLowerCase() === 'host' ? upstream.host : req.rawHeaders[i + 1]}`,
      );
    }
    there.write(`${lines.join('\r\n')}\r\n\r\n`);
    there.write(head);
    there.pipe(socket);
    socket.pipe(there);
  });
  return server;
}

function listen(server: Server, port: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const address = server.address();
      resolve(typeof address === 'object' && address !== null ? address.port : port);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });
}

/** This machine's addresses on the local network, IPv4, for the lines the CLI prints. */
function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const entry of list ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) out.push(entry.address);
    }
  }
  return out;
}

export async function startPlayground(options: PlaygroundOptions): Promise<Playground> {
  const target = new URL(options.receiver);
  const host = options.host ?? 'localhost';
  const port = options.port ?? 8010;
  const everywhere = host === '0.0.0.0' || host === '::';
  let pagePort = 0;
  let receiverPort = 0;

  const receiver = receiverServer(
    new URL(target.origin),
    (req) => originFor(req, pagePort),
    (req) => originFor(req, receiverPort),
  );
  const page = pageServer((req) => ({
    // The receiver page's own path and query, on the proxy's origin.
    receiver: `${originFor(req, receiverPort)}${target.pathname}${target.search}`,
    target: target.href,
  }));

  pagePort = await listen(page, port, host);
  // Port 0 asks the system for one, twice. Otherwise the receiver takes the next.
  receiverPort = await listen(receiver, port === 0 ? 0 : port + 1, host);
  // What this machine opens. Every interface has no name of its own.
  const name = everywhere ? 'localhost' : host;

  return {
    url: `http://${name}:${pagePort}/`,
    receiverUrl: `http://${name}:${receiverPort}${target.pathname}${target.search}`,
    networkUrls: everywhere
      ? lanAddresses().map((address) => `http://${address}:${pagePort}/`)
      : [],
    async close() {
      await Promise.all([close(page), close(receiver)]);
    },
  };
}
