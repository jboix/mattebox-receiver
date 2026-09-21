# AGENTS.md — Standing instructions for the Mattebox Cast receiver

Place this at the repository root. It applies to every deliverable.

---

## What this project is

The **Mattebox Cast receiver** is two npm packages and one app in one
repository: `@mattebox/cast-receiver` (the bridge between Google's receiver
framework and the player's element, with hooks, no DOM of its own), `app/`
(the demo receiver page, a Vite app over the library), and
`@mattebox/cast-playground` (a CLI that opens any receiver page under the
real framework in a desktop browser, with a sender's controls). The rules
below that say "the library" are about `@mattebox/cast-receiver`. Read
`docs/architecture.md` before doing anything.

The receiver exists for two reasons in this order. First, to put its author
in the shoes of an integrator of the engine and the player and find every
place their APIs are awkward, missing, or wrong. Second, to be a usable
receiver. When the two conflict, the first wins: write the awkward code, say
so in a comment where it happens, and report what you had to reach around as
an issue on the engine's or the player's repository.

## Non-negotiable rules

1. **No DOM in the library.** It reads and writes the element it was started
   over through the element's public surface: its attributes, `video`,
   `player`, `engine`, and its two events. It creates no element and appends
   nothing. What the receiver looks like is the page's.

2. **Runtime dependencies are the engine, the core and the player.** All
   peers. Nothing else. Google's receiver framework is a script the page
   loads, never a dependency, and `@types/chromecast-caf-receiver` is not
   added: the slice the library uses is typed in `framework.ts`. Do not add a
   dependency to work around a problem.

3. **The element stays native.** Never forward or wrap an `HTMLMediaElement`
   member for the page. A Cast command is a call on `player.video`, and the
   status is read from the video and the engine, never from a copy. The
   stand-in the framework holds (`path.ts`) keeps the framework's own load off
   the video and nothing else.

4. **No side effects in the library.** `sideEffects: false` is audited:
   importing the built entry creates no global, registers nothing and starts
   no context.

5. **Everything vendor-specific lives in the app.** The library never knows
   what a token is or where a license comes from. `customData.mattebox` is
   the one convention it reads.

6. **No plugin API, no registry, no base class.** One call with hooks.

7. **Do not fix the engine or the player from here.** A missing surface is an
   issue on their repository, not a hidden workaround, and a gap that can be
   stated as a test is pinned in `test/browser/gaps.test.ts`.

8. **Simulation is a fixture, not a feature.** The bridge takes a `CastLoad`
   and drives the player through the path a message takes. The package ships
   no fake context. The tests' fake behaves as the real framework was seen to
   behave under `scripts/spike/` and the playground, and changes only with a
   new finding.

9. **Banned TypeScript:** non-const `enum`, `namespace`, parameter properties,
   decorators. The emit check enforces this.

## Before writing code

- Read the engine's guide chapters 01, 02, 03, 07, 09 and 14, and the
  player's guide chapters 01, 02, 03 and its `docs/architecture.md`. The
  rules they fixed bind the receiver.
- Consume `mattebox`, `@mattebox/player-core` and `@mattebox/player` from npm
  at their released ranges. Do not link local checkouts.
- A question about the framework's behaviour is put to the framework:
  `scripts/spike/probe.mjs` runs the real script with the platform faked.

## While writing code

- Explicit `.js` extensions in all import specifiers.
- `import type` for type-only imports.
- Comments explain **why**. Cite the engine's guide chapter when a rule comes from it.
- Every time you write code that works around the engine or the player, say
  so in a comment where it happens: what you wanted to do, what you had to do
  instead, and which surface would have made it one call.

## Writing

Documentation, comments, commit messages, and user-facing strings use direct language.

- Write plain declarative sentences. State the fact, then at most one sentence of why.
- Write subject, verb, object. Address the reader as "you" and say what they can do: "You can test the receiver without a device by using the playground", never "Without a device, open any receiver page under the real framework". This applies to every text, the README included.
- No em-dashes. Use commas, colons, parentheses, periods.
- No rambling, aphorisms, or clever turns. No "X is what makes Y"; write the fact or "Y because X".
- No idioms or unusual verbs. Name things for what they are. No cute jargon.
- One fact per bullet. Paragraphs of one to three short sentences.
- Reference docs carry no essays. A one-line table entry is the documentation; add a section only when asked.

## The device

The device is the gate with no automation. Findings on a Chromecast come
back as issues, with the device generation and the runtime version.

## Before declaring a deliverable complete

Run every gate and paste the **actual output** into the handoff report:

```bash
npm run verify        # every gate, in CI's order
npm run test:e2e      # the app's page in three browsers
```

## Handoff report format

End every deliverable with:

```markdown
## Deliverable N Handoff

### Built

<file-by-file summary>

### Definition of Done

- [x] item — evidence
- [ ] item — why not

### Deviations from the task

<what, why, and whether docs need updating>

### Decisions not covered by the task

<anything you had to choose; flag for human review>

### Gate output

<actual command output, pasted>

### Findings

<what the framework, the engine or the player was seen to do, with the device generation and the runtime version>
```

## Scope discipline

**Do not build ahead.** The deliverables are ordered so a human can review
incrementally; building ahead defeats that and makes review impossible.

If you believe a deliverable's scope is wrong, say so in the handoff report
and stop. Do not expand scope unilaterally.

## When the task is wrong or silent

The task often encodes decisions the engine and the player made, for non-obvious reasons.
If something seems wrong:

1. Check the engine's and the player's guides; the option may already be decided there.
2. If still wrong, implement what you believe is correct, and **document the
   deviation prominently** in the handoff report.
3. Never silently deviate.
