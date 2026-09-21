# Contributing to the Mattebox Cast receiver

Thank you for contributing. If you are an agent, you also follow
[AGENTS.md](../AGENTS.md). Everyone who takes part follows the
[Code of Conduct](./CODE_OF_CONDUCT.md).

## Setup

You need Node 24 or later (see `.nvmrc`) and npm. The repository uses npm
workspaces, and `package-lock.json` is the only lockfile.

```sh
npm install
npx playwright install chromium firefox webkit   # the browser tier and the app's page suite
npm run verify    # everything CI checks
```

`verify` runs these steps in order:

| Step                         | Tool                          | What it checks                                                                             |
| ---------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------ |
| `npm run lint`               | Biome                         | Formatting and lint rules                                                                  |
| `npm run docs:check`         | remark                        | Markdown formatting, broken links and broken anchors                                       |
| `npm run typecheck`          | tsc                           | Type errors, with `strict` and `exactOptionalPropertyTypes`                                |
| `npm run depcruise`          | dependency-cruiser            | The runtime imports only the peers, there are no cycles, the library never imports the app |
| `npm run knip`               | knip                          | Dead code, unused exports and unused dependencies                                          |
| `npm run build`              | tsc + Rolldown                | It builds the modern ESM, the types and the ES2015 ESM                                     |
| `npm run check:emit`         | scripts/check-emit.mjs        | Banned TS constructs and stray bare import specifiers                                      |
| `npm run check:side-effects` | scripts/side-effect-audit.mjs | Importing the library in isolation creates no global                                       |
| `npx size-limit`             | size-limit                    | The library stays within its size budget, min+brotli                                       |
| `npm run check:size-chart`   | scripts/size-chart.mjs        | docs/size-chart-\*.svg match the build and the pinned stacks                               |
| `npm run check:package`      | packages/\*/package.json      | publint and attw pass on the packed package                                                |
| `npm run test`               | Vitest                        | The Node tests, and the browser tests in Chromium, Firefox and WebKit                      |

`npm run test:e2e` runs the app's page suite. The suite uses Vitest browser
mode over the app's sources, in Chromium, Firefox and WebKit. CI runs it on
every pull request. `verify` does not run it.

You cannot automate the test on a device. You can get close on a desktop in
two ways. `scripts/spike/` runs Google's real framework with a fake
platform. `npm run playground` opens the app under that framework.

## Layout

| Path                          | What it contains                                                         |
| ----------------------------- | ------------------------------------------------------------------------ |
| `packages/cast-receiver`      | `@mattebox/cast-receiver`                                                |
| `packages/cast-receiver/test` | The Node tests, the browser tests, and the fake framework                |
| `app`                         | The demo receiver page. It is a Vite app that uses the library's sources |
| `test/e2e`                    | The app's page suite, in Vitest browser mode                             |
| `docs/guide`                  | The user guide, with one chapter per topic                               |
| `scripts`                     | The check scripts that `verify` runs, and the probes of the spike        |
| `packages/cast-playground`    | `@mattebox/cast-playground`: the CLI, its proxy and its page             |

The typecheck, the tests and the app resolve the library to its sources.
The `paths` in `tsconfig.json` and the aliases in the Vite and Vitest
configs do this. The engine, the core and the player come from npm at their
released ranges.

## Rules

A check or a reviewer enforces each of these rules:

1. **No DOM in the library.** The library creates no element and appends
   nothing.
2. **Runtime dependencies are the engine, the core and the player.** All
   three are peer dependencies. Google's framework is a script that the page
   loads.
3. **The element stays native.** You implement a Cast command as a call on
   `player.video`.
4. **No side effects in the library.** Importing the library registers
   nothing.
5. **Everything vendor-specific lives in the app.**
6. **Every workaround of the engine or the player is called out in a
   comment.** You write the comment where the workaround happens. When you
   can state a gap as a test, you pin it in
   `packages/cast-receiver/test/browser/gaps.test.ts`.
7. **Banned TypeScript:** non-const `enum`, `namespace`, parameter properties,
   decorators. The emit check catches violations.

## Commits

You write Conventional Commits. semantic-release reads the history when
someone runs the Release workflow, so the commit type decides the version
bump:

- `fix:` releases a patch, `feat:` a minor, and `feat!:` or
  `BREAKING CHANGE:` a major.
- `docs:`, `chore:`, `test:` and `refactor:` produce no release.

A package releases when a commit changed a file in its directory. The
subject of the commit goes into the changelog. You must write a body.

`npm install` sets up the git hooks through husky:

- `commit-msg` runs commitlint.
- `pre-commit` runs Biome on the staged files, and the docs check.
- `pre-push` runs `npm run verify`.

## Style

When `npm run verify` passes, the style is right. If you disagree with a
check, open an issue. Do not argue about it in the pull request.
