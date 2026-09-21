/**
 * The playground: a receiver page in a frame, under Google's real receiver
 * framework, and this page as the device's platform and one sender. The
 * frame's page comes through the playground's proxy, which puts
 * `platform.js` first in its head: it turns the framework's IPC socket into
 * messages to this window. The two pages are on two origins. Each control here sends the Cast media
 * message a sender would, and every message the framework answers is logged.
 */

import logoUrl from '../../../../docs/logo.svg';
import type { StreamEntry } from './catalogue.js';
import { STREAMS } from './catalogue.js';
import type { BusinessUnit, Composition, IlResource } from './srgssr.js';
import { BUSINESS_UNITS, fetchComposition, searchMedia, widevine } from './srgssr.js';

const MEDIA = 'urn:x-cast:com.google.cast.media';
const SYSTEM = 'urn:x-cast:com.google.cast.system';
const SENDER = 'playground';

/** The slice of a Cast track the playground reads. */
interface Track {
  trackId: number;
  type: 'AUDIO' | 'TEXT' | 'VIDEO';
  language?: string;
  name?: string;
}

/** The slice of a `MEDIA_STATUS` entry the playground reads. */
interface Status {
  mediaSessionId: number;
  playerState: string;
  idleReason?: string;
  currentTime: number;
  playbackRate: number;
  activeTrackIds?: number[];
  media?: { duration?: number; tracks?: Track[] };
  /** The window a live session can seek in, on the media's timeline. Absent on a buffered one. */
  liveSeekableRange?: { start?: number; end?: number; isMovingWindow?: boolean };
}

function $<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`playground: no #${id}`);
  return node as T;
}

const frame = $<HTMLIFrameElement>('receiver');
const stage = $('screen');
const state = $('state');
const session = $('session');
const seek = $<HTMLInputElement>('seek');
const time = $('time');
const duration = $('duration');
const rate = $<HTMLSelectElement>('rate');
const log = $('log');
const transport = $('transport');
const dialog = $<HTMLDialogElement>('content-dialog');

/** The receiver page through the proxy, and its origin: the one window this page talks to. Set from the server's config. */
let receiverUrl = 'about:blank';
let receiverOrigin = '';

let requestId = 0;
/** The last status: the session a command names, and the tracks the ids come from. */
let last: Status | null = null;
/** When `last` arrived, so the seek bar runs between two statuses. */
let lastAt = 0;
let seeking = false;

function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const pad = (n: number) => String(n).padStart(2, '0');
  const h = Math.floor(s / 3600);
  return h > 0
    ? `${h}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`
    : `${Math.floor(s / 60)}:${pad(s % 60)}`;
}

function write(way: 'in' | 'out' | 'error', summary: string, detail?: unknown): void {
  const item = document.createElement('li');
  item.dataset.way = way;
  const at = document.createElement('time');
  at.textContent = new Date().toLocaleTimeString([], { hour12: false }).slice(3);
  const arrow = document.createElement('b');
  arrow.textContent = way === 'out' ? '→' : way === 'in' ? '←' : '!';
  const details = document.createElement('details');
  const head = document.createElement('summary');
  head.textContent = summary;
  details.append(head);
  if (detail !== undefined) {
    const body = document.createElement('pre');
    body.textContent = JSON.stringify(detail, null, 2);
    details.append(body);
  }
  item.append(at, arrow, details);
  log.append(item);
  log.scrollTop = log.scrollHeight;
}

/** One message to the receiver, in the platform's envelope. */
function send(namespace: string, data: Record<string, unknown>): void {
  if (namespace === MEDIA) write('out', String(data.type), data);
  frame.contentWindow?.postMessage(
    {
      source: 'cast-sender',
      // The platform speaks as `SystemSender`, and the framework takes a system message from no one else.
      data: JSON.stringify({
        namespace,
        senderId: namespace === SYSTEM ? 'SystemSender' : SENDER,
        data: JSON.stringify(data),
      }),
    },
    receiverOrigin,
  );
}

/** A media command over the current session. */
function command(type: string, fields: Record<string, unknown> = {}): void {
  if (last === null) return;
  requestId += 1;
  send(MEDIA, { type, requestId, mediaSessionId: last.mediaSessionId, ...fields });
}

