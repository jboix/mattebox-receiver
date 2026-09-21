// Banned TypeScript helpers and stray bare imports in the built output of
// the library. Needs `npm run build`.
import { globSync, readFileSync } from 'node:fs';
import { fail } from './lib/fail.mjs';

const BANNED = /__publicField|tslib|regenerator|__decorate|__createBinding|__spreadArray/;
// The modern build imports nothing at runtime beyond the engine, the core and the player.
const ALLOWED_BARE = /^(mattebox(\/.*)?|@mattebox\/player-core|@mattebox\/player(\/.*)?)$/;
const IMPORT_SPECIFIER = /(?:from|import)\s*['"]([^'"]+)['"]/g;

// The library alone: the playground is a Node program and a built page, and imports what those need.
const files = globSync('packages/cast-receiver/dist/**/*.js', {
  exclude: ['**/dist/es2015/**'],
}).sort();
if (files.length === 0) fail('no built modules found; run npm run build first');

const banned = files.filter((file) => BANNED.test(readFileSync(file, 'utf8')));
if (banned.length > 0) fail('banned TypeScript construct found in modern output', banned);

const bare = files.filter((file) =>
  Array.from(readFileSync(file, 'utf8').matchAll(IMPORT_SPECIFIER)).some(
    ([, specifier]) => !specifier.startsWith('.') && !ALLOWED_BARE.test(specifier),
  ),
);
if (bare.length > 0) fail('bare import specifier in output; a runtime dependency leaked in', bare);

console.log(`emit check passed (${files.length} files)`);
