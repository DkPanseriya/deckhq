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
- **`⌘K` — one palette over everything.** Fuzzy search across every agent (by name, MK tag,
  session title, project, branch or model), every project (jump to it, filter the queue to it,
  open its whiteboard, reveal its folder, run its dashboard, archive or restore the room, start
  another agent in it), every acknowledgement action that is legal on whatever is selected right
  now, resume, rename, and every command that used to be a header button. Arrow keys move, Enter
  runs, Escape closes and gives focus back to whatever opened it; it is a real dialog with a
  combobox over a labelled listbox, so a screen reader reads each row as "Command: Refresh,
  rescan every session now". Each of the six actions that left the header answers to one
  character — `s` settle, `p` new project, `h` hooks, `r` refresh, `n` notifications, `l` show
  let-go — so every one of them is still one keystroke and Enter away. That is asserted against a
  populated floor whose agent names collide with the command words on purpose, because a ranking
  test on an empty list proves nothing.
- **A settings sheet, for the first time.** Until now the stall window, the poll interval,
  notifications and sound were reachable only by POSTing to `/api/settings` by hand. `⌘K` → `,`
  opens six sections: state (stall window 2–120 minutes, poll interval), notifications (a master
  switch, per-state switches for hands up and for finished-and-waiting, sounds, volume), resume
  (default target), floor (a motion override that can hold the window still, or keep it animating,
  whatever the system asks for), data (the state file path and the dated rate card every cost
  estimate is computed from, both read-only), and hooks — the existing consent screen, embedded
  as a section rather than opened as a dialog of its own. Nothing about the consent contract
  changed: the literal file path and the literal JSON block are still shown before anything is
  written.
- **Notifications that survive the closed tab.** Every notification DeckHQ could raise used to
  come from the page, which meant the one moment it most needed to reach you — every window shut,
  the daemon still running, a hand going up — was the one it could not. `deckhq --notify` gives
  the daemon its own: a Windows toast, `osascript` on macOS, `notify-send` on Linux, **no
  dependency**. Exactly two events are worth interrupting for, per
  `docs/plan/04-ENGAGEMENT-AND-GAMIFICATION.md` §6 — a hand going up, and a working session whose
  process goes away without the runtime saying goodbye. Finished-and-waiting and stalled get the
  badge and nothing else, and a test fails if either is ever added. The copy says what an agent
  did — _"Ada raised a hand in orbital-api"_ — never what you failed to do. Coalescing is the
  client's: one notification per ten seconds, several sessions inside it becoming _"3 sessions
  raised a hand"_. Off until you ask: `--notify` turns it on for one run and persists nothing,
  `settings.osNotify` turns it on for good, and the master notifications switch turns it off
  along with the browser's. A machine with no notifier, or one whose policy refuses ours, falls
  back to the badge in silence. `docs/DEVIATIONS.md` §101.
- **DeckHQ installs, and the dock icon carries the count.** A web app manifest, an icon, and a
  service worker that exists to make the floor installable and does nothing else — it caches
  nothing and intercepts nothing, because a cached floor is a floor that lies about who is
  waiting and `/api/events` is a live stream. Installed, `navigator.setAppBadge()` keeps the
  needs-you number on the dock or taskbar icon with every window closed. The icons are generated
  from the stylesheet's own palette by `scripts/make-pwa-icons.mjs`, so no binary in this
  repository is one nobody can regenerate, and a test fails on any host in the manifest or the
  worker that is not this machine.
- **A permission prompt can be answered from the panel — not yet proven against a live session.**
  DeckHQ now installs a ninth hook, `PermissionRequest`, and it is the only one in the block the
  runtime waits on: when a tool call is about to ask your permission in the terminal, the request
  is held open on `POST /api/permission` for up to ten minutes while a card appears above WHAT IT
  SAID with the tool, its literal input, and **Allow** / **Deny** / **Allow for session** on
  `A` / `D` / `S`. "Allow for session" sends back the runtime's own rule with its destination
  rewritten to `session`, so nothing is ever written into your settings files. DeckHQ never
  allows anything by itself, never answers on a timer, never aborts a turn, and never touches
  `ackState` — five named `INVARIANT:` tests, one per never. The terminal prompt stays live the
  whole time: if nobody answers, if the daemon is closed, or if you answer in the terminal first,
  the terminal is what decides, so a closed DeckHQ can never block a session. The consent screen
  says all of that in its own paragraph before anything is written.
  **The acceptance run is still owed.** No real `PermissionRequest` has ever reached this code:
  the CLI's login on the reference machine is expired, so no tool call could be provoked. What
  exists is 38 tests and a scripted stand-in for the runtime's hook client
  (`scripts/fake-permission-client.mjs`) that sends the real payload to the real route and
  asserts the exact bytes that come back. Until a live session raises a prompt, has it answered
  from the panel, and carries on, this feature is not accepted and stays out of the README, the
  tweet and the pricing page. `docs/DEVIATIONS.md` §86 and §97.
- **DeckHQ now measures itself.** An append-only event ledger,
  `~/.deckhq/ledger/YYYY-MM-DD.jsonl`, one JSON object per line, written by the state machine as
  the floor moves: a session first seen, every activity and ack transition with its `from` and
  `to`, every action you took by name, every send, every token total that moved, and the desktop
  app archiving a session. `docs/01-PRODUCT.md` §6 has said since the first day that this product
  fails if sessions sit in `for_review` longer than 24h — and until now there was no way on earth
  to know whether that was true. There is now. It is also the substrate the daily postcard, the
  rate card, team records and Wrapped are built on. §100.
- **`GET /api/stats?since=` and `deckhq stats`** compute those numbers from that ledger and from
  nothing else: median and p90 time from entering `for_review` to being discharged, how many
  items are sitting there over 24h, discharges and sends per day, tokens per project per day, and
  the longest wait ever with the day it started. Both surfaces call one function, and a test runs
  them over one directory and diffs the answers, so the terminal and the API can never end up with
  two definitions of a median. `deckhq stats` needs no daemon and opens no socket at all.
