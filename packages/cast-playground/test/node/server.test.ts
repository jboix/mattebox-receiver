import type { Server } from 'node:http';
import { createServer, request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { Playground } from '../../src/server.js';
import { injectPlatform, PLATFORM_PATH, startPlayground } from '../../src/server.js';

const PARENT = 'http://localhost:8010';
const TAG = `<script src="${PLATFORM_PATH}" data-parent="${PARENT}"></script>`;

describe('injectPlatform', () => {
  it("puts the platform first in the head, before the framework's script", () => {
    const html = '<!doctype html><html><head><script src="framework.js"></script></head></html>';
    const out = injectPlatform(html, PARENT);
    expect(out.indexOf(TAG)).toBeGreaterThan(-1);
    expect(out.indexOf(TAG)).toBeLessThan(out.indexOf('framework.js'));
    expect(out.indexOf(TAG)).toBeGreaterThan(out.indexOf('<head>'));
  });

  it('keeps the attributes of a head that has some', () => {
    expect(injectPlatform('<head lang="en"><title>x</title></head>', PARENT)).toBe(
      `<head lang="en">\n${TAG}<title>x</title></head>`,
    );
  });

  it('goes after the doctype of a document that writes no head', () => {
    expect(injectPlatform('<!DOCTYPE html><script src="framework.js"></script>', PARENT)).toBe(
      `<!DOCTYPE html>${TAG}<script src="framework.js"></script>`,
    );
  });
});

describe('the playground', () => {
  let upstream: Server | null = null;
  let playground: Playground | null = null;

  /** A receiver page's server: a document with headers that would keep it out of a frame, a script, and a redirect. */
  async function receiver(): Promise<string> {
    const server = createServer((req, res) => {
      if (req.url === '/app.js') {
        res.writeHead(200, { 'content-type': 'text/javascript' });
        res.end('console.log(1)');
      } else if (req.url === '/old') {
        res.writeHead(302, { location: `http://${req.headers.host}/receiver/?a=1` });
        res.end();
      } else {
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'content-security-policy': "default-src 'self'",
          'x-frame-options': 'DENY',
          // The path and query it was asked for, out of the document, so the fixture reflects nothing into HTML.
          'x-asked': req.url ?? '',
        });
        res.end('<html><head><script src="/app.js"></script></head><body></body></html>');
      }
    });
    upstream = server;
    await new Promise<void>((resolve) => server.listen(0, 'localhost', resolve));
    return `http://localhost:${(server.address() as AddressInfo).port}`;
  }

  afterEach(async () => {
    await playground?.close();
    await new Promise((resolve) => upstream?.close(resolve) ?? resolve(undefined));
    playground = null;
    upstream = null;
  });

  it('serves the receiver page at its own path, with the platform and without the headers against a frame', async () => {
    const origin = await receiver();
    playground = await startPlayground({ receiver: `${origin}/receiver/?a=1`, port: 0 });
    expect(new URL(playground.receiverUrl).pathname).toBe('/receiver/');
    expect(new URL(playground.receiverUrl).search).toBe('?a=1');

    const response = await fetch(playground.receiverUrl);
    const html = await response.text();
    expect(html).toContain(`data-parent="${new URL(playground.url).origin}"`);
    expect(html.indexOf(PLATFORM_PATH)).toBeLessThan(html.indexOf('/app.js'));
    expect(response.headers.get('x-asked')).toBe('/receiver/?a=1');
    expect(response.headers.get('content-security-policy')).toBeNull();
    expect(response.headers.get('x-frame-options')).toBeNull();
  });

  it('passes everything that is not a document through, and serves the platform itself', async () => {
    const origin = await receiver();
    playground = await startPlayground({ receiver: `${origin}/`, port: 0 });
    const proxy = new URL(playground.receiverUrl).origin;
    expect(await (await fetch(`${proxy}/app.js`)).text()).toBe('console.log(1)');
    const platform = await fetch(`${proxy}${PLATFORM_PATH}`);
    expect(platform.headers.get('content-type')).toContain('text/javascript');
    expect(await platform.text()).toContain('localhost:8008');
  });

  it("keeps a redirect inside the receiver's origin on the proxy", async () => {
    const origin = await receiver();
    playground = await startPlayground({ receiver: `${origin}/`, port: 0 });
    const proxy = new URL(playground.receiverUrl).origin;
    const response = await fetch(`${proxy}/old`, { redirect: 'manual' });
    expect(response.headers.get('location')).toBe(`${proxy}/receiver/?a=1`);
  });

  it('tells its page where the receiver is', async () => {
    const origin = await receiver();
    playground = await startPlayground({ receiver: `${origin}/receiver/`, port: 0 });
    const config = (await (await fetch(`${playground.url}config.json`)).json()) as {
      receiver: string;
      target: string;
    };
    expect(config).toEqual({ receiver: playground.receiverUrl, target: `${origin}/receiver/` });
  });

  it('names both origins as the browser that asked names this machine', async () => {
    const origin = await receiver();
    playground = await startPlayground({ receiver: `${origin}/`, port: 0, host: '0.0.0.0' });
    const pagePort = new URL(playground.url).port;
    const proxyPort = new URL(playground.receiverUrl).port;
    // Another machine on the network asks by address, and says so in `Host`.
    const ask = (port: string, path: string): Promise<string> =>
      new Promise((resolve, reject) => {
        request(
          { host: '127.0.0.1', port, path, headers: { host: `192.168.1.20:${port}` } },
          (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
          },
        )
          .on('error', reject)
          .end();
      });
    expect(JSON.parse(await ask(pagePort, '/config.json')).receiver).toBe(
      `http://192.168.1.20:${proxyPort}/`,
    );
    expect(await ask(proxyPort, '/')).toContain(`data-parent="http://192.168.1.20:${pagePort}"`);
    // This machine still opens it by name.
    expect(new URL(playground.url).hostname).toBe('localhost');
  });

  it('lists no network address when it listens on this machine alone', async () => {
    const origin = await receiver();
    playground = await startPlayground({ receiver: `${origin}/`, port: 0 });
    expect(playground.networkUrls).toEqual([]);
  });

  it("sends nothing outside the receiver's origin", async () => {
    const origin = await receiver();
    let reached = 0;
    const elsewhere = createServer((_req, res) => {
      reached += 1;
      res.end('elsewhere');
    });
    await new Promise<void>((resolve) => elsewhere.listen(0, 'localhost', resolve));
    const other = `localhost:${(elsewhere.address() as AddressInfo).port}`;
    playground = await startPlayground({ receiver: `${origin}/`, port: 0 });
    const proxyPort = new URL(playground.receiverUrl).port;
    // A request line can name another host: scheme-relative, absolute, or with a backslash.
    const ask = (path: string): Promise<number> =>
      new Promise((resolve, reject) => {
        request({ host: 'localhost', port: proxyPort, path }, (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        })
          .on('error', reject)
          .end();
      });
    try {
      for (const path of [`//${other}/`, `http://${other}/`, `/\\${other}/`]) {
        expect(await ask(path)).toBe(400);
      }
      expect(reached).toBe(0);
    } finally {
      await new Promise((resolve) => elsewhere.close(resolve));
    }
  });

  it('passes a WebSocket upgrade through to a receiver page on an IPv6 address', async () => {
    const server = createServer();
    server.on('upgrade', (req, socket) => {
      socket.end(
        `HTTP/1.1 101 Switching Protocols\r\nupgrade: test\r\nconnection: Upgrade\r\nx-asked: ${req.url}\r\n\r\n`,
      );
    });
    upstream = server;
    await new Promise<void>((resolve) => server.listen(0, '::1', resolve));
    const origin = `http://[::1]:${(server.address() as AddressInfo).port}`;
    playground = await startPlayground({ receiver: `${origin}/`, port: 0 });
    const proxyPort = new URL(playground.receiverUrl).port;
    const asked = await new Promise<string | undefined>((resolve, reject) => {
      request({
        host: 'localhost',
        port: proxyPort,
        path: '/hmr',
        headers: { connection: 'Upgrade', upgrade: 'test' },
      })
        .on('upgrade', (res, socket) => {
          socket.destroy();
          resolve(res.headers['x-asked'] as string | undefined);
        })
        .on('error', reject)
        .end();
    });
    expect(asked).toBe('/hmr');
  });

  it('says so when the receiver page does not answer', async () => {
    playground = await startPlayground({ receiver: 'http://localhost:9/', port: 0 });
    const response = await fetch(playground.receiverUrl);
    expect(response.status).toBe(502);
    expect(await response.text()).toContain('did not answer');
  });
});
