/**
 * The three ways a load goes, in a real browser with the real element: the
 * page's own connector, the library's connector over what the sender sent,
 * and the attributes. Each test gives the receiver a different set of
 * connectors and reads which way the player loaded.
 */
import type { AdsRemoteData } from '@mattebox/player-ads';
import { ads, adsOf } from '@mattebox/player-ads';
import type { Connector, PlayerError } from '@mattebox/player-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ErrorData } from '../../src/framework.js';
import type { CastProgramme } from '../../src/index.js';
import { CAST_CONNECTOR } from '../../src/index.js';
import type { FakeFramework } from '../fake-framework.js';
import { installFakeFramework } from '../fake-framework.js';
import { loadMessage, mount, silence } from './helpers.js';

let fake: FakeFramework;

beforeEach(() => {
  fake = installFakeFramework();
});

afterEach(() => {
  fake.uninstall();
  for (const player of document.querySelectorAll('mattebox-player')) player.remove();
});

const MARKERS = [{ start: 1, end: 2, kind: 'blocked' }];

/** A connector of the page: the id is looked up, and the programme plays what the page's API says. */
function pageConnector(url: string, asked: string[] = []): Connector<{ url: string }> {
  return {
    type: 'demo/id',
    async fetch(id) {
      asked.push(id);
      return { url };
    },
    resolve(data) {
      return {
        sources: [{ url: data.url, type: 'audio/wav' }],
        metadata: { title: 'From the receiver', markers: MARKERS },
      };
    },
  };
}

/** What the player's sender writes for a programme of the `demo/id` connector. */
function sent(extra: Record<string, unknown> = {}): { customData: object } {
  return {
    customData: {
      mattebox: {
        programme: { type: 'demo/id', id: '42' },
        metadata: { title: 'From the sender', markers: MARKERS },
        ...extra,
      },
    },
  };
}

describe('a programme the page has a connector for', () => {
  it('loads by its id, through the page connector', async () => {
    const asked: string[] = [];
    const own = silence(1);
    const { receiver, player } = mount({ connectors: [pageConnector(own, asked)] }, true);
    const errors: PlayerError[] = [];
    receiver.on('error', (error) => errors.push(error));

    await fake.send('LOAD', loadMessage(silence(1), { requestId: 4, ...sent() }));

    expect(receiver.state).toBe('ready');
    expect(asked).toEqual(['42']);
    expect(player.programme?.type).toBe('demo/id');
    expect(player.programme?.id).toBe('42');
    // The receiver's own URL plays, not the sender's.
    expect(player.player?.session?.source.url).toBe(own);
    expect(player.programme?.metadata?.title).toBe('From the receiver');
    expect(player.markers.list).toEqual(MARKERS);
    expect(player.hasAttribute('src')).toBe(false);
    expect(errors).toEqual([]);
    expect(fake.statuses.find((s) => s.requestId === 4)?.playerState).toBe('PAUSED');
  });

  it('seeks to where the sender was', async () => {
    const { player } = mount({ connectors: [pageConnector(silence(4))] }, true);
    await fake.send('LOAD', loadMessage(silence(1), { currentTime: 2, ...sent() }));
    await expect.poll(() => player.media.currentTime).toBeGreaterThanOrEqual(2);
  });

  it('shows a block, fails the LOAD, and clears it on stop', async () => {
    const blocking: Connector = {
      type: 'demo/id',
      fetch: async () => ({}),
      resolve: () => ({ sources: [], block: { message: 'Only in Switzerland' } }),
    };
    const { receiver, player } = mount({ connectors: [blocking] }, true);
    const idle: string[] = [];
    receiver.on('idle', (reason) => idle.push(reason));

    const out = (await fake.send('LOAD', loadMessage(silence(1), sent()))) as ErrorData;

    expect(out.type).toBe('LOAD_FAILED');
    expect(out.reason).toBe('connector/BLOCKED');
    expect(receiver.state).toBe('idle');
    expect(idle).toEqual(['error']);
    // No fallback to what the sender sent: the block is the answer.
    expect(player.programme?.type).toBe('demo/id');
    expect(player.blocked).toEqual({ message: 'Only in Switzerland' });
    expect(player.player?.session ?? null).toBeNull();

    receiver.stop();
    expect(player.blocked).toBeNull();
    expect(idle).toEqual(['error', 'stopped']);
  });

  it('keeps the error of a connector that fails, and does not fall back', async () => {
    const failing: Connector = {
      type: 'demo/id',
      fetch: async () => {
        throw new Error('HTTP 500');
      },
      resolve: () => ({ sources: [] }),
    };
    const { receiver, player } = mount({ connectors: [failing] }, true);
    const errors: PlayerError[] = [];
    receiver.on('error', (error) => errors.push(error));

    const out = (await fake.send('LOAD', loadMessage(silence(1), sent()))) as ErrorData;

    expect(out.type).toBe('LOAD_FAILED');
    expect(out.reason).toBe('connector/CONNECTOR_FAILED');
    expect(errors.map((error) => error.code)).toEqual(['CONNECTOR_FAILED']);
    // Once to each sender.
    expect(new Set(fake.errors.map((error) => error.reason))).toEqual(
      new Set(['connector/CONNECTOR_FAILED']),
    );
    expect(fake.errors).toHaveLength(2);
    expect(receiver.state).toBe('idle');
    // The player keeps the error for its error screen.
    expect(player.error?.code).toBe('CONNECTOR_FAILED');
    expect(player.programme?.type).toBe('demo/id');
  });
});

