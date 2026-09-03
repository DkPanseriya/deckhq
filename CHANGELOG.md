# Changelog

<!-- Sections in an unreleased entry are additive: append bullets under the existing headings
     rather than starting a parallel list, and move an item out of "Known gaps" the moment it
     stops being true. -->

## Unreleased

### Added

- **`deckhq doctor --share` prints the report as a fenced block you can paste anywhere.** The same
  numbers as the report — transcripts, running now, on the floor, waiting on you, hooks, egress —
  with everything that belongs to you taken out: no paths, no project names, no machine name, no
  hook port, no free-text error message, and a date to the day rather than the hour. A problem is
  reported as a count with a pointer back to `deckhq doctor`, so the block says a check failed
  without saying what it read. Project names cannot leak by construction — the report counts
  distinct working directories and never keeps the strings — and a redaction pass runs over the
  assembled block anyway, because a runtime's version string and an adapter's error message are
  text this project did not write. The pitch is its last line. `--share --json` keeps stdout to
  exactly one JSON document and carries the block as a `share` field. The honesty tests of
  `docs/DEVIATIONS.md` §74 now run against this block as well as the report and the proof card:
  the retired overclaim cannot come back through the launch asset. §84.
- **The panel is a review surface, not a viewer.** It used to show a state chip, three big number
  tiles, an animated close-up and the conversation as one wall of unstyled plain text, under seven
  identical grey buttons. You were being asked to review work with none of the review material in
  front of you. Top to bottom it is now the identity line with the close-up shrunk to 44 px
  inline, the session's own title, its state and branch, how long it has been waiting, **what it
  said**, **what changed on disk**, three weighted actions, the composer, and the cost estimate as
  one quiet line at the bottom. `docs/plan/05-GUI-UX-SPEC.md` §4.
- **The last message renders as markdown.** Headings, paragraphs, bullet and numbered lists nested
  by indentation, block quotes, fenced code with a mono face and a ground of its own, inline code,
  bold, italic, and links as their text with the URL visible beside them. The agent wrote
  markdown; showing it as plain text was throwing away the structure the reader needs. Own
  renderer, `public/markdown.js`, no new dependency — and it is two stages on purpose:
  `parseMarkdown()` produces a token tree and touches no DOM, `renderMarkdown()` builds elements
  with `createElement` and `textContent`. There is no `innerHTML` in the client at all, and a
  `<script>` tag inside a fenced block renders as the visible characters it is and executes
  nothing. Both are asserted as `SECURITY:` tests.
- **"What changed in `<project>`", from the working tree.** New endpoint `GET /api/changes?id=`
  runs three read-only git commands in the session's cwd — the unstaged diff, the staged diff, and
  how far the branch is ahead of the default branch — and reports `+142  −18  3 files` over
  per-file rows. Cached per scan, so a panel left open costs three spawns per scan per project at
  most, not three per poll. It turns "want me to open the PR?" from a question you must go
  somewhere else to answer into one you can answer here. The heading names the **project**, never
  the agent: with several agents in one repository a working-tree diff is not attributable to one
  of them, and the section will not imply otherwise. A clean repository says _"nothing
  uncommitted"_ rather than disappearing, because "no changes" is itself review-relevant.
- **Three weighted actions on `1`, `2`, `3`.** `1 Reply` focuses the composer. `2 Approve` sends a
  configurable affirmative — `"Yes, go ahead."` by default, `approveText` in settings — and is the
  only accent-filled button on the screen, because it is the commonest reply in this workflow and
  making it one keystroke is the largest per-day saving in the redesign. `3` benches. Everything
  else — mark for review, let go, rename, new agent, recall, rehire — moved behind `⋯ more`.
  Seven equal buttons was not a choice architecture, it was an inventory.
- **An unsent reply is a visible state.** Text left in the composer is kept per session in
  `localStorage`, survives closing the panel, switching agents and reloading the tab, and shows as
  a `draft` chip on the panel header. It is the agent's queue being held by you. Purely
  client-side: the daemon never sees a draft and a draft never touches ack state.
