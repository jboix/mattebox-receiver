/**
 * The `LOAD` request as the library reads it. Pure: the framework's shapes
 * in, a `CastLoad` out, so the node tests cover every field a sender can
 * leave out.
 */
import type { LoadRequestData, MediaTrack } from './framework.js';
import type { CastLoad, CastLoadTrack } from './types.js';

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** The sender's text tracks. Audio and video tracks come from the manifest, never from the sender. */
function tracks(list: readonly MediaTrack[] | null | undefined): CastLoadTrack[] {
  const out: CastLoadTrack[] = [];
  for (const track of list ?? []) {
    const url = text(track.trackContentId);
    if (track.type !== 'TEXT' || url === undefined) continue;
    out.push({
      id: track.trackId,
      url,
      type: text(track.trackContentType) ?? 'text/vtt',
      kind: track.subtype === 'CAPTIONS' ? 'captions' : 'subtitles',
      name: track.name ?? '',
      language: track.language ?? '',
    });
  }
  return out;
}

/**
 * Reads a `LOAD` request. `contentUrl` wins over `contentId` when a sender
 * gives both, which is the framework's own rule. The request's `customData`
 * wins over the media's: the player's sender sets it on the request.
 */
export function toCastLoad(request: LoadRequestData): CastLoad {
  const media = request.media ?? {};
  const metadata = media.metadata ?? {};
  const type = text(media.contentType);
  const title = text(metadata.title);
  const subtitle = text(metadata.subtitle);
  const format = text(media.hlsSegmentFormat);
  const images: string[] = [];
  for (const image of metadata.images ?? []) {
    const url = text(image.url);
    if (url !== undefined) images.push(url);
  }
  return {
    url: text(media.contentUrl) ?? text(media.contentId) ?? '',
    ...(type === undefined ? {} : { type }),
    streamType: media.streamType === 'LIVE' ? 'live' : 'buffered',
    currentTime:
      typeof request.currentTime === 'number' && request.currentTime > 0 ? request.currentTime : 0,
    // The framework's default: a request that does not say plays.
    autoplay: request.autoplay !== false,
    tracks: tracks(media.tracks),
    metadata: {
      ...(title === undefined ? {} : { title }),
      ...(subtitle === undefined ? {} : { subtitle }),
      images,
    },
    ...(format === undefined ? {} : { hlsSegmentFormat: format }),
    customData: request.customData ?? media.customData ?? null,
  };
}