describe('a programme the page has no connector for', () => {
  it('loads what the sender sent, as a programme of the library connector', async () => {
    const url = silence(4);
    const { receiver, player } = mount({}, true);
    const errors: PlayerError[] = [];
    receiver.on('error', (error) => errors.push(error));
    // What a listener of the page hears on the player itself.
    const heard: string[] = [];
    player.addEventListener('error', (event) => heard.push(event.detail.code));
    player.addEventListener('programmechange', (event) => heard.push(event.detail?.type ?? ''));
    const ads = { urls: ['https://ads.example/vmap.xml'] };

    await fake.send(
      'LOAD',
      loadMessage(url, {
        requestId: 6,
        currentTime: 2,
        ...sent({ addons: { ads }, licenseUrl: 'https://drm.example/wv' }),
      }),
    );

    expect(receiver.state).toBe('ready');
    expect(player.programme?.type).toBe(CAST_CONNECTOR);
    // The sender's id names the programme.
    expect(player.programme?.id).toBe('42');
    expect(player.programme?.metadata?.title).toBe('From the sender');
    expect(player.markers.list).toEqual(MARKERS);
    const data = player.programme?.data as CastProgramme;
    expect(data.addons).toEqual({ ads });
    expect(data.source).toEqual({
      url,
      type: 'audio/wav',
      drm: { licenseUrl: 'https://drm.example/wv' },
      start: 2,
    });
    expect(player.player?.session?.source.url).toBe(url);
    expect(player.hasAttribute('src')).toBe(false);
    // The page has no `demo/id` connector, and no load was tried to find out:
    // one programme, and no error on the player, the receiver or the senders.
    expect(heard).toEqual([CAST_CONNECTOR]);
    expect(errors).toEqual([]);
    expect(fake.errors).toEqual([]);
    expect(fake.statuses.find((s) => s.requestId === 6)?.media?.contentId).toBe(url);
    await expect.poll(() => player.media.currentTime).toBeGreaterThanOrEqual(2);
  });

  it('gives the page the sent add-on sections in time for its own add-on', async () => {
    const { player } = mount({}, true);
    // What a receiver page with the ads add-on does: the library reads no section.
    const addon = ads();
    addon.attach?.(player);
    player.addEventListener('sourcechange', (event) => {
      const programme = player.programme;
      if (event.detail === null || programme?.type !== CAST_CONNECTOR) return;
      const given = (programme.data as CastProgramme).addons.ads as AdsRemoteData | undefined;
      if (given?.breaks !== undefined) adsOf(player).schedule(given.breaks);
    });
    const breaks = [{ offset: 600, vast: 'https://ads.example/mid.xml' }];

    await fake.send('LOAD', loadMessage(silence(1), sent({ addons: { ads: { breaks } } })));

    // The add-on holds the schedule for this programme: it was given after the add-on cleared the one before.
    expect(addon.remoteData?.(player)).toEqual({ breaks });
  });

  it("takes Cast's own title for a sender that wrote no metadata", async () => {
    const { player } = mount({}, true);
    await fake.send(
      'LOAD',
      loadMessage(silence(1), {
        media: { metadata: { title: 'Title', images: [{ url: 'https://i/a.jpg' }] } },
      }),
    );
    expect(player.programme?.type).toBe(CAST_CONNECTOR);
    expect(player.programme?.id).toBeUndefined();
    expect(player.programme?.metadata).toEqual({ title: 'Title', image: 'https://i/a.jpg' });
  });

  it('sets the attributes when the page gave the element no connectors of the receiver', async () => {
    const url = silence(1);
    // The receiver has a connector, but the page never asked it for the element's list.
    const { receiver, player } = mount({ connectors: [pageConnector(silence(1))] });
    const errors: PlayerError[] = [];
    receiver.on('error', (error) => errors.push(error));
    const heard: string[] = [];
    player.addEventListener('error', (event) => heard.push(event.detail.code));

    await fake.send('LOAD', loadMessage(url, sent({ chapters: 'https://cdn.example/c.vtt' })));

    expect(receiver.state).toBe('ready');
    expect(player.getAttribute('src')).toBe(url);
    expect(player.getAttribute('chapters')).toBe('https://cdn.example/c.vtt');
    expect(player.sources).toBeNull();
    expect(heard).toEqual([]);
    expect(errors).toEqual([]);
    expect(fake.errors).toEqual([]);
  });

  it('returns to nothing loaded on stop', async () => {
    const { receiver, player } = mount({}, true);
    await fake.send(
      'LOAD',
      loadMessage(silence(1), sent({ chapters: 'https://cdn.example/c.vtt' })),
    );
    expect(player.sources).not.toBeNull();
    receiver.stop();
    expect(player.sources).toBeNull();
    expect(player.hasAttribute('chapters')).toBe(false);
    await expect.poll(() => player.player?.session ?? null).toBeNull();
  });
});
