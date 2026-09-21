/**
 * The bridge over a faked `cast.framework`, in a real browser with the real
 * element. The native sessions play a generated WAV, so play, pause, seek
 * and the end are the browser's own. The engine sessions load a manifest
 * from the test server, which is all a session needs to exist.
 */
import type { PlayerError } from '@mattebox/player-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ErrorData, MediaStatus } from '../../src/framework.js';
import type { CastLoad, IdleReason, Load, Receiver } from '../../src/index.js';
import type { FakeFramework } from '../fake-framework.js';
import { installFakeFramework } from '../fake-framework.js';
import { fixture, loadMessage, mount, silence, volumeWritable } from './helpers.js';

let fake: FakeFramework;

beforeEach(() => {
  fake = installFakeFramework();
});

afterEach(() => {
  fake.uninstall();
  for (const player of document.querySelectorAll('mattebox-player')) player.remove();
});

/**
 * A `LOAD` of the HLS fixture. The fixture is playlists alone, so the video
 * never gets its metadata, and the framework, which waits for it, never
 * finishes its own load. The receiver's side is over once it is ready.
 */
async function loadEngine(receiver: Receiver, message: object): Promise<void> {
  void fake.send('LOAD', message);
  await expect.poll(() => receiver.state).toBe('ready');
}

function last(): MediaStatus {
  const status = fake.statuses[fake.statuses.length - 1];
  if (status === undefined) throw new Error('no status went out');
  return status;
}

describe('start', () => {
  it("starts the context once, without Google's players", () => {
    const { receiver, player } = mount();
    expect(fake.started).toHaveLength(1);
    expect(fake.started[0]?.skipPlayersLoad).toBe(true);
    expect(() => receiver.start(player)).toThrow(/once/);
  });

  it('creates no element and appends nothing', () => {
    const before = document.body.querySelectorAll('*').length;
    const { player } = mount();
    const own = player.querySelectorAll('*').length + 1;
    expect(document.body.querySelectorAll('*').length).toBe(before + own);
    expect(player.hasAttribute('src')).toBe(false);
  });

  it('turns the debug logger on once the context is ready, and only when asked', () => {
    mount({ debug: true });
    expect(fake.logger.enabled).toBe(false);
    fake.fire('ready');
    // With a level for the core events: the logger logs none until it has one.
    expect(fake.logger).toEqual({
      enabled: true,
      shown: true,
      events: { 'cast.framework.events.category.CORE': 800 },
    });
  });

  it('leaves the debug logger off by default', () => {
    mount();
    fake.fire('ready');
    expect(fake.logger.enabled).toBe(false);
  });
});

