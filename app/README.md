# The app

This is the demo receiver page. It shows how to build a receiver with
`@mattebox/cast-receiver`, and it is deployed to
[GitHub Pages](https://jboix.github.io/mattebox-receiver/). All the
vendor-specific code of this repository is here.

| File             | Is                                                                                      |
| ---------------- | --------------------------------------------------------------------------------------- |
| `index.html`     | The page: Google's framework script, and a player under `controls="custom"`. No buttons |
| `src/main.ts`    | The page's script: the receiver over the `full` preset, the title, and the query flags  |
| `src/resolve.ts` | The resolver: the library's default, plus a token for a URL whose CDN asks for one      |
| `src/srgssr.ts`  | SRG SSR's Akamai token. Imported only by a load whose `customData` has an `srgssr` key  |
| `src/style.css`  | The television theme over the player's `--mbx-*` tokens                                 |

## Running it

```sh
npm run app        # http://localhost:5173/
npm run playground # the playground over the app
npm run app:build  # the static build, `-- --base=/<path>/` for a subpath
npm run test:e2e   # the page in three browsers
```

## Query flags

You can load a stream without a sender by adding `?load=<url>` to the page's
URL. The other parameters describe that load.

| Parameter                      | Is                                                    |
| ------------------------------ | ----------------------------------------------------- |
| `load`                         | The URL to play                                       |
| `type`                         | The content type, when the URL has no known extension |
| `live`                         | The stream type is live                               |
| `t`                            | The start time, in seconds                            |
| `title`, `subtitle`, `artwork` | The metadata the title shows                          |
| `license`                      | The license URL, sent as `customData.mattebox`        |
| `thumbnails`                   | The thumbnails URL, sent as `customData.mattebox`     |
| `token=srgssr`                 | The URL needs SRG SSR's Akamai token                  |
| `debug`                        | Turns the Cast debug logger and its overlay on        |

The guide explains how to host and register the page in
[Deployment and registration](../docs/guide/03-deployment.md).