- **A day's ledger reconstructs the needs-you queue at any past timestamp.** That is WP-17's
  acceptance criterion and it is a test: the same scripted session is driven through the live
  state machine, the floor is photographed at five moments, and each one is compared against
  `reconstructQueue()` replaying the file. It works across midnight because each day file opens
  with a carry-over snapshot carrying the real timestamp each waiting session started waiting.
- **`deckhq ledger export --signed` and `deckhq ledger verify`.** A day, byte-for-byte, plus an
  Ed25519 signature (`node:crypto`, no dependency) carrying the public half of a key generated
  once into your state directory and never sent anywhere. It proves the file has not changed and
  that one key signed it; `verify` prints the key fingerprint and says plainly that this is not
  proof of who that is. This is what lets a team assemble a floor from ledgers in storage they own
  rather than from a server we run.
- **Every record carries a `machineId` and a `projectKey`.** The machine id is 32 random hex
  characters minted once into `state.json` — derived from nothing about your machine, sent
  nowhere — so two of your own ledgers can be merged later without a migration. The project key is
  a hash of the project's directory, never the directory: two tests assert that no record and no
  exported file contains a path, a path segment, or a project name.
- **`settings.ledgerRetentionDays`, 90 by default**, clamped to 1–3650 and pruned once at every
  daemon start. Deleting the ledger costs you history and nothing else — no acknowledgement lives
  in it.
- **DeckHQ installs as a Claude Code plugin.** `/plugin marketplace add DkPanseriya/deckhq` then
  `/plugin install deckhq@deckhq`, and that is the whole setup: the plugin carries the same eight
  hooks the settings screen writes, starts the daemon on your first session if none is running,
  adds `/deckhq:deck` (opens the floor) and `/deckhq:waiting` (prints the queue), and exposes one
  MCP tool, `deckhq_waiting`, so Claude itself can answer "what is waiting on me across all my
  projects". The plugin's hooks carry **no port**: the daemon now publishes the one it bound to
  `~/.deckhq/daemon.json` and the hook command looks it up, which is what makes the same copied
  configuration work on a machine that installs DeckHQ tomorrow — and removes the port-drift class
  of bug from this route entirely, so there is no reinstall banner to show. `SessionStart` is
  `async`, so a cold start never blocks a session, and it starts **exactly one** daemon however
  many terminals you open at once: a probe, an exclusive lock, a second probe. The MCP tool is
  read-only by construction — there is no `deckhq_ack` and there will not be one, because a model
  that can clear the needs-you count can clear it by accident. `plugin/` imports nothing outside
  itself, has no `package.json`, and every URL in every file it ships is loopback; three
  `SECURITY:` tests hold that. **No egress added.** §102.
- **A queue strip under the header, whenever something is waiting.** One chip per item, oldest
  first, each carrying a state glyph, the elapsed time in mono, the agent's name and its project.
  The oldest chip is always leftmost and never scrolls out — there is no scroller at all; on a
  narrow window the rest collapse into a `+N` that opens the deck. Hovering a chip shows the last
  line that agent said; clicking one selects it and opens the panel, and the chip is ringed at the
  same moment the floor rings the same person, which is what teaches the mapping between the two
  surfaces. The times tick live, and past a day of waiting they take a crimson rule under the
  number. It is a `role="list"` of real buttons, not canvas, so it is reachable by keyboard and by
  a screen reader like anything else. `docs/plan/05-GUI-UX-SPEC.md` §3.1.
- **The deck, on `Tab`.** A dense table that replaces the floor and leaves the panel exactly where
  it was — WAITING · WHO · PROJECT · LAST WORD · TOKENS, oldest first, finished turns and raised
  hands above sessions that have gone quiet with a rule between them, 34 px rows. `J` and `K`
  move, `Enter` opens, `1`, `2` and `3` act on the row under the cursor without opening it, `Tab`
  goes back to the floor. It is a genuine `<table>` with a caption, column headers and a row
  header per session, because it is the accessible equivalent of the floor: a screen-reader user
  gets the same queue, in the same order, with the same actions. **The floor is never the only way
  to reach anything.** The floor earns the screenshot; the deck does the job. §3.2, §10.
- **Past six items waiting, the floor says so.** One line at the end of the strip — _"7 waiting ·
  press Tab for the deck"_ — and nothing else changes: it still opens on the floor, because the
  spatial view is the thing that makes the product make sense. Past six, though, the floor stops
  being the efficient surface, and pretending otherwise is the failure mode this whole package
  exists to answer. §3.2.
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
  still refused. §104.
- **Every agent has a face and a name, and a few of them are rare.** Appearance is a deterministic
  hash of the session id — hair style, skin tone, an outfit accent, glasses, build — so the same
  session looks like the same person on every machine, forever, with nothing persisted and nothing
  to migrate. On top of that sit rarity tiers, measured over 10,000 ids at 73.6% common, 20.3%
  uncommon, 5.3% rare and 0.9% legendary: an uncommon agent wears a hat or a scarf, a rare one a
  jacket or a striking hair colour, and a legendary one a crown or a soft aura. It is the Claude
  Buddy mechanic (`docs/plan/08` §3.0), applied to the **agent** — nothing is earned, nothing
  decays, no state or count moves, and the human is never scored. The torso is still the state
  colour at full strength and the state icon still owns the slot above the head, both with tests;
  every appearance colour is at least 70 in sRGB from every state colour, computed rather than
  eyeballed, and guarded at import time. `docs/plan/04` §4, `docs/plan/08` §7, `docs/DEVIATIONS.md`
  §105.
- **An agent arrives already named.** A first name from `public/names.js` is assigned the first
  time a session is seen instead of waiting to be asked for, persisted beside the MK numbers, and
  never reassigned — not when other agents arrive, not across a restart, and not when the list of
  names runs out. _"Ada has been waiting since yesterday"_ is a sentence that makes someone open a
  tab; _"MK3.2 has been waiting since yesterday"_ is not. The MK tag stays underneath as the
  sub-label, in the hover card and on the panel header, because it is what makes a session
  locatable by project. Renaming still wins over the given name, and identity assignment writes no
  user-owned field — that is an `INVARIANT` test.
- **A quiet word for a rare agent.** The hover card and the panel header show `uncommon`, `rare` or
  `legendary` beside the name, in the muted ink, and show nothing at all for the ~74% that are
  common. A word and never a number: no percentage, no rank, and no count of what you have
  "collected" — `docs/plan/08` §1.1 rule 6.
