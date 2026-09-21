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
  const out: { licenseUrl?: string; licenseHeaders?: Record<string, string>; thumbnails?: string } =
    {};
  if (typeof own.licenseUrl === 'string') out.licenseUrl = own.licenseUrl;
  if (typeof own.thumbnails === 'string') out.thumbnails = own.thumbnails;
  const headers = record(own.licenseHeaders);
  if (headers !== null) {
    const kept: Record<string, string> = {};
    for (const [name, value] of Object.entries(headers)) {
      if (typeof value === 'string') kept[name] = value;
    }
    out.licenseHeaders = kept;
  }
  return out;
}

/** A hook that adds `headers` to the requests for `url` and to no other. */
export function headersFor(url: string, headers: Readonly<Record<string, string>>): RequestHook {
  return (request) => {
    if (request.url !== url) return;
    for (const [name, value] of Object.entries(headers)) request.headers[name] = value;
  };
}

export function defaultResolve(load: CastLoad): Load {
  const { licenseUrl, licenseHeaders, thumbnails } = matteboxData(load.customData);
  const hooked =
    licenseUrl !== undefined && licenseHeaders !== undefined
      ? [headersFor(licenseUrl, licenseHeaders)]
      : [];
  return {
    url: load.url,
    ...(load.type === undefined ? {} : { type: load.type }),
    ...(licenseUrl === undefined ? {} : { licenseUrl }),
    ...(thumbnails === undefined ? {} : { thumbnails }),
    ...(hooked.length === 0 ? {} : { requestHooks: hooked }),
  };
}
