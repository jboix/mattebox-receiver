# @mattebox/cast-playground

The playground runs a Cast receiver page in a desktop browser, under
Google's real receiver framework. The page around the receiver acts as the
device's platform and as one sender. You need no device and no registration,
and you do not change the receiver page.

```sh
npx @mattebox/cast-playground http://localhost:5173/
```

The command prints an address. Open it in a browser. You see the receiver
page in a frame of 1280 by 720, the size of a Chromecast screen, next to the
controls of a sender.

| Part         | What you do with it                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------------------ |
| Load content | You send a `LOAD`. You pick a listed stream, a resource of an SRG SSR media, or you type a URL               |
| Load         | You set autoplay and a start time for the next `LOAD`. The `LOAD` names a start time only when you set one   |
| Transport    | You send `PLAY`, `PAUSE`, `STOP`, `SEEK` and `SET_PLAYBACK_RATE`, and you go to the live edge with "Go live" |
| Tracks       | You send `EDIT_TRACKS_INFO`. You choose among the tracks that the last status reported                       |
| Receiver     | You add a query to the receiver page's URL, and you restart the receiver. This part sends no message         |
| Messages     | You read every message sent and answered, with its JSON. This part sends no message                          |

When you type a URL, you can also give a license URL, the sender's
subtitles, and `customData` as JSON. Use `customData` when your receiver has
conventions of its own.

## Options

| Option           | What it sets                                                                                                         |
| ---------------- | -------------------------------------------------------------------------------------------------------------------- |
| `<receiver url>` | The URL of the receiver page, as you would open it in a browser. The page can be local or hosted, over http or https |
| `--port`         | The port of the playground. The default is 8010. The receiver's proxy uses the next port                             |
| `--host`         | The address the playground listens on. The default is `localhost`, which only this machine reaches                   |
| `--lan`          | The playground listens on every interface, so the local network reaches it. This is the same as `--host 0.0.0.0`     |

## On the local network

```sh
npx @mattebox/cast-playground http://localhost:5173/ --lan
```

With `--lan`, the command prints one address of the playground for each
network this machine is on. You can open that address on a phone, a tablet
or another computer. You do not move the receiver page. The proxy reaches
the page from this machine, so a dev server on `localhost` needs no change.

The two pages refer to each other with the address the browser asked for.
One run therefore serves `localhost` and the network at the same time. You
can play a protected stream from `localhost`, because a browser treats
`localhost` as a secure context and only offers its DRM in a secure context.

## The server

The playground uses Node's own `http` module and has no dependency. It starts
two servers:

| Server    | Port                | What it serves                                                                                                        |
| --------- | ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| The page  | `--port`, 8010      | The playground's page, built to static files, and `config.json`, which gives the URL of the receiver's frame          |
| The proxy | The next port, 8011 | The whole origin of the receiver page. The proxy adds `platform.js` as the first script in the head of every document |

The proxy changes only the HTML documents. It does these things:

- It passes every other response through unchanged.
- It follows the receiver's own paths.
- It keeps a redirect inside the receiver's origin on the proxy.
- It pipes a WebSocket through, so the hot reload of a dev server works in
  the frame.
- It removes `Content-Security-Policy` and `X-Frame-Options` from the
  documents it serves. The page can then load in a frame, with the added
  script.
- It answers with a `502` and a message when the receiver page does not
  answer.

## How it works

On a device, the framework talks to the platform over a WebSocket at
`ws://localhost:8008/v2/ipc`. On a desktop, that socket never opens, so the
receiver context never becomes ready.

The playground serves the receiver page through a local proxy. The proxy
changes one thing: it adds `platform.js` as the first script in the head of
every HTML document, before the framework's script. `platform.js` replaces
that one socket with messages to the playground's window. Every other socket
is the real one and goes through the proxy. This includes the hot reload of
a dev server.

The playground answers as the platform does. It sends the platform's `ready`
message, with the capabilities of a registered device, and it connects one
sender. The framework, the receiver's library and the receiver page are the
same code that a device runs.

## In this repository

```sh
npm run playground                          # over the repository's app, with hot reload
npm run playground -- <receiver url>        # over any receiver page
npm run playground -- <receiver url> --lan  # and on the local network
```

You run the playground from the sources with one command. The command builds
the package when a source file is newer than the last build.

## From code

You can start the playground from a script:

```ts
import { startPlayground } from "@mattebox/cast-playground";

const playground = await startPlayground({
  receiver: "http://localhost:5173/",
});
console.log(playground.url);
await playground.close();
```

## License

MIT
