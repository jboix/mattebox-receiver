import { fileURLToPath } from 'node:url';

/**
 * Tests and the app import the library by name and get its sources, the same
 * mapping as tsconfig.json's paths, so no build is needed first.
 */
export const alias = [
  {
    find: '@mattebox/cast-receiver',
    replacement: fileURLToPath(new URL('packages/cast-receiver/src/index.ts', import.meta.url)),
  },
];
