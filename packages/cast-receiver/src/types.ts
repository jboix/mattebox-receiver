/**
 * The library's public types: what the page gives `createReceiver`, what a
 * sender's request looks like once read, and what the player loads. The
 * receiver framework's own shapes are in `framework.ts` and never leave the
 * package.
 */
import type { MatteboxPlayerElement } from '@mattebox/player';
import type { Handler, PlayerError } from '@mattebox/player-core';
import type { KernelConfig, Stage } from 'mattebox';
// `Preset` is only reachable through a preset subpath. Any preset exports it.
import type { Preset } from 'mattebox/presets/full';

export type { Preset };

/** One request the engine is about to make, as a hook sees it. A hook rewrites it in place. */
export interface HookedRequest {
  url: string;
  headers: Record<string, string>;
}

export type RequestHook = (request: HookedRequest) => void;

/** A text track the sender sent along with the media. */
export interface CastLoadTrack {
  readonly id: number;
  readonly url: string;
  readonly type: string;
  readonly kind: 'subtitles' | 'captions';
  readonly name: string;
  readonly language: string;
}

export interface CastLoadMetadata {
  readonly title?: string;
  readonly subtitle?: string;
  readonly images: readonly string[];
}

/** The sender's request, as the library reads it. */
export interface CastLoad {
  readonly url: string;
  readonly type?: string;
  readonly streamType: 'buffered' | 'live';
  readonly currentTime: number;
  readonly autoplay: boolean;
  readonly tracks: readonly CastLoadTrack[];
  readonly metadata: CastLoadMetadata;
  readonly hlsSegmentFormat?: string;
  readonly customData: unknown;
}

/** What the player loads. */
export interface Load {
  readonly url: string;
  readonly type?: string;
  readonly licenseUrl?: string;
  /** A WebVTT sprite-sheet track, the element's `thumbnails` attribute. */
  readonly thumbnails?: string;
  /** Seen by every request the engine makes, the license request included. */
  readonly requestHooks?: readonly RequestHook[];
}

/** The one convention the default resolver reads: `customData.mattebox`. Every member is optional. */
export interface MatteboxCustomData {
  readonly licenseUrl?: string;
  readonly licenseHeaders?: Readonly<Record<string, string>>;
  readonly thumbnails?: string;
}

export interface ReceiverMessages {
  readonly namespace: string;
  onMessage(senderId: string, data: unknown): void;
}

export interface ReceiverOptions {
  /**
   * The engine composition. Take `mattebox/presets/full`. The page imports it
   * and the library bundles none, so a page that wants fewer bytes passes a
   * smaller preset, and one that wants a stage off names it in `without`.
   */
  readonly preset: Preset;
  /** Turns what the sender sent into what the player loads. Default: the passthrough of `defaultResolve`. */
  readonly resolve?: (load: CastLoad) => Load | Promise<Load>;
  /** Stages for the engine, merged by name over the preset's: a name the preset has replaces its instance, which is how a stage gets options. */
  readonly stages?: readonly Stage[];
  /** Names of preset stages to leave out, such as `cmcd`. The engine refuses a name another stage requires. */
  readonly without?: readonly string[];
  /** Kernel tuning for the engine. Default: the memory profile for the device. */
  readonly config?: Partial<KernelConfig>;
  /** Custom namespaces, passed through. */
  readonly messages?: readonly ReceiverMessages[];
  /** The Cast debug logger on, with the overlay. Default false. */
  readonly debug?: boolean;
}

export type ReceiverState = 'idle' | 'loading' | 'ready' | 'error';

/** Why the receiver went back to idle. */
export type IdleReason = 'stopped' | 'finished' | 'error';

export interface Receiver {
  /**
   * The chain for `MatteboxPlayerElement.define`: the mattebox handler over
   * the preset, carrying the receiver's stages, config and request hook, then
   * the native handler.
   */
  handlers(): Handler[];
  /**
   * Binds the page's element and starts the framework's context over it.
   * Once per page. On a page without the framework, a desktop browser, it
   * binds the element and starts nothing, and `load` still drives the player.
   */
  start(player: ReceiverPlayer): void;
  /**
   * Drives the player through the path a `LOAD` message takes. For a page
   * that simulates a sender, and for the tests. Resolves once the player
   * holds the source, and rejects when the load fails or a later one wins.
   */
  load(load: CastLoad): Promise<Load>;
  readonly state: ReceiverState;
  on(event: 'load', fn: (load: CastLoad, resolved: Load) => void): () => void;
  on(event: 'idle', fn: (reason: IdleReason) => void): () => void;
  on(event: 'error', fn: (error: PlayerError) => void): () => void;
  /** Ends the session and returns the player to `:not([src])`. */
  stop(): void;
}

/** The element the receiver is started over: the page's `<mattebox-player>`. A type alone: the library never imports the element's code. */
export type ReceiverPlayer = MatteboxPlayerElement;
