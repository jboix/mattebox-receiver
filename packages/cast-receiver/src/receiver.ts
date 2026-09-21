/**
 * `createReceiver`: one call on the page, with hooks. It builds the handler
 * chain the page gives to `MatteboxPlayerElement.define`, and once started
 * it stands between the framework's messages and the page's element.
 */
import type { Handler, PlayerError } from '@mattebox/player-core';
import type { Bridge } from './bridge.js';
import { createBridge, LoadFailed, Superseded } from './bridge.js';
import * as commands from './commands.js';
import type { CastReceiverContext, ErrorData, Interceptor, LoadRequestData } from './framework.js';
import {
  COMMANDS,
  CORE_EVENTS,
  debugLogger,
  LOAD,
  LOGGER_INFO,
  READY,
  receiverContext,
} from './framework.js';
import { chain, createHookRouter } from './handlers.js';
import { toCastLoad } from './load.js';
import type { Path } from './path.js';
import { installPath } from './path.js';
import { memoryProfile } from './profile.js';
import { defaultResolve } from './resolve.js';
import { live, writeStatus } from './status.js';
import type { TrackIds } from './tracks.js';
import { createTrackIds } from './tracks.js';
import type {
  CastLoad,
  IdleReason,
  Load,
  Receiver,
  ReceiverOptions,
  ReceiverPlayer,
  ReceiverState,
} from './types.js';

/** The engine's events that move the track list or the selection. */
const TRACK_EVENTS = ['tracks:changed', 'tracks:selected'];

type Listener = (...args: never[]) => void;

/** The reason a sender reads: the player's category and code. */
function reason(error: PlayerError): string {
  return `${error.category}/${error.code}`;
}

