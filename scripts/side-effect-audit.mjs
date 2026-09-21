// Importing the library's built entry in isolation must register nothing: no
// global, no custom element, no engine, no Cast context. Needs `npm run build`.
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { fail } from './lib/fail.mjs';

const entry = 'packages/cast-receiver/dist/index.js';
if (!existsSync(entry)) fail(`${entry} is missing; run npm run build first`);

const before = new Set(Object.getOwnPropertyNames(globalThis));
await import(pathToFileURL(entry).href);

const leaked = Object.getOwnPropertyNames(globalThis).filter((key) => !before.has(key));
if (leaked.length > 0) fail(`importing the library created globals: ${leaked.join(', ')}`);

console.log('side-effect audit passed (the library imports cleanly)');
