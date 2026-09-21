/**
 * The bridge: a `CastLoad` in, the player driven through its public surface
 * out. A `LOAD` message, the app's `?load` and the tests all come through
 * here, so a simulated load takes the path a sender's does.
 *
 * The library writes attributes on the element and calls the video. It
 * creates no element and appends nothing.
 */
import type { PlayerError, Session } from '@mattebox/player-core';
import { play } from './commands.js';
import type { HookRouter } from './handlers.js';
import type { CastLoad, Load, ReceiverPlayer } from './types.js';

/** Set before `src`, in this order: each reloads, and the element folds a burst into one load. */
const BEFORE_SRC = ['type', 'license-url', 'thumbnails'] as const;

/** A load that a later load, or a stop, replaced before it finished. */
export class Superseded extends Error {}

/** A load the player refused: the fatal error it reported. */
export class LoadFailed extends Error {
  declare readonly detail: PlayerError;
  constructor(detail: PlayerError) {
    super(`${detail.category}/${detail.code}`);
    this.detail = detail;
  }
}

export interface Bridge {
  load(player: ReceiverPlayer, load: CastLoad): Promise<Load>;
  /** Returns the player to `:not([src])`. */
  unload(player: ReceiverPlayer): void;
}

function write(player: ReceiverPlayer, name: string, value: string | undefined): void {
  if (value === undefined) player.removeAttribute(name);
  else player.setAttribute(name, value);
}

/**
 * Resolves with the session that plays `url`, rejects with the fatal error
 * that came first. An engine session exists once its manifest parsed. A
 * native session exists the moment `src` is assigned, before the browser
 * has read a byte, so for one the wait goes on to the metadata: a file the
 * browser cannot play fails the `LOAD` instead of following a success.
 */
function settled(
  player: ReceiverPlayer,
  url: string,
  stale: () => boolean,
  replaced: () => boolean,
): Promise<Session> {
  return new Promise((resolve, reject) => {
    const video = player.video;
    let session: Session | null = null;
    const done = (): void => {
      player.removeEventListener('sourcechange', onSource);
      player.removeEventListener('error', onError);
      video.removeEventListener('loadedmetadata', onMetadata);
    };
    const onMetadata = (): void => {
      if (session === null) return;
      done();
      resolve(session);
    };
    const onSource = (event: CustomEvent<Session | null>): void => {
      if (stale()) {
        done();
        reject(new Superseded());
      } else if (event.detail !== null && event.detail.source.url === url) {
        session = event.detail;
        if (session.engine !== null || video.readyState >= HTMLMediaElement.HAVE_METADATA) {
          onMetadata();
        }
      }
    };
    const onError = (event: CustomEvent<PlayerError>): void => {
      if (!event.detail.fatal) return;
      done();
      // The receiver hears the same event first and unloads on it, so an
      // unload here is this load's own failure. Only a later load takes it over.
      reject(replaced() ? new Superseded() : new LoadFailed(event.detail));
    };
    player.addEventListener('sourcechange', onSource);
    player.addEventListener('error', onError);
    video.addEventListener('loadedmetadata', onMetadata);
  });
}

/** The video's events after which a seek that was not possible may be. */
const SEEKABLE_EVENTS = ['loadedmetadata', 'durationchange', 'progress', 'canplay'];

/**
 * Seeks to where the sender was. Wanted: to load at a position. Neither the
 * element nor `engine.load` takes one, so the engine fetches from zero
 * first. Had to: set `currentTime` once the video can seek there, which on
 * WebKit is later than its metadata. The surface that would make it one
 * call: a start time on `load`, and an attribute for it on the element.
 */
function startAt(video: HTMLVideoElement, time: number): void {
  const done = (): void => {
    for (const name of SEEKABLE_EVENTS) video.removeEventListener(name, attempt);
    video.removeEventListener('emptied', done);
  };
  function attempt(): void {
    if (video.readyState < HTMLMediaElement.HAVE_METADATA) return;
    // Past the end there is nowhere to start: the video stays at zero.
    if (Number.isFinite(video.duration) && time >= video.duration) {
      done();
      return;
    }
    const ranges = video.seekable;
    for (let i = 0; i < ranges.length; i += 1) {
      if (time < ranges.start(i) || time > ranges.end(i)) continue;
      done();
      video.currentTime = time;
      return;
    }
  }
  for (const name of SEEKABLE_EVENTS) video.addEventListener(name, attempt);
  // A new source takes the wait with it.
  video.addEventListener('emptied', done);
  attempt();
}

export function createBridge(
  resolve: (load: CastLoad) => Load | Promise<Load>,
  router: HookRouter,
  onResolved: (load: CastLoad, resolved: Load) => void,
): Bridge {
  /** Bumped by every load, and by every unload. A load whose numbers are old lost. */
  let loads = 0;
  let unloads = 0;

  async function load(player: ReceiverPlayer, request: CastLoad): Promise<Load> {
    loads += 1;
    const mine = loads;
    const from = unloads;
    const replaced = (): boolean => mine !== loads;
    const stale = (): boolean => replaced() || from !== unloads;
    const resolved = await resolve(request);
    if (stale()) throw new Superseded();
    if (resolved.url === '') {
      throw new LoadFailed({
        category: 'config',
        code: 'CONFIG_INVALID',
        fatal: true,
        recoverable: false,
        handler: null,
        context: { reason: 'the load carries no URL' },
      });
    }
    // Before `src`: the first request of the load already goes through them.
    router.set(resolved.requestHooks ?? []);
    onResolved(request, resolved);

    const outcome = settled(player, resolved.url, stale, replaced);
    write(player, 'type', resolved.type);
    write(player, 'license-url', resolved.licenseUrl);
    write(player, 'thumbnails', resolved.thumbnails);
    // Setting `src` to its own value loads again, which is what a second
    // LOAD of the same content asks for.
    player.setAttribute('src', resolved.url);
    await outcome;

    // A live stream starts at its edge: the sender's time is on the
    // sender's timeline and means nothing here.
    if (request.streamType !== 'live' && request.currentTime > 0) {
      startAt(player.video, request.currentTime);
    }
    if (request.autoplay) play(player);
    else player.video.pause();
    return resolved;
  }

  function unload(player: ReceiverPlayer): void {
    unloads += 1;
    router.set([]);
    player.removeAttribute('src');
    for (const name of BEFORE_SRC) player.removeAttribute(name);
  }

  return { load, unload };
}
