// Spike, second half: the app itself, the library and the player included,
// under the real receiver framework, with the device's IPC WebSocket faked
// by Playwright. It plays the platform and one sender against a real stream
// and prints every media message the framework sends back, shortened.
//
//   node scripts/spike/app.mjs [url] [contentType]
//
// Firefox, because Playwright's Chromium ships no H.264 decoder.
import { firefox } from 'playwright';
import { createServer } from 'vite';

const url =
  process.argv[2] ??
  'https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8';
const contentType = process.argv[3] ?? 'application/vnd.apple.mpegurl';

/** `wav:<seconds>` as the URL: a generated WAV in a data URL, which every browser plays natively. */
function wav(seconds) {
  const samples = Math.round(seconds * 8000);
  const bytes = Buffer.alloc(44 + samples, 128);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(36 + samples, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24);
  bytes.writeUInt32LE(8000, 28);
  bytes.writeUInt16LE(1, 32);
  bytes.writeUInt16LE(8, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(samples, 40);
  return `data:audio/wav;base64,${bytes.toString('base64')}`;
}
const contentId = url.startsWith('wav:') ? wav(Number(url.slice(4))) : url;
const MEDIA = 'urn:x-cast:com.google.cast.media';
const SYSTEM = 'urn:x-cast:com.google.cast.system';

const server = await createServer({ root: 'app', logLevel: 'error', server: { port: 5199 } });
await server.listen();
const browser = await firefox.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const started = Date.now();
const out = [];
const say = (line) =>
  out.push(`${((Date.now() - started) / 1000).toFixed(1).padStart(5)}s ${line}`);
page.on('pageerror', (e) => say(`[pageerror] ${e.message}`));
page.on('console', (m) => {
  if (process.env.SPIKE_CONSOLE === 'raw') console.log('RAW', m.type(), m.text().slice(0, 300));
  if (m.text().startsWith('mattebox receiver')) say(`[page] ${m.text()}`);
});

let socket = null;
await page.routeWebSocket(/localhost:8008/, (ws) => {
  socket = ws;
  ws.onMessage((raw) => {
    const message = JSON.parse(raw);
    let data = message.data;
    try {
      data = JSON.parse(message.data);
    } catch {}
    if (data?.type === 'ready') {
      say('<- ready');
      setTimeout(
        () =>
          send(SYSTEM, 'SystemSender', {
            type: 'senderconnected',
            senderId: 'sender-1',
            userAgent: 'probe',
          }),
        10,
      );
    } else if (data?.type === 'MEDIA_STATUS') {
      const s = data.status[0] ?? {};
      const tracks = (s.media?.tracks ?? [])
        .map((t) => `${t.trackId}:${t.type[0]}:${t.language}`)
        .join(' ');
      say(
        `<- MEDIA_STATUS req=${data.requestId} session=${s.mediaSessionId} ${s.playerState}` +
          `${s.idleReason ? `/${s.idleReason}` : ''} t=${s.currentTime?.toFixed?.(2)} rate=${s.playbackRate}` +
          `${s.media ? ` type=${s.media.contentType} dur=${s.media.duration?.toFixed?.(1)} stream=${s.media.streamType}` : ''}` +
          `${s.liveSeekableRange ? ` live=${s.liveSeekableRange.start.toFixed(0)}-${s.liveSeekableRange.end.toFixed(0)}` : ''}` +
          `${tracks === '' ? '' : ` tracks=[${tracks}]`} active=${JSON.stringify(s.activeTrackIds)}` +
          `${s.media?.metadata?.title ? ` title="${s.media.metadata.title}"` : ''}` +
          `${s.extendedStatus ? ` extended=${s.extendedStatus.playerState}` : ''}`,
      );
    } else if (message.namespace === MEDIA) {
      say(`<- ${JSON.stringify(data).slice(0, 300)}`);
    }
  });
});

function send(namespace, senderId, data) {
  if (namespace === MEDIA) say(`-> ${JSON.stringify(data).slice(0, 160)}`);
  socket.send(JSON.stringify({ namespace, senderId, data: JSON.stringify(data) }));
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const video = () =>
  page.evaluate(() => {
    const player = document.querySelector('mattebox-player');
    const v = player.video;
    return {
      handler: player.player?.session?.handler ?? null,
      paused: v.paused,
      time: Number(v.currentTime.toFixed(2)),
      rate: v.playbackRate,
      size: `${v.videoWidth}x${v.videoHeight}`,
      blob: v.src.startsWith('blob:'),
      src: player.hasAttribute('src'),
      heading: player.querySelector('mbx-title')?.getAttribute('heading') ?? null,
      engineTracks: (player.engine?.tracks.available ?? [])
        .map((t) => `${t.contentType}:${t.lang ?? ''}`)
        .join(' '),
    };
  });

await page.goto(`http://localhost:5199/${process.env.SPIKE_QUERY ?? ''}`);
if (process.env.SPIKE_CONSOLE)
  await page.evaluate(() => cast.framework.CastReceiverContext.getInstance().setLoggerLevel(0));
await wait(2500);
await page.exposeFunction('spikeError', (line) => say(`[player error] ${line}`));
await page.evaluate(() => {
  document
    .querySelector('mattebox-player')
    .addEventListener('error', (e) =>
      window.spikeError(JSON.stringify({ ...e.detail, trace: undefined }).slice(0, 600)),
    );
});
if (process.env.SPIKE_EVENTS) {
  await page.exposeFunction('spikeSay', (line) => say(`[video] ${line}`));
  await page.evaluate(() => {
    const v = document.querySelector('mattebox-player').video;
    for (const name of [
      'loadstart',
      'loadedmetadata',
      'canplay',
      'seeking',
      'seeked',
      'play',
      'playing',
      'pause',
      'waiting',
      'ended',
      'emptied',
      'error',
      'ratechange',
    ]) {
      v.addEventListener(name, () =>
        window.spikeSay(`${name} t=${v.currentTime.toFixed(2)} ready=${v.readyState}`),
      );
    }
  });
}
send(MEDIA, 'sender-1', {
  type: 'LOAD',
  requestId: 1,
  autoplay: !process.env.SPIKE_PAUSED,
  currentTime: process.env.SPIKE_PAUSED ? 0 : 60,
  media: {
    contentId,
    contentType,
    streamType: 'BUFFERED',
    metadata: { metadataType: 0, title: 'Tears of Steel', subtitle: 'Spike', images: [] },
  },
});
// The load is over once a status says something other than IDLE, or an error came back.
for (let i = 0; i < 120; i += 1) {
  if (
    out.some(
      (line) =>
        /MEDIA_STATUS.* (PLAYING|PAUSED|BUFFERING) /.test(line) || line.includes('LOAD_FAILED'),
    )
  )
    break;
  await wait(500);
}
await wait(4000);
say(`video ${JSON.stringify(await video())}`);
send(MEDIA, 'sender-1', { type: 'PAUSE', requestId: 2, mediaSessionId: 1 });
await wait(800);
send(MEDIA, 'sender-1', {
  type: 'SEEK',
  requestId: 3,
  mediaSessionId: 1,
  currentTime: process.env.SPIKE_SEEK ? Number(process.env.SPIKE_SEEK) : 300,
  resumeState: 'PLAYBACK_START',
});
await wait(5000);
say(`video ${JSON.stringify(await video())}`);
send(MEDIA, 'sender-1', {
  type: 'SET_PLAYBACK_RATE',
  requestId: 4,
  mediaSessionId: 1,
  playbackRate: 1.5,
});
await wait(600);
const status = out.filter((line) => line.includes('tracks=[')).pop() ?? '';
const audio = [...status.matchAll(/(\d+):A:/g)].map((m) => Number(m[1]));
const text = [...status.matchAll(/(\d+):T:/g)].map((m) => Number(m[1]));
if (audio.length > 1 || text.length > 0) {
  const ids = [audio[audio.length - 1], text[0]].filter((id) => id !== undefined);
  send(MEDIA, 'sender-1', {
    type: 'EDIT_TRACKS_INFO',
    requestId: 5,
    mediaSessionId: 1,
    activeTrackIds: ids,
  });
  await wait(2500);
}
send(MEDIA, 'sender-1', { type: 'STOP', requestId: 6, mediaSessionId: 1 });
await wait(1500);
say(`video ${JSON.stringify(await video())}`);

console.log(out.join('\n'));
await browser.close();
await server.close();