describe('LOAD', () => {
  it('goes through resolve to the element, and the status answers the request', async () => {
    const seen: Array<[CastLoad, Load]> = [];
    const url = silence(1);
    const { receiver, player } = mount();
    receiver.on('load', (load, resolved) => seen.push([load, resolved]));

    expect(receiver.state).toBe('idle');
    const sent = fake.send('LOAD', loadMessage(url, { requestId: 11 }));
    expect(receiver.state).toBe('loading');
    await sent;

    expect(receiver.state).toBe('ready');
    expect(player.getAttribute('src')).toBe(url);
    expect(player.getAttribute('type')).toBe('audio/wav');
    expect(player.player?.session?.handler).toBe('native');
    expect(seen).toHaveLength(1);
    expect(seen[0]?.[0].url).toBe(url);

    const status = fake.statuses.find((s) => s.requestId === 11);
    expect(status?.playerState).toBe('PAUSED');
    expect(status?.media?.contentId).toBe(url);
    expect(status?.media?.streamType).toBe('BUFFERED');
    expect(status?.mediaSessionId).toBe(1);
  });

  it('plays on autoplay and starts where the sender was', async () => {
    const { player } = mount();
    await fake.send('LOAD', loadMessage(silence(4), { autoplay: true, currentTime: 2 }));
    await expect.poll(() => player.video.paused).toBe(false);
    await expect.poll(() => player.video.currentTime).toBeGreaterThanOrEqual(2);
    await expect.poll(() => last().playerState).toBe('PLAYING');
    expect(last().media?.duration).toBeCloseTo(4, 1);
  });

  it("uses the page's resolve, and sets the attributes it returns before src", async () => {
    const url = silence(1);
    const { player } = mount({
      resolve: async (load) => ({
        url,
        type: 'audio/wav',
        licenseUrl: `https://drm.example/${String((load.customData as { id: string }).id)}`,
        thumbnails: 'https://cdn.example/sprites.vtt',
      }),
    });
    await fake.send(
      'LOAD',
      loadMessage('urn:page:42', { customData: { id: 'abc' }, media: { contentType: 'x/urn' } }),
    );
    expect(player.getAttribute('src')).toBe(url);
    expect(player.getAttribute('license-url')).toBe('https://drm.example/abc');
    expect(player.getAttribute('thumbnails')).toBe('https://cdn.example/sprites.vtt');
    // The sender hears of the content it named, not of what the page made of it.
    expect(last().media?.contentId).toBe('urn:page:42');
  });

  it('clears what the load before it set', async () => {
    const { player } = mount();
    await fake.send(
      'LOAD',
      loadMessage(silence(1), { customData: { mattebox: { licenseUrl: 'https://drm.example' } } }),
    );
    expect(player.getAttribute('license-url')).toBe('https://drm.example');
    await fake.send('LOAD', loadMessage(silence(1)));
    expect(player.hasAttribute('license-url')).toBe(false);
  });

  it('gives the metadata back in the status', async () => {
    mount();
    await fake.send(
      'LOAD',
      loadMessage(silence(1), {
        media: {
          metadata: { title: 'Title', subtitle: 'Sub', images: [{ url: 'https://i/a.jpg' }] },
        },
      }),
    );
    expect(last().media?.metadata).toEqual({
      metadataType: 0,
      title: 'Title',
      subtitle: 'Sub',
      images: [{ url: 'https://i/a.jpg' }],
    });
  });

  it('lets the later of two loads win', async () => {
    const { receiver, player } = mount();
    const second = silence(2);
    const first = fake.send('LOAD', loadMessage(silence(1), { requestId: 1 }));
    const later = fake.send('LOAD', loadMessage(second, { requestId: 2 }));
    expect(((await first) as ErrorData).type).toBe('LOAD_CANCELLED');
    expect(((await later) as { requestId: number }).requestId).toBe(2);
    expect(player.getAttribute('src')).toBe(second);
    expect(receiver.state).toBe('ready');
  });
});

describe('the commands', () => {
  it('are calls on the video, each answered with a status', async () => {
    const { player } = mount();
    const video = player.video;
    await fake.send('LOAD', loadMessage(silence(4)));

    await fake.send('PLAY', { requestId: 2 });
    await expect.poll(() => video.paused).toBe(false);
    expect(fake.statuses.some((s) => s.requestId === 2)).toBe(true);

    await fake.send('PAUSE', { requestId: 3 });
    expect(video.paused).toBe(true);
    expect(fake.statuses.find((s) => s.requestId === 3)?.playerState).toBe('PAUSED');

    await fake.send('SEEK', { requestId: 4, currentTime: 3 });
    await expect.poll(() => video.currentTime).toBeCloseTo(3, 1);
    await expect.poll(() => last().currentTime).toBeCloseTo(3, 1);

    await fake.send('SEEK', { requestId: 5, relativeTime: -2, resumeState: 'PLAYBACK_START' });
    await expect.poll(() => video.paused).toBe(false);
    expect(video.currentTime).toBeLessThan(3);
    await fake.send('PAUSE', { requestId: 6 });

    const writable = volumeWritable();
    await fake.send('SET_VOLUME', { requestId: 7, volume: { level: 0.25, muted: false } });
    expect(video.muted).toBe(false);
    await expect.poll(() => last().volume?.muted).toBe(false);
    if (writable) {
      expect(video.volume).toBeCloseTo(0.25, 3);
      await expect.poll(() => last().volume?.level).toBeCloseTo(0.25, 3);
    }

    await fake.send('SET_PLAYBACK_RATE', { requestId: 8, playbackRate: 1.5 });
    expect(video.playbackRate).toBe(1.5);
    await fake.send('SET_PLAYBACK_RATE', { requestId: 9, relativePlaybackRate: 2 });
    expect(video.playbackRate).toBe(3);
    await expect.poll(() => last().playbackRate).toBe(3);
  });

  it('STOP returns the player to :not([src]) and tells the senders why', async () => {
    const reasons: IdleReason[] = [];
    const { receiver, player } = mount();
    receiver.on('idle', (reason) => reasons.push(reason));
    await fake.send('LOAD', loadMessage(silence(1)));
    await fake.send('STOP', { requestId: 5 });

    expect(player.matches('mattebox-player:not([src])')).toBe(true);
    expect(player.hasAttribute('type')).toBe(false);
    expect(receiver.state).toBe('idle');
    expect(reasons).toEqual(['stopped']);
    await expect.poll(() => player.player?.session ?? null).toBeNull();
    const idle = fake.statuses.find((s) => s.playerState === 'IDLE' && s.idleReason !== undefined);
    expect(idle?.idleReason).toBe('CANCELLED');
  });

  it('the end of the media is FINISHED, and the receiver goes idle', async () => {
    const reasons: IdleReason[] = [];
    const { receiver, player } = mount();
    receiver.on('idle', (reason) => reasons.push(reason));
    await fake.send('LOAD', loadMessage(silence(0.25), { autoplay: true }));
    await expect.poll(() => reasons, { timeout: 5000 }).toEqual(['finished']);
    expect(fake.statuses.some((s) => s.idleReason === 'FINISHED')).toBe(true);
    expect(player.hasAttribute('src')).toBe(false);
  });
});

