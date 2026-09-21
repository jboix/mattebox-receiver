/**
 * A faked `cast.framework`, for the tests alone: the package ships no fake
 * context. It behaves the way the real framework was seen to behave where
 * the real script ran against a faked platform (`scripts/spike/`):
 *
 * - It drives the element the start options gave it, or the first media
 *   element in the page.
 * - A `LOAD` its interceptor passes on makes it assign the content's URL to
 *   that element's `src` and wait for `loadedmetadata`. A type it would play
 *   with Shaka or MPL never loads, because `skipPlayersLoad` left them out.
 *   A `LOAD` answered with null leaves it loading, and it drops every
 *   command until a load completes.
 * - It applies play, pause, seek and volume to the element, puts a sender's
 *   text track on it as a `<track>`, and unloads the element on `STOP`.
 * - It sends a status on the element's events while it holds a session.
 * - Every outgoing status passes the `MEDIA_STATUS` interceptor.
 *
 * A test plays the sender through `send`.
 */
import type {
  CastReceiverOptions,
  CustomMessageEvent,
  ErrorData,
  LoadRequestData,
  MediaInformation,
  MediaStatus,
} from '../src/framework.js';

type Interceptor = (message: never) => unknown;

export interface SentError {
  readonly senderId: string;
  readonly requestId: number;
  readonly type: string;
  readonly reason: string | undefined;
  readonly customData: unknown;
}

export interface FakeFramework {
  /** Plays the sender. Resolves with what the interceptor returned, once the framework has handled it. */
  send(type: string, message: object): Promise<unknown>;
  /** A custom message from a sender. */
  custom(namespace: string, senderId: string, data: unknown): void;
  /** Fires a system event, `ready` among them. */
  fire(type: string): void;
  readonly statuses: MediaStatus[];
  readonly errors: SentError[];
  /** The `LOAD` requests the framework got to handle itself, after the interceptor. */
  readonly loads: LoadRequestData[];
  /** The commands the framework dropped because no load had completed. */
  readonly dropped: string[];
  readonly started: CastReceiverOptions[];
  readonly logger: { enabled: boolean; shown: boolean; events: Record<string, number> };
  uninstall(): void;
}

const OWN_PLAYERS = /mpegurl|dash\+xml|ms-sstr/i;

function isError(value: unknown): value is ErrorData {
  const type = (value as ErrorData | null)?.type;
  return type === 'LOAD_FAILED' || type === 'LOAD_CANCELLED' || type === 'ERROR';
}

