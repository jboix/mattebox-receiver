#!/usr/bin/env node
// Renders docs/size-chart-{dark,light}.svg: the JavaScript a Mattebox
// receiver page carries against the player library Google's framework puts
// on the device when a receiver leaves it to play. Both rows are bundled the
// same way, from their npm packages by rolldown, one entry per row, then
// min+gzip. JavaScript only. The page's library is the workspace build; its
// engine and player come from the workspace's node_modules at their
// released versions; Shaka is a pinned npm version,
// installed at run time into scripts/size-chart/, whose lockfile pins its
// dependencies too. The framework's other player, MPL, is not on npm and
// has no row.
//
//   npm run build && npm run size-chart
//   npm run size-chart -- --verbose   # lists the chunks each row counts
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { rolldown } from 'rolldown';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs');
/** Where the other stacks install: a manifest this script writes, and a committed lockfile. */
const STACKS_DIR = join(ROOT, 'scripts', 'size-chart');
const VERBOSE = process.argv.includes('--verbose');

const LIBRARY = JSON.stringify(join(ROOT, 'packages', 'cast-receiver', 'dist', 'index.js'));

/** What the app's page imports of the player: the element and the controls it composes. */
const PLAYER = [
  "import '@mattebox/player/element';",
  "import '@mattebox/player/elements/control-bar';",
  "import '@mattebox/player/elements/current-time';",
  "import '@mattebox/player/elements/duration';",
  "import '@mattebox/player/elements/live-button';",
  "import '@mattebox/player/elements/seek-bar';",
  "import '@mattebox/player/elements/spinner';",
  "import '@mattebox/player/elements/title';",
];

// The engine and the library are free of side effects, so a bare import of
// either bundles to nothing. The row uses what it imports, as the page does.
const ENGINE = ["import preset from 'mattebox/presets/full';", 'globalThis.engine = [preset];'];

const USE_LIBRARY = [
  `import { createReceiver } from ${LIBRARY};`,
  'globalThis.receiver = createReceiver;',
];

/** The element's preset table: one lazy chunk per preset, none on a page that gives its own chain. */
const PRESET_TABLE = /[\\/]mattebox[\\/].*[\\/]presets[\\/](?!full[\\/])/;

/**
 * One row per stack. `entry` is what a page imports; `install` the pinned
 * packages it comes from (none for the workspace's own). `skip` names the
 * dynamic chunks the page never loads. `version` names the package whose
 * installed version the row shows. `detail` is the lines under the label.
 */
const STACKS = [
  {
    label: 'mattebox receiver page',
    detail: (version) => [
      `library + player v${version('@mattebox/player')} + engine v${version('mattebox')}`,
      'as the app composes them',
    ],
    highlight: true,
    entry: [...USE_LIBRARY, ...PLAYER, ...ENGINE].join('\n'),
    skip: PRESET_TABLE,
  },
  {
    // The 4.15 line is the one the framework loads by default (its `shakaVersion`).
    // What the framework fetches for DASH, and for HLS under `useShakaForHls`,
    // when a receiver does not set `skipPlayersLoad`. No UI: the compiled build.
    label: 'shaka player',
    detail: () => ['the compiled build, no UI', 'what the framework loads without skipPlayersLoad'],
    version: 'shaka-player',
    install: { 'shaka-player': '4.15.61' },
    entry: "import 'shaka-player/dist/shaka-player.compiled.js';",
  },
];

/**
 * Installs the pinned packages. The lockfile holds their dependencies still
 * between runs; npm rewrites it only when a version here moves.
 */
function installOthers() {
  const dependencies = {};
  for (const stack of STACKS) Object.assign(dependencies, stack.install);
  mkdirSync(STACKS_DIR, { recursive: true });
  writeFileSync(
    join(STACKS_DIR, 'package.json'),
    `${JSON.stringify({ name: 'size-chart', private: true, dependencies }, null, 2)}\n`,
  );
  execFileSync(
    'npm',
    ['install', '--no-audit', '--no-fund', '--ignore-scripts', '--loglevel=error'],
    {
      cwd: STACKS_DIR,
      stdio: 'inherit',
    },
  );
}

/** The version of a package installed under `dir`, read off its manifest. */
function installedVersion(dir, pkg) {
  return JSON.parse(readFileSync(join(dir, 'node_modules', pkg, 'package.json'), 'utf8')).version;
}

/**
 * Bundles one stack and sums min+gzip over the chunks the page loads: the
 * entry, everything it imports statically, and every dynamic chunk not
 * skipped, followed the same way. A skipped chunk's private modules stay
 * out; what it shares with a counted chunk is in a shared chunk and counts.
 */
async function stackBytes(stack) {
  // Under the node_modules the stack resolves from: the workspace's for
  // Mattebox, the pinned install for the others. Git ignores both.
  const dir = join(stack.install === undefined ? ROOT : STACKS_DIR, 'node_modules', '.size-chart');
  mkdirSync(dir, { recursive: true });
  const entry = join(dir, `${stack.label.replace(/[^a-z]+/g, '-')}.js`);
  writeFileSync(entry, `${stack.entry}\n`);
  const bundle = await rolldown({
    input: entry,
    platform: 'browser',
    logLevel: 'silent',
  });
  const { output } = await bundle.generate({ format: 'es', minify: true });
  await bundle.close();

  const chunks = new Map(output.filter((o) => o.type === 'chunk').map((c) => [c.fileName, c]));
  const skipped = (chunk) =>
    stack.skip !== undefined && chunk.moduleIds.some((id) => stack.skip.test(id));
  const counted = new Set();
  const visit = (name) => {
    const chunk = chunks.get(name);
    if (chunk === undefined || counted.has(name)) return;
    counted.add(name);
    for (const dep of chunk.imports) visit(dep);
    for (const dep of chunk.dynamicImports) {
      const target = chunks.get(dep);
      if (target !== undefined && !skipped(target)) visit(dep);
    }
  };
  for (const chunk of chunks.values()) if (chunk.isEntry) visit(chunk.fileName);

  let bytes = 0;
  if (VERBOSE) console.log(`${stack.label}:`);
  for (const name of counted) {
    const chunk = chunks.get(name);
    const size = gzipSync(chunk.code, { level: 9 }).length;
    bytes += size;
    if (VERBOSE) {
      const from =
        chunk.facadeModuleId === null ? `${chunk.moduleIds.length} modules` : chunk.facadeModuleId;
      console.log(
        `  ${fmt(size).padStart(10)}  ${name}  (${from.replace(STACKS_DIR, '.').replace(ROOT, '.')})`,
      );
    }
  }
  return bytes;
}

