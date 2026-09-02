# Contributing to DeckHQ

Issues and pull requests are welcome. Two things decide whether a change can be merged at all, and
they are first here because they are cheaper to read than to rediscover after you have written the
code.

## 1. The invariant is not negotiable

> **What the user owes is decided by the user, never by the runtime.**
> — [`docs/01-PRODUCT.md`](docs/01-PRODUCT.md) §2

`activityState` is _observed_. It changes on its own: a session starts, produces output, blocks,
goes quiet, exits.

`ackState` is _owned by the user_. It changes only when the user acts.

**No code path may allow an observed state change to remove an item from the user's waiting area.**
Opening a conversation does not clear it. Scrolling past it does not clear it. Reading it does not
clear it. Only an explicit action — a button, a number key — does.

This is not a preference. Every competing tool derives its queue from runtime state, which is why
work disappears from those queues the moment the process goes idle, and why the thing you owe stops
being visible exactly when you stopped looking. The invariant is the entire reason this project
exists.

There are tests named `INVARIANT:` in `test/unit/state-machine.test.mjs` and
`test/integration/daemon.test.mjs`. **A change that needs them relaxed, skipped or rewritten is the
wrong change** — not a change that needs a test update. If your feature seems to require it, open
an issue describing what you are trying to do and we will find another way.

The most common accidental violation: calling `/api/ack` from a render path, a scroll handler, a
focus handler, or any code that runs because the user _looked_ at something.

## 2. No network egress, ever

DeckHQ makes **no outbound network calls of any kind**. Not analytics. Not telemetry. Not update
checks. Not crash reporting. Not fonts, icons or scripts from a CDN. Not a version ping. The only
sockets are the loopback listener and the runtime processes DeckHQ starts on your behalf.

This is a rejection criterion, not a preference:

- **A dependency that phones home will not be merged**, however useful it is, and regardless of
  whether the calls can be disabled by a setting.
- A feature that requires egress will not be merged into the core. If a future paid service needs
  the network, it is an opt-in service that lives outside the core, and the core keeps working with
  it uninstalled.
- This does not change when the project starts charging money. It is the trust story, and it is
  worth more than any feature that would break it.

The Content-Security-Policy in `src/http/server.mjs` is `default-src 'self'` with `connect-src
'self'`, so an accidental fetch to a third-party host fails in the browser rather than shipping.
Keep it that way.

## 3. No runtime dependencies

`package.json` has no `dependencies` block and should not grow one. Node's standard library and the
browser's own APIs have covered every need so far — the HTTP server, the transcript parsing, the
SSE stream, the whole renderer. A security reviewer can read this entire project in an afternoon
precisely because there is nothing else to read.

Dev dependencies are fine — there are two, `eslint` and `prettier`.

A genuinely unavoidable runtime dependency needs maintainer sign-off before the PR is written, and
a line in `CHANGELOG.md` explaining why the standard library was not enough.

---

## Running it

Node 18 or newer. Nothing to install to run the product itself.

```sh
npm install            # dev tooling only: eslint and prettier
npm start              # daemon on http://127.0.0.1:4317
npm start -- --port 4400
node bin/deckhq.mjs --help
```

State lives in `~/.deckhq/state.json`, overridable with `$DECKHQ_STATE_DIR`. Nothing is ever
written inside the package directory.

### A floor with agents on it

You do not need real sessions, and you should not use real ones for screenshots — they carry your
project names and session titles.

```sh
npm run demo           # synthetic ~/.claude in a temp dir, driven through the real hook endpoint
npm run demo:capture   # photograph a running floor over the DevTools protocol
```

## Testing

```sh
npm test                                  # everything
npm run test:unit                         # unit only
npm test -- test/unit/state-machine.test.mjs   # one file
npm run lint
npm run format:check                      # CI checks this; npm run format fixes it
```

CI runs lint, format check and the full suite on Ubuntu, macOS and Windows against Node 18, 20 and
22 — all nine combinations must be green. Path handling and process spawning are the two places
that break on one platform and pass on the others, so be suspicious of both.

## What a pull request needs

- **Tests pass on all three platforms.** Watch the CI matrix, not just your own machine.
- **The `INVARIANT:` tests are untouched.** See §1.
- **No new runtime dependency.** See §3.
- **Deviations are documented.** If the implementation departs from what
  [`docs/`](docs/) specifies — a different algorithm, a missed budget, a constraint the plan did not
  anticipate — append a numbered entry to [`docs/DEVIATIONS.md`](docs/DEVIATIONS.md) with the reason
  and, where there is one, the measurement. That log is the most useful document in this repository.
  Being wrong in it is fine; being silent is not.
- **A screenshot, if you touched the floor.** Anything under `public/render/` or `public/style.css`
  needs a before-and-after image in the PR. The three worst bugs in this project's history were
  invisible to the whole unit suite and obvious in one PNG.

## Style

`prettier` decides formatting; do not argue with it. `eslint` is deliberately thin. JSDoc types on
exported functions, comments that explain _why_ rather than restate the code, and no abbreviations
in names that a newcomer would have to look up.

## Reporting a security issue

Do not open a public issue. See [`SECURITY.md`](SECURITY.md).

## Code of conduct

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Licence

Contributions are accepted under the MIT licence, the same terms as the project.