- **You can see what each agent is doing, from across the room.** DeckHQ now installs
  `PreToolUse` and `PostToolUse` alongside its other hooks — same tagged block, same consent
  screen, same exact removal — and keeps the current tool per session: `Bash npm test`,
  `Edit src/events/backfill.ts`, `Read README.md`, or the tool's own name for everything else,
  120 characters at most. It shows as a small bubble above the head while the tool runs, as a
  tool-class icon (file, shell, web) when the floor is zoomed out or reduced motion is on, and as
  one quiet `doing:` line on the panel header. The bubble yields: an agent with its hand up, an
  hourglass, a review tick or a waiting badge keeps that, because what needs you outranks what is
  merely happening. A path outside the session's own working directory is reduced to its file
  name, so a screenshot of your floor cannot carry someone else's directory tree, and every
  payload string is flattened to one line of printable text before it is drawn — on canvas with
  `fillText`, in the panel with `textContent`, never as markup. Nothing about a tool event
  touches `ackState`, the needs-you count, or the stall clock; there is a named `INVARIANT:` test
  for exactly that. A tool nobody reported finishing expires with the stall window rather than
  hanging over a head forever. `docs/DEVIATIONS.md` §89.
- **Every file in "what changed" opens its own diff, in the panel.** Click a row — or focus it
  and press Enter — and the unified diff for that file unfolds under it: hunk headers, added and
  removed lines, context, in a mono face, collapsed by default, with `[ expand all ]` under the
  table. New endpoint `GET /api/diff?id=&file=` runs `git diff` and `git diff --cached` for the
  one file, in the session's cwd, as argv arrays, cached per scan exactly like `/api/changes`.
  A path that resolves outside the session's repository is a 400, never a clamp, and a diff past
  200 KB comes back marked truncated rather than silently halved. The renderer,
  `public/diff-view.js`, is two stages like the markdown one — `parseDiff()` classifies lines and
  touches no DOM, `renderDiff()` builds elements with `textContent` — so a diff of an HTML file
  full of `<script>` renders as the visible characters it is and creates no element. That is a
  `SECURITY:` test. The heading still names the **project**: `05` §4.2's honesty requirement is
  untouched.
- **"Open in editor", per file row, from an allowlist of five.** The `↗` on a row POSTs
  `{id, file, line}` to `/api/open-in-editor` and the daemon opens it at the first changed line.
  The browser never sends a command: which program that means is the new `editor` setting —
  `code`, `cursor`, `zed`, `idea` or `subl`, or blank for "the first one on PATH" — resolved
  against a frozen table and spawned as an argv array. Anything else is refused at the settings
  route, refused by the store, and refused again by the resolver; `$EDITOR` is consulted only to
  choose between allowlisted editors, so an `$EDITOR` of `rm` selects nothing. On Windows, where
  `code` is `code.cmd` and Node will not spawn a batch file without a shell, the launch goes
  through `cmd.exe` with a command line DeckHQ quotes itself and a path containing a quote or a
  percent sign is refused rather than run. `docs/DEVIATIONS.md` §90.
- **"Open in terminal" knows ten terminals, not one.** macOS detects and prefers Ghostty, iTerm2,
  Warp, kitty, WezTerm, then Terminal.app; Linux honours `$TERMINAL` first and then tries
  Alacritty, foot, kitty, WezTerm, GNOME Terminal, Konsole, Xfce Terminal, xterm and the Debian
  `x-terminal-emulator` alternative. Each one is launched through its own documented interface —
  `ghostty -e`, `kitty --directory`, `wezterm start --cwd`, `konsole --workdir`,
  `xfce4-terminal -x` — rather than a shared guess at `-e`. It picks the emulator DeckHQ is itself
  running inside when it can tell (`$TERM_PROGRAM`, or the variable each one exports), falls back
  to whatever is installed in that order, and walks on to the next candidate if one will not open,
  so a terminal that has been uninstalled costs one failed spawn rather than the feature.
  `openNewSession()` gets the same treatment — and, on macOS, finally passes the first prompt
  through, which the old path silently dropped. `docs/DEVIATIONS.md` §91.
- **A `terminal` setting pins one.** `POST /api/settings {"terminal": "ghostty"}` — `auto` by
  default, which is detection. A pin outranks `$TERMINAL` and everything detected; a pin for
  something the machine no longer has is reported rather than silently ignored, and the detected
  terminals are still tried behind it.