- **The team has records.** Longest wait ever and the day that stretch began, the busiest day, the
  most turns in any seven days, the room that never slept — the project with somebody in it across
  the most distinct hours of the day this week — and the fastest discharge day, the lowest median
  time in review of any day that discharged enough to have a median. All five are computed from
  the local event ledger by `records()`, published on `GET /api/stats` under `records`, and
  printed under `deckhq stats`. **Every one is a record of the team's work and none of them is a
  score on you**: there is no streak, no level, no count of your days and nothing that can be
  broken by a weekend, and two tests assert that no line of the copy addresses the reader in the
  second person — one over the rendered output of both surfaces, one over every string literal in
  the source. `docs/plan/08` §7 and §1.1 rule 6, `docs/plan/04` §1 and §5.
- **A record shows up beside the agent it is about.** When one of the records has the open session
  or its project as its subject, the panel's identity area carries one quiet line for it —
  _"longest wait ever was here: 2d 12h, 1 Sep"_ — and nothing at all the rest of the time, which
  is most of the time. A ledger younger than a week says so on the line (`· since 1 Sep`) rather
  than claiming a week it has not lived through, and the rolling window is clipped to the ledger
  instead of padded past it.
- **A machine with nothing on it gets actors, not a blank screen.** Install DeckHQ before you have
  run anything and the floor used to say "Nothing on the floor yet" over a `claude` code block —
  the blank screen that dev tools lose people on. The daemon now serves a small cast instead:
  seven actors across three rooms, two of them waiting on you, under one line — _"These are
  actors. Run `claude` in any repo and a real one walks in."_ The moment the scan finds a real
  session the whole cast is gone and it walks in alone, within one poll rather than on a reload.
  The actors are inert by construction and not by a check somebody has to remember: they never
  enter the registry, so acknowledging, benching, replying to or resuming one is refused by the
  same code that refuses an id that does not exist, and nothing about one can reach `state.json`,
  the identity file or the cache. `deckhq waiting`, `deckhq statusline` and `deckhq doctor` all
  report zero on that machine, because a fake count in a shell prompt is the one lie this product
  cannot afford. `docs/DEVIATIONS.md` §108.
- **`S` puts your office on the clipboard.** One key composites the floor and a stat strip into a
  PNG — `SAMCO-DESK · 6 rooms · 25 people`, the four tallies with their state dots, today's
  estimate, the longest wait, and a small wordmark — copies it, and saves it to
  `~/.deckhq/snapshots/`. No "share to X" button that opens a compose window; the PNG is on the
  clipboard and the product gets out of the way. It works with the tab in the background, which
  is the case that found a real bug: a hidden tab reports `clientWidth` of 0 and a stale
  `clientHeight`, so the image is sized from the canvas's backing store and the device pixel
  ratio and never from layout. Two-times resolution and under 2 MB turned out to disagree until
  the floor was resampled the unobvious way: nearest-neighbour rather than smooth, which took the
  same 1600×1000 floor from **4.05 MB to 1.96 MB** and is also sharper, because the floor's
  materials are deliberately high-entropy and bilinear interpolation invents a new colour at
  nearly every pixel. Where they still disagree on a very large floor, resolution wins and the
  toast says the size. `docs/DEVIATIONS.md` §109.
- **`Shift+S` redacts, and it means the whole image.** Every project name becomes its MK tag —
  on the room plates as well as in the strip, because the plates are what a screenshot actually
  shows. The floor is handed a redacted snapshot to draw and handed the truth back immediately
  afterwards, so redaction needed no new renderer entry point and no second copy of the floor.
  The working directory and the project id go too: the id is a slug of the directory name, so it
  spells the project out. The hostname stays, deliberately — the office is named after the
  machine because people share things with their name on them, and `DECKHQ_HOSTNAME` is there for
  anyone who wants it called something else.
- **Three sounds, synthesised in the browser.** A low wooden door-close when a session finishes
  its turn and walks into your office, two soft knocks when a hand goes up, and a rising two-note
  chime when the office clears. No asset files, no fetches, nothing bundled — each is an
  oscillator or a filtered noise burst and an envelope. Rate-limited to the same ten-second window
  the notifications coalesce in, so three sessions finishing together is one door; silent when the
  tab is hidden _and_ the OS notification actually fired, which is checked from what happened
  rather than assumed from what was asked for; and one keystroke from the palette (`⌘K` → `u`)
  turns them off for good. Volume comes from the settings sheet. The envelopes were measured
  through a real `OfflineAudioContext` rather than described: the two noise sounds arrived 15 dB
  under the chime, because a lowpass throws away most of white noise's energy and an oscillator
  loses none of its own, and the volume slider had stopped affecting the door above a third of its
  travel. Both fixed, with the measurements in the source. **They still default to off**, which is
  a departure from the GUI spec and is deliberate: flipping that default would make every existing
  install start making noise on upgrade, and the reason it is off — a product that sits beside a
  terminal at 11pm does not arrive making noise — is pinned by a named test. Turning them on now
  plays the chime once so you can hear what you have agreed to. `docs/DEVIATIONS.md` §110.1 puts
  the call to the owner.
- **The office-cleared moment.** When the last waiting agent is discharged and the office had been
  busy for at least a minute: the light warms 6% over 1.2 seconds, the chime plays, and one line
  fades in and out over three — _"Office clear. 6 discharged today, longest wait 1d 2h."_ Then it
  is gone. The minute is the rule that makes it worth having: a session that arrives and is
  discharged in the same breath earns nothing, so the moment marks a real milestone and not a
  keystroke. It never scores you — it records the team's work, in the third person, and there is
  no version of the line containing "you", a streak or a level. `prefers-reduced-motion`
  suppresses the warming and keeps the line, because the line is the information and the warming
  is the decoration. The warm is a CSS overlay on the stage that does not exist until it is
  needed; the floor is unchanged.
- **`POST /api/snapshot` writes the PNG, and takes nothing from the request but the pixels.** The
  daemon names the file from its own clock, checks the PNG magic bytes before writing anything,
  and has its own 8 MB body ceiling — the shared 1 MB JSON cap is right for JSON and wrong for
  the one route that carries an image. Five non-PNG bodies, including a shell script announced as
  `image/png`, and a filename smuggled through two headers, are all covered by named `SECURITY:`
  tests.
