/**
 * No framework on the page: a desktop browser. `start` binds the element and
 * `load` drives it through the path a `LOAD` message takes, which is what
 * the app's `?load` does.
 */
import { describe, expect, it } from 'vitest';
import type { CastLoad } from '../../src/index.js';
import { mount, silence } from './helpers.js';

function castLoad(url: string, extra: Partial<CastLoad> = {}): CastLoad {
  return {
    url,
    type: 'audio/wav',
    streamType: 'buffered',
    currentTime: 0,
    autoplay: true,
    tracks: [],
    metadata: { title: 'Simulated', images: [] },
    customData: null,
    ...extra,
  };
}

describe('without the framework', () => {
  it('start binds, load plays, stop goes idle', async () => {
    expect('cast' in globalThis).toBe(false);
    const { receiver, player } = mount();
    const titles: Array<string | undefined> = [];
    receiver.on('load', (load) => titles.push(load.metadata.title));

    const url = silence(2);
    const resolved = await receiver.load(castLoad(url));
    expect(resolved.url).toBe(url);
    expect(titles).toEqual(['Simulated']);
    expect(receiver.state).toBe('ready');
    await expect.poll(() => player.video.paused).toBe(false);

    receiver.stop();
    expect(receiver.state).toBe('idle');
    expect(player.hasAttribute('src')).toBe(false);
    await expect.poll(() => player.player?.session ?? null).toBeNull();
    player.remove();
  });

  it('load before start is an error', async () => {
    const { createReceiver } = await import('../../src/index.js');
    const dual = (await import('mattebox/presets/full')).default;
    await expect(createReceiver({ preset: dual }).load(castLoad('x'))).rejects.toThrow(/start/);
  });
});
