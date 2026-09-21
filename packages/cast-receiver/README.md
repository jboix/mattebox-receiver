# @mattebox/cast-receiver

This library connects Google's Cast receiver framework (CAF, version 3) to
`<mattebox-player>`. You can turn a web page into a Chromecast receiver with
a few lines of code. The library creates no DOM, and importing it has no
side effects.

Install the library and its peer dependencies:

```sh
npm install @mattebox/cast-receiver @mattebox/player @mattebox/player-core mattebox
```

Add Google's framework to your page:

```html
<script src="https://www.gstatic.com/cast/sdk/libs/caf_receiver/v3/cast_receiver_framework.js"></script>
```

Create the receiver, create the player with the receiver's handlers, and
start the receiver:

```ts
import { createReceiver } from '@mattebox/cast-receiver';
import { MatteboxPlayerElement } from '@mattebox/player';
import full from 'mattebox/presets/full';

const receiver = createReceiver({ preset: full });
const player = new MatteboxPlayerElement({ handlers: receiver.handlers() });
document.body.append(player);
receiver.start(player);
```

| The library does this                                                     | The library does not do this                                          |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| It passes the sender's `LOAD` through your `resolve` and loads the player | It does not create or append any element                              |
| It reports the media status from the video and the engine                 | It does not know what a token is, or where a license comes from       |
| It selects audio and text tracks under stable Cast ids                    | It does not bundle an engine preset. Your page imports one            |
| It sends the player's errors to every sender                              | It does not load Google's framework. Your page loads it               |
| It passes custom namespaces through                                       | It does not ship a fake framework. The library's tests have their own |

The framework's script is never a dependency of the library. The engine, the
core and the player are peer dependencies.

You can read the guide in the repository:
[docs/guide](https://github.com/jboix/mattebox-receiver/blob/main/docs/guide/README.md).

## License

MIT
