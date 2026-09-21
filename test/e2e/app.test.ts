/**
 * The app's page, from its own sources: index.html's markup and main.ts,
 * with a query string a developer would type. No device and no framework,
 * so this is the `?load` path, the one a desktop browser takes.
 */
import type { MatteboxPlayerElement } from '@mattebox/player';
import { beforeAll, describe, expect, it } from 'vitest';
import page from '../../app/index.html?raw';
import '../../app/src/style.css';

/** A valid WAV in a data URL: a source every browser plays, and that a query string can carry. */
function silence(seconds: number): string {
  const samples = Math.round(seconds * 8000);
  const bytes = new Uint8Array(44 + samples).fill(128, 44);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
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
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:audio/wav;base64,${btoa(binary)}`;
}

function player(): MatteboxPlayerElement {
  const found = document.querySelector('mattebox-player');
  if (found === null) throw new Error('the page has no player');
  return found;
}

describe('the receiver page', () => {
  beforeAll(async () => {
    const markup = /<body>([\s\S]*)<script type="module"/.exec(page)?.[1];
    if (markup === undefined) throw new Error('index.html has no body to mount');
    document.body.innerHTML = markup;
    const query = new URLSearchParams({
      load: silence(2),
      type: 'audio/wav',
      title: 'A title',
      subtitle: 'A subtitle',
      artwork: 'https://example.com/a.jpg',
    });
    history.replaceState(null, '', `?${query}`);
    await import('../../app/src/main.js');
  });

  it('swaps the parsed player for one with the receiver chain, controls and attributes included', () => {
    expect(document.querySelectorAll('mattebox-player')).toHaveLength(1);
    expect(player().getAttribute('controls')).toBe('custom');
    const tags = [...player().children].map((node) => node.localName);
    expect(tags.filter((tag) => tag === 'video')).toHaveLength(1);
    expect(tags).toEqual(expect.arrayContaining(['mbx-title', 'mbx-spinner', 'mbx-control-bar']));
    // Nothing on the device is clickable: the bar carries no button.
    expect(player().querySelector('mbx-play-button, mbx-start-button')).toBeNull();
  });

  it('?load drives the player through the bridge, natively for a WAV', async () => {
    await expect.poll(() => player().player?.session?.handler, { timeout: 15_000 }).toBe('native');
    expect(player().hasAttribute('src')).toBe(true);
    await expect.poll(() => player().video.paused).toBe(false);
  });

  it("writes the title's three attributes from the load's metadata", () => {
    const title = player().querySelector('mbx-title');
    expect(title?.getAttribute('heading')).toBe('A title');
    expect(title?.getAttribute('subheading')).toBe('A subtitle');
    expect(title?.getAttribute('artwork')).toBe('https://example.com/a.jpg');
  });

  it('shows the wallpaper once nothing is loaded, and hides the video and the bar under it', async () => {
    await expect.poll(() => player().hasAttribute('src'), { timeout: 10_000 }).toBe(false);
    expect(player().matches('mattebox-player:not([src])')).toBe(true);
    // Hidden with its box kept: the engine sizes the first rendition to it.
    expect(getComputedStyle(player().video).visibility).toBe('hidden');
    const bar = player().querySelector('mbx-control-bar');
    expect(bar === null ? 'hidden' : getComputedStyle(bar).visibility).toBe('hidden');
    expect(getComputedStyle(player()).backgroundImage).toContain('gradient');
  });
});
