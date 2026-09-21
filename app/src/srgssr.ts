/**
 * SRG SSR's token, the one thing about SRG SSR content a receiver has to do
 * itself. The sender picks the resource and sends its URL and its Widevine
 * license URL. A resource the integration layer marks `tokenType: AKAMAI`
 * plays only with Akamai auth parameters on its URL, and the sender's were
 * issued for the sender. Optional: `resolve.ts` imports this module only for
 * a load whose `customData` has an `srgssr` key.
 */

const TOKEN_SERVER = 'https://tp.srgssr.ch/akahd/token?acl=';

/** The Akamai ACL for a stream URL: its directory and everything below. */
function aclPath(url: URL): string {
  const path = url.pathname;
  return `${path.substring(0, path.lastIndexOf('/') + 1)}*`;
}

/** Adds the Akamai auth parameters the token server issues for the stream's path. */
async function tokenize(streamUrl: string, signal: AbortSignal): Promise<string> {
  const url = new URL(streamUrl);
  const response = await fetch(`${TOKEN_SERVER}${encodeURIComponent(aclPath(url))}`, { signal });
  if (!response.ok) throw new Error(`token server failed: HTTP ${response.status}`);
  const data = (await response.json()) as { token?: { authparams?: string } };
  const params = new URLSearchParams(data.token?.authparams ?? '');
  for (const [key, value] of params) url.searchParams.set(key, value);
  return url.toString();
}

/** `customData.srgssr`, as a sender writes it: `{ tokenType: 'AKAMAI' }`, the integration layer's own field. */
export function tokenizer(data: unknown): typeof tokenize | null {
  const tokenType = (data as { tokenType?: unknown } | null)?.tokenType;
  return tokenType === 'AKAMAI' ? tokenize : null;
}
