/**
 * A new license token from the sender, for a license server that answers
 * 401 or 403. eme-core calls `onUnauthorized` once before it sends the
 * request again; this asks every sender on `urn:x-cast:ch.mattebox.license`
 * and waits for the first reply. The reply's `licenseHeaders` then go on
 * every request to the load's license servers, and its `licenseUrl` or
 * `licenseUrls` replace them. The library knows no token format: a sender
 * says which headers to send.
 *
 * The messages: `{ type: 'unauthorized', id, keySystem, status }` out, and
 * `{ type: 'license', id, licenseHeaders?, licenseUrl?, licenseUrls? }` back.
 */
import { licenseServers, strings } from './resolve.js';
import type { HookedRequest, Load, ReceiverPlayer } from './types.js';

export const LICENSE_NAMESPACE = 'urn:x-cast:ch.mattebox.license';

/** How long a sender has to reply, in milliseconds. Past it, the request goes again unchanged and fails. */
const REPLY_WAIT = 10_000;

/** A sender's reply as it arrived: each member is checked where it is used. */
interface Reply {
  readonly licenseHeaders?: unknown;
  readonly licenseUrl?: unknown;
  readonly licenseUrls?: unknown;
}

export interface LicenseChannel {
  /** The load the player holds now; a new load forgets the last one's reply. */
  loaded(load: Load): void;
  /** Adds the replied headers to the license requests. */
  hook(request: HookedRequest): void;
  /** A sender's message on the namespace. */
  onMessage(data: unknown): void;
  onUnauthorized(context: { readonly keySystem: string; readonly status: number }): Promise<void>;
}

export function createLicenseChannel(
  send: (message: unknown) => boolean,
  player: () => ReceiverPlayer | null,
): LicenseChannel {
  let servers: string[] = [];
  let headers: Readonly<Record<string, string>> | null = null;
  let asked = 0;
  const waiting = new Map<unknown, (reply: Reply | null) => void>();

  function apply(reply: Reply): void {
    headers = strings(reply.licenseHeaders) ?? headers;
    const drm = (
      player()?.engine as {
        drm?: { setLicenseUrl(url: string): void; setLicenseUrls(urls: object): void };
      } | null
    )?.drm;
    if (typeof reply.licenseUrl === 'string') {
      drm?.setLicenseUrl(reply.licenseUrl);
      servers.push(reply.licenseUrl);
    }
    const urls = strings(reply.licenseUrls);
    if (urls !== null) {
      drm?.setLicenseUrls(urls);
      servers.push(...Object.values(urls));
    }
  }

  return {
    loaded(load) {
      servers = licenseServers(load);
      headers = null;
    },
    hook(request) {
      if (headers === null || !servers.includes(request.url)) return;
      for (const [name, value] of Object.entries(headers)) request.headers[name] = value;
    },
    onMessage(data) {
      const message = data as (Reply & { type?: unknown; id?: unknown }) | null;
      const resolve = message?.type === 'license' ? waiting.get(message.id) : undefined;
      if (resolve === undefined) return;
      waiting.delete(message?.id);
      resolve(message);
    },
    async onUnauthorized({ keySystem, status }) {
      asked += 1;
      const id = asked;
      const reply = await new Promise<Reply | null>((resolve) => {
        waiting.set(id, resolve);
        if (!send({ type: 'unauthorized', id, keySystem, status })) {
          waiting.delete(id);
          resolve(null);
          return;
        }
        setTimeout(() => {
          if (waiting.delete(id)) resolve(null);
        }, REPLY_WAIT);
      });
      if (reply !== null) apply(reply);
    },
  };
}
