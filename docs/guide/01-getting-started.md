# 01 Getting started

This chapter explains how you build a receiver page. It shows what you put
on the page, which calls you make, and what the library does after you start
it.

## The page

A receiver is a web page. Google loads it onto the device. On that page, you
load Google's receiver framework as a script, you place a player, and you
start the library with that player.

```html
<script src="https://www.gstatic.com/cast/sdk/libs/caf_receiver/v3/cast_receiver_framework.js"></script>

<mattebox-player controls="custom">
  <mbx-title></mbx-title>
  <mbx-spinner></mbx-spinner>
  <mbx-control-bar>
    <mbx-current-time></mbx-current-time>
    <mbx-seek-bar></mbx-seek-bar>
    <mbx-duration></mbx-duration>
  </mbx-control-bar>
</mattebox-player>
```

You must load the framework's script from gstatic. Google does not allow you
to host a copy. You do not need buttons in the bar, because a user cannot
click, hover or focus anything on the device.

Install the library and its peer dependencies:

```sh
npm install @mattebox/cast-receiver @mattebox/player @mattebox/player-core mattebox
```

## The calls

You create the receiver, you create the player with the receiver's handlers,
you add the player to the page, and you start the receiver.

```ts
import { createReceiver } from "@mattebox/cast-receiver";
import { MatteboxPlayerElement } from "@mattebox/player";
import full from "mattebox/presets/full";

const receiver = createReceiver({ preset: full });
const player = new MatteboxPlayerElement({ handlers: receiver.handlers() });
document.body.append(player);
receiver.start(player);
```

You must create the player in script, because the player needs the
receiver's handlers. With `@mattebox/player` 0.5.0, you cannot give the
handlers to a player that you wrote in the HTML. Importing the package
registers the element before `MatteboxPlayerElement.define({ handlers })` can
run.

You can still write the player's controls in the HTML. Create a player in
script and move the attributes and the controls of the HTML player into it.
The app does this in its `adopt()` function.

`createReceiver` takes these options:

| Option     | What it does                                                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `preset`   | Sets the stages of the engine. You import the preset yourself. The library bundles no preset                                                |
| `resolve`  | Converts the sender's request into what the player loads. The default is `defaultResolve`                                                   |
| `stages`   | Adds stages to the engine. The library merges them with the preset's stages by name. A stage replaces the preset's stage with the same name |
| `without`  | Lists the names of the preset stages that you want to leave out, such as `cmcd`                                                             |
| `config`   | Tunes the kernel of the engine. The default is the memory profile for the device                                                            |
| `messages` | Lists your custom namespaces. Each namespace has its own handler                                                                            |
| `debug`    | Turns on the Cast debug logger and its overlay. The default is false                                                                        |

## The preset

Use the `full` preset. It contains both protocols (HLS and DASH), MPEG-TS
segments, the three EME stages, `cmcd` and `thumbnails`.

A receiver needs every protocol and every segment format. The sender chooses
the protocol and the segment format, and you build the page before any
sender connects.

You can remove a stage in two ways:

- You can name the stage in `without`. The engine does not use the stage,
  but its code stays in the page.
- You can import a smaller preset, such as `dual-ts-drm` or `hls`. The code
  of the missing stages stays out of the page, because you import the preset
  and the library bundles none.

```ts
createReceiver({ preset: full, without: ["cmcd"] });
```

The `cmcd` stage adds a `CMCD` query argument to every request to the CDN.
Remove it when your CDN signs the whole URL, or when your CDN uses the query
in its cache key.

You can replace a preset stage. Pass a stage in `stages` with the same name
as the preset's stage. Use this to give `cmcd` a content id or to set its
header mode.

## The receiver

`createReceiver` returns a receiver with these members:

| Member            | What it does                                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `handlers()`      | Returns the handlers for the player. The first is the mattebox handler with the preset. The second is the native handler |
| `start(player)`   | Binds the element and starts the framework's context with it. You can call it once per page                              |
| `load(castLoad)`  | Loads media into the player the same way a `LOAD` message does. Use it when your page simulates a sender                 |
| `stop()`          | Ends the session. The player returns to `mattebox-player:not([src])`                                                     |
| `state`           | Returns `idle`, `loading`, `ready` or `error`                                                                            |
| `on('load', fn)`  | Calls `fn(load, resolved)` when a load is resolved. `load` is the sender's request. `resolved` is what the player loads  |
| `on('idle', fn)`  | Calls `fn(reason)` when the receiver becomes idle. `reason` is `stopped`, `finished` or `error`                          |
| `on('error', fn)` | Calls `fn(error)` when the player reports an error, fatal or not. `error` is the player's unified error                  |

You can work on a receiver page without a device. A desktop browser does not
have the framework. There, `start` binds the element and starts no context,
and `load` still loads media into the player.

## What the page owns

The library creates no DOM. Your page decides how the receiver looks.

You can show the sender's metadata. Listen to the `load` event and set the
title's attributes:

```ts
const title = player.querySelector("mbx-title");
receiver.on("load", ({ metadata }) => {
  title.setAttribute("heading", metadata.title ?? "");
  title.setAttribute("subheading", metadata.subtitle ?? "");
});
```

You can style the idle screen. The player has no `src` when nothing is
loaded:

```css
/* The idle wallpaper: the moment with nothing loaded. */
mattebox-player:not([src]) {
  background: url(wallpaper.jpg) center / cover;
}
```

A television plays sound, so do not set `muted` on a device. A desktop
browser only autoplays a muted video. If your page also runs on a desktop,
write `muted` in the HTML and remove it when the user agent contains `CrKey`.

## The debug logger

The Cast debug logger is a separate script. Load it after the framework's
script. The library turns the logger on when `debug` is true and the script
is on the page.

```html
<script src="https://www.gstatic.com/cast/sdk/libs/devtools/debug_layer/caf_receiver_logger.js"></script>
```

Next: [02 Loads](02-loads.md).
