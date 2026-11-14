/**
 * The bridge: a `CastLoad` in, the player driven through its public surface
 * out. A `LOAD` message, the app's `?load` and the tests all come through
 * here, so a simulated load takes the path a sender's does.
 *
 * A load goes one of three ways:
 *
 * 1. The sender's programme, by its connector's type and id, when the page
 *    gave the receiver a connector of that type. The page resolves it: its
 *    own token, its own metadata.
 * 2. What the sender sent, as a `mattebox/cast` programme. The library's
 *    connector resolves it, so the player applies the sent markers, poster
 *    and chapters as for any programme.
 * 3. The element's attributes: the URL and the license servers alone. For a
 *    page that gave the element no connectors of the receiver.
 *
 * The way is chosen before the load, from the connectors the page gave. No
 * load is tried to find out, so the player reports no error of the choice.
 * A connector that fails, or blocks the programme, is the answer.
 *
 * The library writes attributes and `sources` on the element and calls the
 * video. It creates no element and appends nothing.
 */
import type {
  ConnectorSource,
  PlayerError,
  Programme,
  ProgrammeMetadata,
  Session,
  Source,
} from '@mattebox/player-core';
import { Blocked } from '@mattebox/player-core';
import { play } from './commands.js';
import { CAST_CONNECTOR } from './connector.js';
import type { HookRouter } from './handlers.js';
import { matteboxData } from './resolve.js';
import { liveRange } from './status.js';
import type { CastLoad, CastProgramme, Load, MatteboxCustomData, ReceiverPlayer } from './types.js';

/** What names the source by attribute. `src` wins over `sources`, and `license-url` over a source's own servers. */
const SOURCE = ['src', 'type', 'license-url', 'certificate-url'] as const;

/** What goes with the source, whichever way it loads. */
const BESIDE = ['thumbnails', 'chapters'] as const;

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
  /** Rejects with `Blocked` for a programme its connector blocked: nothing loaded, and the player shows why. */
  load(player: ReceiverPlayer, load: CastLoad): Promise<Load>;
  /** Returns the player to nothing loaded. */
  unload(player: ReceiverPlayer): void;
}

function write(player: ReceiverPlayer, name: string, value: string | undefined): void {
  if (value === undefined) player.removeAttribute(name);
  else player.setAttribute(name, value);
}

/**
 * Resolves with the session of this load. Rejects with the fatal error that
 * came first, or with the block of the programme. An engine session exists
 * once its manifest parsed. A native session exists the moment `src` is
 * assigned, before the browser has read a byte, so for one the wait goes
 * on to the metadata: a file the browser cannot play fails the `LOAD`
 * instead of following a success.
 */
function settled(
  player: ReceiverPlayer,
  mine: (session: Session) => boolean,
  stale: () => boolean,
  replaced: () => boolean,
): Promise<Session> {
  return new Promise((resolve, reject) => {
    const video = player.media;
    let session: Session | null = null;
    const done = (): void => {
      player.removeEventListener('sourcechange', onSource);
      player.removeEventListener('programmechange', onProgramme);
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
      } else if (event.detail !== null && mine(event.detail)) {
        session = event.detail;
        if (session.engine !== null || video.readyState >= HTMLMediaElement.HAVE_METADATA) {
          onMetadata();
        }
      }
    };
    const onProgramme = (event: CustomEvent<Programme | null>): void => {
      const block = event.detail?.block;
      if (block === undefined || stale()) return;
      done();
      reject(new Blocked(block));
    };
    const onError = (event: CustomEvent<PlayerError>): void => {
      if (!event.detail.fatal) return;
      done();
      // The receiver hears the same event first and unloads on it, so an
      // unload here is this load's own failure. Only a later load takes it over.
      reject(replaced() ? new Superseded() : new LoadFailed(event.detail));
    };
    player.addEventListener('sourcechange', onSource);
    player.addEventListener('programmechange', onProgramme);
    player.addEventListener('error', onError);
    video.addEventListener('loadedmetadata', onMetadata);
  });
}

