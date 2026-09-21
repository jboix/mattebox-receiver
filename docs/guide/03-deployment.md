# 03 Deployment and registration

This chapter explains how you host the receiver page, how you register it
with Google, and how you connect a sender to it. It also explains how you
test the page without a device.

## Hosting

A receiver page is a set of static files. You must serve them over HTTPS.

The app in this repository deploys to GitHub Pages from `main`. The workflow
`.github/workflows/github-page.yml` runs this build:

```sh
npm run app:build -- --base=/mattebox-receiver/
```

You must build for ES2015 if you support first generation devices. The app
builds for ES2015.

## Registration

The owner of the Cast developer account registers the page.

1. Open the [Cast developer console](https://cast.google.com/publish).
2. Add an application of type Custom Receiver, and give it the HTTPS URL of the page.
3. Note the application id.
4. Add each test device by its serial number, and restart the device.

An unpublished receiver works only on registered devices. You do not need to
publish a demo.

## The sender

The application id is public. You set it on the cast button of the sender:

```html
<mbx-cast-button receiver="APPLICATION_ID"></mbx-cast-button>
```

## Working without a device

You can load a stream on the app's page without a sender. Add `?load=<url>`
to the URL of the page. The library handles this load in the same way as a
`LOAD` message from a sender.

You can describe the load with these parameters:

| Parameter                      | What it sets                                             |
| ------------------------------ | -------------------------------------------------------- |
| `load`                         | The content URL                                          |
| `type`                         | The MIME type of the content                             |
| `title`, `subtitle`, `artwork` | The metadata that a sender sends                         |
| `license`, `thumbnails`        | The values of `customData.mattebox`                      |
| `live`                         | The stream type, which becomes `LIVE`                    |
| `t`                            | The start time that a sender sends, in seconds           |
| `debug`                        | The Cast debug logger and its overlay, which it turns on |

```sh
npm run app
# http://localhost:5173/?load=https://example.com/master.m3u8&title=Hello
```

You can test more with the playground. The playground runs the page with the
real framework from Google. It simulates the platform of the device, and it
gives you the controls of a sender.

### The playground

`@mattebox/cast-playground` opens a receiver page in a frame, next to the
controls of a sender. The receiver page runs with the real framework. The
playground page simulates the platform of the device and one sender. You can
use it in any browser. You need no device and no registration, and you do
not change the receiver page.

```sh
npx @mattebox/cast-playground http://localhost:5173/   # a page of yours
npm run playground                                     # in this repository: over the app
npm run playground -- <receiver url> --lan             # any page, and on the local network
```

The playground has these parts:

| Part         | What you do with it                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------------------ |
| Load content | You send a `LOAD`. You pick a listed stream, a resource of an SRG SSR media, or you type a URL               |
| Load         | You set autoplay and a start time for the next `LOAD`. The `LOAD` names a start time only when you set one   |
| Transport    | You send `PLAY`, `PAUSE`, `STOP`, `SEEK` and `SET_PLAYBACK_RATE`, and you go to the live edge with "Go live" |
| Tracks       | You send `EDIT_TRACKS_INFO`. You choose among the tracks that the last status reported                       |
| Receiver     | You add a query to the receiver page's URL, and you restart the receiver. This part sends no message         |
| Messages     | You read every message sent and answered, with its JSON. This part sends no message                          |

The playground sends the license URL of a listed stream in
`customData.mattebox`. When you type a URL, you can also give a license URL,
subtitles from the sender, and the token flag.

With the SRG SSR option, the playground resolves the media, as a sender
does. It searches, it fetches the composition of the media from the
integration layer, and it lists the resources. The "Send" button sends one
resource. The message contains the URL and the type of the resource, and its
Widevine license URL. It also contains
`customData.srgssr.tokenType: "AKAMAI"` when the resource needs a token. The
receiver never sees the URN, and it never calls the integration layer.

On a live session, the transport reads `liveSeekableRange` from the status,
as a sender does. The seek bar shows the live window. The time shows the
distance to the end of the window. The "Go live" button seeks to the end of
the window. The playground shows no seek bar when the window is shorter than
thirty seconds.

The frame is 1280 by 720 pixels, which is the viewport of a Chromecast. The
playground scales the frame to the space that the page has. You can add a
query to the URL of the receiver page with the "Receiver" field. For
example, `debug` turns on the Cast debug overlay of the app. The debug
logger works only on a registered device, so the playground answers as a
registered device.

The playground serves the receiver page through a local proxy. The proxy
puts `platform.js` first in the head of each document. This script replaces
the socket between the framework and the platform. It sends the messages to
the window of the playground instead. The code of the receiver page is the
same code that a device runs. You can read the other details in
[the README of the package](../../packages/cast-playground/README.md).
