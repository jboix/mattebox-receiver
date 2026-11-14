/**
 * The app's resolver. The sender resolves its content: it sends the URL to
 * play, the license URL in `customData.mattebox`, and nothing the receiver
 * has to look up. The library's default reads exactly that, and this page
 * adds one thing to it: a token for a URL whose CDN asks for one.
 *
 * A token is the receiver's to fetch, because the sender's was issued for the
 * sender. Who issues it is vendor-specific, so it is a module of its own,
 * named by the load and fetched only by a load that names it. A page for
 * another vendor replaces the table below and nothing else.
 */
import type { CastLoad, Load } from '@mattebox/cast-receiver';
import { defaultResolve, matteboxData } from '@mattebox/cast-receiver';
import type { MatteboxPlayerElement } from '@mattebox/player';

/** Adds to a URL the token its CDN asks for. */
type Tokenize = (url: string, signal: AbortSignal) => Promise<string>;

/**
 * The token issuers this page knows, by the key a sender names one with in
 * `customData`: `{ srgssr: { tokenType: 'AKAMAI' } }`. Each is a dynamic
 * import, so a load that names none fetches none.
 */
const ISSUERS: Readonly<Record<string, (data: unknown) => Promise<Tokenize | null>>> = {
  srgssr: async (data) => {
    const { tokenizer } = await import('./srgssr.js');
    return tokenizer(data);
  },
};

/**
 * The resolver runs before the player loads anything, so what a load needs
 * first is fetched here: the ads module, for a load whose sender sent ads.
 */
export function resolver(player: MatteboxPlayerElement): (load: CastLoad) => Promise<Load> {
  return async (load) => {
    const resolved = defaultResolve(load);
    if (matteboxData(load.customData).addons?.ads !== undefined) {
      const { follow } = await import('./ads.js');
      follow(player);
    }
    const custom = load.customData;
    if (typeof custom !== 'object' || custom === null) return resolved;
    const signal = AbortSignal.timeout(15_000);
    let url = resolved.url;
    for (const [key, issuer] of Object.entries(ISSUERS)) {
      const data = (custom as Record<string, unknown>)[key];
      if (data === undefined) continue;
      const tokenize = await issuer(data);
      if (tokenize !== null) url = await tokenize(url, signal);
    }
    return { ...resolved, url };
  };
}
