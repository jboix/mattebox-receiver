# 02 Loads

This chapter explains what happens when a sender sends a `LOAD` message. It
shows the request that the library gives you, how `resolve` converts it for
the player, and what the library sends back to the senders.

## The request

The library reads the sender's `LOAD` message and gives you a `CastLoad`:

```ts
interface CastLoad {
  url: string; // contentUrl, else contentId
  type?: string; // contentType
  streamType: "buffered" | "live";
  currentTime: number;
  autoplay: boolean; // true unless the request says false
  tracks: CastLoadTrack[]; // the sender's text tracks
  metadata: { title?: string; subtitle?: string; images: string[] };
  hlsSegmentFormat?: string;
  customData: unknown; // the request's, else the media's
}
```

## resolve

Every integrator needs the `resolve` option. It is a function that receives
the `CastLoad` and returns a `Load`, which is what the player loads. Your
function can be asynchronous.

```ts
interface Load {
  url: string;
  type?: string;
  licenseUrl?: string;
  licenseUrls?: Record<string, string>;
  certificateUrl?: string;
  thumbnails?: string;
  chapters?: string;
  requestHooks?: Array<
    (request: { url: string; headers: Record<string, string> }) => void
  >;
}
```

The library uses each member of the `Load` as follows:

| Member           | What the library does with it                                                                              |
| ---------------- | ---------------------------------------------------------------------------------------------------------- |
| `url`            | Is what plays, unless a connector of your page resolves the sender's programme                             |
| `type`           | Is the source's type. The player trusts `type` over the URL's extension                                    |
| `licenseUrl`     | Is the source's license server. The player gives it to `engine.drm.setLicenseUrl`                          |
| `licenseUrls`    | Gives the engine one license server per key system, with `engine.drm.setLicenseUrls`. Engine sessions only |
| `certificateUrl` | Is the FairPlay or Widevine service certificate of the source                                              |
| `thumbnails`     | Sets the element's `thumbnails`. You need the `thumbnails` stage and `<mbx-seek-bar>`                      |
| `chapters`       | Sets the element's `chapters`, the URL of a WebVTT chapters file                                           |
| `requestHooks`   | Calls each hook for every request that the engine makes for this load. This includes the license request   |

The default function is `defaultResolve`. It copies the request's `url` and
`type`, and it reads one key of `customData`.

## customData.mattebox

`defaultResolve` reads the `mattebox` key of `customData`. The sender sets
it like this:

```ts
button.addEventListener("castload", (event) => {
  event.detail.customData = {
    mattebox: {
      licenseUrl: "https://drm.example/widevine",
      licenseUrls: { "com.microsoft.playready": "https://drm.example/playready" },
      certificateUrl: "https://drm.example/fairplay.cer",
      licenseHeaders: { "x-token": token },
      thumbnails: "https://cdn.example/sprites.vtt",
    },
  };
});
```

Every member is optional. `@mattebox/player-cast` fills in `licenseUrl`,
`licenseUrls` and `certificateUrl` from the source's `drm`. The library
converts `licenseHeaders` into a request hook. The hook adds the headers to
the requests to the license servers and to no other request.

`@mattebox/player-cast` also sends the programme under the same key. The
bridge reads these members, not `defaultResolve`:

| Member        | What it is                                                                                    |
| ------------- | --------------------------------------------------------------------------------------------- |
| `programme`   | The connector the sender's programme came from: `{ type, id }`, or `{ type, data }`           |
| `metadata`    | The title, the subtitle, the description, the image, the poster, the chapters and the markers |
| `chapters`    | The URL of a chapters file, which `defaultResolve` copies to the `Load`                       |
| `videoTracks` | The other versions of the picture, such as sign language                                      |
| `date`        | The clock time a live viewer watches, in epoch seconds. Absent at the live edge               |
| `addons`      | What each add-on of the sender's page sent, under its name                                    |

The library reads nothing else from `customData`. This library defines a
shape for the `mattebox` key only.

## The programme

The library loads the player one of three ways:

| The page                                                            | The load                                              |
| ------------------------------------------------------------------- | ----------------------------------------------------- |
| Gave `createReceiver` a connector of the sender's `programme` type  | The sender's `programme`, through your connector      |
| Gave the element `receiver.connectors()`, and has no such connector | What the sender sent, through the library's connector |
| Never called `receiver.connectors()`                                | The `Load` alone, through the element's attributes    |

- Your connector fetches the programme by its id. It gives its own URL,
  token, metadata, markers and block. The sender's URL is not used.
- The library's connector makes a programme of type `mattebox/cast`
  (`CAST_CONNECTOR`). The player applies the sent markers, poster and
  chapters as for any programme. `player.programme.data` is a
  `CastProgramme`: the `source`, the `metadata` and the `addons` of the
  sender's page.
- The attributes are `src`, `type`, `license-url` and `certificate-url`.
  The sent metadata and markers are not applied.
- The library chooses before it loads, from the `connectors` option. Give
  your connectors there: the library does not see a connector you give to
  `define()` yourself.
- A connector that fails is the answer. The `LOAD` fails with the
  connector's error, and the player keeps the error.
- A connector that blocks the programme fails the `LOAD` with the reason
  `connector/BLOCKED`. The player keeps the block.

The library reads no add-on section. Your page gives a section to its own
add-on, at each session. For the ads of `@mattebox/player-ads`:

