/**
 * A Cast command becomes a call on the video or on the engine, never on a
 * wrapper: play, pause, seek, volume and rate are the video's, and track
 * selection is the engine's, or the video's text tracks for a native session.
 */
import type {
  EditTracksInfoRequestData,
  PlaybackRateRequestData,
  SeekRequestData,
} from './framework.js';
import { live, liveRange } from './status.js';
import type { TrackIds, TrackTarget } from './tracks.js';
import type { ReceiverPlayer } from './types.js';

/** How close to the end of the live range a seek has to land to mean the edge, in seconds. */
const EDGE_TOLERANCE = 1;

export function play(player: ReceiverPlayer): void {
  // A rejected play is the autoplay policy or a load that lost; the status says which state holds.
  player.video.play().catch(() => undefined);
}

export function seek(player: ReceiverPlayer, request: SeekRequestData): void {
  const video = player.video;
  const engine = player.engine;
  const target =
    typeof request.currentTime === 'number'
      ? request.currentTime
      : typeof request.relativeTime === 'number'
        ? video.currentTime + request.relativeTime
        : null;
  if (target !== null) {
    const range = liveRange(video, engine);
    const api = live(engine);
    // A seek to the end of a live stream is a seek to the edge, and the
    // engine knows where that is better than the range's last second does.
    if (api !== null && range !== null && target >= range.end - EDGE_TOLERANCE) api.seekToEdge();
    else video.currentTime = range === null ? target : Math.max(range.start, target);
  }
  if (request.resumeState === 'PLAYBACK_START') play(player);
  else if (request.resumeState === 'PLAYBACK_PAUSE') player.video.pause();
}

export function setPlaybackRate(player: ReceiverPlayer, request: PlaybackRateRequestData): void {
  const video = player.video;
  if (typeof request.playbackRate === 'number' && request.playbackRate > 0) {
    video.playbackRate = request.playbackRate;
  } else if (typeof request.relativePlaybackRate === 'number' && request.relativePlaybackRate > 0) {
    video.playbackRate = video.playbackRate * request.relativePlaybackRate;
  }
}

function matches(track: TextTrack, target: TrackTarget): boolean {
  return (
    target.origin === 'video' &&
    track.kind === target.kind &&
    track.label === target.label &&
    track.language === target.language
  );
}

/**
 * `EDIT_TRACKS_INFO`: the ids name what plays. An audio id selects that
 * track. The text id selects that track, and a list with no text id turns
 * text off. A text track of the video's own is shown through its `mode`,
 * which is all a native session has. There is no audio choice on a native
 * session: Chromium never shipped `AudioTrackList`.
 *
 * Returns what is left for the framework: the ids of the sender's own text
 * tracks, which it put on the video and shows by itself. Null when the
 * request was the library's alone. The library sets their `mode` too, which
 * is all a page without the framework has.
 */
export function editTracks(
  player: ReceiverPlayer,
  ids: TrackIds,
  request: EditTracksInfoRequestData,
): number[] | null {
  const engine = player.engine;
  const wanted = request.activeTrackIds ?? null;
  /** The ids of the video's own text tracks: the ones the framework knows, because a sender sent them. */
  const own = (wanted ?? []).filter((id) => ids.target(id)?.origin === 'video');
  if (typeof request.language === 'string' && request.language !== '') {
    // A language wins over the ids, which is the framework's own rule.
    const found = ids.byLanguage(request.language);
    if (found !== null) showText(player, found);
    return found?.origin === 'engine' ? null : own;
  }
  if (wanted === null) {
    if (request.enableTextTracks !== false) return null;
    textOff(player, null);
    return [];
  }
  let text: TrackTarget | null = null;
  for (const id of wanted) {
    const target = ids.target(id);
    if (target === null) continue;
    if (target.origin === 'engine' && target.contentType === 'audio') {
      if (engine?.tracks.active('audio')?.id !== target.trackId)
        engine?.tracks.select(target.trackId);
    } else {
      text = target;
    }
  }
  if (text === null || request.enableTextTracks === false) textOff(player, null);
  else showText(player, text);
  return own;
}

function showText(player: ReceiverPlayer, text: TrackTarget): void {
  if (text.origin === 'engine') {
    // The engine shows its own track on the video and disables the others.
    player.engine?.tracks.select(text.trackId);
    return;
  }
  textOff(player, text);
  for (const track of Array.from(player.video.textTracks)) {
    if (matches(track, text)) track.mode = 'showing';
  }
}

/** Turns every subtitle track off except `keep`: the engine's pipeline, and the video's own tracks. */
function textOff(player: ReceiverPlayer, keep: TrackTarget | null): void {
  const engine = player.engine;
  if (engine !== null && engine.tracks.active('text') !== null) engine.tracks.deselect('text');
  for (const track of Array.from(player.video.textTracks)) {
    if (track.kind !== 'subtitles' && track.kind !== 'captions') continue;
    if (keep !== null && matches(track, keep)) continue;
    if (track.mode === 'showing') track.mode = 'disabled';
  }
}
