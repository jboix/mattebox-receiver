/**
 * The demo receiver page: the reference integration of
 * `@mattebox/cast-receiver`. The markup is in index.html. Everything here is
 * the page's: which elements it composes, how the title is written, the
 * resolver, and the two query flags.
 *
 *   ?load=<url>    runs the bridge without a device, for desktop work
 *                  (&type=, &title=, &subtitle=, &artwork=, &license=, &thumbnails=, &token=srgssr, &live, &t=)
 *   ?debug         turns the Cast debug logger and its overlay on
 */
import '@mattebox/player/elements/control-bar';
import '@mattebox/player/elements/current-time';
import '@mattebox/player/elements/duration';
import '@mattebox/player/elements/live-button';
import '@mattebox/player/elements/seek-bar';
import '@mattebox/player/elements/spinner';
import '@mattebox/player/elements/title';
import type { CastLoad } from '@mattebox/cast-receiver';
import { createReceiver } from '@mattebox/cast-receiver';
import { MatteboxPlayerElement } from '@mattebox/player/element';
import full from 'mattebox/presets/full';
import logoUrl from '../../docs/logo.svg';
import { resolve } from './resolve.js';

const query = new URLSearchParams(location.search);
const debug = query.has('debug');

const LOGGER_URL =
  'https://www.gstatic.com/cast/sdk/libs/devtools/debug_layer/caf_receiver_logger.js';

/** The debug logger is a script of its own, and it goes after the framework's. Only behind the flag. */
function loadLogger(): Promise<void> {
  return new Promise((done) => {
    const script = document.createElement('script');
    script.src = LOGGER_URL;
    script.addEventListener('load', () => done());
    // Without it the receiver still runs, and says so where a developer looks.
    script.addEventListener('error', () => {
      console.warn('mattebox receiver: the Cast debug logger did not load');
      done();
    });
    document.head.append(script);
  });
}

// A television shows no tab. The icon is for the desktop, where the page is worked on.
{
  const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (icon !== null) icon.href = logoUrl;
}

/**
 * The player, with the receiver's chain.
 *
 * Wanted: the three lines of the library's guide, with
 * `MatteboxPlayerElement.define({ handlers })` reaching the player in the
 * markup. Importing the player registers the element, imports run before
 * this module's own code, and an element upgraded by then keeps the empty
 * defaults for good. Had to: build a second player with the chain, move
 * the markup's attributes and controls into it, and swap it in. The surface
 * that would make it one call: options the element reads at its first load,
 * or a registration the page can hold back.
 */
function adopt(parsed: Element, options: ConstructorParameters<typeof MatteboxPlayerElement>[0]) {
  const player = new MatteboxPlayerElement(options);
  for (const { name, value } of Array.from(parsed.attributes)) player.setAttribute(name, value);
  // The parsed player put its own video among its children. The controls move, the video stays behind.
  for (const child of Array.from(parsed.children)) {
    if (child.localName !== 'video') player.append(child);
  }
  parsed.replaceWith(player);
  return player;
}

/** A sender's load, from the query string. */
function simulated(url: string): CastLoad {
  const text = (name: string): string | undefined => query.get(name) ?? undefined;
  const type = text('type');
  const title = text('title');
  const subtitle = text('subtitle');
  const artwork = text('artwork');
  const license = text('license');
  const sprites = text('thumbnails');
  const token = text('token');
  return {
    url,
    ...(type === undefined ? {} : { type }),
    streamType: query.has('live') ? 'live' : 'buffered',
    currentTime: Number(query.get('t') ?? 0) || 0,
    autoplay: true,
    tracks: [],
    metadata: {
      ...(title === undefined ? {} : { title }),
      ...(subtitle === undefined ? {} : { subtitle }),
      images: artwork === undefined ? [] : [artwork],
    },
    customData: {
      mattebox: {
        ...(license === undefined ? {} : { licenseUrl: license }),
        ...(sprites === undefined ? {} : { thumbnails: sprites }),
      },
      // `&token=srgssr`: the URL needs SRG SSR's Akamai token.
      ...(token === 'srgssr' ? { srgssr: { tokenType: 'AKAMAI' } } : {}),
    },
  };
}

async function main(): Promise<void> {
  const parsed = document.querySelector('mattebox-player');
  if (parsed === null) throw new Error('the page has no <mattebox-player>');
  if (debug) await loadLogger();

  // The `full` preset: every protocol and tier, with `cmcd` and `thumbnails`.
  // A page that wants fewer bytes passes a smaller preset, and one that
  // wants a stage off names it in `without`.
  const receiver = createReceiver({ preset: full, resolve, debug });
  const player = adopt(parsed, { handlers: receiver.handlers() });

  // A television plays sound. The markup says `muted` for the desktop, where
  // a browser refuses to autoplay anything else.
  const device = /CrKey\//.test(navigator.userAgent);
  if (device) player.removeAttribute('muted');

  // The title's three attributes, from what the sender sent.
  const title = player.querySelector('mbx-title');
  receiver.on('load', ({ metadata }) => {
    title?.setAttribute('heading', metadata.title ?? '');
    title?.setAttribute('subheading', metadata.subtitle ?? '');
    const artwork = metadata.images[0];
    if (artwork === undefined) title?.removeAttribute('artwork');
    else title?.setAttribute('artwork', artwork);
  });
  receiver.on('error', (error) => {
    console.error(`mattebox receiver: ${error.category}/${error.code}`, error);
  });

  receiver.start(player);

  const url = query.get('load');
  if (url !== null) {
    // The same path a LOAD message takes, without a sender.
    receiver.load(simulated(url)).catch((cause) => {
      console.error('mattebox receiver: the simulated load failed', cause);
    });
  }
}

void main();
