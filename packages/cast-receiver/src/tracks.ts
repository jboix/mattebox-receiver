/**
 * Cast track ids. A sender names tracks by number, and `EDIT_TRACKS_INFO`
 * arrives long after the list went out, so an id is assigned once per load
 * and never moves: the sender's own tracks keep the ids the sender gave
 * them, and the engine's audio and text tracks, or a native session's text
 * tracks, take the next free numbers in the order they first appear.
 *
 * Pure: the engine's tracks and the video's text tracks come in as plain
 * data, so the node tests cover it.
 */
import type { MediaTrack } from './framework.js';
import type { CastLoadTrack } from './types.js';

/** An engine track, by what the library reads of it. The engine's `Track` satisfies it. */
export interface EngineTrackView {
  readonly id: string;
  readonly contentType: string;
  readonly mimeType: string;
  readonly lang?: string;
  readonly role?: string;
}

/** One of the video's own text tracks, by position in `video.textTracks`. */
export interface TextTrackView {
  readonly kind: string;
  readonly label: string;
  readonly language: string;
}

/** Where a Cast track id leads. */
export type TrackTarget =
  | { readonly origin: 'engine'; readonly contentType: 'audio' | 'text'; readonly trackId: string }
  /** A text track of the video's own: the sender's, once the page put it there, or a native session's. */
  | {
      readonly origin: 'video';
      readonly kind: string;
      readonly label: string;
      readonly language: string;
    };

interface Entry {
  readonly track: MediaTrack;
  readonly target: TrackTarget;
}

export interface TrackIds {
  /** The Cast tracks for what the session has now. Ids already given are kept. */
  sync(engine: readonly EngineTrackView[] | null, text: readonly TextTrackView[]): MediaTrack[];
  target(id: number): TrackTarget | null;
  /** The Cast id of an engine track, or of a text track of the video's own, once `sync` has seen it. */
  idOf(target: TrackTarget): number | null;
  /** The first text track in a language, by its primary subtag: `fr` finds `fr-CH`. */
  byLanguage(language: string): TrackTarget | null;
}

function keyOf(target: TrackTarget): string {
  return target.origin === 'engine'
    ? `engine:${target.trackId}`
    : `video:${target.kind}:${target.language}:${target.label}`;
}

function subtitles(kind: string): boolean {
  return kind === 'subtitles' || kind === 'captions';
}

export function createTrackIds(sender: readonly CastLoadTrack[]): TrackIds {
  const entries = new Map<string, Entry>();
  let next = 1;

  function add(target: TrackTarget, track: Omit<MediaTrack, 'trackId'>, id?: number): void {
    const key = keyOf(target);
    if (entries.has(key)) return;
    const trackId = id ?? next;
    next = Math.max(next, trackId + 1);
    entries.set(key, { target, track: { ...track, trackId } });
  }

  // The sender's first, under the sender's ids. The page puts each on the
  // video as a `<track>`, so its target is the video's text track of the
  // same kind, language and label.
  for (const track of sender) {
    add(
      { origin: 'video', kind: track.kind, label: track.name, language: track.language },
      {
        type: 'TEXT',
        subtype: track.kind === 'captions' ? 'CAPTIONS' : 'SUBTITLES',
        trackContentId: track.url,
        trackContentType: track.type,
        name: track.name,
        language: track.language,
      },
      track.id,
    );
  }

  function sync(
    engine: readonly EngineTrackView[] | null,
    text: readonly TextTrackView[],
  ): MediaTrack[] {
    const present = new Set<string>();
    for (const track of sender) {
      present.add(
        keyOf({ origin: 'video', kind: track.kind, label: track.name, language: track.language }),
      );
    }
    for (const track of engine ?? []) {
      if (track.contentType !== 'audio' && track.contentType !== 'text') continue;
      const target: TrackTarget = {
        origin: 'engine',
        contentType: track.contentType,
        trackId: track.id,
      };
      const audio = track.contentType === 'audio';
      add(target, {
        type: audio ? 'AUDIO' : 'TEXT',
        ...(audio ? {} : { subtype: track.role === 'caption' ? 'CAPTIONS' : 'SUBTITLES' }),
        trackContentType: track.mimeType,
        // The name a viewer reads: the language, then the role, then the id,
        // the order the player's own menus use.
        name: track.lang ?? track.role ?? track.id,
        language: track.lang ?? '',
      });
      present.add(keyOf(target));
    }
    // An engine session mirrors its text tracks onto the video, and they
    // are listed above under the engine's ids. So the video's own list
    // counts for a native session alone.
    if (engine === null) {
      for (const track of text) {
        if (!subtitles(track.kind)) continue;
        const target: TrackTarget = { origin: 'video', ...track };
        add(target, {
          type: 'TEXT',
          subtype: track.kind === 'captions' ? 'CAPTIONS' : 'SUBTITLES',
          name: track.label !== '' ? track.label : track.language,
          language: track.language,
        });
        present.add(keyOf(target));
      }
    }
    const out: MediaTrack[] = [];
    for (const [key, entry] of entries) if (present.has(key)) out.push(entry.track);
    return out.sort((a, b) => a.trackId - b.trackId);
  }

  function target(id: number): TrackTarget | null {
    for (const entry of entries.values()) if (entry.track.trackId === id) return entry.target;
    return null;
  }

  function idOf(wanted: TrackTarget): number | null {
    return entries.get(keyOf(wanted))?.track.trackId ?? null;
  }

  function byLanguage(language: string): TrackTarget | null {
    const primary = (tag: string): string => tag.toLowerCase().split('-')[0] as string;
    for (const entry of entries.values()) {
      if (entry.track.type !== 'TEXT') continue;
      if (primary(entry.track.language ?? '') === primary(language)) return entry.target;
    }
    return null;
  }

  return { sync, target, idOf, byLanguage };
}
