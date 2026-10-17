# Stability and versions

`@mattebox/cast-receiver` is at version 0.x. This page says what you can
rely on now, what version 1.0 promises, and what changes before it.

## Before 1.0

- A patch release fixes bugs. It changes no API.
- A minor release adds features. It can also change or remove an API. The
  release notes name the change.
- Use a tilde range, such as `~0.1.0`, if you review each minor release
  before you take it.
- The package names the `mattebox` and `@mattebox/player` versions it works
  with in its peer dependencies. Keep all three inside those ranges.

## The public API

You can rely on these, within the rules above:

| Surface                                                        | Where                                               |
| -------------------------------------------------------------- | --------------------------------------------------- |
| The receiver calls and their options                           | [Chapter 01](guide/01-getting-started.md#the-calls) |
| The load request: `resolve`, `customData.mattebox`, and tokens | [Chapter 02](guide/02-loads.md)                     |
| The status the sender receives, and the error codes            | [Chapter 02](guide/02-loads.md#the-status)          |
| The custom message namespace                                   | [Chapter 02](guide/02-loads.md#custom-messages)     |
| The demo app's query flags                                     | [App documentation](../app/README.md#query-flags)   |

These are not a promise:

- The markup and styles of the receiver page. Your page owns them.
- The stages the receiver preset contains.
- The bundle size.

## What 1.0 promises

- Version numbers follow [Semantic Versioning](https://semver.org/). Only a
  major release changes or removes a public API.
- A message a sender of the same major version sends keeps its meaning.
  A deprecated field keeps working for at least two minor releases.

## What changes before 1.0

| API                   | Expected change                                                             |
| --------------------- | --------------------------------------------------------------------------- |
| `customData.mattebox` | DRM license settings and signed URLs that the player's cast sender forwards |
| DRM                   | The license request goes through the same hooks as on the page              |

## Reporting a break

If a patch release breaks your receiver, or a minor release breaks it
without a note,
[open an issue](https://github.com/jboix/mattebox-receiver/issues/new/choose).
That is a bug.