- **The rate card is a file with a date on it, and you can replace it.** Cost estimates used to
  come from four tiers hand-typed in the middle of `src/core/model.mjs`. They are now
  `src/data/rates.json` — versioned `2026-09-04`, carrying the pricing page it was read from and
  the date it was read, keyed by model id prefix with the longest prefix winning. Drop a
  `~/.deckhq/rates.json` beside your state and it merges over the shipped table entry by entry —
  change one model's price, add a model nobody ships, name your own version string — and it takes
  effect the moment you save the file. No restart. Rows this project has not checked against a
  published price list (the Codex/OpenAI prefixes) are flagged `unverified` in the file itself,
  because a number in a dated table implies a source. `docs/DEVIATIONS.md` §111.
- **Every cost on the screen names the table it came from.** The review card's bottom line reads
  `≈ $7.86 · list price, rate card 2026-09-04 · not a bill`; `deckhq stats` prints
  `rate card 2026-09-04 — list-price estimate, not a bill` (and carries `rateCardVersion` in
  `--json`); the settings sheet's "Rate card" row reads the live version rather than a constant. A
  cost figure whose table nobody can name is a figure nobody can check. The rule that cost is an
  estimate and never a bill is now asserted as literal text: a test collects every cost string any
  surface can produce and fails if one of them carries a figure without a qualifier, or says
  "bill" without "not a" in front of it.
- **A room's plate carries what it has spent today.** `today ≈ $18.40 · list price`, as a quiet
  third line under the name and the session count, computed from the event ledger's per-project
  token deltas since local midnight. A project the ledger has no record for today falls back to
  its session totals and says `to date` instead — the plate never says "today" about a number that
  is not today's. Produced and tested; not yet painted, because the one function that draws a room
  plate was outside this package's scope. §111.
- **Float your office over the terminal.** `P`, or `⌘K` → "Float the office", opens a 320×200
  always-on-top window holding your office, the corridor beside it, the needs-you numeral and the
  hands-up count. It survives tab switches and app switches, it updates on every event the floor
  does, it flashes once when somebody walks in, and clicking a person opens the main window's panel
  on them. It answers "I closed the tab and forgot" without a tray app, a shell, or a permission
  prompt — Chromium's Document Picture-in-Picture is a plain web API. Firefox and Safari have no
  such window: there the count goes to the app badge WP-16 already wires, and one line says so.
  It is **a second render target of the same floor**, never a second floor: it draws the live plan,
  the live baked bitmap and the live agent records the main canvas is using, so there is one
  building and one answer to where each session is standing. It also keeps the people moving while
  the tab is hidden, which is the only time it is the thing you are looking at.
  `public/minifloor.js`, `docs/DEVIATIONS.md` §113, `docs/media/mini-floor.png`.

### Changed

- **The building is the size of what is in it.** The floor drew the right rooms and then measured
  them wrong: the envelope was built to the window's shape and the treemap stretched whatever
  rooms there were to tile it, so one active project got an 88 x 67 room for a two-seat table —
  about 55% of the screen as pale carpet with nothing on it. A room's footprint now comes from its
  occupants and their furniture (a table for N seats, the circulation round it, the clearance the
  planting and the wall fixtures stand in, and the plate band), and the floor's extent is the sum
  of its rooms, the service column and the corridors. On the reference machine that is a 56.8 x
  54.5 unit building instead of 132.4 x 76.3, a 16.7 x 22.9 room instead of 90.4 x 67.1, and
  people drawn at 42.6 px instead of 30.4. The office and the lounge follow the same rule — a
  games table appears when the lounge has more people in it than places to put them, rather than
  on a fixed headcount, so a dozen benched agents no longer get an arcade. What the rooms do not
  need is drawn as open floor rather than as more carpet, and what the building does not need is
  the dark studio ground it stands on. Many active projects still pack as they did. §106.
- **The idle-projects strip gives way in rows, not in columns.** With the working floor now the
  width of its rooms there is often one readable column, and the old three-row cap put seventeen
  repos on top of each other inside it. Rows grow instead and the columns hold their width, so the
  strip on the reference machine is seventeen legible lines. A line still costs a line, and the
  strip is still a corner of the floor rather than a room. §106.
- **The header counts describe what is on the floor.** It read `21 at desk · 47 benched` over a
  picture with two people at a desk and twelve in the lounge: both numbers were true of the deck
  and neither was true of the room under them. "At desk" is now the sessions the floor actually
  draws at a desk, "benched" the ones drawn in the lounge, and the two that are not drawn are
  named rather than folded in — a quiet `N finished` for sessions that have ended in a repo nobody
  is working in, and the lounge door's own `N went home`. Both are hidden when they are nought.
  Nothing is lost: a finished session is still in the panel, still in `deckhq ls`, still one
  keystroke from the palette, and still counted on its repo's line in the idle strip. The
  needs-you numeral and its three-way breakdown are unchanged — a session that needs you needs you
  whether or not there is a room to stand it in. §106.
- **The floor stops growing as well as shrinking.** The fit scale is now clamped at both ends — a
  character body is never under 16 px and never over 44 px. A quiet machine's floor is genuinely
  small, and on a large display it was being blown up like a poster. §106.
- **The header is a headline, not a toolbar.** It was brand, five small numbers and six buttons of
  equal weight, three of them maintenance and one wired to nothing. It is now the brand, the
  needs-you numeral at 44 px of JetBrains Mono with its three-way breakdown beside it, the floor
  counts as one quiet line, the `⌘K` hint, and exactly one primary action — `+ New agent`.
  Everything else is in the palette. The degraded and write-error banners are untouched; they are
  the honest-limits machinery and they were already right.
- **The needs-you numeral is the display element of the interface.** It was 13 px in a corner —
  five millimetres for the single most important fact in the product. It is 44 px now, and at zero
  it drops to the quietest ink in the set and loses its weight, because a cleared queue should
  look calm rather than like a scoreboard reading nought. It also stopped being crimson: that
  colour is reserved for a session standing in your office, and the total is the sum of three
  states, one of which is a session that has merely gone quiet. The stylesheet now sets no text
  anywhere in the accent colour at all, which is one fewer exception than before.
