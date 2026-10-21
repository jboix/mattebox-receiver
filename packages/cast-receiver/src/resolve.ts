/**
 * The default resolver: a passthrough with one convention,
 * `customData.mattebox`. Nothing else is read from `customData`. A page
 * whose sender puts a token there resolves it in its own `resolve`.
 */
import type { CastLoad, Load, MatteboxCustomData, RequestHook } from './types.js';

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

/** `customData.mattebox`, with every member that is not of its type dropped. */
export function matteboxData(customData: unknown): MatteboxCustomData {
  const own = record(record(customData)?.mattebox);
  if (own === null) return {};
  const out: {
    licenseUrl?: string;
    licenseUrls?: Record<string, string>;
    certificateUrl?: string;
    licenseHeaders?: Record<string, string>;
    thumbnails?: string;
  } = {};
  if (typeof own.licenseUrl === 'string') out.licenseUrl = own.licenseUrl;
  if (typeof own.certificateUrl === 'string') out.certificateUrl = own.certificateUrl;
  if (typeof own.thumbnails === 'string') out.thumbnails = own.thumbnails;
  const urls = strings(own.licenseUrls);
  if (urls !== null) out.licenseUrls = urls;
  const headers = strings(own.licenseHeaders);
  if (headers !== null) out.licenseHeaders = headers;
  return out;
}

/** The string members of an object, or null when `value` is not one. */
export function strings(value: unknown): Record<string, string> | null {
  const own = record(value);
  if (own === null) return null;
  const kept: Record<string, string> = {};
  for (const [name, member] of Object.entries(own)) {
    if (typeof member === 'string') kept[name] = member;
  }
  return kept;
}

/** Every license server of a load: its `licenseUrl` and each of its `licenseUrls`. */
export function licenseServers(load: {
  readonly licenseUrl?: string;
  readonly licenseUrls?: Readonly<Record<string, string>>;
}): string[] {
  const urls = Object.values(load.licenseUrls ?? {});
  return load.licenseUrl === undefined ? urls : [load.licenseUrl, ...urls];
}

/** A hook that adds `headers` to the requests for `url`, or for any of `url`, and to no other. */
export function headersFor(
  url: string | readonly string[],
  headers: Readonly<Record<string, string>>,
): RequestHook {
  const urls = typeof url === 'string' ? [url] : url;
  return (request) => {
    if (!urls.includes(request.url)) return;
    for (const [name, value] of Object.entries(headers)) request.headers[name] = value;
  };
}

export function defaultResolve(load: CastLoad): Load {
  const data = matteboxData(load.customData);
  const { licenseUrl, licenseUrls, certificateUrl, licenseHeaders, thumbnails } = data;
  const servers = licenseServers(data);
  const hooked =
    servers.length > 0 && licenseHeaders !== undefined ? [headersFor(servers, licenseHeaders)] : [];
  return {
    url: load.url,
    ...(load.type === undefined ? {} : { type: load.type }),
    ...(licenseUrl === undefined ? {} : { licenseUrl }),
    ...(licenseUrls === undefined ? {} : { licenseUrls }),
    ...(certificateUrl === undefined ? {} : { certificateUrl }),
    ...(thumbnails === undefined ? {} : { thumbnails }),
    ...(hooked.length === 0 ? {} : { requestHooks: hooked }),
  };
}