async function rows() {
  const out = [];
  for (const stack of STACKS) {
    const version = (pkg) => installedVersion(stack.install === undefined ? ROOT : STACKS_DIR, pkg);
    out.push({
      label: stack.label,
      version: stack.version === undefined ? 'main' : `v${version(stack.version)}`,
      detail: stack.detail(version),
      bytes: await stackBytes(stack),
      highlight: stack.highlight === true,
    });
  }
  return out;
}

const THEMES = {
  dark: {
    bg: '#0b0b0d',
    text: '#f4f4f5',
    muted: '#8a8a93',
    track: '#18181c',
    bar: '#9a9aa2',
    accent: '#f5a524',
    axis: '#3a3a42',
  },
  light: {
    bg: '#ffffff',
    text: '#111114',
    muted: '#6b6b74',
    track: '#f0f0f3',
    bar: '#a1a1aa',
    accent: '#e8930c',
    axis: '#d4d4d9',
  },
};

const kb = (bytes) => bytes / 1024;
const fmt = (bytes) => `${kb(bytes).toFixed(1)} KB`;

function render(rows, theme, { title, subtitle, ariaLabel, tick }) {
  const t = THEMES[theme];
  const width = 1100;
  const left = 560;
  const right = 896;
  const rowH = 104;
  const barH = 54;
  const top = 150;
  const maxKb = Math.ceil(Math.max(...rows.map((r) => kb(r.bytes))) / tick) * tick;
  const scale = (right - left) / maxKb;
  const height = top + rows.length * rowH + 80;
  const font = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
  const mono = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace";

  const bars = rows
    .map((row, i) => {
      const y = top + i * rowH;
      const w = Math.max(3, kb(row.bytes) * scale);
      const fill = row.highlight ? t.accent : t.bar;
      const nameWeight = row.highlight ? 700 : 400;
      const valueWeight = row.highlight ? 700 : 400;
      const lines = [`${row.version} · ${row.detail[0]}`, ...row.detail.slice(1)];
      const detail = lines
        .map(
          (line, n) =>
            `\n  <text x="44" y="${y + 50 + n * 22}" font-family="${mono}" font-size="15" fill="${t.muted}">${line}</text>`,
        )
        .join('');
      return `
  <text x="44" y="${y + 26}" font-family="${font}" font-size="26" font-weight="${nameWeight}" fill="${t.text}">${row.label}</text>${detail}
  <rect x="${left}" y="${y}" width="${right - left}" height="${barH}" fill="${t.track}"/>
  <rect x="${left}" y="${y}" width="${w.toFixed(1)}" height="${barH}" fill="${fill}"/>
  <text x="${width - 44}" y="${y + 36}" text-anchor="end" font-family="${mono}" font-size="28" font-weight="${valueWeight}" fill="${row.highlight ? t.text : t.muted}">${fmt(row.bytes)}</text>`;
    })
    .join('');

  const ticks = [];
  for (let v = 0; v <= maxKb; v += tick) {
    const x = left + v * scale;
    ticks.push(
      `<line x1="${x.toFixed(1)}" y1="${height - 62}" x2="${x.toFixed(1)}" y2="${height - 54}" stroke="${t.axis}" stroke-width="2"/>`,
      `<text x="${x.toFixed(1)}" y="${height - 30}" text-anchor="middle" font-family="${mono}" font-size="15" fill="${t.muted}">${v}</text>`,
    );
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${ariaLabel}">
  <rect width="${width}" height="${height}" rx="18" fill="${t.bg}"/>
  <text x="44" y="60" font-family="${font}" font-size="34" font-weight="700" fill="${t.text}">${title}</text>
  <text x="44" y="98" font-family="${font}" font-size="22" fill="${t.muted}">${subtitle}</text>${bars}
  <line x1="${left}" y1="${height - 62}" x2="${right}" y2="${height - 62}" stroke="${t.axis}" stroke-width="2"/>
  ${ticks.join('\n  ')}
</svg>
`;
}

installOthers();
const all = await rows();
const chart = {
  file: 'size-chart',
  rows: all,
  title: 'What a Mattebox receiver page carries',
  subtitle: 'min+gzip · KB · both bundled from npm the same way, JavaScript only',
  ariaLabel: 'JavaScript size of a Mattebox Cast receiver page against Shaka Player, min+gzip',
  tick: 50,
};
mkdirSync(OUT, { recursive: true });
for (const theme of Object.keys(THEMES)) {
  const path = join(OUT, `${chart.file}-${theme}.svg`);
  writeFileSync(path, render(chart.rows, theme, chart));
  console.log(`wrote ${path}`);
}
for (const row of chart.rows) {
  console.log(
    `${row.label.padEnd(32)} ${row.version.padEnd(9)} ${fmt(row.bytes).padStart(10)}  (${row.detail.join(', ')})`,
  );
}