/**
 * Gives the engine of the session that plays `url` its license servers per
 * key system. Wanted: an attribute for them, as `license-url` is for one.
 * The element has none, and `sources` would drop `src`, which the page's
 * idle state reads. Had to: set them on `engine.drm` when the session
 * starts, the moment the element applies `license-url` itself. A native
 * session has no engine and gets `license-url` alone. The surface that
 * would make it one call: a `license-urls` attribute, or DRM on `src`'s
 * source.
 */
function licenseUrlsFor(
  player: ReceiverPlayer,
  url: string,
  urls: Readonly<Record<string, string>>,
): void {
  // The next session is this load's, or a later load replaced it: either way, once.
  const onSource = (event: CustomEvent<Session | null>): void => {
    player.removeEventListener('sourcechange', onSource);
    const session = event.detail;
    if (session === null || session.source.url !== url) return;
    const drm = (session.engine as { drm?: { setLicenseUrls(urls: object): void } } | null)?.drm;
    drm?.setLicenseUrls(urls);
  };
  player.addEventListener('sourcechange', onSource);
}

/** The video's events after which a seek that was not possible may be. */
const SEEKABLE_EVENTS = ['loadedmetadata', 'durationchange', 'progress', 'canplay'];

/**
 * Runs `attempt` now and at each event after which a seek may have become
 * possible, until it returns true. A new source takes the wait with it.
 */
function whenSeekable(video: HTMLVideoElement, attempt: () => boolean): void {
  const done = (): void => {
    for (const name of SEEKABLE_EVENTS) video.removeEventListener(name, run);
    video.removeEventListener('emptied', done);
  };
  function run(): void {
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA && attempt()) done();
  }
  for (const name of SEEKABLE_EVENTS) video.addEventListener(name, run);
  video.addEventListener('emptied', done);
  run();
}

/**
 * Seeks to where the sender was, for a load whose source the bridge did not
 * build: a connector's, or the `src` attribute's. Wanted: to load at a
 * position. A source takes one, `start`, but the element has no attribute
 * for it and a connector makes its own sources, so the engine fetches from
 * zero first. Had to: set `currentTime` once the video can seek there,
 * which on WebKit is later than its metadata. The surface that would make
 * it one call: a start time on the element, beside `src` and `sources`.
 */
function startAt(video: HTMLVideoElement, time: number): void {
  whenSeekable(video, () => {
    // Past the end there is nowhere to start: the video stays at zero.
    if (Number.isFinite(video.duration) && time >= video.duration) return true;
    const ranges = video.seekable;
    for (let i = 0; i < ranges.length; i += 1) {
      if (time < ranges.start(i) || time > ranges.end(i)) continue;
      video.currentTime = time;
      return true;
    }
    return false;
  });
}

/**
 * Seeks a live stream to the clock time the sender's viewer watched. The
 * sender's position is on the sender's timeline, so it comes as a date,
 * and the engine's clock anchor turns it into a time of this session. A
 * date outside the window stays at the edge. Decided once, when the window
 * is known: a date ahead of the edge must not become a seek later.
 */
function startAtDate(player: ReceiverPlayer, date: number): void {
  const video = player.media;
  whenSeekable(video, () => {
    const engine = player.engine;
    const range = liveRange(video, engine);
    if (range === null) return false;
    const clock = (engine as { pdt?: { toPresentationTime(date: number): number | null } } | null)
      ?.pdt;
    const time = clock?.toPresentationTime(date) ?? null;
    if (time !== null && time >= range.start && time <= range.end) video.currentTime = time;
    return true;
  });
}