- **`deckhq doctor` says which terminal it would open**, and how it knows:
  `terminal        Ghostty   (this session runs inside it)`. The parenthesis is one of
  `(installed)`, `($TERMINAL)`, `(pinned in settings)`, `(always present)`, or, for a pin the
  machine no longer satisfies, one saying so. The row names only checks that were actually run
  and never claims the launch works — outside Windows, it has not been tried on a real desktop.
  It is in the local report only, never in `--share`: which emulator you run is a fact about
  you, not a number anyone can check.
- **`deckhq statusline` — the queue as one line, for a status bar.** `▣ 3 waiting · 1 hand up`,
  with the zero half omitted and `▣ clear` when nothing is waiting. `waiting` is the header's own
  numeral and `hands up` is the subset that is blocked on an answer, both from the same `counts()`
  the interface uses, so the two can never disagree. It reads a running DeckHQ if one answers on
  127.0.0.1 within 150 ms and `~/.deckhq/state.json` plus the scan cache if none does — 3 ms median
  on 77 sessions, 5.6 ms on a synthetic 400, against a 20 ms budget asserted in the test.
  `--json` for scripts. `deckhq statusline --install` writes it into your Claude Code status line
  under the same consent discipline as hooks: the literal JSON and the file path are printed, and
  nothing is written without `--yes`. The entry is tagged, your settings file is copied to
  `~/.deckhq/backups/` first, `--remove` takes out only what DeckHQ wrote, and a status line
  somebody else configured is reported and left alone. No outbound network calls. §92.
- **The terminal deck: `deckhq ls`, `waiting`, `ack`, `bench`, `open`.** The deck of
  `docs/plan/05-GUI-UX-SPEC.md` §3.2 as a table — oldest first, finished turns and raised hands
  above stalls, separated by a rule — in raw ANSI with no dependency. `waiting` is that queue
  alone; `ls` also lists everyone else on the payroll, and `--all` adds the benched and the let go.
  `NO_COLOR`, a pipe, `TERM=dumb` and `--no-color` all turn the colour off; `--json` on both reads.
  `<id>` is the MK tag the table prints, a name you gave, or any prefix of the session id, and an
  ambiguous one is refused rather than guessed. Reads work with or without a daemon; `ack` and
  `bench` go through the running daemon's `/api/ack` and nothing else, because `act()` is the only
  code path allowed to clear a user-owned state — with no daemon they print `start deckhq to act`
  and exit 2. §93.
- **DeckHQ has a VS Code extension.** `vscode/` — install it and the floor is a panel beside your
  code, with `▣ 3 waiting · 1 hand up` in the status bar. On the first window it looks for a
  daemon on `127.0.0.1:4317`–`4326` and, finding none, starts one with `npx --yes deckhq
--no-open`; `deckhq.autoStart: false` if you would rather start it yourself. Four commands:
  **Open floor**, **Show waiting** (the queue as a quick pick, oldest first, Enter opens the panel
  at that agent), **Start daemon** and **Stop daemon**. The count is pushed live from
  `/api/events`, so it moves the moment a session's turn ends, with a 5-second poll as the
  fallback; the line is the same string `deckhq statusline` renders, asserted against it so two
  DeckHQ surfaces on one screen cannot disagree. **No telemetry, no dependencies, no build step,
  and no socket that goes anywhere but `127.0.0.1`** — a test reads the extension's own source and
  fails the build if another host, `node:https`, `node:dns`, `node:tls` or a `fetch(` appears in
  it. It reads `/api/state` and `/api/events` and posts nothing: a status bar cannot discharge a
  debt by displaying it. The panel loads the floor in an iframe on the daemon's own origin rather
  than re-serving it, so the floor's own requests stay same-origin and **nothing in the daemon's
  CSRF guard had to be relaxed for the editor** — a test asserts a `vscode-webview://` origin is
  still refused. §94.

### Changed