- **The dead "Show let go" toggle is gone, and so is the setting it wrote.** It had been in the
  header for four months writing `settings.showLetGo`, which no code has ever read
  (`docs/DEVIATIONS.md` §58). `zoom` went with it — same defect, never reported. "Show let-go
  agents" survives as a view toggle in the palette, held in the tab rather than on disk, because
  what you are currently looking at is not a property of the machine. The route's allowlist is now
  derived from the store's defaults instead of hand-maintained — the two lists drifting apart is
  exactly how a setting nobody reads stays alive — and a new test fails on the next settings key
  that changes nothing.
- **`settings.notifications` finally does something.** It was declared, defaulted to on, and never
  consulted; the client checked only the browser permission. It is now the master switch, with
  `notifyHandsUp` and `notifyForReview` under it, so the two states that reach you when the tab is
  closed can be chosen separately.
- **The floor is generated from the people on it, not from the repositories on disk.** Rooms exist
  only for projects with an agent at a desk, hand up, or waiting; a room's desks are the agents at
  them, minimum one table, where they used to be the session count with every benched session
  included. Projects nobody is in collapse into ONE directory strip along the bottom of the
  working floor — one line each, carrying the name, the session count and how long ago anything
  happened, and clicking a line scopes the panel exactly as clicking a room plate does. Archived
  projects stay off the floor entirely. On the reference machine the working floor was one
  furnished room and ten large empty cells; it is now one furnished room filling 59% of the floor,
  3.3% of it bare, with seventeen idle repos in a strip taking 8.2%. `docs/DEVIATIONS.md` §96.
- **Benched agents who have gone quiet go home.** A benched agent with no activity for longer than
  `settings.goneHomeDays` (default 7, `0` to keep everybody) is not drawn, the lounge is sized to
  the people who ARE drawn, and the door plate reads `12 benched · 35 went home`. Nothing about
  their state changes — this reads an observed timestamp and writes nothing, so `ackState` and the
  invariant are untouched, and any new activity brings them back on the next scan. They stay in
  the header, in the panel, and one `g` away on the keyboard.
- **People never shrink below legibility.** The character scale is decoupled from the world scale,
  and `05-GUI-UX-SPEC.md` §6.2's floors are applied per element where each is drawn: 16 px of
  body, 11 px of name label (was 9), 12 px of state icon (was 10), 13 px of waiting badge. At fit
  on a 1600x1000 stage the reference floor now draws a 31 px body and an 11 px label.
- **A re-plan is animated.** A room appearing when its first agent sits down, or folding into the
  directory when its last one leaves, cross-fades over 260 ms rather than popping. Reduced motion
  and a hidden tab get the cut.
- **`2 Approve` gives up its accent fill while a permission card is up.** The panel's rule is one
  filled button on the screen; Allow is also a primary action, and two crimson buttons is exactly
  the "which one is the action?" problem that rule exists to prevent. Approve keeps its key, its
  place and its label. `docs/DEVIATIONS.md` §97.3.
- **The hooks consent screen reads as paragraphs.** An adapter's note is split on blank lines
  instead of being set as one block, because the `PermissionRequest` paragraph is the one that
  grants a runtime the ability to be answered rather than only watched, and it must not be the
  tail of a wall of text. Still `textContent`, still no markup.