```ts
import { CAST_CONNECTOR } from "@mattebox/cast-receiver";
import { ads, adsOf } from "@mattebox/player-ads";

// Attach the add-on here, not in `define()`: its listener has to run before yours.
ads().attach(player);
// The add-on clears its schedule at each session. Yours is given after that.
player.addEventListener("sourcechange", (event) => {
  const programme = player.programme;
  if (event.detail === null || programme?.type !== CAST_CONNECTOR) return;
  const sent = programme.data.addons.ads;
  for (const url of sent?.urls ?? []) void adsOf(player).load(url);
  if (sent?.breaks) adsOf(player).schedule(sent.breaks);
});
```

- A programme your own connector resolved has its own ads. The sent section
  is for a programme made of what the sender sent.
- HLS interstitials need the engine's `interstitials` stage. Pass it in the
  receiver's `stages`.

## Token refresh

A token can expire during a session. Pass the `eme-core` factory as
`emeCore`, and a license server's 401 or 403 asks the senders for a new
token.

```ts
import emeCore from "mattebox/stages/eme-core";

const receiver = createReceiver({ preset: full, emeCore });
```

- The receiver sends `{ type: "unauthorized", id, keySystem, status }` on
  `urn:x-cast:ch.mattebox.license` to every sender.
- The sender replies `{ type: "license", id, licenseHeaders }`, and may add
  `licenseUrl` or `licenseUrls`. `@mattebox/player-cast` does this through
  its `castunauthorized` event.
- The headers then go on every license request of the load. The license
  request goes again once.
- Without a reply in 10 seconds, the request goes again unchanged and fails.
- The engine calls the hook from version 0.15. An older engine ignores it.

## Tokens

Your sender can send a token in `customData`. You read the token in your own
`resolve` function and add it to the requests with a request hook.

```ts
import { createReceiver, defaultResolve } from "@mattebox/cast-receiver";

const receiver = createReceiver({
  preset: full,
  resolve: async (load) => {
    const { token } = load.customData as { token: string };
    const base = defaultResolve(load);
    return {
      ...base,
      requestHooks: [
        ...(base.requestHooks ?? []),
        (request) => {
          request.headers.authorization = `Bearer ${token}`;
        },
      ],
    };
  },
});
```

Each load gets new hooks. The engine and its handler stay the same between
loads.

## Routing

The library does not read a preset name from the load, and it does not
choose an engine for each load. One engine with the `full` preset plays HLS
and DASH.

The engine does not accept some sources, such as an mp4 or an mp3. These
sources go to the native handler, which is the last handler.

A load without a `contentType` still reaches the engine. The engine's
adapters read the manifest to detect its format.

## DRM

A Chromecast supports Widevine only. It cannot play FairPlay content. If
your resolver chooses between several resources of the same content, it must
choose the resource that has a Widevine license.

## Tracks

The library gives the senders one list of Cast tracks. It assigns the track
ids with these rules:

- The sender's own text tracks keep the ids that the sender gave them.
- The engine's audio and text tracks take the next free numbers. In a native session, the video's text tracks take them instead.
- The library assigns an id once per load and never changes it. An `EDIT_TRACKS_INFO` message therefore always names a track that still exists.
- The library leaves out forced subtitle tracks. The engine shows them by itself while no subtitle is selected.
- The library leaves out tracks the device cannot decode, as `engine.tracks.selectable` reports them.
- An engine track takes the manifest's name (HLS `NAME`, DASH `Label`), or its language code without one.

When a sender sends `EDIT_TRACKS_INFO`, the library selects the engine's
tracks through `engine.tracks`.

A sender's text track is a `<track>` element on the video. On a device, the
framework adds that element. The library shows or hides the track with its
`mode`.

A native session has no audio tracks, because Chromium never shipped
`AudioTrackList`.

## Live

A load with a `streamType` of `LIVE` works the same way as any other load.
The library ignores the sender's `currentTime`, and the stream starts at the
live edge.

A `@mattebox/player-cast` sender that plays behind the edge sends
`customData.mattebox.date`. The library seeks to that clock time, through
the engine's `pdt` namespace. A date outside the window stays at the edge.

The status contains the seekable range. The library takes the range from the
engine's availability window. When a sender seeks to the end of the range,
the library calls `engine.live.seekToEdge()`.

## The status

The library does not store the status. It reads the values each time it
sends the status:

- It reads the time, the duration, the rate and the volume from the video.
- It computes the player state from the video's `paused` and `ended` and from the player's `waiting`.
- It reads the tracks from the engine, or from the video in a native session.

## Errors

The player emits an `error` event for every error, fatal or not. The library
sends each one to every sender as a Cast `ERROR` message. The `reason` of
the message is `category/code`, for example `drm/DRM_LICENSE_FAILED`. The
`customData.mattebox` of the message contains the category, the code and
`fatal`.

When the player refuses a load, the library answers the `LOAD` message with
`LOAD_FAILED`.

After a fatal error, the receiver becomes idle, and the status says `IDLE`
with the idle reason `ERROR`. The player unloads, except after a connector's
error or a block: the player keeps those, so an `<mbx-error-screen>` shows
why nothing plays. The next load or `stop()` clears them.

## Custom messages

You can receive messages on your own namespaces. List them in the `messages`
option:

```ts
createReceiver({
  preset: full,
  messages: [
    {
      namespace: "urn:x-cast:com.example.app",
      onMessage: (senderId, data) => console.log(senderId, data),
    },
  ],
});
```

The library declares each namespace to the framework as JSON. It passes each
message to your handler unchanged, with the sender's id.

Next: [03 Deployment and registration](03-deployment.md).