- **`2 Approve` is a send, never an acknowledgement.** It posts the affirmative through
  `/api/send` exactly as typing it would, and the review is discharged by the daemon when the
  runtime records the user turn — the documented `UserPromptSubmit` exception — never by the
  client deciding it has been dealt with. THE INVARIANT is now also checked statically:
  `test/unit/panel-invariant.test.mjs` reads the client source and fails if `/api/ack` appears
  anywhere under `public/` outside the one call inside `performAction()`, or if any render, open,
  refresh, load or send path can reach it. The worst version of this bug is a well-meaning ack
  wired into a render path, and no behavioural test can see it.
- **The demo floor builds real repositories.** Its project directories used to be `C:\code` or
  `~/code` — paths it named and never created. The review card reads the working tree, so the
  fixture now creates one of each shape the panel draws: a dirty repository carrying the diff the
  spec uses as its example, a clean one, plain directories with no git, and one project whose
  directory does not exist. All of it inside the temp root the demo already removes on exit, and a
  machine without `git` still gets a floor. Its `for_review` sessions also end on a message
  written the way an agent actually writes one, in markdown.
- `scripts/capture-floor.mjs --press` takes a sequence of keys rather than a single one, so a
  screenshot can be aimed at a chosen place in the needs-you queue.

### Fixed

- **SECURITY: a session id could choose where a launcher script was written.** The macOS
  "open in terminal" path built its temp filename as `deckhq-resume-<session id>-<timestamp>`,
  and the id arrives in a request body. An id containing `../` therefore picked the directory.
  Ids are now stripped to `[A-Za-z0-9._-]` and capped before they reach a path. The id's journey
  into the command itself was already safe — argv arrays throughout, and single-quoted for `sh`
  in the one wrapper file that has to exist — and there are now tests over every platform and
  every emulator asserting that an id made of shell metacharacters lands in exactly one argument
  and is equal to it. `docs/DEVIATIONS.md` §91.
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
  `docs/DEVIATIONS.md` §83.
- **Agents teleport to your office instead of walking to it.** The floor plan's signature counts
  who is waiting, benched and let go, so the product's most important transition — a turn ends and
  the agent leaves its desk for your office — was also a plan rebuild, and a rebuilt plan seats
  everybody in one snap. Measured on the demo floor at 10 fps: **one frame of movement, 431,956
  pixels changed, no walk at all**. The new snapshot is now bridged onto the rebuilt plan by first
  seating the previous roster where it already was, so agents whose state did not change stay put
  and the one whose state did change walks — **42 frames, 4.1 seconds**, and nobody interpolates
  across two different buildings. `docs/DEVIATIONS.md` §88.

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
  on instead of assuming it. `docs/DEVIATIONS.md` §82.

### Testing

- **The VS Code extension is asserted from the repository's own suite, and once inside a real
  editor.** Forty unit and integration tests cover the egress scan over the extension's source,
  an `INVARIANT:` test that `/api/events` is the only path it ever requests, its `needsYou` and
  its status line against `src/core/model.mjs` and `src/cli/statusline.mjs`, its port scan
  against `src/cli/source.mjs`, the panel's CSP, seven refused `cmd.exe` metacharacters in a
  configured start command, SSE frame reassembly against a real loopback server, and the daemon
  facts the panel depends on — that the floor may be framed, and that a `vscode-webview://` POST
  is still 403. `node scripts/vscode-verify.mjs` then runs six assertions inside a real VS Code
  against the demo floor, including that the status bar item appears and agrees with the daemon.
  §94.
- **Every (platform, emulator, launch form) pair has its exact argument list asserted** —
  twenty-one of them, byte for byte, in `test/unit/terminals.test.mjs`, plus detection order,
  `$TERMINAL` precedence, the pinned setting, and a hostile session id checked against every
  pair. The pair list is compared against the table itself, so an emulator cannot be added
  without an assertion. This is the only proof available for code written on a machine that
  cannot run it, and it is not the same thing as verification — see `docs/DEVIATIONS.md` §9.
- **The debounce test no longer races the wall clock.** "save() debounces" in
  `test/unit/store.test.mjs` slept 100 ms and looked for the file, slept 300 ms and looked again.
  On Windows CI (Node 18 and 20, run 33756126370) that turned `main` red while the same test
  passed everywhere else: a runner that services a timer late puts the write on the wrong side
  of the look, and no choice of sleep length can rule that out. The store's debounce clock is now
  injectable — `new Store(file, { timers })`, defaulting to the real one — and the test cranks it
  by hand: exactly one timer is scheduled, for exactly `SAVE_DEBOUNCE_MS`; nothing reaches the
  disk until it is fired; one write with the right contents lands when it is. Same proof, no
  timing. The sibling "rapid successive writes coalesce" test, which slept 350 ms for the same
  reason, is on the same clock. `docs/DEVIATIONS.md` §80.