describe('errors', () => {
  it('a load the player refuses fails the LOAD, reaches every sender, and ends idle', async () => {
    const errors: PlayerError[] = [];
    const { receiver, player } = mount();
    receiver.on('error', (error) => errors.push(error));
    const out = (await fake.send(
      'LOAD',
      loadMessage(fixture('missing.mp4'), { requestId: 9, media: { contentType: 'video/mp4' } }),
    )) as ErrorData;

    expect(out.type).toBe('LOAD_FAILED');
    expect(out.requestId).toBe(9);
    expect(out.reason).toMatch(/^media\/MEDIA_/);
    expect(errors).toHaveLength(1);
    expect(fake.errors.map((e) => e.senderId)).toEqual(['sender-1', 'sender-2']);
    expect(fake.errors[0]?.reason).toBe(out.reason);
    expect(fake.errors[0]?.customData).toEqual({
      mattebox: { category: 'media', code: errors[0]?.code, fatal: true },
    });
    expect(fake.statuses.some((s) => s.idleReason === 'ERROR')).toBe(true);
    expect(receiver.state).toBe('idle');
    expect(player.hasAttribute('src')).toBe(false);
  });

  it('a load with no URL never reaches the element', async () => {
    const { player } = mount();
    const out = (await fake.send('LOAD', { requestId: 3, media: {} })) as ErrorData;
    expect(out.type).toBe('LOAD_FAILED');
    expect(out.reason).toBe('config/CONFIG_INVALID');
    expect(player.hasAttribute('src')).toBe(false);
  });
});

