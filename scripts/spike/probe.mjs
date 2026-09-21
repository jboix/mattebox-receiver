// Spike probe: the real receiver framework in desktop Chromium, with the
// device's IPC WebSocket faked by Playwright. It plays the platform and one
// sender, and prints every message the framework sends back.
//
//   node scripts/spike/probe.mjs <experiment>
import { chromium as chrome, firefox, webkit } from 'playwright';

const chromium = { chromium: chrome, firefox, webkit }[process.env.SPIKE_BROWSER ?? 'chromium'];

const experiment = process.argv[2] ?? 'A';
const MEDIA = 'urn:x-cast:com.google.cast.media';
const SYSTEM = 'urn:x-cast:com.google.cast.system';

const browser = await chromium.launch();
const page = await browser.newPage();
const out = [];
page.on('pageerror', (e) => out.push(`[pageerror] ${e.message}`));
page.on('console', (m) => {
  const text = m.text();
  if (text.startsWith('SPIKE')) out.push(text);
  else if (process.env.SPIKE_CONSOLE && !/IpcChannel|CastMessageBus|WebSocket/.test(text))
    out.push(`   fw: ${text.slice(0, 200)}`);
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
    out.push(
      `<- ${message.namespace.split('.').pop()} to=${message.senderId} ${JSON.stringify(data).slice(0, 700)}`,
    );
    if (data?.type === 'ready') {
      // The platform's answer to `ready`, then one sender.
      setTimeout(
        () =>
          toReceiver(SYSTEM, 'SystemSender', {
            type: 'senderconnected',
            senderId: 'sender-1',
            userAgent: 'probe',
          }),
        10,
      );
    }
  });
});

function toReceiver(namespace, senderId, data) {
  out.push(`-> ${data.type} ${JSON.stringify(data).slice(0, 200)}`);
  socket.send(JSON.stringify({ namespace, senderId, data: JSON.stringify(data) }));
}

await page.goto('https://example.com/');
await page.setContent(`<video muted></video>
<script src="https://www.gstatic.com/cast/sdk/libs/caf_receiver/v3/cast_receiver_framework.js"></script>`);
await page.waitForFunction(() => 'cast' in window);

