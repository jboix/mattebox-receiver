/**
 * The chain the page passes to `MatteboxPlayerElement.define`: the mattebox
 * handler over the receiver's preset, then the native handler.
 *
 * Wanted: to give the element a load's request hooks with the load. The
 * element takes no hooks, and the mattebox handler takes them once, when it
 * is built. Had to: build the handler here with one hook of the library's
 * own, which calls whatever the current load resolved. The surface that
 * would make it one call: request hooks on the element, per load.
 */
import type { Handler } from '@mattebox/player-core';
import { matteboxHandler, nativeHandler } from '@mattebox/player-core';
import type { KernelConfig, Stage } from 'mattebox';
import type { HookedRequest, Preset, RequestHook } from './types.js';

/** The hooks of the load the player holds. The handler's one hook reads it on every request. */
export interface HookRouter {
  set(hooks: readonly RequestHook[]): void;
  readonly hook: RequestHook;
}

export function createHookRouter(): HookRouter {
  let current: readonly RequestHook[] = [];
  return {
    set(hooks) {
      current = hooks;
    },
    hook(request: HookedRequest) {
      for (const hook of current) hook(request);
    },
  };
}

export interface ChainOptions {
  readonly preset: Preset;
  readonly stages?: readonly Stage[] | undefined;
  readonly without?: readonly string[] | undefined;
  readonly config: Partial<KernelConfig>;
  readonly hook: RequestHook;
}

export function chain(options: ChainOptions): Handler[] {
  return [
    matteboxHandler({
      preset: options.preset,
      ...(options.stages === undefined ? {} : { stages: options.stages }),
      ...(options.without === undefined ? {} : { without: options.without }),
      config: options.config,
      transport: { requestHooks: [options.hook] },
      // A Cast device is never an AirPlay sender.
      airplay: false,
    }),
    nativeHandler(),
  ];
}
