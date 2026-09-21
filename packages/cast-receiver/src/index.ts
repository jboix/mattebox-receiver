/**
 * @mattebox/cast-receiver: the bridge between Google's Cast receiver
 * framework and `<mattebox-player>`. Importing it registers nothing, loads
 * nothing and touches no DOM. The page loads the framework's script, places
 * the player, and calls `createReceiver`.
 */

export { LoadFailed, Superseded } from './bridge.js';
export { createReceiver } from './receiver.js';
export { defaultResolve, headersFor, matteboxData } from './resolve.js';
export type * from './types.js';