/** What the sender sent, as the data of a `mattebox/cast` programme. */
function sentProgramme(
  request: CastLoad,
  resolved: Load,
  sent: MatteboxCustomData,
  start: number | null,
): CastProgramme {
  const { licenseUrl, licenseUrls, certificateUrl } = resolved;
  const drm = {
    ...(licenseUrl === undefined ? {} : { licenseUrl }),
    ...(licenseUrls === undefined ? {} : { licenseUrls }),
    ...(certificateUrl === undefined ? {} : { certificateUrl }),
  };
  const source: Source = {
    url: resolved.url,
    ...(resolved.type === undefined ? {} : { type: resolved.type }),
    ...(Object.keys(drm).length === 0 ? {} : { drm }),
    ...(sent.videoTracks === undefined ? {} : { videoTracks: sent.videoTracks }),
    ...(start === null ? {} : { start }),
  };
  // Cast's own fields first, for a sender that wrote no metadata of the player's.
  const { title, subtitle, images } = request.metadata;
  const metadata: ProgrammeMetadata = {
    ...(title === undefined ? {} : { title }),
    ...(subtitle === undefined ? {} : { subtitle }),
    ...(images[0] === undefined ? {} : { image: images[0] }),
    ...sent.metadata,
  };
  return {
    source,
    ...(Object.keys(metadata).length === 0 ? {} : { metadata }),
    addons: sent.addons ?? {},
  };
}

export function createBridge(
  resolve: (load: CastLoad) => Load | Promise<Load>,
  router: HookRouter,
  onResolved: (load: CastLoad, resolved: Load) => void,
  /**
   * The types of the page's own connectors on the player, or null when the
   * page gave the element no connectors of the receiver.
   */
  connectors: () => readonly string[] | null,
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
    // Before the source: the first request of the load already goes through them.
    router.set(resolved.requestHooks ?? []);
    onResolved(request, resolved);

    const sent = matteboxData(request.customData);
    // A live stream's time is on the sender's timeline and means nothing here.
    const start =
      request.streamType !== 'live' && request.currentTime > 0 ? request.currentTime : null;

    /** Loads a programme through a connector of the player. */
    const byConnector = (source: ConnectorSource): Promise<Session> => {
      const outcome = settled(
        player,
        () => player.programme?.type === source.type,
        stale,
        replaced,
      );
      for (const name of SOURCE) player.removeAttribute(name);
      write(player, 'thumbnails', resolved.thumbnails);
      write(player, 'chapters', resolved.chapters);
      // Each of these reloads, and the element folds the burst into one load.
      player.sources = [source];
      return outcome;
    };

    /** Loads the URL by the element's attributes, as a page's own markup does. */
    const byAttributes = (): Promise<Session> => {
      const outcome = settled(
        player,
        (session) => session.source.url === resolved.url,
        stale,
        replaced,
      );
      if (player.sources !== null) player.sources = null;
      write(player, 'type', resolved.type);
      write(player, 'license-url', resolved.licenseUrl);
      write(player, 'certificate-url', resolved.certificateUrl);
      if (resolved.licenseUrls !== undefined)
        licenseUrlsFor(player, resolved.url, resolved.licenseUrls);
      write(player, 'thumbnails', resolved.thumbnails);
      write(player, 'chapters', resolved.chapters);
      // Setting `src` to its own value loads again, which is what a second
      // LOAD of the same content asks for.
      player.setAttribute('src', resolved.url);
      return outcome;
    };

    const own = connectors();
    const programme = sent.programme;
    /** The source carries the start: the engine fetches from there, and no seek follows. */
    let started = false;
    if (own === null) {
      await byAttributes();
    } else if (programme !== undefined && own.includes(programme.type)) {
      await byConnector(programme);
    } else {
      // The sender's id names the programme, whichever connector it came from there.
      const id = programme?.id;
      await byConnector({
        type: CAST_CONNECTOR,
        ...(id === undefined ? {} : { id }),
        data: sentProgramme(request, resolved, sent, start),
      });
      started = true;
    }

    if (start !== null && !started) startAt(player.media, start);
    if (request.streamType === 'live' && sent.date !== undefined) startAtDate(player, sent.date);
    if (request.autoplay) play(player);
    else player.media.pause();
    return resolved;
  }

  function unload(player: ReceiverPlayer): void {
    unloads += 1;
    router.set([]);
    for (const name of [...SOURCE, ...BESIDE]) player.removeAttribute(name);
    // Setting `sources` loads, so only when there is a list to drop.
    if (player.sources !== null) player.sources = null;
  }

  return { load, unload };
}
