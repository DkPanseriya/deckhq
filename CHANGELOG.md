# Changelog

<!-- Sections in an unreleased entry are additive: append bullets under the existing headings
     rather than starting a parallel list, and move an item out of "Known gaps" the moment it
     stops being true. -->

## Unreleased

### Fixed

- **A daemon can no longer start on a different port from the hooks that feed it.** Hooks are
  written with the port the daemon had when they were installed, so a later start on the 4317
  default — or on 4318 after the in-use walk — left every hook event posting into a void while the
  settings file stayed valid and the header went on claiming exact state. It is the only broken
  state in the product that looks healthy from every surface at once. `deckhq doctor` reports it
  (§75); now `deckhq` does not create it. With no `--port` given, the daemon listens where the
  installed hooks post if that port is free, and says so in one log line. If a DeckHQ daemon
  already holds it, `deckhq` prints one line naming its URL and starts nothing rather than binding
  the next port along and running degraded beside it. If something that is not DeckHQ holds it, the
  requested port is used and the header's reinstall banner does the rest. An explicit `--port` or
  `DECKHQ_PORT` is honoured exactly as given — naming a port is a request to be on it.
  `docs/DEVIATIONS.md` §81.

### Performance

- **The daemon no longer boots the Claude Code CLI every five seconds.** `liveSessions()` shelled
  out to `claude agents --json` on every poll, forever. Measured on this machine: **406–984 ms of
  the child's own processor time** per call (median 609 ms), which at one call per 5 s is ~12% of
  a core against a 2% budget — and spent out of process, so no measurement of the daemon's own CPU
  could ever see it. The roster is now cached for 60 s and corrected between probes by the two
  signals that are cheap: a `kill(pid, 0)` check retires a session that exited (0.055 ms for a
  whole roster, so death is still noticed within one poll), and the scan drags a probe forward
  when a transcript moves for a session the roster does not list. Over three interleaved rounds of
  24 polls: **24 spawns down to 2–3**, and 14.0–18.3 s of waiting down to 1.0–1.5 s. Verified
  against a forced probe in the same poll — 12 polls, 12 exact agreements.
- What that deliberately leaves stale: a session that starts and then writes nothing at all reads
  as not-live for up to 60 s. It cannot touch user-owned state — `live` is an observation, and
  `for_review` is sticky through a liveness loss either way. `docs/DEVIATIONS.md` §77 has the
  reasoning, including why hook-awareness was weighed and not added.
- **The warm scan is back inside its 50 ms budget.** `readDesktopSessions()` — the desktop app's
  archive join from `docs/DEVIATIONS.md` §46 — re-read and re-parsed all 61 files (8.8 MB) of the
  app's session store on every poll, with no cache of any kind: 78 ms on a quiet machine, up to
  170 ms on a busy one, which was **about 96% of the whole scan**. Each file's parsed result is
  now cached and invalidated by `(mtime, size)`, the same rule the summary cache uses. The warm
  scan drops from 82–173 ms to **4.5–8.9 ms** — 17–20x, and an order of magnitude inside budget —
  while a first scan is unchanged. The archive flag is cached against the file that carries it,
  not against the transcript, so archiving in the app is still seen on the very next poll and a
  rehired agent cannot be re-fired by a stale flag (§78).
- **The review of that work is closed out.** The pid check behind the roster cache was verified on
  Windows against a process that really exited, not just a pid that never existed (both `ESRCH`;
  only the protected System process is `EPERM`). Pid reuse inside the 60 s roster window is now a
  measured, tested exposure rather than an open question: a pid the check has once seen dead can
  never bring its session back, so the only way to be wrong is for a session to exit **and** have
  its pid reused inside one 5 s poll — which here needs ~25 process creations a second — and even
  then the desk is drawn occupied for at most 60 s and nothing user-owned moves. The head-window
  JSON scanner has tests for a window cut mid-string, mid-number and on the backslash of an
  escape, and the desktop-cache tests prove their mtime pins round-trip on the filesystem they run
  on instead of assuming it. `docs/DEVIATIONS.md` §80.

## 1.2.0

The release that can actually be installed. 1.1.0 called itself the first public release and was
then never pushed to the registry, so `npx deckhq` — the README's only install instruction —
returned `E404` for the whole of its life. Every other improvement in this project was academic
while that was true, so this release is mostly the unglamorous work of making one command work.

### Packaging

- **The package is publishable without a private-by-default accident.** `publishConfig.access` is
  now `public`. A scoped or first-time publish that omits it fails at the registry, or worse
  succeeds as a private package on an account that has no private plan.
- **A broken build can no longer reach the registry.** `prepublishOnly` runs `npm run lint` and
  `npm test` before anything is uploaded. Publishing is the one operation in this project that
  cannot be undone — npm unpublish is time-boxed and the version number is burned either way — so
  it is the one that gets the gate.
- **The description is the pitch again.** It used to end with "(Codex adapter included but
  unverified.)", which is honest and belongs in the README's Honest limits, where it still is. The
  description is the single line that appears in npm search results next to a dozen competitors;
  spending its last forty characters on a caveat about a secondary adapter was a bad trade. The
  caveat has not been softened, only moved.