- **Onboarding is three coach marks on real things, not a modal.** What was there listed all six
  states in about 190 words, in a dialog, in front of the floor, before you had seen the floor do
  anything. Now: one card on the needs-you numeral (_"7 sessions are waiting on you. This number
  is yours. The runtime can't clear it."_), one on your office (_"They finished and walked in
  here. Reading a message doesn't send them away — only you do."_), one on a waiting agent
  (_"Click anyone."_). Each is dismissible, `Escape` skips all three and never asks again, and the
  whole sequence reads in 10.2 seconds against the fifteen the spec budgets — asserted in the
  suite, so copy that grows past it fails the build. `⌘K` → "Onboarding again" brings it back on
  purpose. The floor stays clickable underneath: there is no scrim, because the third card's whole
  instruction is to click something. A card whose anchor the renderer cannot place drops its arrow
  rather than pointing at a guess — that is the state the two floor marks are in today, and
  `docs/DEVIATIONS.md` §108.1 states the one renderer export that would fix it.

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
- **`J` and `K` sort stalled sessions last, on the floor as well as in the deck.** The queue is one
  list now, in one order, wherever you walk it — the floor's ring, the strip's chips, the deck's
  rows and `deckhq waiting` all read the same function, and a test runs the browser's copy and the
  CLI's over one snapshot and asserts they agree row for row. A finished turn and a raised hand
  come before a session that has merely gone quiet, because they need different responses and a
  stall is not a debt in the same way.
- `scripts/capture-floor.mjs --press` takes a sequence of keys rather than a single one, so a
  screenshot can be aimed at a chosen place in the needs-you queue. It also understands three
  escapes — `^` holds Ctrl for the next key, `~` is Enter and `>` is Tab — so a shot can be aimed
  through the command palette or into the deck.
  screenshot can be aimed at a chosen place in the needs-you queue. It also understands two
  escapes — `^` holds Ctrl for the next key and `~` is Enter — so a shot can be aimed through the
  command palette.
- **The WHO column, the deck's JSON and `deckhq deck open <name>` all know an agent's given name.**
  The column used to fall through to the session title because almost nobody had ever named an
  agent; now everybody has a name and it says what it was always meant to say. A given name also
  resolves an agent by name on the command line, exactly as a chosen one does.
- **`records` on `GET /api/stats` is the team's records, not a line count.** The raw count of
  ledger records it used to hold is `recordCount` now, and `computeStats()` publishes both names,
  so anything reading the count has somewhere to move to that is already there. `deckhq stats`
  reads the computation directly and is unaffected. One field, one local endpoint, recorded in
  `docs/DEVIATIONS.md` §111 as the breaking change it is.
- **A model the rate card has never heard of now has no price, instead of Opus's.** The old tier
  test matched `haiku`, then `sonnet`, then `gpt|codex|o3|o4`, and priced everything else at
  $15/$75 per million — a local model, a Codex id the tests never saw, an unrecognised Bedrock
  string, all of them. That is not a coarse estimate, it is an invented one, and it was being
  summed into project totals. `estimateCost` returns `null` now, the panel says
  `no rate for this model`, and a room nothing can price gets no cost line at all. `$0.00` is a
  claim about the money; "no rate" is the truth. `Agent.costEstimate` is `number|null`
  accordingly.

### Fixed

- **SECURITY: on Windows, a session id containing `&` was split into two commands.** Opening a
  session in a console goes through `start`, which is an internal `cmd.exe` command rather than a
  program, so `cmd.exe` re-parses the whole command line after it — and Node's Windows argument
  quoting wraps a value only when it contains a space, a tab or a quote, leaving `&`, `|`, `^`,
  `<` and `>` bare for `cmd.exe` to read as syntax. Measured on Windows 11: an argument of `x&y`
  reached the launched program as `x`. The session id arrives in a request body, so this was the
  same class of problem as the Codex one below, on the one platform whose launch form had
  actually been run. DeckHQ now builds that command line itself, with every value double-quoted
  and handed over with `windowsVerbatimArguments`, and the two characters that can escape a
  double-quoted `cmd` argument — `"` and `%` — are refused with an error that says why rather
  than escaped: a Claude Code session id is a UUID and a folder with a `%` in its name is rare.
  The working directory is now named on the line too (`start /d`) instead of inherited through
  two processes. The quoting rule is the one WP-47 already worked out for `code.cmd`, moved into
  `src/core/cmdline.mjs` so there is one definition of it. Both the defect and the fix were
  launched for real, with a working directory containing a space and an `&`.
  `docs/DEVIATIONS.md` §98.
- **"New Codex session" now runs `codex`, with your first prompt.** It used to open a terminal
  running `codex resume new` — a resume of nothing — and drop the prompt the panel had asked
  you for. The prompt is one argument, never part of a shell string, on every platform; and
  if no terminal emulator can be found the panel now says so instead of reporting success.
  (`docs/DEVIATIONS.md` §99)
- **An archived project's finished sessions were drawn in a room that did not exist.** The floor
  decided who to hide by asking whether a session's project was _idle_, and a project you archived
  and then stopped working in is on neither the active list nor the idle one — so its sessions
  were left at desks in a room the plan had never built. It asks whether the project has a room
  now, which is the question it meant. §106.
- **SECURITY: a Codex session id reached a shell.** Opening a Codex session in a terminal built
  its command as a shell string on both POSIX platforms — an AppleScript
  `do script "cd \"<cwd>\" && codex resume <id>"` on macOS, and `bash -lc "codex resume <id>"` on
  Linux — with the session id and the working directory interpolated straight in. Both arrive in
  a request body, and the macOS escaping covered `"` and `\` only, so `'`, `` ` ``, `$(` and `;`
  went through into something that would run them. Every Codex spawn is now an argv array:
  opening a terminal goes through the same `launchTerminal()` the Claude Code adapter uses, and
  the adapter contains no `bash`, no `osascript`, no `do script` and no shell of any kind. There
  are 29 new tests asserting the exact array for all 19 (platform, emulator, launch form) pairs,
  that an id made of shell metacharacters lands in exactly one argument and is equal to it, that
  a hostile working directory does the same, and — over the adapter's own source — that it
  launches exactly one process and does it with a named argv array. Codex sessions also pick up
  the whole of WP-04 in passing: ten emulators instead of four, `$TERMINAL`, and the `terminal`
  setting, which this adapter used to ignore. The adapter is still unverified against real Codex
  (`docs/DEVIATIONS.md` §8) — what is proved here is the arrays, not the behaviour.
  `docs/DEVIATIONS.md` §95.
- **SECURITY: a session id could choose where a launcher script was written.** The macOS
  "open in terminal" path built its temp filename as `deckhq-resume-<session id>-<timestamp>`,
  and the id arrives in a request body. An id containing `../` therefore picked the directory.
  Ids are now stripped to `[A-Za-z0-9._-]` and capped before they reach a path. The id's journey
  into the command itself was already safe — argv arrays throughout, and single-quoted for `sh`
  in the one wrapper file that has to exist — and there are now tests over every platform and
  every emulator asserting that an id made of shell metacharacters lands in exactly one argument
  and is equal to it. `docs/DEVIATIONS.md` §91.
- **A prop's contact shadow no longer scales without bound.** Its depth is a property of how thick
  a thing is, not of how big it is; unbounded, the room-sized rug a large project room now gets
  cast a 380 px ellipse across half the room.
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

- **The team's records are checked against ledgers built so the answer is known.** Twenty-two
  tests over synthetic ledgers: each record is the record it claims to be, a stall coming back is
  not a new turn, a single two-second discharge cannot be a "fastest day", a room with no name
  never borrows another room's record, a ledger three days old reports three days and dates them,
  and adding a day to a date still lands on the next day when the clocks change. Two of them are
  the copy guard: the second person appears nowhere in either surface, with `waiting on you`
  allowlisted because it is the product's own noun phrase for the queue and not a reproach.
- **The permission feature's five "never"s are each a named `INVARIANT:` test.** Never auto-allow,
  never answer on a timer, never set `interrupt`, never send a destination other than `session`,
  never touch `ackState`. The route is driven through fake request and response objects so that
  "nothing was written back" — the load-bearing state in this feature — can be asserted while the
  socket is still open, which a real HTTP client cannot observe until the hold has already ended.
  `test/integration/permission.test.mjs` then runs the scripted runtime against a real daemon and
  asserts the exact JSON it receives for all three buttons and for both fall-through paths.
- **The GUI's queue and `deckhq waiting` are held to one order by one test.** The browser cannot
  import the CLI's module and the CLI cannot import the browser's, so the ordering exists twice on
  purpose; `test/unit/deck-view.test.mjs` runs both over a single fixture — a stall older than
  everything else, two rows sharing a timestamp to the millisecond, a benched agent, a let-go one
  and a working one — and asserts the id sequences are identical. Ties now break on the session id
  in both, so the order cannot depend on how a particular engine happens to sort. The deck's own
  DOM is asserted against a stub document that parses no HTML: a caption, five column headers with
  `scope="col"`, a row header per session, one `<tbody>` per group, rows in queue order, and a
  hostile display name that stays characters rather than becoming an element.
  `docs/DEVIATIONS.md` §103.
- **The VS Code extension is asserted from the repository's own suite, and once inside a real
  editor.** Forty unit and integration tests cover the egress scan over the extension's source,
  an `INVARIANT:` test that `/api/events` is the only path it ever requests, its `needsYou` and
  its status line against `src/core/model.mjs` and `src/cli/statusline.mjs`, its port scan
  against `src/cli/source.mjs`, the panel's CSP, seven refused `cmd.exe` metacharacters in a
  configured start command, SSE frame reassembly against a real loopback server, and the daemon
  facts the panel depends on — that the floor may be framed, and that a `vscode-webview://` POST
  is still 403. `node scripts/vscode-verify.mjs` then runs six assertions inside a real VS Code
  against the demo floor, including that the status bar item appears and agrees with the daemon.
  §104.
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
- **52 tests for the ledger, and one of them is the whole point.** `INVARIANT: a failing ledger
changes neither the agents nor one byte of ack state` drives one scripted session — a scan,
  three hook events, a tick, three legal actions, one illegal one, a desktop archive, a send and a
  second scan — through three registries: one with no ledger, one with a working ledger, and one
  whose every ledger call throws. The resulting agents and the entire ack map are deep-compared,
  and so is the error the illegal action produced. A second `INVARIANT:` test greps `ledger.mjs`
  for `store.mjs`, `setAck` and `reviewSince`, because the real guarantee is the direction of the
  imports and it should fail loudly if anyone reaches past it. The 2-second flush is proved on an
  injected clock, never by sleeping (§80's lesson), and the append is proved by flushing two
  ledgers at one directory and counting both files' worth of records. `docs/DEVIATIONS.md` §100.
- **49 tests for the notifier and the PWA, none of which start a process.** The interruption
  budget is asserted as a table, including the absence of finished-and-waiting and stalled —
  the two states most likely to be added back by someone who thinks more notification is more
  product. Death detection is walked through all four shapes, and the registry's own record of
  whether a runtime said goodbye through `SessionStart → PreToolUse → Stop → UserPromptSubmit →
SessionEnd`. Coalescing is proved on an injected clock rather than slept through, the same
  discipline §80 established. The exact argv array for each of the three platforms is asserted
  whole, and a title containing `"; & $(` has to reach every one of them as a single argument
  that equals it. The PowerShell script is read back and must contain neither value inside a
  double-quoted string. The service worker and the manifest are read for any host that is not
  loopback, for a cache, and for a `respondWith`. `docs/DEVIATIONS.md` §101.
- **64 tests for the plugin, and one of them is the reason it will work on somebody else's
  machine.** `claude plugin install` copies `plugin/` and nothing else, so a single import
  reaching for a sibling `src/` would resolve for the author and for no user; the test walks every
  import specifier in every file the installer copies and fails any that leaves the directory.
  Three `SECURITY:` tests hold the no-egress promise: every URL in every shipped file must be
  loopback, the manifest's two inert metadata URLs are pinned by key so a third cannot appear
  quietly, and the host is one constant nothing — not an environment variable, not a payload — can
  move. The hook command is spawned as a real child process with a real payload on stdin and made
  to find a daemon on an OS-assigned port discoverable only through `daemon.json`; the MCP server
  is driven over its real stdio transport; eight concurrent `SessionStart` starts produce exactly
  one spawn. `docs/DEVIATIONS.md` §102.
- **12 tests for the documentation site, and four of them are the egress promise.** The suite builds
  `site/` into a temporary directory and reads what came out: no page fetches anything
  cross-origin, no page carries a `<script>` or an `<iframe>` at all, the stylesheet has no
  `@import`, no `@font-face` and no remote `url()`, and the only hosts named anywhere in the
  sources are the two a reader is meant to be sent to. It also asserts that every internal link
  resolves to a file that was built, that a `<script>` inside a deviation entry renders as the six
  visible characters it is, and that the copy contains none of the phrasings `docs/plan/08` §4.2
  retires. A site that quietly grew a font from a CDN would fail the build the same way a daemon
  that grew a socket does. §112.
- **The Windows launch argv is now asserted on every platform, not only on Windows.** One test held
  the SECURITY property that a `.cmd` shim is run as `cmd.exe /d /s /c <shim>` and never as a shell
  string — and it read `process.platform` off the host, so the six Ubuntu and macOS jobs resolved
  nothing, dereferenced `null` and went red on `main` while all three Windows jobs passed.
  `resolveLauncher()` takes an injected `platform` now, exactly as `src/core/editor.mjs` already
  did, and reads `path.win32` or `path.posix` from it so a PATH of `C:\tools` is not split on `:`
  just because the host is Linux. The assertion got stronger rather than weaker: one test became
  five, each naming the platform it is about — the exact `ComSpec`, the fallback when there is
  none, the `.exe` that wins over the `.cmd` beside it, the extensionless posix answer, and the
  negative that a stray `deckhq.cmd` on a posix PATH resolves to nothing. All five run on all nine
  matrix jobs. The rest of the suite was swept for the same defect by forcing `process.platform` to
  `linux`; the three other tests that read it are testing host behaviour and are correct as they
  are. §114.
- **8 tests for how the CDP driver starts a browser, and what it does when it cannot.** That the
  Linux sandbox and `/dev/shm` flags are added on Linux and **nowhere else** — the committed
  `win32` goldens were captured against an exact command line — that a launch failure is labelled
  `CHROME_UNAVAILABLE` so a caller can forgive it by kind rather than by message, that a browser
  which has already died is reported at once instead of at the deadline, and that a browser which
  is not there at all ends as that label rather than as a stack trace. None of them launches a
  real Chrome; the test that would is the goldens gate, which is a separate npm script for exactly
  that reason. §114.
- **The goldens job skips a browser it cannot start, as §87 said it would.** It named two tooling
  gaps — no WebSocket, no Chrome — and missed the third and likeliest: a Chrome that is present and
  will not start. The Ubuntu runner has one, both guards passed, and the job then failed a merge
  over a gate that has no linux goldens to compare against and could not have proved anything
  anyway. The launch now adds `--no-sandbox`, `--disable-setuid-sandbox` and
  `--disable-dev-shm-usage` on Linux only, waits 60 s under `CI` instead of 20, retries three times
  on a fresh debugging port, reads Chrome's stderr so the reason survives, reports a process that
  has already exited at once rather than at the deadline, and finds the browser by `CHROME_BIN` and
  by name on PATH as well as at the absolute paths it already knew. If none of that works the job
  prints `SKIPPED (nothing checked)` with Chrome's own complaint and exits 0. Only a launch failure
  is forgiven; a capture that fails, a floor that will not settle and a golden that does not match
  all still fail loudly. Windows is byte-identical and still passes at 0 px on all four
  populations. CI also gains a `concurrency` group that cancels superseded **pull request** runs
  only — a push to `main` is keyed on its own commit, so every merge runs to completion instead of
  being recorded as cancelled — and `timeout-minutes` on both jobs. §114.

### Packaging

- **Nothing in `vscode/` reaches npm.** The root `files` allow-list is unchanged and a test
  asserts no entry can match it. The extension is packaged separately with `npx --yes
@vscode/vsce package` — never a runtime dependency — into a 27 KB `.vsix`, versioned `0.1.0`
  independently of this package because a Marketplace listing and an npm release are not the same
  artifact. Publishing it needs a Marketplace publisher account and a token, and has not happened.
  §104.
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

- **The room plate's daily spend is computed but not drawn.** `buildPlan` puts it in the room's
  third plate line and the snapshot carries it per project, but the only function that paints a
  room plate draws two lines and recomputes them from the snapshot rather than reading the plan's —
  and that file was outside the package that added the line. The remaining change is roughly ten
  lines in `public/render/scene.js`, spelled out in `docs/DEVIATIONS.md` §111, plus a goldens
  regeneration in the same commit, because it is the first thing in months to change what the
  floor looks like without changing what is on it.
- **The Codex/OpenAI rates in `src/data/rates.json` are unverified.** They are the numbers the
  hand-typed tier carried, flagged as such in the file, and nothing in this project has checked
  them against a published price list. Anthropic's rows were read off the pricing page on
  2026-09-04.
- **The permission feature has never met a live session.** Everything downstream of the runtime is
  tested and screenshotted; the runtime itself has not been in the loop once, because `claude`'s
  stored login on the reference machine is expired and re-authenticating is an interactive browser
  flow. The remaining step is one `claude login`, one session raising a real prompt, and one
  press of Allow. Until then the response bytes are verified against a schema read out of the
  installed binary rather than against the binary's behaviour. `docs/DEVIATIONS.md` §86.1, §97.5.
- **Codex cannot answer a permission prompt yet.** It has the same hook and the same response
  shape, but no `http` hook type at all, so it needs a `command` hook that reads the daemon's
  port and relays on stdin/stdout. That same hook is also the fallback for the two managed-settings
  switches that can turn HTTP hooks off over DeckHQ's head, neither of which is detected today.
  §97.4.
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
- **`--notify` has been run for real on Windows only.** The whole chain fired a toast on Windows
  11 with a hostile agent name and exited 0, and Windows registered the notifier's app identity,
  which is what a delivered toast looks like from outside. The `osascript` and `notify-send`
  argument lists are asserted in the suite and have been executed nowhere — the same standing gap
  as the terminal table. The Windows toast also presents itself as Windows PowerShell, because a
  node process has no app identity of its own and giving DeckHQ one means a Start Menu shortcut,
  which is an installer's job.
- **Installing the app is unverified.** The manifest parses, both icons resolve at the sizes they
  claim, and the badge call resolves against a live daemon. Whether a browser offers **Install**,
  and whether the installed icon then takes the badge, has not been seen: the browsing context
  available for this work refuses to register any service worker at all, including one that does
  not exist. `docs/DEVIATIONS.md` §101.6.
- **`settings.osNotify` ships off, and has no row in the settings sheet.** Whether a background
  process may raise toasts on this machine is a different consent from the one the browser asked
  for, and defaulting it on because the browser's is on would be deciding for the owner. Until
  that decision is made, `deckhq --notify` and a POST to `/api/settings` are the interface.

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
- **DeckHQ has a documentation site.** `site/` — the pitch and `npx deckhq` over the hero GIF, a
  real `doctor` run, the floor, the review card and the deck; "the model in 60 seconds" for the six
  states and the one rule; install for `npx`, a global install, the Claude Code plugin and the VS
  Code extension, with Homebrew, winget and scoop marked _on the next release_ because no tag has
  run that job yet; hooks and privacy for every path read and written and the consent in front of
  both; adapters for what is verified, what is not, and how to contribute one; an FAQ whose first
  entry answers "why not just use `claude agents`" with the measured persistence argument and this
  machine's own four lines; and `docs/DEVIATIONS.md` rendered as an engineering log, an index plus
  one page per entry. **No site generator and no dependency**: hand-written HTML bodies, a shared
  shell, and a 250-line markdown converter that escapes before it adds a tag. `node site/build.mjs`
  renders `site/dist/`; `--serve` puts it on a loopback port to look at.
  `docs/media/site-index.png` is the home page. §112.
- **The site keeps the product's promise, and a test says so.** No analytics, no CDN, no web font,
  no script of any kind on any page. `JetBrains Mono` and `IBM Plex Sans` are named first in their
  stacks and fall back to the system's own faces, because there is no `.woff2` in this repository
  and fetching one would be exactly the thing being refused. The palette is `public/style.css`'s
  own tokens, so a screenshot and the page around it are the same colours.
- **`.github/workflows/pages.yml` publishes it on every push to `main`.** Checkout, `node
site/build.mjs`, the site suite again against the bytes about to be published, then
  `upload-pages-artifact` and `deploy-pages`. Read-only by default, with only the deploy job
  raising itself to what Pages needs; one deployment at a time, and a newer push waits rather than
  cancelling a running one. There is no `npm install` step because there is nothing to install.
  **The owner must enable Pages once** — Settings → Pages → Build and deployment → Source: GitHub
  Actions — because no workflow can turn it on for its own repository, and until that is done the
  deploy step fails while nothing else in the repository notices. **Unproven until a push runs
  it.**

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
