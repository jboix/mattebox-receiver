// One budget, min+brotli. kB is 1000 bytes. Needs `npm run build`.
// The design said about 6 kB. The first measurement set the budget, and it
// holds. Raise it only with a reason in the commit body.
module.exports = [
  {
    name: '@mattebox/cast-receiver',
    path: 'packages/cast-receiver/dist/index.js',
    // The engine, the core and the player are peers: never part of the
    // library's download. Google's framework is a script the page loads.
    ignore: ['mattebox', '@mattebox/player-core', '@mattebox/player'],
    brotli: true,
    limit: '6 kB',
  },
];