- **29 tests for the diff and the editor.** The route is exercised against real repositories in
  temp directories for all seven shapes it has to answer — dirty, clean, not a repository, git
  absent, directory gone, a path outside the repository, and a diff past the cap — including one
  where the session's cwd is a subdirectory of its repository, which is the case that decides
  whether a row's path resolves at all. The renderer is run against a stub document that parses
  no HTML, so the only way a `<script>` in a diff could become an element is if the renderer
  created one, and it does not. The editor allowlist is tested by refusal: `rm`, `sh`, `curl`,
  `node` and `../../bin/sh` are each rejected, an `$EDITOR` of `rm -rf /` selects nothing, and
  the exact argv — including the doubled quotes Windows needs — is asserted without any program
  starting. Three of the tests recompute the new colour tokens' WCAG contrast from the stylesheet
  itself. `docs/DEVIATIONS.md` §90.

### Packaging

- **Nothing in `vscode/` reaches npm.** The root `files` allow-list is unchanged and a test
  asserts no entry can match it. The extension is packaged separately with `npx --yes
@vscode/vsce package` — never a runtime dependency — into a 27 KB `.vsix`, versioned `0.1.0`
  independently of this package because a Marketplace listing and an npm release are not the same
  artifact. Publishing it needs a Marketplace publisher account and a token, and has not happened.
  §94.
- **A tag now produces the release page, not only the package.** `publish.yml` gains a `release`
  job that runs once the OIDC publish has succeeded. It downloads the tarball the registry
  actually serves and checks it against the registry's own `dist.integrity`; builds
  `deckhq-X.Y.Z-win.zip` from it plus a two-line `packaging/deckhq.cmd` launcher; renders a
  Homebrew formula, a three-file winget manifest and a scoop manifest against those two digests
  (`scripts/release/manifests.mjs`); takes the matching `## X.Y.Z` section of this file as the
  notes (`scripts/release/changelog-section.mjs`); and creates the GitHub Release with the two
  screenshots and all of it attached. The workflow now defaults to `contents: read` and that job
  raises itself, so it is the only one in the file that can write to the repository whatever the
  account's default token scope is. `packaging/README.md` says what a user does with each asset.
  **Unproven until a tag runs it.** That run is WP-43's acceptance criterion and nothing here
  claims it.
- The publish job's npm upgrade is pinned to `npm@^11.5.1` instead of `@latest`, and the floor is
  asserted before anything else runs. The job also refuses to publish a version that has no
  changelog section, so the release page can never come up empty after the irreversible step.
- Ten tests cover the two release scripts, including one that fails the suite when
  `package.json`'s version has no section here — the same refusal, made locally. The zip step was
  also rehearsed by hand: the launcher was run out of a staging directory unpacked from a real
  `npm pack` tarball, so the one path that YAML review cannot check — launcher to `bin` — is
  proved. `docs/DEVIATIONS.md` §81.
- `packaging/deckhq.cmd` is checked out with CRLF endings (`.gitattributes`). The repository is
  otherwise LF-only, and the release job zips this file on a Linux runner for `cmd.exe` to run.

### Added

- **The floor is photographed on every change, and a pixel that moves without permission fails the
  build.** The three worst bugs in this project's history — the rig a quarter-turn out of true, a
  sofa drawn through a wall, chair backrests ninety degrees off — were invisible to hundreds of
  passing unit tests and obvious in one screenshot. `npm run goldens` captures the demo floor at
  1600x1000 for four fixture populations (25 agents, nobody, one agent, and the 70-session
  reference machine) and commits them; `npm run goldens:check` recaptures and compares pixel for
  pixel. Zero dependencies: the PNG codec and the diff are 300 lines over `node:zlib`, because
  8-bit non-interlaced PNG is a chunk walk, one `inflate` and five scanline filters. A failure
  writes the actual capture and a diff image — the expected floor at quarter contrast with every
  changed pixel painted red.
