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
  thumbnails?: string;
  requestHooks?: Array<
    (request: { url: string; headers: Record<string, string> }) => void
  >;
}
```

The library uses each member of the `Load` as follows:

| Member         | What the library does with it                                                                            |
| -------------- | -------------------------------------------------------------------------------------------------------- |
| `url`          | Sets the element's `src`. The element loads again when you set `src` to the value it already has         |
| `type`         | Sets the element's `type`. The element trusts `type` over the URL's extension                            |
| `licenseUrl`   | Sets the element's `license-url`. The element gives it to `engine.drm.setLicenseUrl`                     |
| `thumbnails`   | Sets the element's `thumbnails`. You need the `thumbnails` stage and `<mbx-seek-bar>`                    |
| `requestHooks` | Calls each hook for every request that the engine makes for this load. This includes the license request |

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
      licenseHeaders: { "x-token": token },
      thumbnails: "https://cdn.example/sprites.vtt",
    },
  };
});
```

All three members are optional. The library converts `licenseHeaders` into a
request hook. The hook adds the headers to the license request and to no
other request.

The library reads nothing else from `customData`. The sender,
`@mattebox/player-cast`, does not define a shape for `customData`. This
library defines a shape for the `mattebox` key only.

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
with the idle reason `ERROR`.

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
