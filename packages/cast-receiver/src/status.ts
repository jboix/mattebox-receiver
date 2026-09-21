/**
 * The media status, read and never kept: the current time and the duration
 * from the video, the live range from the engine, the player state from the
 * video and the player's `waiting`, the tracks from the engine or the
 * video. Whichever path sends it, the status is a function of these reads.
 */
import type { Mattebox } from 'mattebox';
import type { LiveSeekableRange, MediaStatus, MediaTrack } from './framework.js';
import { COMMANDS, SEEK_COMMAND } from './framework.js';
import type { TextTrackView, TrackIds } from './tracks.js';
import type { CastLoad, IdleReason, ReceiverPlayer } from './types.js';

/**
 * Declared here because it cannot be imported: `LiveApi` is in the engine's
 * `dist/protocols/live-shared.d.ts`, which its `exports` do not reach. The
 * player carries the same copy, for the same reason.
 */
export interface LiveApi {
  readonly edge: number | null;
  readonly atEdge: boolean;
  seekToEdge(): void;
}

/** The engine's live namespace, once the presentation has an edge. The presets compose it for VOD too. */
export function live(engine: Mattebox | null): LiveApi | null {
  const api = (engine as { live?: LiveApi } | null)?.live;
  return api !== undefined && api.edge !== null ? api : null;
}

export type PlayerState = 'IDLE' | 'PLAYING' | 'PAUSED' | 'BUFFERING';

export function playerState(reads: {
  readonly loaded: boolean;
  readonly paused: boolean;
  readonly ended: boolean;
  readonly waiting: boolean;
}): PlayerState {
  if (!reads.loaded || reads.ended) return 'IDLE';
  if (reads.paused) return 'PAUSED';
  return reads.waiting ? 'BUFFERING' : 'PLAYING';
}

/**
 * The live range: the engine's own availability window, where the session
 * offers it, because the video's seekable range on a live MediaSource also
 * covers what is buffered behind the window. The video's otherwise.
 */
export function liveRange(
  video: HTMLVideoElement,
  engine: Mattebox | null,
): LiveSeekableRange | null {
  if (live(engine) === null && Number.isFinite(video.duration)) return null;
  const own = live(engine) === null ? null : (engine?.stats.snapshot().live?.span ?? null);
  const seekable = video.seekable;
  const last = seekable.length - 1;
  const span =
    own !== null && own.end > own.start
      ? own
      : last >= 0
        ? { start: seekable.start(last), end: seekable.end(last) }
        : null;
  if (span === null) return null;
  return { start: span.start, end: span.end, isMovingWindow: true, isLiveDone: false };
}

export function textTracks(video: HTMLVideoElement): TextTrackView[] {
  const out: TextTrackView[] = [];
  for (const track of Array.from(video.textTracks)) {
    out.push({ kind: track.kind, label: track.label, language: track.language });
  }
  return out;
}

/** The Cast tracks and the active ones among them, for the session the player holds. */
export function readTracks(
  player: ReceiverPlayer,
  ids: TrackIds,
): { tracks: MediaTrack[]; active: number[] } {
  const engine = player.engine;
  const tracks = ids.sync(
    engine === null ? null : engine.tracks.available,
    textTracks(player.video),
  );
  const active: number[] = [];
  const audio = engine?.tracks.active('audio') ?? null;
  if (audio !== null) {
    const id = ids.idOf({ origin: 'engine', contentType: 'audio', trackId: audio.id });
    if (id !== null) active.push(id);
  }
  const text = engine?.tracks.active('text') ?? null;
  if (text !== null) {
    const id = ids.idOf({ origin: 'engine', contentType: 'text', trackId: text.id });
    if (id !== null) active.push(id);
  }
  for (const track of Array.from(player.video.textTracks)) {
    if (track.mode !== 'showing') continue;
    const id = ids.idOf({
      origin: 'video',
      kind: track.kind,
      label: track.label,
      language: track.language,
    });
    if (id !== null && !active.includes(id)) active.push(id);
  }
  return { tracks, active };
}

/** What the status needs beyond the reads: the load it answers for, and why it is idle when it is. */
export interface StatusContext {
  readonly load: CastLoad | null;
  readonly ids: TrackIds | null;
  readonly mediaSessionId: number;
  readonly idleReason: IdleReason | null;
}

const IDLE_REASONS: Readonly<Record<IdleReason, string>> = {
  stopped: 'CANCELLED',
  finished: 'FINISHED',
  error: 'ERROR',
};

/** Writes the reads over an outgoing status. The framework's own fields stay where the library has no read. */
export function writeStatus(
  status: MediaStatus,
  player: ReceiverPlayer,
  context: StatusContext,
): void {
  const video = player.video;
  const engine = player.engine;
  const loaded = context.load !== null && player.player?.session != null;
  const state = playerState({
    loaded,
    paused: video.paused,
    ended: video.ended,
    waiting: player.hasAttribute('waiting'),
  });
  status.playerState = state;
  if (status.mediaSessionId === undefined) status.mediaSessionId = context.mediaSessionId;
  if (state === 'IDLE') {
    const reason = video.ended && loaded ? 'finished' : context.idleReason;
    if (reason !== null) status.idleReason = IDLE_REASONS[reason];
  } else {
    delete status.idleReason;
  }
  status.currentTime = video.currentTime;
  status.playbackRate = video.playbackRate;
  status.volume = { level: video.volume, muted: video.muted };

  const range = loaded ? liveRange(video, engine) : null;
  if (range === null) delete status.liveSeekableRange;
  else status.liveSeekableRange = range;
  // A live stream with no window has nowhere to seek to.
  const seekable = range === null ? Number.isFinite(video.duration) : range.end > range.start;
  status.supportedMediaCommands = seekable ? COMMANDS : COMMANDS & ~SEEK_COMMAND;

  if (context.load === null || context.ids === null || !loaded) return;
  const source = player.player?.session?.source;
  const media = status.media ?? {};
  media.contentId = context.load.url;
  // The framework was given a masked URL to load. The senders never see it.
  delete media.contentUrl;
  const type = source?.type ?? context.load.type;
  if (type !== undefined) media.contentType = type;
  media.streamType = range === null ? 'BUFFERED' : 'LIVE';
  if (Number.isFinite(video.duration)) media.duration = video.duration;
  else delete media.duration;
  const { title, subtitle, images } = context.load.metadata;
  // The generic metadata type, 0. What the sender sent, given back.
  media.metadata = {
    metadataType: 0,
    ...(title === undefined ? {} : { title }),
    ...(subtitle === undefined ? {} : { subtitle }),
    images: images.map((url) => ({ url })),
  };
  const read = readTracks(player, context.ids);
  media.tracks = read.tracks;
  status.media = media;
  status.activeTrackIds = read.active;
}