- **The gate is calibrated against a measured noise floor, not a guess.** Two captures of the same
  floor differ by exactly 36 pixels of 1,600,000 — one count on one channel, in the same 592x2
  strip of the header, flipping direction between runs. The smallest real defect it has to catch
  moves 1,181. So a pixel counts as changed at a channel delta over 8, and a capture fails past
  160 changed pixels: 4.4x above the noise, 7.4x below the weakest signal. The check prints the
  noise it is seeing on every run, so the day that number starts creeping is the day it is visible
  rather than the day the tolerance gets quietly widened. Both numbers replace an earlier
  eyeballed pair that measurement showed sat _under_ the defect they existed to catch;
  `docs/DEVIATIONS.md` §87 has both tables and the arithmetic.
- **Proved load-bearing the only way that counts:** the one line of the rig facing fix was
  reverted, and the check failed three of four populations by 24,449, 12,602 and 1,181 pixels.
  The fourth is the population with nobody on the floor, so it correctly still passed. The line
  was then restored.
- Captures are made repeatable rather than hoped to be: every fixture value is a pure function of
  the population name, `prefers-reduced-motion` is emulated so the renderer draws one static pose
  per state, Chrome is pinned to sRGB with greyscale anti-aliasing and no hinting — and two
  screenshots half a second apart must be byte-identical before either is used, so a floor that is
  still moving fails loudly instead of quietly becoming a golden that can never match again.
- `scripts/demo-floor.mjs` takes `--population NAME`, each with its own fixture directory, so a
  goldens run cannot tear down the floor you are looking at in `npm run demo`. Its seeded settings
  mark the tour as done, which every capture script previously had to dismiss by hand.

### Known gaps

- **Goldens are committed for Windows only, so the Ubuntu CI job reports SKIPPED and proves
  nothing yet.** Text is rasterised by the operating system, so one set of goldens cannot serve
  three platforms and there was no linux or macOS machine in reach. The job captures anyway and
  uploads the four PNGs as an artifact, which is how the first linux set gets made: download it,
  commit it under `test/goldens/linux/`, and the gate starts biting on the next push. Until then
  the check is real locally and decorative in CI, and it says so in those words rather than
  printing a green "all match" over a comparison that never happened.
- The Ubuntu runner's time for the job is the one unmeasured number: 26–29 s for all four
  populations on the Windows laptop over six runs, against the 90 s budget the work package asked
  for, plus roughly 5 s of checkout and Node setup with nothing to install.

### Repository

- **The README leads with the product instead of 450 words about it.** The pitch, `npx deckhq`,
  the hero GIF, then `npx deckhq doctor` with a real run and one sentence on why its fourth line
  is the number nobody else counts. Everything below the fold is the copy that was already there.
- **A hero GIF that is generated, not drawn** — `docs/media/hero.gif`, 5.9 s, 1200×750, 241 KB. An
  agent's turn ends, it leaves its desk, walks the corridor into your office and joins the queue
  waiting on you. `scripts/capture-hero.mjs` records the demo floor while the turn is ended through
  the real `/api/hook` endpoint, so the state change comes from the real state machine and the
  image carries no real project names; `scripts/gif-encoder.mjs` encodes it with no dependency,
  because neither ffmpeg nor ImageMagick can be assumed on the machine that cuts a release. Both
  are dev scripts — `scripts/` is not in the published package. `docs/DEVIATIONS.md` §88.
- The README's panel shot is the **review card** (`docs/media/panel-review-card.png`), and the
  section above it describes three weighted actions rather than the seven-button row that shipped
  before it.
- **1.2.0 has a GitHub release**, with the floor, the review card and the hero GIF attached and the
  changelog section as its notes — the package had been on the registry with no release page at
  all. The repository description is now the `package.json` description verbatim, so the two cannot
  drift apart, and `local-first` and `privacy` join the topics.
- **The release workflow stops attaching a screenshot of a panel that no longer exists.**
  `publish.yml` and `packaging/README.md` named `docs/media/panel.png`, which is the panel from
  before WP-08, so every future release page would have shown the superseded surface. Both now name
  the review card and the hero GIF, matching what v1.2.0 actually carries.

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
