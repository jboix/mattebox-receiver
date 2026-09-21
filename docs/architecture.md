# Architecture

The Mattebox Cast receiver contains two packages and one app. This document
explains what each part owns and which rules apply between the parts. You
can read the [guide](guide/README.md) to learn how to use the library.

A Chromecast receiver is a web page. Google loads the page onto the device
from a URL, and a developer account registers that URL. The application id
of an integrator must point at a page that the integrator hosts. An
integrator therefore cannot use a page that this repository hosts. For this
reason the product is a library. An integrator writes the receiver page in a
few lines with it. The app is the page that this repository hosts for
itself.

| Part                        | Owns                                                                                                         | Imports                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `@mattebox/cast-receiver`   | It connects the receiver framework from Google to `<mattebox-player>`. It creates no DOM                     | It imports the engine, the core and the player. All are peers     |
| `app/`                      | It is the demo receiver page. It owns the composition, the theme, the resolver and the two query flags       | It imports the library, the player and the engine from npm ranges |
| `@mattebox/cast-playground` | It is a CLI. It runs a receiver page with the real framework in a desktop browser, with controls of a sender | It imports no other part. It has no runtime dependency            |

All the vendor-specific code is in the app. The library does not know what a
token is, and it does not know where a license comes from. The library gives
the request to the page, and the page returns a source.

## Rules

1. **No DOM.** The library starts over one element. It reads and writes that element only through the public surface of the element: the attributes, `video`, `player`, `engine`, and the two events. The library creates no element and appends nothing.
2. **The element stays native.** The library applies a Cast command as a call on `player.video`. The library reads the status from the video and the engine. It never reads the status from a copy.
3. **The framework is a script the page loads.** The framework is never a dependency. The library declares the types of the part that it uses in `framework.ts`.
4. **No plugin API, no registry, no base class.** The library has one call, `createReceiver`, and this call takes hooks.
5. **Neither the engine nor the player is fixed from here.** When a surface is missing, you open an issue on the repository of the engine or the player. You also write a comment at the place where the receiver works around the missing surface.

## The library

| Module         | Is                                                                                                                            |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `types.ts`     | It declares the public types: the options, `CastLoad`, `Load` and `Receiver`                                                  |
| `framework.ts` | It declares the types of the part of the receiver framework that the library uses. It has the two accessors for `window.cast` |
| `load.ts`      | It converts a `LOAD` request to a `CastLoad`. It is pure                                                                      |
| `resolve.ts`   | It contains the default resolver. The resolver reads one convention, `customData.mattebox`. It is pure                        |
| `tracks.ts`    | It assigns the Cast track ids, one time per load. It is pure                                                                  |
| `profile.ts`   | It selects the memory profile for the device. It is pure                                                                      |
| `handlers.ts`  | It builds the handler chain for `MatteboxPlayerElement.define`. It has the one request hook, which follows the current load   |
| `status.ts`    | It computes the media status from reads of the video and the engine                                                           |
| `commands.ts`  | It applies the commands that the library owns: seek, playback rate and track selection                                        |
| `bridge.ts`    | It takes a `CastLoad` and controls the player through the attributes of the element. A message and a simulation both use it   |
| `path.ts`      | It contains the status path. It decides what the framework receives and which messages the library answers                    |
| `receiver.ts`  | It contains `createReceiver`. It holds the state and the events, and it connects the other modules                            |

## The status path

The design of the status path comes from tests with the real framework from
Google. The framework ran in a desktop browser, and the tests simulated the
platform of the device. The tests showed two facts:

- The framework reports the status of a media element only after the framework itself has loaded that element.
- When the library stops a load of the framework, the load stays open, and the framework drops every command.

The library therefore gives the framework a stand-in for the video. The
stand-in behaves as the video for every read, every event and every playback
call. The stand-in keeps the `src` and the `load()` of the framework away
from the video.

| Message                       | Applied by                                                                                                              |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `LOAD`                        | The library applies it, through `resolve` and the attributes of the element                                             |
| `PLAY`, `PAUSE`, `SET_VOLUME` | The framework applies them on the video                                                                                 |
| `SEEK`                        | The library applies it on the video. On a live session, a seek to the end of the range calls `engine.live.seekToEdge()` |
| `SET_PLAYBACK_RATE`           | The library applies it on the video                                                                                     |
| `EDIT_TRACKS_INFO`            | The library applies it through `engine.tracks`. The framework applies it for the text tracks of a sender                |
| `STOP`                        | The library unloads the player. The framework ends its own session                                                      |
| `MEDIA_STATUS`, outgoing      | The framework sends it. The library writes the values that it reads over the status                                     |

## The app

`app/index.html` is the reference integration. It contains a player with
`controls="custom"`. The player has a title, a spinner and a control bar.
The bar has the current time, a seek bar, the duration and
`<mbx-live-button>`, which shows the live state. The page has no controls to
click, because you cannot click on a device.

- `app/src/main.ts` is the script of the page.
- `app/src/resolve.ts` is the resolver of the page.
- `app/src/style.css` is the television theme. It sets the `--mbx-*` tokens of the player.