export function installFakeFramework(): FakeFramework {
  const interceptors = new Map<string, Interceptor>();
  const custom = new Map<string, Array<(event: CustomMessageEvent) => void>>();
  const system = new Map<string, Array<() => void>>();
  const statuses: MediaStatus[] = [];
  const errors: SentError[] = [];
  const loads: LoadRequestData[] = [];
  const dropped: string[] = [];
  const started: CastReceiverOptions[] = [];
  const logger = { enabled: false, shown: false, events: {} as Record<string, number> };
  let element: HTMLMediaElement | null = null;
  /** The framework's own media session: what it loaded, or null while idle or loading. */
  let session: { id: number; media: MediaInformation } | null = null;
  let sessions = 0;
  let idleReason: string | undefined;

  function run<T>(type: string, message: T): unknown {
    const interceptor = interceptors.get(type) as ((message: T) => unknown) | undefined;
    return interceptor === undefined ? message : interceptor(message);
  }

  function broadcast(requestId?: number): void {
    const status: MediaStatus = {
      type: 'MEDIA_STATUS',
      mediaSessionId: sessions,
      playerState:
        session === null || element === null ? 'IDLE' : element.paused ? 'PAUSED' : 'PLAYING',
      currentTime: session === null ? 0 : (element?.currentTime ?? 0),
      ...(session === null ? {} : { media: { ...session.media } }),
      ...(session === null && idleReason !== undefined ? { idleReason } : {}),
      ...(requestId === undefined ? {} : { requestId }),
    };
    const out = run('MEDIA_STATUS', status) as MediaStatus | null;
    if (out !== null) statuses.push(out);
  }

  function unload(reason: string): void {
    if (session === null) return;
    session = null;
    idleReason = reason;
    element?.removeAttribute('src');
    element?.load();
  }

  async function load(request: LoadRequestData): Promise<void> {
    loads.push(request);
    const held = element;
    const media = request.media ?? {};
    if (held === null || OWN_PLAYERS.test(media.contentType ?? '')) {
      // The real framework waits here for a player library that never came.
      await new Promise(() => undefined);
      return;
    }
    sessions += 1;
    const loaded = new Promise((resolve) => {
      held.addEventListener('loadedmetadata', resolve, { once: true });
    });
    held.src = media.contentUrl ?? media.contentId ?? '';
    held.autoplay = request.autoplay !== false;
    await loaded;
    session = { id: sessions, media };
    idleReason = undefined;
    // The real framework writes the time whether the request has one or not: zero without.
    held.currentTime = typeof request.currentTime === 'number' ? request.currentTime : 0;
    if (request.autoplay !== false) void held.play().catch(() => undefined);
    broadcast(request.requestId);
  }

  /** What the framework does itself with a message its interceptor passed on. */
  async function handle(type: string, message: Record<string, unknown>): Promise<void> {
    if (type === 'LOAD') {
      await load(message as LoadRequestData);
      return;
    }
    if (session === null || element === null) {
      dropped.push(type);
      return;
    }
    const requestId = message.requestId as number | undefined;
    if (type === 'PLAY') void element.play().catch(() => undefined);
    else if (type === 'PAUSE') element.pause();
    else if (type === 'SEEK') {
      if (typeof message.relativeTime === 'number') element.currentTime += message.relativeTime;
      else if (typeof message.currentTime === 'number') element.currentTime = message.currentTime;
      if (message.resumeState === 'PLAYBACK_START') void element.play().catch(() => undefined);
      else if (message.resumeState === 'PLAYBACK_PAUSE') element.pause();
    } else if (type === 'SET_VOLUME') {
      const volume = message.volume as { level?: number; muted?: boolean } | undefined;
      if (volume?.level !== undefined) element.volume = volume.level;
      if (volume?.muted !== undefined) element.muted = volume.muted;
    } else if (type === 'STOP') unload('CANCELLED');
    else if (type === 'EDIT_TRACKS_INFO') {
      const wanted = (message.activeTrackIds as number[] | undefined) ?? [];
      for (const track of session.media.tracks ?? []) {
        if (track.type !== 'TEXT' || track.trackContentId === undefined) continue;
        let node = element.querySelector<HTMLTrackElement>(`track[id="${track.trackId}"]`);
        if (node === null) {
          node = document.createElement('track');
          node.id = String(track.trackId);
          node.kind = track.subtype === 'CAPTIONS' ? 'captions' : 'subtitles';
          node.label = track.name ?? '';
          node.srclang = track.language ?? '';
          node.src = track.trackContentId;
          element.appendChild(node);
        }
        node.track.mode = wanted.includes(track.trackId) ? 'showing' : 'disabled';
      }
    } else return;
    broadcast(requestId);
  }

  async function send(type: string, message: object): Promise<unknown> {
    const out = await run(type, message);
    if (isError(out)) {
      // The real one sends the error to the sender, then an idle status with the reason.
      idleReason = 'ERROR';
      broadcast();
    } else if (out !== null) await handle(type, out as Record<string, unknown>);
    return out;
  }

  const manager = {
    setMessageInterceptor(type: string, interceptor: Interceptor): void {
      interceptors.set(type, interceptor);
    },
    broadcastStatus(_includeMedia?: boolean, requestId?: number): void {
      broadcast(requestId);
    },
    sendError(
      senderId: string,
      requestId: number,
      type: string,
      reason?: string,
      customData?: unknown,
    ): void {
      errors.push({ senderId, requestId, type, reason, customData });
    },
    stop(): void {
      // The real one runs the STOP interceptor for its own stop too.
      void send('STOP', { type: 'STOP', requestId: 0 });
    },
  };

  const context = {
    getPlayerManager: () => manager,
    addCustomMessageListener(namespace: string, listener: (event: CustomMessageEvent) => void) {
      if (started.length > 0 && started[0]?.customNamespaces?.[namespace] === undefined) {
        throw new Error('New namespaces can not be requested after start has been called');
      }
      custom.set(namespace, [...(custom.get(namespace) ?? []), listener]);
    },
    getSenders: () => [{ id: 'sender-1' }, { id: 'sender-2' }],
    getDeviceCapabilities: () => (started.length > 0 ? { is_hdr_supported: false } : null),
    canDisplayType: () => false,
    addEventListener(type: string, listener: () => void): void {
      system.set(type, [...(system.get(type) ?? []), listener]);
    },
    start(options: CastReceiverOptions = {}): void {
      started.push(options);
      element = options.mediaElement ?? document.querySelector('video, audio');
      // The real one sends a status on the events of the element it drives.
      for (const name of ['playing', 'pause', 'seeked', 'ended', 'volumechange', 'ratechange']) {
        element?.addEventListener(name, () => {
          if (session !== null) broadcast();
        });
      }
    },
    stop(): void {},
  };

  (globalThis as { cast?: unknown }).cast = {
    framework: { CastReceiverContext: { getInstance: () => context } },
    debug: {
      CastDebugLogger: {
        getInstance: () => {
          // The real logger asks the context for its own namespace, which the framework refuses once started.
          if (started.length > 0) {
            throw new Error('New namespaces can not be requested after start has been called');
          }
          return debug;
        },
      },
    },
  };

  const debug = {
    setEnabled(enabled: boolean) {
      logger.enabled = enabled;
    },
    showDebugLogs(shown: boolean) {
      logger.shown = shown;
    },
    set loggerLevelByEvents(levels: Record<string, number>) {
      logger.events = levels;
    },
  };

  return {
    send,
    custom(namespace, senderId, data) {
      for (const listener of custom.get(namespace) ?? []) listener({ senderId, data });
    },
    fire(type) {
      for (const listener of system.get(type) ?? []) listener();
    },
    statuses,
    errors,
    loads,
    dropped,
    started,
    logger,
    uninstall() {
      delete (globalThis as { cast?: unknown }).cast;
    },
  };
}