await page.evaluate((experiment) => {
  // A WAV the page loads itself: the element the framework did not load.
  function silence(seconds) {
    const samples = Math.round(seconds * 8000);
    const bytes = new Uint8Array(44 + samples).fill(128, 44);
    const view = new DataView(bytes.buffer);
    const ascii = (o, t) => {
      for (let i = 0; i < t.length; i += 1) view.setUint8(o + i, t.charCodeAt(i));
    };
    ascii(0, 'RIFF');
    view.setUint32(4, 36 + samples, true);
    ascii(8, 'WAVEfmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 8000, true);
    view.setUint32(28, 8000, true);
    view.setUint16(32, 1, true);
    view.setUint16(34, 8, true);
    ascii(36, 'data');
    view.setUint32(40, samples, true);
    return URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
  }
  const video = document.querySelector('video');
  let emptied = 0;
  video.addEventListener('emptied', () => {
    emptied += 1;
    console.log(`SPIKE emptied #${emptied} src=${video.src.slice(0, 30)}`);
  });
  const context = cast.framework.CastReceiverContext.getInstance();
  const manager = context.getPlayerManager();
  const own = experiment.startsWith('B');
  let session = 0;

  // C: the framework holds a stand-in that reads through to the video and
  // ignores `src` and `load()`, so its own load cannot touch the page's.
  function standIn() {
    const ignored = new Set([
      'src',
      'load',
      'setAttribute',
      'removeAttribute',
      'autoplay',
      'preload',
    ]);
    const attributes = {};
    const listeners = new Map();
    const replay = () => {
      // The framework waits for the load it thinks it started. The video
      // fired these before the framework listened, so they are told again,
      // to the framework's listeners alone.
      for (const name of [
        'loadstart',
        'durationchange',
        'loadedmetadata',
        'loadeddata',
        'canplay',
        'canplaythrough',
      ]) {
        for (const fn of [...(listeners.get(name) ?? [])]) fn.call(video, new Event(name));
      }
    };
    return new Proxy(video, {
      get(target, key) {
        if (key === 'addEventListener')
          return (name, fn, options) => {
            listeners.set(name, [...(listeners.get(name) ?? []), fn]);
            target.addEventListener(name, fn, options);
          };
        if (key === 'removeEventListener')
          return (name, fn, options) => {
            listeners.set(
              name,
              (listeners.get(name) ?? []).filter((held) => held !== fn),
            );
            target.removeEventListener(name, fn, options);
          };
        if (key === 'load') return () => console.log('SPIKE stand-in: load() ignored');
        if (key === 'setAttribute')
          return (n, v) => {
            attributes[n] = v;
          };
        if (key === 'removeAttribute')
          return (n) => {
            delete attributes[n];
          };
        if (key === 'getAttribute') return (n) => attributes[n] ?? null;
        if (key === 'src') return attributes.src ?? '';
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
      set(target, key, value) {
        if (ignored.has(key)) {
          console.log(`SPIKE stand-in: ${String(key)}= ignored`);
          attributes[key] = value;
          if (key === 'src' && value) setTimeout(replay, 0);
          return true;
        }
        return Reflect.set(target, key, value, target);
      },
    });
  }
  const held = experiment.startsWith('C') ? standIn() : null;
  if (held === null && !own) manager.setMediaElement(video);
  manager.setMessageInterceptor('LOAD', async (request) => {
    if (experiment.includes('late')) {
      // The engine's case: the session exists before the video has its metadata.
      setTimeout(() => {
        video.src = silence(30);
      }, 300);
      return request;
    }
    video.src = silence(30);
    await new Promise((r) => video.addEventListener('loadedmetadata', r, { once: true }));
    console.log(`SPIKE own load done, duration=${video.duration}`);
    session += 1;
    if (own) {
      setTimeout(() => manager.broadcastStatus(true, request.requestId), 0);
      return null;
    }
    // Cmask: the framework is told a type its basic player takes, so it does not wait for Shaka or MPL.
    if (experiment.includes('mask')) request.media.contentType = 'video/mp4';
    return request;
  });
  manager.setMessageInterceptor('MEDIA_STATUS', (status) => {
    console.log(`SPIKE status before: ${JSON.stringify(status).slice(0, 400)}`);
    if (own && session > 0) {
      status.mediaSessionId = session;
      status.playerState = video.paused ? 'PAUSED' : 'PLAYING';
      status.currentTime = video.currentTime;
      status.media = {
        contentId: 'own',
        contentType: 'audio/wav',
        streamType: 'BUFFERED',
        duration: video.duration,
      };
    }
    return status;
  });
  if (experiment.startsWith('C')) {
    // Answered by the page: run, ask for a status, stop the framework's own handling.
    for (const type of ['SET_PLAYBACK_RATE', 'EDIT_TRACKS_INFO']) {
      manager.setMessageInterceptor(type, (request) => {
        console.log(`SPIKE intercepted ${type} ${JSON.stringify(request)}`);
        if (type === 'SET_PLAYBACK_RATE') video.playbackRate = request.playbackRate;
        manager.broadcastStatus(true, request.requestId);
        return null;
      });
    }
    manager.setMessageInterceptor('STOP', (request) => {
      console.log('SPIKE intercepted STOP, passed on');
      return request;
    });
    window.spikeStop = () => {
      manager.setIdleReason('ERROR');
      manager.stop();
    };
  }
  if (own) {
    for (const type of ['PLAY', 'PAUSE', 'SEEK']) {
      manager.setMessageInterceptor(type, (request) => {
        console.log(`SPIKE intercepted ${type} ${JSON.stringify(request)}`);
        if (type === 'PLAY') video.play();
        else if (type === 'PAUSE') video.pause();
        else video.currentTime = request.currentTime;
        setTimeout(() => manager.broadcastStatus(true, request.requestId), 50);
        return null;
      });
    }
  }
  context.start({
    ...(held === null ? {} : { mediaElement: held }),
    skipPlayersLoad: true,
    disableIdleTimeout: own,
    supportedCommands: 12303,
  });
}, experiment);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await wait(800);
const type = experiment.includes('hls') ? 'application/vnd.apple.mpegurl' : 'audio/wav';
toReceiver(MEDIA, 'sender-1', {
  type: 'LOAD',
  requestId: 1,
  autoplay: false,
  currentTime: 0,
  media: {
    contentId: 'https://example.com/media',
    contentType: type,
    streamType: 'BUFFERED',
    tracks: [
      {
        trackId: 7,
        type: 'TEXT',
        subtype: 'SUBTITLES',
        trackContentId: 'https://example.com/ca.vtt',
        trackContentType: 'text/vtt',
        name: 'Català',
        language: 'ca',
      },
    ],
  },
});
await wait(1500);
toReceiver(MEDIA, 'sender-1', { type: 'PLAY', requestId: 2, mediaSessionId: 1 });
await wait(800);
toReceiver(MEDIA, 'sender-1', { type: 'SEEK', requestId: 3, mediaSessionId: 1, currentTime: 12 });
await wait(800);
toReceiver(MEDIA, 'sender-1', { type: 'GET_STATUS', requestId: 4 });
await wait(500);
if (experiment.startsWith('C')) {
  toReceiver(MEDIA, 'sender-1', {
    type: 'SET_PLAYBACK_RATE',
    requestId: 5,
    mediaSessionId: 1,
    playbackRate: 1.5,
  });
  await wait(400);
  toReceiver(MEDIA, 'sender-1', {
    type: 'EDIT_TRACKS_INFO',
    requestId: 6,
    mediaSessionId: 1,
    activeTrackIds: [7],
  });
  await wait(400);
  out.push(
    `children of the video: ${await page.evaluate(() => document.querySelector('video').innerHTML)}`,
  );
  if (experiment.includes('stopapi')) await page.evaluate(() => window.spikeStop());
  else toReceiver(MEDIA, 'sender-1', { type: 'STOP', requestId: 7, mediaSessionId: 1 });
  await wait(600);
}
const end = await page.evaluate(() => {
  const v = document.querySelector('video');
  return { paused: v.paused, time: v.currentTime, src: v.src.slice(0, 40) };
});
console.log(out.join('\n'));
console.log('video at the end:', JSON.stringify(end));
await browser.close();
