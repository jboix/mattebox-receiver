import { MatteboxPlayerElement } from '@mattebox/player';
import full from 'mattebox/presets/full';
import type { Receiver, ReceiverOptions } from '../../src/index.js';
import { createReceiver } from '../../src/index.js';

/**
 * A valid WAV, so a native session in a hermetic test reaches `loadedmetadata`
 * instead of a MediaError. 8-bit mono at 8 kHz of silence. The same helper
 * the player's tests use.
 */
export function silence(seconds = 0.125): string {
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
  return URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
}

/**
 * A fixture's URL on the test server, which serves the repository root. Not
 * `new URL(..., import.meta.url)`: Vite rewrites that form into an asset
 * lookup, and a playlist is no asset it knows.
 */
export function fixture(path: string): string {
  return `${location.origin}/packages/cast-receiver/test/browser/fixtures/${path}`;
}

export interface Mounted {
  readonly receiver: Receiver;
  readonly player: MatteboxPlayerElement;
}

/** The page's three lines: a receiver, its chain given to the element, and the start over it. */
export function mount(options: Partial<ReceiverOptions> = {}): Mounted {
  const receiver = createReceiver({ preset: full, ...options });
  const player = new MatteboxPlayerElement({ handlers: receiver.handlers() });
  // Muted, as the app's markup has it: a headless browser refuses to autoplay sound.
  player.setAttribute('muted', '');
  player.setAttribute('controls', 'none');
  document.body.append(player);
  receiver.start(player);
  return { receiver, player };
}

/** A `LOAD` message the way the player's sender builds it. */
export function loadMessage(url: string, extra: Record<string, unknown> = {}): object {
  const { media, ...request } = extra;
  return {
    requestId: 1,
    autoplay: false,
    currentTime: 0,
    ...request,
    media: {
      contentId: url,
      contentType: 'audio/wav',
      streamType: 'BUFFERED',
      ...(media as object),
    },
  };
}

/**
 * Whether this browser honours a write to `video.volume`. Playwright's
 * WebKit on Linux does not, reliably: the level belongs to the system's
 * audio stream, and a video reads back that stream's level, sometimes the
 * one written and sometimes the one a test before it left. `muted` is the
 * element's own everywhere, so the tests always check that.
 */
export function volumeWritable(): boolean {
  return !/AppleWebKit/.test(navigator.userAgent) || /Chrome\//.test(navigator.userAgent);
}
