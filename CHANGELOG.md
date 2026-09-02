# Changelog

## 1.1.0

First public release. Everything below is a fix to something that would have bitten a real
`npx` user on a machine that is not the development machine.

### Fixed

- **State no longer lives in the package directory.** It moves to `~/.deckhq/state.json`, with
  `$DECKHQ_STATE_DIR` as an override. The old location was inside whatever directory `npx` or
  `npm -g` had installed the package into: the package manager is free to evict or replace it on a
  version bump, and a root-owned global install could not write to it at all. Both would have
  discarded every acknowledgement, bench and let-go — the user-owned half of the model — without
  saying anything. A `state.json` left beside the package by 1.0.0 is copied across once on first
  start; the original is left where it was.

- **Failed writes are reported, not just logged.** A store that cannot write is losing every
  acknowledgement made since it last succeeded. The header now says so and names the path.

- **Hooks are installed with the daemon's real port.** The hook command used to post to a
  hard-coded `127.0.0.1:4317`, but the daemon walks forward when 4317 is taken and accepts
  `--port`. In either case every event went nowhere while the settings file looked perfect and the
  header went on claiming exact state. The port is now written at install time, `installed()`
  reports false when the installed hooks point somewhere else, and the hooks screen offers a
  one-click reinstall that repoints them instead of stacking a second set.

- **The hooks screen reports delivery, not just installation.** It shows how many hook events have
  arrived and when the last one did, so an install that is silently not being delivered is visible
  rather than assumed to be fine.

- Settings backups moved from the package directory to `~/.deckhq/backups/`, for the same reason
  as the state file.

- `POST /api/ack` returns the agent it changed. `Registry.act()` had always returned `undefined`,
  so the `agent` field in that response was never populated.

### Removed

- `reference/` — the prototype that validated the idea against real data. It was never built on
  and is dead weight in a public tree. Still in git history at `v1.0.0`.
- `docs/00-PRODUCT-legacy.md`, superseded by `docs/01-PRODUCT.md`.

### Verified

- **`send()` now has been run end to end**, closing the gap `docs/DEVIATIONS.md` §9 recorded.
  `claude --resume <id> -p` was exercised against a throwaway session: it returns the _same_
  session id and appends both turns to the _same_ transcript file. It does not fork a new session,
  which would have put a duplicate agent on the floor for every reply.

### Added

- `scripts/demo-floor.mjs` builds a synthetic `~/.claude` in a temp directory and drives a daemon
  into all six states through the real hook endpoint, so the README screenshots can show the
  product working without publishing anyone's real project names or session titles.
- `scripts/capture-floor.mjs` photographs a running floor over the DevTools protocol. Chrome's own
  `--screenshot` flag is no use: it waits for the page to go quiet, and DeckHQ deliberately never
  does.

### Known gaps

Carried forward from `docs/DEVIATIONS.md` §8–9:

- **Codex support is unverified.** The adapter is written against documented rollout-file
  conventions and has never run against real Codex data.
- **`openInTerminal()` is verified on Windows only.** The macOS and Linux paths are implemented and
  reviewed but have not been run.

## 1.0.0

Initial build. See `docs/` for the blueprint and `docs/DEVIATIONS.md` for every departure from it.