export function createReceiver(options: ReceiverOptions): Receiver {
  const router = createHookRouter();
  const listeners: Record<string, Set<Listener>> = {
    load: new Set(),
    idle: new Set(),
    error: new Set(),
  };
  let state: ReceiverState = 'idle';
  let player: ReceiverPlayer | null = null;
  let context: CastReceiverContext | null = null;
  let path: Path | null = null;
  let built: Handler[] | null = null;
  /** The load the player holds, and its track ids. Null while idle. */
  let current: { readonly load: CastLoad; readonly ids: TrackIds } | null = null;
  /** One per load: a sender tells one media session from the next by it. */
  let mediaSessionId = 0;
  let idleReason: IdleReason | null = null;
  let offEngine: Array<() => void> = [];
  /** The fatal error that last sent the receiver idle, and how many times it went idle. */
  let failure: PlayerError | null = null;
  let idles = 0;

  function emit(event: string, ...args: unknown[]): void {
    for (const fn of [...(listeners[event] ?? [])]) (fn as (...a: unknown[]) => void)(...args);
  }

  const bridge: Bridge = createBridge(
    options.resolve ?? defaultResolve,
    router,
    (load, resolved) => {
      emit('load', load, resolved);
    },
  );

  /**
   * The chain, built on the first routing question and not before: the
   * memory profile reads the device, and the framework knows the device
   * only once its context has started, which is after the page called
   * `handlers()`.
   */
  function real(): Handler[] {
    if (built === null) {
      const capabilities = context?.getDeviceCapabilities() ?? null;
      const config =
        options.config ??
        memoryProfile(
          {
            userAgent: globalThis.navigator?.userAgent ?? '',
            capabilities,
            // The platform answers once the context is ready, which the capabilities say.
            fullHd60:
              context === null || capabilities === null
                ? null
                : context.canDisplayType('video/mp4', 'avc1.64002A', 1920, 1080, 60),
          },
          options.debug === true,
        );
      built = chain({
        preset: options.preset,
        stages: options.stages,
        without: options.without,
        config,
        hook: router.hook,
      });
    }
    return built;
  }

  function handlers(): Handler[] {
    return ['mattebox', 'native'].map((name, index) => {
      const at = (): Handler => real()[index] as Handler;
      return {
        name,
        canHandle: (source, env) => at().canHandle(source, env),
        handle: (source, video) => at().handle(source, video),
      };
    });
  }

  /** `bySender`: a sender's STOP, which the framework ends its own session on. Anything else has to tell it. */
  function toIdle(why: IdleReason, bySender = false): void {
    if (player === null || (state === 'idle' && current === null)) return;
    idles += 1;
    idleReason = why;
    // The framework holds a session of its own only once a load completed.
    const held = current !== null;
    current = null;
    bridge.unload(player);
    // Wanted: removing `src` to unload, as the element's guide says. In
    // @mattebox/player 0.5.0 the element forgets the session and leaves the
    // core playing it. Had to: unload the core, which is public. The surface
    // that would make it one call: the element unloading on a removed `src`.
    void player.player?.unload();
    state = 'idle';
    // The framework's own session ends too, and its status goes out with
    // the reason written over it.
    if (!bySender && held) path?.idle();
    emit('idle', why);
  }

  function onError(error: PlayerError): void {
    if (error.fatal) {
      state = 'error';
      failure = error;
    }
    emit('error', error);
    const manager = context?.getPlayerManager();
    if (manager !== undefined && context !== null) {
      const data = { mattebox: { category: error.category, code: error.code, fatal: error.fatal } };
      for (const sender of context.getSenders()) {
        manager.sendError(sender.id, 0, 'ERROR', reason(error), data);
      }
    }
    if (error.fatal) toIdle('error');
  }

  /** The engine's track events, for the session the player holds now. */
  function watchEngine(): void {
    for (const off of offEngine) off();
    offEngine = [];
    const engine = player?.engine ?? null;
    if (engine === null) return;
    for (const name of TRACK_EVENTS) offEngine.push(engine.on(name, () => path?.changed()));
  }

  async function load(request: CastLoad): Promise<Load> {
    if (player === null) throw new Error('mattebox receiver: start() comes before load()');
    state = 'loading';
    idleReason = null;
    const before = idles;
    try {
      const resolved = await bridge.load(player, request);
      // A fatal error between the session and here already sent the receiver
      // idle: a first segment that fails, faster than a promise settles.
      if (idles !== before) {
        throw failure === null ? new Superseded() : new LoadFailed(failure);
      }
      mediaSessionId += 1;
      current = { load: request, ids: createTrackIds(request.tracks) };
      state = 'ready';
      watchEngine();
      return resolved;
    } catch (cause) {
      // A refused load already came through the player's `error` event.
      // One that lost to a later load changes nothing: the later one decides.
      if (!(cause instanceof Superseded) && !(cause instanceof LoadFailed)) {
        state = 'idle';
      }
      throw cause;
    }
  }

  function stop(): void {
    toIdle('stopped');
  }

  function bind(element: ReceiverPlayer): void {
    player = element;
    element.addEventListener('error', (event) => onError(event.detail));
    element.video.addEventListener('ended', () => {
      if (current !== null) toIdle('finished');
    });
    // A sender's track the page put on the video, or a selection made there.
    element.video.textTracks.addEventListener('addtrack', () => path?.changed());
    element.video.textTracks.addEventListener('change', () => path?.changed());
  }

  function start(element: ReceiverPlayer): void {
    if (player !== null) throw new Error('mattebox receiver: start() runs once per page');
    bind(element);
    context = receiverContext();
    if (context === null) return;

    const manager = context.getPlayerManager();
    path = installPath(manager, element.video, {
      seek: (request) => commands.seek(element, request),
      setPlaybackRate: (request) => commands.setPlaybackRate(element, request),
      editTracks: (request) =>
        current === null ? null : commands.editTracks(element, current.ids, request),
      stop: () => toIdle('stopped', true),
      writeStatus: (status) => {
        writeStatus(status, element, {
          load: current?.load ?? null,
          ids: current?.ids ?? null,
          mediaSessionId,
          idleReason,
        });
      },
    });

    const onLoad: Interceptor<LoadRequestData> = async (request) => {
      try {
        await load(toCastLoad(request));
      } catch (cause) {
        const failed: ErrorData = {
          type: cause instanceof Superseded ? 'LOAD_CANCELLED' : 'LOAD_FAILED',
          ...(cause instanceof LoadFailed ? { reason: reason(cause.detail) } : {}),
          ...(request.requestId === undefined ? {} : { requestId: request.requestId }),
        };
        return failed;
      }
      return path?.loaded(request, live(element.engine) !== null) ?? request;
    };
    manager.setMessageInterceptor(LOAD, onLoad);

    const namespaces: Record<string, string> = {};
    for (const entry of options.messages ?? []) {
      namespaces[entry.namespace] = 'JSON';
      context.addCustomMessageListener(entry.namespace, (event) => {
        entry.onMessage(event.senderId, event.data);
      });
    }

    if (options.debug === true) {
      // Before `start`: the logger asks the context for a namespace of its
      // own, and the framework refuses a new namespace once it has started.
      const logger = debugLogger();
      if (logger !== null) {
        // The logger draws its overlay once the context is ready, not before.
        context.addEventListener(READY, () => {
          logger.setEnabled(true);
          // The logger logs no event until it is given a level for it, and an overlay with nothing in it says nothing.
          logger.loggerLevelByEvents = { [CORE_EVENTS]: LOGGER_INFO };
          logger.showDebugLogs(true);
        });
      }
    }

    context.start({
      // The player's element plays. Google's own player libraries stay off the device.
      skipPlayersLoad: true,
      supportedCommands: COMMANDS,
      customNamespaces: namespaces,
      ...path.options,
    });
  }

  return {
    handlers,
    start,
    load,
    stop,
    get state(): ReceiverState {
      return state;
    },
    on(event: string, fn: Listener): () => void {
      const set = listeners[event];
      set?.add(fn);
      return () => {
        set?.delete(fn);
      };
    },
  };
}
