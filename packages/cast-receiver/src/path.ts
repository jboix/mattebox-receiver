/**
 * The status path: how the senders get their media status, and who applies
 * the playback commands. One interface, and nothing above this module
 * changes with what is behind it. The finding came from Google's real script,
 * run in a desktop browser with the device's platform faked.
 *
 * The framework reports from a media element only after it has loaded that
 * element itself: it assigns the content's URL to `src`, which would wipe
 * the MediaSource the engine attached, and it waits for the load events.
 * An interceptor that answers `LOAD` with null leaves the framework loading
 * forever, and it drops every later command.
 *
 * So the framework is given a stand-in for the video. The stand-in is the
 * video for every read, every event and every playback call: play, pause,
 * `volume` and `playbackRate` land on the real video, called
 * by the framework. It differs in two things. It keeps the framework's
 * `src`, `load()` and `autoplay` to itself, and tells the framework's
 * listeners the load events the video fired before the framework listened.
 * And it drops the framework's `currentTime`: the start of a session is
 * the engine's, and a seek is the library's. Nothing the page sees is wrapped.
 *
 * The outgoing status passes the library's interceptor, which writes the
 * reads over it.
 */
import type {
  CastReceiverOptions,
  EditTracksInfoRequestData,
  LoadRequestData,
  MediaStatus,
  PlaybackRateRequestData,
  PlayerManager,
  SeekRequestData,
} from './framework.js';
import { EDIT_TRACKS_INFO, MEDIA_STATUS, SEEK, SET_PLAYBACK_RATE, STOP } from './framework.js';

/** What the path asks of the receiver. Every command is already bound to the player. */
export interface PathCommands {
  seek(request: SeekRequestData): void;
  setPlaybackRate(request: PlaybackRateRequestData): void;
  /** Selects what the library can, and returns the ids left for the framework: the sender's own text tracks. */
  editTracks(request: EditTracksInfoRequestData): number[] | null;
  stop(): void;
  writeStatus(status: MediaStatus): void;
}

export interface Path {
  /** For `CastReceiverContext.start`. */
  readonly options: CastReceiverOptions;
  /** What the `LOAD` interceptor returns once the player holds the source. */
  loaded(request: LoadRequestData, live: boolean): LoadRequestData;
  /** Something changed that the framework cannot see: the tracks, the selection. */
  changed(requestId?: number): void;
  /** The receiver went idle by itself: an error, or the end. The framework's own player follows. */
  idle(): void;
}

/** What the framework writes on its media element to load and unload, which the video must never see. */
const KEPT = new Set<PropertyKey>(['src', 'autoplay', 'preload']);

/**
 * The events a load fires, in order, each with the `readyState` the video
 * has reached once it fired. The framework waits for them after it assigns
 * `src`.
 */
const LOAD_EVENTS: ReadonlyArray<readonly [string, number]> = [
  ['loadstart', 0],
  ['durationchange', 1],
  ['loadedmetadata', 1],
  ['loadeddata', 2],
  ['canplay', 3],
  ['canplaythrough', 4],
];

/**
 * What the framework is told the content is, so it takes its basic player
 * and never waits for the Shaka or MPL it did not load. It picks by the
 * type and by the URL's extension, so both are masked. The stand-in keeps
 * the URL off the video, and the status interceptor gives the senders the
 * real ones back.
 */
const MASK_TYPE = 'video/mp4';
const MASK_URL = 'about:blank#mattebox';

type Listen = (name: string, fn: EventListener, options?: unknown) => void;