- `control-plane` dropped from the keywords. DeckHQ does not orchestrate anything and should not
  turn up when someone searches for a tool that does. `claude`, `local-first` and `privacy` added,
  because those are what the intended user actually types.
- A `funding` field pointing at GitHub Sponsors, matching the new `.github/FUNDING.yml`.
- `package-lock.json` said `1.0.0`. It had not been regenerated for the 1.1.0 bump, so the one file
  whose job is to describe exactly what gets installed was describing a version two releases old.
  Now correct, and `*.tgz` is ignored so a stray `npm pack` cannot commit a tarball of the package
  into the package.

The tarball is 42 files and 225 kB: `bin`, `src`, `public`, the README and the licence. It grew by
three files because `deckhq doctor` added `src/cli/`. No state, no logs, no tests, no `docs/`, no
`.claude/`.

### Repository

Everything a stranger looks for before they open a pull request, and none of which existed.

- `CONTRIBUTING.md`, leading with the two things that get a change rejected regardless of how good
  it is: the invariant in `docs/01-PRODUCT.md` §2, and network egress. Both were only written down
  in the README's footer, where a contributor finds them after they have written the code.
- `SECURITY.md`, describing the actual model rather than a template one — loopback bind with no
  `--host` flag, why that is not sufficient on its own and what the CSRF guard adds, path-confined
  static serving, argv-array spawns, conversation text rendered as text — plus a private route to
  report something that is wrong with it.
- `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1).
- Issue forms for bugs and features, and a pull request template. The bug form asks for the output
  of `deckhq doctor`, so an environment report arrives with the first message instead of after
  three round trips.
- `.github/FUNDING.yml`.
- `docs/plan/RELEASE-CHECKLIST.md`, the ordered commands for cutting a release, written down
  because the thing that went wrong with 1.1.0 was a step nobody had written down.

### Added

- **`deckhq doctor`.** One command that answers "what does DeckHQ actually know about this
  machine": how many sessions are on disk, how many the runtime reports as running, whether hooks
  are installed and — separately, which matters — whether they are being _delivered_, and whether
  state can be written. `--json` for scripting. The bug report form asks for its output, so an
  environment report now arrives with the first message instead of after three round trips.
- **`deckhq doctor --capture-proof`** writes a PNG comparing what the runtime reports against what
  DeckHQ holds. It renders the number of finished sessions still waiting on you, which is the only
  version of that comparison that survives a reader checking it — see `docs/DEVIATIONS.md` §74.

### Changed

- **The interface chrome is cold now, and the floor reads as lit.** The neutrals were tinted
  toward the accent hue, which put warm chrome around a warm floor: herringbone, carpet and warm
  light sitting on a ground of the same temperature, so the floor never looked illuminated, only
  brown. The neutrals moved to a violet-blue bias, taking hue separation from the floor from about
  66° to about 169°. The seven state colours are untouched — they are a measured contract with the
  renderer, and the rule when something failed was that the ground moves, not the state colour.

### Fixed

- **The desktop archive flag was being written into cached session summaries.** In memory this was
  masked, because a fresh read re-applied the flag on every poll and only while that read kept
  succeeding. It would not have stayed masked: `archived` drives `let_go`, so a persisted copy
  would have re-fired a deliberately rehired agent on every poll, for ever. The flag is now
  stripped both when an entry is written and when one is read off disk, because a cache file can
  arrive from a backup, another machine, or an older build. A cache hit carries no `archived` key
  at all rather than `archived: false` — the two mean different things to the registry, and
  neither is a decision a cache is entitled to make.
- **Five interface surfaces set small text in a state or accent colour**, all of them below the
  4.5:1 floor the stylesheet's own header already required. The worst was the error toast at
  2.39:1 — the surface that tells you a send has failed. Contrast is now asserted in the test
  suite against every ground the text can actually land on, reading the literal values back out of
  the stylesheet rather than a copy.
- **`deckhq doctor` aborted with exit 127 after printing a correct report.** `process.exit()` tore
  down the event loop while a loopback socket was still closing. Worth recording how it survived:
  364 tests passed against a binary that could not exit, because every one of them called the
  function and asserted its return value and none spawned the command. A command's contract
  includes how it ends.

### Performance

- **The summary cache persists across restarts**, so a daemon start no longer re-parses every
  transcript on disk. Measured on 66 real sessions across 307 MB of transcripts: a second start
  falls from 780–854 ms to **59–90 ms**. Cold start is unchanged; the only addition is one 62 KB
  atomic write.
- Only entries that are provably current are served. Painting a stale summary and reconciling
  afterwards was specified, built, and rejected: a stale `turnEnded` reaches the code that writes
  `reviewSince`, a user-owned field nothing observed is allowed to clear, and the likeliest reason
  a transcript moved while the daemon was down is that you replied to it in a terminal. That would
  have manufactured a review debt that then survives for ever.

### Known gaps

Carried forward from `docs/DEVIATIONS.md` §8–9, unchanged by this release:

- **Codex support is unverified.** The adapter is written against documented rollout-file
  conventions and has never run against real Codex data.
- **`openInTerminal()` is verified on Windows only.** The macOS and Linux paths are implemented and
  reviewed but have not been run.

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
