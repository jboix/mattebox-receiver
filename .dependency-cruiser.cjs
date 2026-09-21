// The boundary rules. See docs/architecture.md.
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'runtime-deps-are-the-engine-the-core-and-the-player',
      comment:
        'The library takes the engine, the core and the player, all peers, and nothing else. ' +
        "Google's receiver framework is a script the page loads, never a dependency.",
      severity: 'error',
      from: { path: '^packages/cast-receiver/src/' },
      to: {
        dependencyTypes: ['npm', 'npm-dev', 'npm-no-pkg', 'npm-unknown'],
        dependencyTypesNot: ['npm-peer'],
      },
    },
    {
      name: 'peers-are-the-three',
      comment: 'A peer that is not the engine, the core or the player is a new dependency.',
      severity: 'error',
      from: { path: '^packages/cast-receiver/src/' },
      to: {
        dependencyTypes: ['npm-peer'],
        pathNot: 'node_modules/(mattebox|@mattebox/player-core|@mattebox/player)/',
      },
    },
    {
      name: 'the-library-never-imports-the-app',
      comment: 'Everything vendor-specific lives in the app, and the library never knows it.',
      severity: 'error',
      from: { path: '^packages/' },
      to: { path: '^app/' },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      from: { orphan: true, pathNot: '\\.d\\.ts$' },
      to: {},
    },
  ],
  options: {
    tsConfig: { fileName: 'tsconfig.json' },
    doNotFollow: { path: 'node_modules' },
    // Type-only imports count.
    tsPreCompilationDeps: true,
  },
};