function standIn(video: HTMLMediaElement): HTMLMediaElement {
  const kept = new Map<PropertyKey, unknown>();
  const listeners = new Map<string, EventListener[]>();

  /**
   * Tells the framework's listeners what the video already fired, and no
   * more than that. An engine session exists once its manifest parsed, before
   * the video has its metadata: those events are still to come, and they
   * reach the framework from the video itself.
   */
  function replay(): void {
    for (const [name, reached] of LOAD_EVENTS) {
      if (video.readyState < reached) return;
      for (const fn of [...(listeners.get(name) ?? [])]) fn.call(video, new Event(name));
    }
  }

  const listen: Listen = (name, fn, options) => {
    listeners.set(name, [...(listeners.get(name) ?? []), fn]);
    video.addEventListener(name, fn, options as AddEventListenerOptions);
  };
  const unlisten: Listen = (name, fn, options) => {
    listeners.set(
      name,
      (listeners.get(name) ?? []).filter((held) => held !== fn),
    );
    video.removeEventListener(name, fn, options as EventListenerOptions);
  };

  const own: Record<PropertyKey, unknown> = {
    addEventListener: listen,
    removeEventListener: unlisten,
    load: () => undefined,
    setAttribute: (name: string, value: string) => kept.set(name, value),
    removeAttribute: (name: string) => kept.delete(name),
    getAttribute: (name: string) => kept.get(name) ?? null,
  };

  return new Proxy(video, {
    get(target, key) {
      if (key in own) return own[key];
      if (KEPT.has(key)) return kept.get(key) ?? '';
      // Plain member access on the video: WebKit's accessors refuse the receiver `Reflect` passes.
      const value: unknown = (target as unknown as Record<PropertyKey, unknown>)[key];
      return typeof value === 'function' ? value.bind(target) : value;
    },
    set(target, key, value) {
      // The framework ends its load with a write of the request's time, and
      // of zero when the request has none. The start is the engine's: the
      // edge of a live window, or the first second a stream has, which is
      // not always zero. A write of zero takes the playhead off either, and
      // before the buffer a browser stalls. The sender's own time is sought
      // by the bridge, and a sender's SEEK is the library's, so no write of
      // the framework's is wanted.
      if (key === 'currentTime') return true;
      if (!KEPT.has(key)) {
        (target as unknown as Record<PropertyKey, unknown>)[key] = value;
        return true;
      }
      kept.set(key, value);
      // After the assignment returns, the way a real load fires its events.
      if (key === 'src' && value !== '') setTimeout(replay, 0);
      return true;
    },
  });
}

export function installPath(
  manager: PlayerManager,
  video: HTMLMediaElement,
  commands: PathCommands,
): Path {
  function changed(requestId?: number): void {
    manager.broadcastStatus(true, requestId);
  }

  manager.setMessageInterceptor(MEDIA_STATUS, (status: MediaStatus) => {
    commands.writeStatus(status);
    return status;
  });

  // The framework ends its own session on STOP, and the stand-in keeps its
  // unload off the video. The player is unloaded here.
  manager.setMessageInterceptor(STOP, (request: object) => {
    commands.stop();
    return request;
  });

  manager.setMessageInterceptor(SET_PLAYBACK_RATE, (request: PlaybackRateRequestData) => {
    commands.setPlaybackRate(request);
    changed(request.requestId);
    return null;
  });

  // The framework knows the sender's text tracks, which it puts on the video
  // itself, and none of the engine's. It gets the ids it knows.
  manager.setMessageInterceptor(EDIT_TRACKS_INFO, (request: EditTracksInfoRequestData) => {
    const left = commands.editTracks(request);
    if (left === null) {
      changed(request.requestId);
      return null;
    }
    // The framework answers the request itself once it has done its part.
    // On the framework's own object, as with LOAD.
    request.activeTrackIds = left;
    return request;
  });

  // A seek is the library's. On a live session the end of the range means
  // the engine's edge, and on any session the stand-in keeps the framework's
  // `currentTime` off the video.
  manager.setMessageInterceptor(SEEK, (request: SeekRequestData) => {
    commands.seek(request);
    changed(request.requestId);
    return null;
  });

  return {
    // Through the options: the context replaces an element set on the manager before it starts.
    options: { mediaElement: standIn(video) },
    loaded(request, live) {
      // Written on the framework's own object, never on a copy: it keeps
      // what it needs to answer the sender on the message it handed over,
      // and a copy leaves every later command unanswered.
      if (request.media !== undefined) {
        request.media.contentType = MASK_TYPE;
        // `contentUrl` wins over `contentId` in the framework, and the id stays the sender's.
        request.media.contentUrl = MASK_URL;
      }
      // The sender's time means nothing on a live timeline, and the framework would seek to it.
      if (live) delete request.currentTime;
      return request;
    },
    changed,
    idle() {
      manager.stop();
    },
  };
}
