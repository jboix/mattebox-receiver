// One budget, min+brotli. kB is 1000 bytes. Needs `npm run build`.
// The design said about 6 kB, and the first measurement set that budget.
// 15 kB since the receiver loads a sender's programme three ways: through
// the page's connector, through the library's, and by the attributes. That
// took 0.88 kB. The owner set the budget on 2026-11-14, with room for what
// casting still needs.
// Raise it only with a reason in the commit body.
module.exports = [
  {
    name: '@mattebox/cast-receiver',
    path: 'packages/cast-receiver/dist/index.js',
    // The engine, the core and the player are peers: never part of the
    // library's download. Google's framework is a script the page loads.
    ignore: ['mattebox', '@mattebox/player-core', '@mattebox/player'],
    brotli: true,
    limit: '15 kB',
  },
];
