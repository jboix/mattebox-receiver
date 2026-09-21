/**
 * SRG SSR content through the integration layer (IL), as a sender uses it:
 * search by business unit, resolve a URN to its media composition, and list
 * the resources a viewer can be sent. The playground picks one and sends the
 * receiver its URL, its Widevine license URL, and whether it needs a token.
 * The receiver never calls the IL. Copied from the player demo's `srgssr.ts`,
 * less the token and FairPlay, which are the receiver's and Safari's.
 */

const IL_HOST = 'il.srgssr.ch';
export const BUSINESS_UNITS = ['srf', 'rts', 'rsi', 'rtr', 'swi'] as const;
export type BusinessUnit = (typeof BUSINESS_UNITS)[number];

export interface SearchResult {
  readonly title: string;
  readonly urn: string;
  readonly mediaType: string;
  readonly date: string;
  /** Milliseconds. */
  readonly duration: number;
}

export async function searchMedia(
  bu: BusinessUnit,
  query: string,
  signal: AbortSignal,
): Promise<SearchResult[]> {
  const params = new URLSearchParams({
    vector: 'srgplay',
    includeAggregations: 'false',
    includeSuggestions: 'false',
    sortBy: 'default',
    sortDir: 'desc',
    pageSize: '20',
    q: query,
  });
  const url = `https://${IL_HOST}/integrationlayer/2.0/${bu}/searchResultMediaList?${params}`;
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`search failed: HTTP ${response.status}`);
  const data = (await response.json()) as { searchResultMediaList?: SearchResult[] };
  return (data.searchResultMediaList ?? []).map(({ title, urn, mediaType, date, duration }) => ({
    title,
    urn,
    mediaType,
    date,
    duration,
  }));
}

interface DrmEntry {
  readonly type: 'WIDEVINE' | 'PLAYREADY' | 'FAIRPLAY';
  readonly licenseUrl: string;
}

/** One playable resource of a chapter, as the IL describes it. */
export interface IlResource {
  readonly url: string;
  readonly streaming: string;
  readonly quality: string;
  readonly presentation: string;
  readonly mimeType: string;
  readonly mediaContainer?: string;
  readonly dvr?: boolean;
  readonly live?: boolean;
  readonly tokenType?: string;
  readonly drmList?: readonly DrmEntry[];
}

export interface Composition {
  readonly title: string;
  readonly imageUrl?: string;
  readonly resources: readonly IlResource[];
}

export async function fetchComposition(urn: string, signal: AbortSignal): Promise<Composition> {
  const url = `https://${IL_HOST}/integrationlayer/2.1/mediaComposition/byUrn/${encodeURIComponent(
    urn,
  )}?onlyChapters=true&vector=portalplay`;
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`media composition failed: HTTP ${response.status}`);
  const data = (await response.json()) as {
    chapterUrn: string;
    chapterList?: Array<{
      urn: string;
      title: string;
      imageUrl?: string;
      resourceList?: IlResource[];
    }>;
  };
  const chapter = (data.chapterList ?? []).find((c) => c.urn === data.chapterUrn);
  if (chapter === undefined) throw new Error('media composition has no main chapter');
  return {
    title: chapter.title,
    ...(chapter.imageUrl === undefined ? {} : { imageUrl: chapter.imageUrl }),
    resources: chapter.resourceList ?? [],
  };
}

/** A Chromecast is Widevine: the license URL a protected resource is sent with, or null when it has none. */
export function widevine(resource: IlResource): string | null {
  return (resource.drmList ?? []).find((entry) => entry.type === 'WIDEVINE')?.licenseUrl ?? null;
}