describe('an engine session', () => {
  const master = fixture('hls/master.m3u8');

  it('routes HLS to the engine, and every request through the hooks of its load', async () => {
    const urls: string[] = [];
    const { receiver, player } = mount({
      resolve: (load) => ({
        url: load.url,
        ...(load.type === undefined ? {} : { type: load.type }),
        requestHooks: [(request) => urls.push(request.url)],
      }),
    });
    await loadEngine(
      receiver,
      loadMessage(master, { media: { contentType: 'application/vnd.apple.mpegurl' } }),
    );
    expect(player.player?.session?.handler).toBe('mattebox');
    expect(urls[0]).toBe(master);

    // The next load has no hooks, and the first load's no longer run.
    await fake.send('LOAD', loadMessage(silence(1)));
    const count = urls.length;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(urls.length).toBe(count);
  });

  /** The stages the session's engine composed, by name, off `engine.capabilities`. */
  async function composed(without?: readonly string[]): Promise<readonly string[]> {
    const { receiver, player } = mount(without === undefined ? {} : { without });
    await loadEngine(
      receiver,
      loadMessage(master, { media: { contentType: 'application/vnd.apple.mpegurl' } }),
    );
    return [...(player.engine?.capabilities() ?? [])];
  }

  it("composes the preset's every stage by default", async () => {
    const stages = await composed();
    expect(stages).toContain('cmcd');
    expect(stages).toContain('thumbnails');
  });

  it("leaves out the preset's stages named in `without`", async () => {
    const stages = await composed(['cmcd']);
    expect(stages).not.toContain('cmcd');
    expect(stages).toContain('thumbnails');
  });

  it('reports the tracks under stable ids and selects through engine.tracks', async () => {
    const { receiver, player } = mount();
    await loadEngine(
      receiver,
      loadMessage(master, {
        media: {
          contentType: 'application/vnd.apple.mpegurl',
          tracks: [
            {
              trackId: 1,
              type: 'TEXT',
              trackContentId: fixture('subs-ca.vtt'),
              trackContentType: 'text/vtt',
              subtype: 'SUBTITLES',
              name: 'Català',
              language: 'ca',
            },
          ],
        },
      }),
    );
    const tracks = last().media?.tracks ?? [];
    expect(tracks.map((t) => [t.trackId, t.type, t.language])).toEqual([
      [1, 'TEXT', 'ca'],
      [2, 'AUDIO', 'en'],
      [3, 'AUDIO', 'fr'],
      [4, 'TEXT', 'de'],
    ]);
    expect(last().activeTrackIds).toEqual([2]);

    await fake.send('EDIT_TRACKS_INFO', { requestId: 2, activeTrackIds: [3, 4] });
    const engine = player.engine;
    await expect.poll(() => engine?.tracks.active('audio')?.lang).toBe('fr');
    await expect.poll(() => engine?.tracks.active('text')?.lang).toBe('de');
    await expect.poll(() => last().activeTrackIds).toEqual([3, 4]);

    await fake.send('EDIT_TRACKS_INFO', { requestId: 3, activeTrackIds: [3] });
    await expect.poll(() => engine?.tracks.active('text') ?? null).toBeNull();
  });

  it("applies the memory profile's trace ring, and a config of the page's over it", async () => {
    const { receiver, player } = mount({ config: { bufferGoalSeconds: 7 } });
    await loadEngine(
      receiver,
      loadMessage(master, { media: { contentType: 'application/vnd.apple.mpegurl' } }),
    );
    expect(player.engine?.stats.snapshot().scheduling.bufferGoal).toBe(7);
  });
});

describe("a sender's text track on a native session", () => {
  it('is shown and hidden through the mode of the track the page put on the video', async () => {
    const { player } = mount();
    // The page's part: the library appends nothing.
    player.addEventListener('sourcechange', (event) => {
      if (event.detail === null) return;
      const track = document.createElement('track');
      track.kind = 'subtitles';
      track.label = 'Català';
      track.srclang = 'ca';
      track.src = fixture('subs-ca.vtt');
      player.video.append(track);
    });
    await fake.send(
      'LOAD',
      loadMessage(silence(1), {
        media: {
          tracks: [
            {
              trackId: 4,
              type: 'TEXT',
              trackContentId: fixture('subs-ca.vtt'),
              subtype: 'SUBTITLES',
              name: 'Català',
              language: 'ca',
            },
          ],
        },
      }),
    );
    await fake.send('EDIT_TRACKS_INFO', { requestId: 2, activeTrackIds: [4] });
    expect(player.video.textTracks[0]?.mode).toBe('showing');
    await expect.poll(() => last().activeTrackIds).toEqual([4]);

    await fake.send('EDIT_TRACKS_INFO', { requestId: 3, activeTrackIds: [] });
    expect(player.video.textTracks[0]?.mode).toBe('disabled');

    await fake.send('EDIT_TRACKS_INFO', { requestId: 4, language: 'ca-ES' });
    expect(player.video.textTracks[0]?.mode).toBe('showing');
  });
});