/** The MIME type a sender would send, by the URL's extension. */
function typeOf(url: string): string {
  const path = url.split(/[?#]/)[0] ?? '';
  if (path.endsWith('.mpd')) return 'application/dash+xml';
  if (path.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl';
  if (path.endsWith('.mp3')) return 'audio/mpeg';
  return 'video/mp4';
}

/** Seconds since the last status, which is how far a playing session and a moving window have run. */
function elapsed(): number {
  return (Date.now() - lastAt) / 1000;
}

/** Where the media is now: the last status, run forward while it plays. */
function now(): number {
  if (last === null) return 0;
  const running = last.playerState === 'PLAYING' ? elapsed() * last.playbackRate : 0;
  return Math.min(last.currentTime + running, last.media?.duration ?? Number.POSITIVE_INFINITY);
}

/**
 * The window of a live session, as a sender reads it: the status has no
 * duration, and `liveSeekableRange` instead. A moving window runs with the
 * clock between two statuses. Null on a buffered session.
 */
function liveWindow(): { start: number; end: number } | null {
  const range = last?.liveSeekableRange;
  if (last === null || last.playerState === 'IDLE') return null;
  if (typeof range?.start !== 'number' || typeof range.end !== 'number') return null;
  const moved = range.isMovingWindow === true ? elapsed() : 0;
  return { start: range.start + moved, end: range.end + moved };
}

/** Under this many seconds of window there is nowhere to seek: live without DVR. */
const DVR_WINDOW = 30;
/** The engine's edge sits some seconds behind the end of the window. Within this many, the playhead is at it. */
const AT_EDGE = 35;

function activeOf(type: Track['type']): number[] {
  const tracks = last?.media?.tracks ?? [];
  return (last?.activeTrackIds ?? []).filter(
    (id) => tracks.find((t) => t.trackId === id)?.type === type,
  );
}

/** One radio per track. An `EDIT_TRACKS_INFO` names every active id, so the other kind's are repeated. */
function renderTracks(type: 'AUDIO' | 'TEXT', host: HTMLElement): void {
  const tracks = (last?.media?.tracks ?? []).filter((t) => t.type === type);
  const active = activeOf(type);
  const heading = host.querySelector('h3');
  host.replaceChildren(...(heading === null ? [] : [heading]));
  if (tracks.length === 0) {
    const none = document.createElement('p');
    none.className = 'none';
    none.textContent = 'None reported';
    host.append(none);
    return;
  }
  const other = activeOf(type === 'AUDIO' ? 'TEXT' : 'AUDIO');
  const option = (label: string, id: number | null, checked: boolean) => {
    const row = document.createElement('label');
    row.className = 'track';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = type;
    radio.checked = checked;
    radio.addEventListener('change', () =>
      command('EDIT_TRACKS_INFO', { activeTrackIds: id === null ? other : [...other, id] }),
    );
    const small = document.createElement('small');
    small.textContent = id === null ? '' : `#${id}`;
    row.append(radio, label, ' ', small);
    host.append(row);
  };
  if (type === 'TEXT') option('Off', null, active.length === 0);
  for (const track of tracks) {
    option(
      track.name || track.language || 'Unnamed',
      track.trackId,
      active.includes(track.trackId),
    );
  }
}

function render(): void {
  const loaded = last !== null && last.playerState !== 'IDLE';
  state.textContent =
    last === null
      ? 'ready'
      : `${last.playerState}${last.idleReason ? ` · ${last.idleReason}` : ''}`;
  state.dataset.state = last?.playerState ?? 'IDLE';
  session.textContent = last === null ? 'No media session' : `Media session ${last.mediaSessionId}`;
  for (const control of transport.querySelectorAll<
    HTMLButtonElement | HTMLInputElement | HTMLSelectElement
  >('button, input, select')) {
    control.disabled = !loaded;
  }
  if (last !== null) rate.value = String(last.playbackRate);
  renderTracks('AUDIO', $('audio'));
  renderTracks('TEXT', $('text'));
}

/** The seek row, every frame: a buffered session by its duration, a live one by its window. */
function tick(): void {
  const live = liveWindow();
  const loaded = last !== null && last.playerState !== 'IDLE';
  $('to-live').hidden = live === null;
  duration.classList.toggle('live', live !== null);
  if (live !== null) {
    const dvr = live.end - live.start >= DVR_WINDOW;
    const behind = Math.max(0, live.end - now());
    seek.disabled = !dvr;
    seek.min = String(live.start);
    seek.max = String(live.end);
    duration.textContent = 'LIVE';
    if (!seeking) {
      seek.value = String(dvr ? now() : live.end);
      time.textContent = behind < AT_EDGE ? 'at the edge' : `-${clock(behind)}`;
    }
  } else {
    const total = last?.media?.duration;
    const known = typeof total === 'number' && Number.isFinite(total) && total > 0;
    seek.disabled = !loaded || !known;
    seek.min = '0';
    seek.max = String(known ? total : 0);
    duration.textContent = clock(known ? total : 0);
    if (!seeking) {
      seek.value = String(now());
      time.textContent = clock(now());
    }
  }
  requestAnimationFrame(tick);
}

window.addEventListener('message', (event) => {
  if (event.origin !== receiverOrigin || event.source !== frame.contentWindow) return;
  if (event.data?.source !== 'cast-platform') return;
  const message = JSON.parse(event.data.data) as { namespace: string; data: string };
  let data: Record<string, unknown> & { type?: string };
  try {
    data = JSON.parse(message.data);
  } catch {
    return;
  }
  if (data.type === 'ready') {
    // The platform's answer to `ready`: its own `ready`, which names the
    // application and the device and is what fires the context's READY
    // event, then one sender. A registered device is what the Cast debug
    // logger asks for before it draws its overlay.
    write('in', 'ready: the receiver context started');
    setTimeout(() => {
      send(SYSTEM, {
        type: 'ready',
        applicationId: 'PLAYGROUND',
        applicationName: 'Mattebox receiver playground',
        sessionId: 'playground-session',
        launchingSenderId: SENDER,
        deviceCapabilities: {
          display_supported: true,
          audio_assistant: false,
          is_hdr_supported: false,
          is_device_registered: true,
        },
      });
      send(SYSTEM, { type: 'senderconnected', senderId: SENDER, userAgent: SENDER });
    }, 10);
    state.textContent = 'ready';
    state.dataset.state = 'IDLE';
  } else if (data.type === 'MEDIA_STATUS') {
    const status = (data.status as Status[])[0];
    if (status === undefined) return;
    // A status without `media` repeats the last one's: the framework sends it once per load.
    const media = status.media ?? last?.media;
    last = media === undefined ? status : { ...status, media };
    lastAt = Date.now();
    write(
      'in',
      `MEDIA_STATUS ${status.playerState}${status.idleReason ? `/${status.idleReason}` : ''} at ${clock(status.currentTime)}`,
      data,
    );
    render();
  } else if (message.namespace === MEDIA) {
    write('error', String(data.type), data);
  }
});

/** What one `LOAD` carries, from whichever tab it came. */
interface Media {
  readonly url: string;
  readonly title: string;
  readonly type?: string;
  readonly live?: boolean;
  readonly licenseUrl?: string;
  readonly artwork?: string;
  /** The URL plays only with a token, and whose: the receiver fetches its own. */
  readonly token?: 'srgssr';
  readonly vtt?: { readonly url: string; readonly language: string };
  /** A receiver's own conventions, merged over the two this page knows. */
  readonly customData?: Record<string, unknown>;
}

function load(media: Media): void {
  dialog.close();
  requestId += 1;
  send(MEDIA, {
    type: 'LOAD',
    requestId,
    autoplay: $<HTMLInputElement>('autoplay').checked,
    // Absent unless asked for: a sender that names no time leaves the start to the receiver.
    ...($<HTMLInputElement>('start-on').checked
      ? { currentTime: Number($<HTMLInputElement>('start').value) || 0 }
      : {}),
    activeTrackIds: [],
    media: {
      contentId: media.url,
      contentType: media.type || typeOf(media.url),
      streamType: media.live === true ? 'LIVE' : 'BUFFERED',
      metadata: {
        metadataType: 0,
        title: media.title,
        subtitle: 'Playground',
        images: media.artwork === undefined ? [] : [{ url: media.artwork }],
      },
      tracks:
        media.vtt === undefined
          ? []
          : [
              {
                trackId: 100,
                type: 'TEXT',
                subtype: 'SUBTITLES',
                trackContentId: media.vtt.url,
                trackContentType: 'text/vtt',
                language: media.vtt.language,
                name: media.vtt.language,
              },
            ],
      // The two conventions the app reads: the library's own, and the key that names a token issuer.
      customData: {
        ...(media.licenseUrl === undefined ? {} : { mattebox: { licenseUrl: media.licenseUrl } }),
        ...(media.token === 'srgssr' ? { srgssr: { tokenType: 'AKAMAI' } } : {}),
        ...media.customData,
      },
    },
  });
}

/** One row of a list: a title, a line under it, and what choosing it does. */
function pick(title: string, meta: string, chosen: () => void): HTMLLIElement {
  const item = document.createElement('li');
  const button = document.createElement('button');
  button.type = 'button';
  const head = document.createElement('span');
  head.className = 'pick-title';
  head.textContent = title;
  button.append(head);
  if (meta !== '') {
    const line = document.createElement('span');
    line.className = 'pick-meta';
    line.textContent = meta;
    button.append(line);
  }
  button.addEventListener('click', () => {
    for (const other of document.querySelectorAll('.picks li.current'))
      other.classList.remove('current');
    item.classList.add('current');
    chosen();
  });
  item.append(button);
  return item;
}

function streamMedia(entry: StreamEntry): Media {
  return {
    url: entry.url,
    title: entry.label,
    ...(entry.type === undefined ? {} : { type: entry.type }),
    ...(entry.live === undefined ? {} : { live: entry.live }),
    ...(entry.licenseUrl === undefined ? {} : { licenseUrl: entry.licenseUrl }),
  };
}
$('streams').append(
  ...STREAMS.map((entry) => pick(entry.label, entry.note ?? '', () => load(streamMedia(entry)))),
);

$<HTMLFormElement>('custom').addEventListener('submit', (event) => {
  event.preventDefault();
  const url = $<HTMLInputElement>('url').value.trim();
  const vtt = $<HTMLInputElement>('vtt').value.trim();
  const licenseUrl = $<HTMLInputElement>('license').value.trim();
  const type = $<HTMLSelectElement>('type').value;
  // The receiver's own conventions, as JSON. Anything but an object is refused here, not sent.
  const note = $('custom-state');
  const raw = $<HTMLInputElement>('custom-data').value.trim();
  let customData: Record<string, unknown> | undefined;
  if (raw !== '') {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error();
      customData = parsed as Record<string, unknown>;
    } catch {
      note.textContent = 'customData has to be a JSON object.';
      note.classList.add('bad');
      return;
    }
  }
  note.classList.remove('bad');
  load({
    url,
    ...(customData === undefined ? {} : { customData }),
    title:
      $<HTMLInputElement>('title').value.trim() || (url.split(/[?#]/)[0]?.split('/').pop() ?? url),
    live: $<HTMLInputElement>('live').checked,
    ...(type === '' ? {} : { type }),
    ...(licenseUrl === '' ? {} : { licenseUrl }),
    ...($<HTMLInputElement>('token').checked ? { token: 'srgssr' as const } : {}),
    ...(vtt === ''
      ? {}
      : { vtt: { url: vtt, language: $<HTMLInputElement>('vtt-lang').value.trim() || 'en' } }),
  });
});

// ---- SRG SSR: the sender resolves the media and sends one resource ------------

{
  const bu = $<HTMLSelectElement>('search-bu');
  const query = $<HTMLInputElement>('search-query');
  const status = $('search-state');
  const results = $('search-results');
  const composition = $('composition');
  for (const unit of BUSINESS_UNITS) {
    const option = document.createElement('option');
    option.value = unit;
    option.textContent = unit.toUpperCase();
    bu.append(option);
  }
  bu.value = 'rts';
  let pending: AbortController | null = null;
  let debounce = 0;

  /** One request at a time: the next one ends the one in flight. */
  function next(): AbortSignal {
    pending?.abort();
    pending = new AbortController();
    return pending.signal;
  }

  function cell(text: string, className?: string): HTMLTableCellElement {
    const td = document.createElement('td');
    td.textContent = text;
    if (className !== undefined) td.className = className;
    return td;
  }

  function describe(resource: IlResource): string {
    const parts = [resource.streaming, resource.quality, resource.presentation];
    if (resource.mediaContainer) parts.push(resource.mediaContainer);
    if (resource.live) parts.push(resource.dvr ? 'live, DVR' : 'live');
    return parts.filter((part) => part).join(', ');
  }

  /** What a sender sends for a resource: its URL and type, the Widevine license URL, and whether it needs a token. */
  function send_(media: Composition, resource: IlResource): void {
    const licenseUrl = widevine(resource);
    load({
      url: resource.url,
      title: media.title,
      type: resource.mimeType,
      live: resource.live === true,
      ...(media.imageUrl === undefined ? {} : { artwork: media.imageUrl }),
      ...(licenseUrl === null ? {} : { licenseUrl }),
      ...(resource.tokenType === 'AKAMAI' ? { token: 'srgssr' as const } : {}),
    });
  }

  /** The media's resources, one row each, with a Send where a Chromecast can play it. */
  function renderComposition(media: Composition): void {
    const name = document.createElement('h3');
    name.className = 'composition-title';
    name.textContent = media.title;
    composition.replaceChildren(name);
    composition.hidden = false;
    if (media.resources.length === 0) {
      const none = document.createElement('p');
      none.className = 'hint';
      none.textContent = 'This media has no playable resource.';
      composition.append(none);
      return;
    }
    const table = document.createElement('table');
    table.className = 'resources';
    const head = document.createElement('tr');
    for (const text of ['Resource', 'DRM', 'Token', '']) {
      const th = document.createElement('th');
      th.scope = 'col';
      th.textContent = text;
      head.append(th);
    }
    const body = document.createElement('tbody');
    for (const resource of media.resources) {
      const row = document.createElement('tr');
      const drm = (resource.drmList ?? []).map((entry) => entry.type.toLowerCase()).join(', ');
      const token = resource.tokenType === 'AKAMAI';
      row.append(
        cell(describe(resource)),
        cell(drm === '' ? 'clear' : drm, drm === '' ? 'muted' : 'pill'),
        cell(token ? 'akamai' : 'none', token ? 'pill' : 'muted'),
      );
      const action = document.createElement('td');
      if (drm === '' || widevine(resource) !== null) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = 'Send';
        button.addEventListener('click', () => send_(media, resource));
        action.append(button);
      } else {
        action.className = 'muted';
        action.title = 'A Chromecast is Widevine, and this resource has no Widevine license';
        action.textContent = 'no Widevine';
      }
      row.append(action);
      body.append(row);
    }
    const thead = document.createElement('thead');
    thead.append(head);
    table.append(thead, body);
    composition.append(table);
  }

  async function resolveUrn(urn: string): Promise<void> {
    status.textContent = 'Resolving…';
    try {
      const media = await fetchComposition(urn, next());
      renderComposition(media);
      status.textContent = `${media.resources.length} resources. The receiver gets the one sent, never the URN.`;
    } catch (cause) {
      if ((cause as Error).name === 'AbortError') return;
      composition.hidden = true;
      status.textContent = `Could not resolve ${urn}: ${(cause as Error).message}`;
    }
  }

  async function search(text: string): Promise<void> {
    status.textContent = 'Searching…';
    composition.hidden = true;
    try {
      const found = await searchMedia(bu.value as BusinessUnit, text, next());
      results.replaceChildren(
        ...found.map((result) =>
          pick(
            result.title,
            `${result.mediaType.toLowerCase()} · ${result.date.slice(0, 10)} · ${clock(result.duration / 1000)}`,
            () => void resolveUrn(result.urn),
          ),
        ),
      );
      results.hidden = found.length === 0;
      status.textContent = found.length === 0 ? 'Nothing found.' : `${found.length} results.`;
    } catch (cause) {
      if ((cause as Error).name === 'AbortError') return;
      results.hidden = true;
      status.textContent = (cause as Error).message;
    }
  }

  /** Enter, or a new business unit: a URN resolves, anything else searches at once. */
  function submit(): void {
    clearTimeout(debounce);
    const text = query.value.trim();
    if (text === '') return;
    if (text.startsWith('urn:')) {
      results.hidden = true;
      void resolveUrn(text);
    } else void search(text);
  }

  $<HTMLFormElement>('search').addEventListener('submit', (event) => {
    event.preventDefault();
    submit();
  });
  // As in the player demo: the search runs once the typing stops. A URN waits for Enter.
  query.addEventListener('input', () => {
    clearTimeout(debounce);
    const text = query.value.trim();
    if (text === '' || text.startsWith('urn:')) {
      pending?.abort();
      results.hidden = true;
      return;
    }
    debounce = window.setTimeout(() => void search(text), 300);
  });
  bu.addEventListener('change', submit);
}

// ---- the chooser: one dialog, two routes ---------------------------------------

{
  const tabs = [...dialog.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  for (const tab of tabs) {
    tab.addEventListener('click', () => {
      for (const other of tabs) other.setAttribute('aria-selected', String(other === tab));
      for (const panel of dialog.querySelectorAll<HTMLElement>('[role="tabpanel"]')) {
        panel.hidden = panel.id !== `route-${tab.dataset.route}`;
      }
    });
  }
  $('open-content').addEventListener('click', () => dialog.showModal());
  $('close-content').addEventListener('click', () => dialog.close());
  // A click on the backdrop lands on the dialog itself, and closes it.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
}

// ---- the theme: one button, naming the theme it would switch to ----------------

{
  const KEY = 'mattebox.receiver.theme';
  const button = $<HTMLButtonElement>('theme-toggle');
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  const current = (): 'light' | 'dark' => {
    const set = document.documentElement.dataset.theme;
    if (set === 'light' || set === 'dark') return set;
    return system.matches ? 'dark' : 'light';
  };
  const paint = (): void => {
    const dark = current() === 'dark';
    button.textContent = dark ? '☀ Light' : '☾ Dark';
    button.setAttribute('aria-pressed', String(dark));
  };
  button.addEventListener('click', () => {
    const next = current() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Storage may be unavailable; the theme still changes.
    }
    paint();
  });
  // Follows the system until a choice is made.
  system.addEventListener('change', paint);
  paint();
}

{
  const on = $<HTMLInputElement>('start-on');
  const at = $<HTMLInputElement>('start');
  const sync = (): void => {
    at.disabled = !on.checked;
  };
  on.addEventListener('change', sync);
  sync();
}

for (const img of document.querySelectorAll<HTMLImageElement>('img.logo')) img.src = logoUrl;
{
  const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (icon !== null) icon.href = logoUrl;
}

for (const button of transport.querySelectorAll<HTMLButtonElement>('button[data-command]')) {
  button.addEventListener('click', () => command(button.dataset.command ?? ''));
}
rate.addEventListener('change', () =>
  command('SET_PLAYBACK_RATE', { playbackRate: Number(rate.value) }),
);
seek.addEventListener('input', () => {
  seeking = true;
  const live = liveWindow();
  time.textContent =
    live === null ? clock(Number(seek.value)) : `-${clock(live.end - Number(seek.value))}`;
});
// The end of the range is the edge: the receiver takes a seek there as a seek to live.
$('to-live').addEventListener('click', () => {
  const live = liveWindow();
  if (live !== null) command('SEEK', { currentTime: live.end });
});
seek.addEventListener('change', () => {
  seeking = false;
  command('SEEK', { currentTime: Number(seek.value) });
});
$('clear').addEventListener('click', () => log.replaceChildren());

/** Starts the receiver's page over: a new receiver context, and no media session. */
function restart(): void {
  last = null;
  state.textContent = 'starting';
  state.dataset.state = 'OFF';
  render();
  state.textContent = 'starting';
  // The receiver page's own URL, with the query the page asks for added to it.
  const url = new URL(receiverUrl);
  const extra = new URLSearchParams(
    $<HTMLInputElement>('page-query').value.trim().replace(/^\?/, ''),
  );
  for (const [key, value] of extra) url.searchParams.set(key, value);
  // Through a blank page, so the same URL loads again.
  frame.src = 'about:blank';
  setTimeout(() => {
    frame.src = url.href;
  }, 0);
}
$('reload').addEventListener('click', restart);
$('page-query').addEventListener('change', restart);

// The frame is a Chromecast's 1280 by 720 whatever room the page has, so the app's vh sizes read as on a television.
new ResizeObserver(() => {
  frame.style.transform = `scale(${stage.clientWidth / 1280})`;
}).observe(stage);

// The server says where the receiver page is: its own URL, on the proxy's origin.
const config = (await (await fetch('./config.json')).json()) as {
  receiver: string;
  target: string;
};
receiverUrl = config.receiver;
receiverOrigin = new URL(config.receiver).origin;
$('target').textContent = config.target;

restart();
tick();
