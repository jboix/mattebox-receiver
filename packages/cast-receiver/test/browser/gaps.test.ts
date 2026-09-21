/**
 * The player's gaps the receiver reaches around, pinned as they are in the
 * released player. Each test states today's behaviour, so the day the
 * player closes a gap its test fails, and the workaround it names goes.
 */
import '@mattebox/player';
import { MatteboxPlayerElement } from '@mattebox/player';
import type { Source } from '@mattebox/player-core';
import { nativeHandler } from '@mattebox/player-core';
import { afterEach, describe, expect, it } from 'vitest';
import { silence } from './helpers.js';

afterEach(() => {
  for (const player of document.querySelectorAll('mattebox-player')) player.remove();
});

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('gaps in @mattebox/player, as released', () => {
  it('define(options) never reaches a player that is already in the page (app/src/main.ts)', async () => {
    // Importing the package registers the element, and imports run before
    // the module's own code, so a player in the markup is upgraded with the
    // empty defaults before `define({ handlers })` can run.
    const parsed = document.createElement('mattebox-player');
    parsed.setAttribute('muted', '');
    parsed.setAttribute('type', 'audio/wav');
    document.body.append(parsed);

    const native = nativeHandler();
    // The page's own chain: the native handler, under a name that tells it apart.
    const page = {
      ...native,
      name: 'page',
      handle: async (source: Source, video: HTMLMediaElement) => ({
        ...(await native.handle(source, video)),
        handler: 'page',
      }),
    };
    MatteboxPlayerElement.define({ handlers: [page] });
    try {
      parsed.setAttribute('src', silence(1));
      // The element resolves its default preset with a dynamic import first.
      await expect.poll(() => parsed.player?.session?.handler, { timeout: 10_000 }).toBe('native');

      // A player created after the call does get them.
      const later = document.createElement('mattebox-player');
      later.setAttribute('muted', '');
      later.setAttribute('type', 'audio/wav');
      later.setAttribute('src', silence(1));
      document.body.append(later);
      await expect.poll(() => later.player?.session?.handler).toBe('page');
    } finally {
      MatteboxPlayerElement.define({});
    }
  });

  it('removing src does not unload: the core keeps its session (receiver.ts, toIdle)', async () => {
    const player = new MatteboxPlayerElement({ handlers: [nativeHandler()] });
    player.setAttribute('muted', '');
    player.setAttribute('src', silence(1));
    document.body.append(player);
    await expect.poll(() => player.player?.session?.handler).toBe('native');

    player.removeAttribute('src');
    await wait(100);
    // The guide says removing `src` unloads. The session is still there.
    expect(player.player?.session).not.toBeNull();
    expect(player.video.getAttribute('src')).not.toBeNull();
  });

  it('the bar wakes on a pause, and not on a seek that no pointer or key made', async () => {
    const player = new MatteboxPlayerElement({ handlers: [nativeHandler()] });
    player.setAttribute('muted', '');
    player.setAttribute('controls', 'custom');
    player.innerHTML =
      '<mbx-control-bar idle-ms="50"><mbx-current-time></mbx-current-time><mbx-seek-bar></mbx-seek-bar></mbx-control-bar>';
    player.setAttribute('src', silence(4));
    document.body.append(player);
    await expect.poll(() => player.player?.session?.handler).toBe('native');
    await player.video.play();
    await expect.poll(() => player.hasAttribute('idle'), { timeout: 3000 }).toBe(true);

    // A sender's seek: the bar stays hidden, so the viewer sees no position.
    player.video.currentTime = 2;
    await wait(150);
    expect(player.hasAttribute('idle')).toBe(true);

    // A sender's pause does wake it: the bar never hides over a paused video.
    player.video.pause();
    await wait(150);
    expect(player.hasAttribute('idle')).toBe(false);
  });
});