describe('custom messages', () => {
  it('pass through untouched, each namespace to its handler, with the sender id', () => {
    const got: unknown[] = [];
    mount({
      messages: [
        { namespace: 'urn:x-cast:a', onMessage: (id, data) => got.push(['a', id, data]) },
        { namespace: 'urn:x-cast:b', onMessage: (id, data) => got.push(['b', id, data]) },
      ],
    });
    expect(fake.started[0]?.customNamespaces).toEqual({
      'urn:x-cast:a': 'JSON',
      'urn:x-cast:b': 'JSON',
    });
    const data = { any: ['thing'] };
    fake.custom('urn:x-cast:b', 'sender-2', data);
    expect(got).toEqual([['b', 'sender-2', data]]);
    expect(got[0]).toContain(data);
  });
});

describe("the framework's stand-in", () => {
  it('keeps the load the framework makes off the video, and tells it the load events again', async () => {
    const { player } = mount();
    const video = player.video;
    expect(fake.started[0]?.mediaElement).not.toBe(video);

    const url = silence(2);
    let emptied = 0;
    await fake.send('LOAD', loadMessage(url, { requestId: 4 }));
    video.addEventListener('emptied', () => {
      emptied += 1;
    });
    // The framework assigned its URL and got its metadata, and the video never saw either.
    expect(fake.loads).toHaveLength(1);
    expect(video.src).toBe(url);
    expect(emptied).toBe(0);
    expect(fake.statuses.some((s) => s.requestId === 4 && s.playerState === 'PAUSED')).toBe(true);
  });

  it('gives the framework a type and a URL its basic player takes, and the senders the real ones', async () => {
    const { receiver } = mount();
    await loadEngine(
      receiver,
      loadMessage(fixture('hls/master.m3u8'), {
        media: { contentType: 'application/vnd.apple.mpegurl' },
      }),
    );
    await expect.poll(() => fake.loads.length).toBe(1);
    expect(fake.loads[0]?.media?.contentType).toBe('video/mp4');
    expect(fake.loads[0]?.media?.contentUrl).not.toContain('.m3u8');
    // A track event of the engine's sends a status while the framework still loads.
    await expect.poll(() => fake.statuses.length).toBeGreaterThan(0);
    expect(last().media?.contentType).toBe('application/vnd.apple.mpegurl');
    expect(last().media?.contentId).toBe(fixture('hls/master.m3u8'));
    expect(last().media?.contentUrl).toBeUndefined();
  });

  it("leaves a live stream's start to the engine", async () => {
    mount();
    await fake.send('LOAD', loadMessage(silence(1), { currentTime: 0.5 }));
    expect(fake.loads[0]?.currentTime).toBe(0.5);
  });

  it("drops the framework's currentTime: the start is the engine's, and a seek is the library's", async () => {
    const { player } = mount();
    await fake.send('LOAD', loadMessage(silence(4)));
    player.video.currentTime = 2;
    const held = fake.started[0]?.mediaElement as HTMLMediaElement;
    // The write the framework ends its load with, of zero when the request names no time.
    held.currentTime = 0;
    expect(player.video.currentTime).toBe(2);
    // The read is still the video's.
    expect(held.currentTime).toBe(2);
  });

  it('is the video for the framework: its play, pause, seek and volume land there', async () => {
    const { player } = mount();
    await fake.send('LOAD', loadMessage(silence(4)));
    await fake.send('PLAY', { requestId: 2 });
    await expect.poll(() => player.video.paused).toBe(false);
    await fake.send('SEEK', { requestId: 3, currentTime: 3 });
    await expect.poll(() => player.video.currentTime).toBeGreaterThanOrEqual(3);
    const writable = volumeWritable();
    await fake.send('SET_VOLUME', { requestId: 4, volume: { level: 0.5, muted: false } });
    expect(player.video.muted).toBe(false);
    if (writable) expect(player.video.volume).toBeCloseTo(0.5, 3);
    expect(fake.dropped).toEqual([]);
  });

  it("ends the framework's own session when the receiver goes idle by itself", async () => {
    const { receiver } = mount();
    await fake.send('LOAD', loadMessage(silence(1)));
    receiver.stop();
    await expect.poll(() => last().playerState).toBe('IDLE');
    expect(last().idleReason).toBe('CANCELLED');
    // The framework holds no session any more: a command now is dropped.
    await fake.send('PLAY', { requestId: 9 });
    expect(fake.dropped).toEqual(['PLAY']);
  });
});
