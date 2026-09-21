/**
 * The slice of Google's receiver framework (CAF, version 3) the library
 * reads. No `@types/chromecast-caf-receiver`: the framework is a script the
 * page loads, never a dependency, and these names are what that script puts
 * on `window.cast`. The message types are strings on the wire, so the
 * library names them itself and reads no enum from the framework.
 */

export interface MediaTrack {
  readonly trackId: number;
  /** `TEXT`, `AUDIO` or `VIDEO`. */
  readonly type: string;
  readonly trackContentId?: string;
  readonly trackContentType?: string;
  /** For a text track: `SUBTITLES`, `CAPTIONS`, `DESCRIPTIONS`, `CHAPTERS` or `METADATA`. */
  readonly subtype?: string;
  readonly name?: string;
  readonly language?: string;
}

export interface MediaMetadata {
  readonly metadataType?: number;
  readonly title?: string;
  readonly subtitle?: string;
  readonly images?: ReadonlyArray<{ readonly url?: string }> | null;
}

export interface MediaInformation {
  contentId?: string;
  contentUrl?: string;
  contentType?: string;
  /** `BUFFERED`, `LIVE` or `NONE`. */
  streamType?: string;
  tracks?: MediaTrack[] | null;
  metadata?: MediaMetadata | null;
  hlsSegmentFormat?: string;
  hlsVideoSegmentFormat?: string;
  duration?: number;
  customData?: unknown;
}

/** What every request from a sender carries. */
export interface RequestData {
  readonly requestId?: number;
  readonly mediaSessionId?: number;
  readonly customData?: unknown;
}

export interface LoadRequestData extends RequestData {
  readonly media?: MediaInformation;
  /** Writable: the library takes it off a live load before the framework reads it. */
  currentTime?: number;
  readonly autoplay?: boolean;
  readonly activeTrackIds?: readonly number[] | null;
  readonly playbackRate?: number;
}

export interface SeekRequestData extends RequestData {
  readonly currentTime?: number;
  readonly relativeTime?: number;
  /** `PLAYBACK_START` or `PLAYBACK_PAUSE`. Absent keeps the state. */
  readonly resumeState?: string;
}

export interface PlaybackRateRequestData extends RequestData {
  readonly playbackRate?: number;
  readonly relativePlaybackRate?: number;
}

export interface EditTracksInfoRequestData extends RequestData {
  /** Writable: the library leaves the framework the ids it knows. */
  activeTrackIds?: readonly number[] | null;
  readonly language?: string;
  readonly enableTextTracks?: boolean;
}

export interface LiveSeekableRange {
  start: number;
  end: number;
  isMovingWindow: boolean;
  isLiveDone: boolean;
}

/** The outgoing `MEDIA_STATUS`, as its interceptor sees it. Mutable: the library writes its reads over it. */
export interface MediaStatus {
  type?: string;
  requestId?: number;
  mediaSessionId?: number;
  /** `IDLE`, `PLAYING`, `PAUSED` or `BUFFERING`. */
  playerState?: string;
  /** `CANCELLED`, `INTERRUPTED`, `FINISHED` or `ERROR`, with `IDLE`. */
  idleReason?: string;
  currentTime?: number;
  playbackRate?: number;
  supportedMediaCommands?: number;
  volume?: { level?: number; muted?: boolean };
  media?: MediaInformation;
  activeTrackIds?: number[];
  liveSeekableRange?: LiveSeekableRange;
  customData?: unknown;
}

export interface ErrorData {
  type: string;
  reason?: string;
  requestId?: number;
  customData?: unknown;
}

/** An interceptor returns the message to let the framework go on, or null to answer for it. */
export type Interceptor<T> = (message: T) => T | ErrorData | null | Promise<T | ErrorData | null>;

export interface PlayerManager {
  /** `never`: every interceptor is assignable, whatever message it reads. */
  setMessageInterceptor(type: string, interceptor: (message: never) => unknown): void;
  broadcastStatus(includeMedia?: boolean, requestId?: number, customData?: unknown): void;
  sendError(
    senderId: string,
    requestId: number,
    type: string,
    reason?: string,
    customData?: unknown,
  ): void;
  /** Ends the framework's own media session, as a `STOP` from a sender does. */
  stop(): void;
}

export interface CustomMessageEvent {
  readonly senderId: string;
  readonly data: unknown;
}

export interface CastReceiverOptions {
  /** The element the framework's own player drives. Default: the first media element in the page. */
  mediaElement?: HTMLMediaElement;
  skipPlayersLoad?: boolean;
  customNamespaces?: Record<string, string>;
  supportedCommands?: number;
  statusText?: string;
}

export interface CastReceiverContext {
  getPlayerManager(): PlayerManager;
  addCustomMessageListener(namespace: string, listener: (event: CustomMessageEvent) => void): void;
  getSenders(): ReadonlyArray<{ readonly id: string }>;
  /** Null until the context is ready. */
  getDeviceCapabilities(): Readonly<Record<string, unknown>> | null;
  canDisplayType(
    mimeType: string,
    codecs?: string,
    width?: number,
    height?: number,
    framerate?: number,
  ): boolean;
  addEventListener(type: string, listener: () => void): void;
  start(options?: CastReceiverOptions): unknown;
  stop(): void;
}

export interface DebugLogger {
  setEnabled(enabled: boolean): void;
  showDebugLogs(show: boolean): void;
  /** What the overlay logs: an event type or an event category, to a `cast.framework.LoggerLevel`. Nothing by default. */
  loggerLevelByEvents: Record<string, number>;
}

/** `cast.framework.LoggerLevel.INFO`. */
export const LOGGER_INFO = 800;
/** `cast.framework.events.category.CORE`: the load, the playback and the error events. */
export const CORE_EVENTS = 'cast.framework.events.category.CORE';

interface CastGlobal {
  readonly framework?: {
    readonly CastReceiverContext?: { getInstance(): CastReceiverContext };
  };
  readonly debug?: {
    readonly CastDebugLogger?: { getInstance(): DebugLogger };
  };
}

function cast(): CastGlobal | undefined {
  return (globalThis as { cast?: CastGlobal }).cast;
}

/** The page's one context, or null on a page without the framework. */
export function receiverContext(): CastReceiverContext | null {
  return cast()?.framework?.CastReceiverContext?.getInstance() ?? null;
}

/** The debug logger, or null when the page did not load its script. */
export function debugLogger(): DebugLogger | null {
  return cast()?.debug?.CastDebugLogger?.getInstance() ?? null;
}

/** The message types the library intercepts, as they go over the wire. */
export const LOAD = 'LOAD';
export const SEEK = 'SEEK';
export const STOP = 'STOP';
export const SET_PLAYBACK_RATE = 'SET_PLAYBACK_RATE';
export const EDIT_TRACKS_INFO = 'EDIT_TRACKS_INFO';
export const MEDIA_STATUS = 'MEDIA_STATUS';
/** `cast.framework.system.EventType.READY`. */
export const READY = 'ready';

/** `cast.framework.messages.Command`: pause 1, seek 2, stream volume 4, stream mute 8, edit tracks 4096, playback rate 8192. */
export const COMMANDS = 1 | 2 | 4 | 8 | 4096 | 8192;
/** Live without a window worth seeking: no seek. */
export const SEEK_COMMAND = 2;
