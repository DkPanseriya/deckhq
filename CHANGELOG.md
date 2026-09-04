# Changelog

<!-- Sections in an unreleased entry are additive: append bullets under the existing headings
     rather than starting a parallel list, and move an item out of "Known gaps" the moment it
     stops being true. -->

## Unreleased

### Added

- **The Supporter pack: more themes and avatars, and nothing else.** A pack is one signed JSON
  file. `deckhq pack install <file>` copies it into `~/.deckhq/packs/<name>/pack.json` and a
  running DeckHQ picks it up within a second, no restart. It carries floor themes and avatar sets;
  there is no key in its format for a tier, a licence, an expiry or a feature flag, and one that
  tried to carry a key like that is **refused rather than ignored**. `⌘K` → Settings → Floor now
  shows the pack's themes beside the shipped ones, and an Avatars row appears only when a pack
  actually offers a set — an install with no pack has no row and no advertisement. Choosing "as
  they come" puts every face back exactly, and nothing changes because a file appeared in a
  directory: the set is a setting, empty by default, because a face is the one thing in this
  product that must never change on its own. `docs/DEVIATIONS.md` §127.
- **`deckhq pack` — `build`, `verify`, `install`, `list`, `remove`.** No account, no licence check,
  no activation, no update check and no network call anywhere in it; the only question DeckHQ ever
  asks about a pack is whether it was signed by the Ed25519 publisher key compiled into the build,
  and it answers that locally with `node:crypto` over the pack's canonical JSON. An unsigned pack,
  one signed by a key this build does not know, or one edited after signing is refused **whole**
  with its reason and nothing in it loads. A bad ITEM is refused **alone**: a theme that fails the
  contrast gate is dropped with the measurement and the rest of the pack still installs, so one
  bad colour cannot cost a customer the pack they paid for. `deckhq pack verify` prints what is
  inside one before you install it.
- **A pack cannot lower a bar.** Every theme in a pack goes through the same `validateTheme` and
  the same `assertThemeContrast` a theme DeckHQ ships does — this is the door `docs/DEVIATIONS.md`
  §125.9 left closed, opened exactly this far and no further. Every avatar colour is held to the
  same ≥ 70 sRGB distance from every state colour that `public/render/palette.js` holds its own
  tables to, so an agent can never wear a state, and a pale "jacket" that would read as the torso
  under it is refused with its luminance. `packs/supporter-sample/` is a real pack with two extra
  themes — **warehouse** (poured concrete and steel racking) and **garden** (a conservatory in
  leaf) — plus one avatar set, committed as reviewable unsigned source beside the signed artifact
  and a build script.
- **Floor replay: watch yesterday. Free.** `⌘K` → "Watch yesterday" scrubs the floor through a day
  of your own event ledger at 60×, so a working day is about twenty minutes and dragging the bar
  is instant. Each frame is `reconstructQueue(records, t)` — the needs-you queue exactly as the
  machine wrote it down, not a re-derivation — and frames land on changes rather than on a clock,
  so a quiet hour is one frame and a busy day is a few dozen. It is **read-only**: there is no
  writer anywhere in the path, no acknowledgement moves, the ledger file's modification time does
  not change, and an `INVARIANT:` test drives a whole day to the end and asserts all three. The
  deck, the panel, the header count and the notifications stay live the whole time; only the
  canvas is looking at yesterday. The plan listed replay in the Supporter pack; it ships free,
  because a feature that reads your own ledger cannot be sold without becoming a gate on data you
  already own. §127.
- **A rate-card editor in the settings sheet. Also free.** Settings → Data now edits
  `~/.deckhq/rates.json` — your own prices per million tokens, merged over the shipped table one
  model at a time, with the shipped model ids offered as completions and the cache columns showing
  the multiplier that will be used if you leave them empty. A malformed row is refused whole with
  the row named and nothing is written; clearing every row removes the file rather than leaving an
  empty one behind that would claim the table is overridden for ever. There is no "fetch the
  latest prices" button and there will not be one. The plan listed this in the pack too; it ships
  free, because the file has existed since WP-26 and anybody can edit it in a text editor — and
  because "cost is an estimate, never a bill" only holds if the person looking at a wrong number
  can correct it. §127.
- **`GET /api/packs`**, **`GET /api/replay/days`**, **`GET /api/replay?day=`**, and
  **`GET`/`POST /api/rates`**. All loopback, all local, none of them egress. The replay routes are
  two GETs and there is no writer among them, asserted.

- **Two more runtimes: Gemini CLI and OpenCode.** Four now, on one floor, with correct attribution
  and no shared state: disabling or removing any one leaves the others fully working, and a runtime
  that is not installed contributes nothing and reports itself cleanly rather than erroring.
  `deckhq doctor` grew two rows without `src/cli/doctor.mjs` changing at all, which is the property
  the adapter interface exists for and there is now a test asserting it against the real registry.
  Gemini CLI is read from its JSONL session files under `~/.gemini/tmp/<project>/chats/`, including
  juniors; OpenCode through its own JSON-emitting commands — `opencode db`, `session list` and
  `export` — because since v1.2.0 it keeps everything in a SQLite database, and DeckHQ has no
  dependencies and would not guess at a byte layout when the runtime ships a supported interface.
  Resume, new session and send are wired for both, as argv arrays with no shell anywhere.
  **Both are unverified — see Known gaps.** `docs/DEVIATIONS.md` §123.
- **`docs/ADAPTERS.md` — add a runtime without asking us.** The `RuntimeAdapter` contract with what
  each method owes you, the seven stability rules, a worked example that adds a fictional runtime
  end to end, the fixture convention, the checklist, and the honesty rule: an adapter is unverified
  until it has been run against real data and has to say so in three places. Adding a runtime is
  three files in one directory plus one line in the registry and one union member in `RuntimeId` —
  nothing else in the product names a runtime.
- **Lights out: one card at the end of the day.** At 22:00 — or as soon as the last live session
  ends, if the evening is already under way — the floor dims to night and a single card appears:
  _"Friday. 40 turns across 6 rooms. `orbital-api` shipped 6, `checkout-flow` waited 4h 3m. 6
  agents still up. ≈ $39.46 list price, rate card 2026-09-04. Longest wait today: 1d 2h → still
  standing."_ Every number is a replay of the event ledger. It appears **once per local day**,
  Escape or a click dismisses it, `S` saves it as a PNG with a small photograph of the floor it is
  about, and it never comes back on its own — Stardew Valley's day-end save, not a summons. The
  hour is `settings.lightsOutHour` in the settings sheet's Floor section, and `⌘K` → "Today's
  card" shows it again without spending the day's. Nothing in it addresses you, and that is a test
  rather than a convention: the copy generator is driven over synthetic ledgers and every string
  literal in the file is scanned for a second person. `docs/DEVIATIONS.md` §118.
- **Wrapped, weekly and annual.** Monday morning, and from 1 December the year so far. Turns per
  room, tokens, an estimated spend that names its dated rate card, the longest wait and whether it
  fell against the week before, the room that never slept, the session sent the most messages, the
  busiest hour — and the count of _"You're absolutely right"_ across the week's assistant turns.
  Every line carries the window it was computed over, and a ledger younger than the window says
  where it actually starts instead of claiming a week it did not live through. Generated on the
  machine, from the machine: no email, no server, no account, no request of any kind leaves the
  box. One key puts it on the clipboard as a PNG, and `Shift+S` swaps every project name for its
  MK tag first. `⌘K` → "Wrapped". `docs/DEVIATIONS.md` §119.
- **`GET /api/wrapped?kind=week|annual`**, and a `window` field on `GET /api/stats` — what
  happened between two timestamps, room by room, from one walk over the ledger. Both cards read the
  same function, so a day and a week cannot disagree about what a turn is.
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
- **`deckhq doctor` now names the managed policy that is switching your hooks off.** Two Claude
  Code settings keys can stop DeckHQ's hooks from running over its head — `allowManagedHooksOnly`,
  which ignores every hook your organisation did not deploy, and `allowedHttpHookUrls`, which
  decides whether the `PermissionRequest` hook may reach `127.0.0.1` at all. From every surface
  DeckHQ had, that state was indistinguishable from a broken install: the settings file is
  byte-for-byte what the consent screen showed, the port matches the running daemon, and no event
  ever arrives. The adapter now reads the `managed-settings.json` for the platform — macOS
  `/Library/Application Support/ClaudeCode/`, Linux and WSL `/etc/claude-code/`, Windows
  `C:\Program Files\ClaudeCode\` — plus the `managed-settings.d/` drop-ins beside it, and the row
  reads `installed, but a managed policy blocks them — <key> (<file>)`, with exit 1, because this
  is the "looks healthy, delivers nothing" class §75 reserved that code for. The `!` line under it
  says what each key actually takes away, which is not the same thing: `allowManagedHooksOnly`
  ends every event, `allowedHttpHookUrls` ends only the permission card and leaves the other eight
  delivering. `GET /api/hooks` gains `blockedByPolicy`, and the hooks screen says the same thing
  in one line above the Install button, including that pressing it again will not help. Read-only
  throughout, generous about what counts as being on the allowlist, and the user's own
  `allowedHttpHookUrls` can only ever widen the merged list — never fail a machine whose policy is
  fine. `docs/DEVIATIONS.md` §115.

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
- **A project room's door plate carries today's spend.** Under the name and the session line, in
  the same quiet mono: `today ≈ $22.93 · list price`. The number was already being computed and
  already carried in every snapshot; the renderer drew two lines and stopped, because the file it
  had to be drawn in belonged to another package. It is drawn now. A room whose models the rate
  card cannot price gets **no third line at all** rather than `$0.00` — a floor of unpriced rooms
  looks exactly as it did before the meter existed. `docs/DEVIATIONS.md` §111.
- **The team's record shows on the floor's hover card, not only in the panel.** "longest wait ever
  was here: 3d 4h, 28 Aug", "the room that never slept: 24 hours of the day" — the same line, from
  the same `records.js`, off the same five-minute `GET /api/stats` cache the panel already keeps,
  so the card and the panel can never disagree about a record while both are on screen. A hover
  never waits on the network. It is context and never a call to action, and the test that no
  record line addresses the reader covers this surface too. `docs/DEVIATIONS.md` §107.
- **Five more tools say what they are doing above an agent's head.** `Write src/foo.ts`,
  `MultiEdit src/foo.ts`, `Grep TODO\(.*\)`, `Glob src/**/*.ts`, `WebFetch example.com` — they
  used to show as their bare names. Same rules as the first three: a path is resolved against the
  **session's** working directory and reduced to its file name when it escapes, so a bubble on a
  screenshot never carries somebody else's directory tree. `WebFetch` shows the **host only** —
  the path and the query are where an issue number, a document id or a token live.
  `docs/DEVIATIONS.md` §89.
- **The reply streams into the panel while you watch, and the composer comes back immediately.**
  A send used to block for the whole turn — up to ten minutes with the box disabled reading
  "Sending…" and nothing on screen. `send()` now runs
  `claude --resume <id> -p <text> --output-format stream-json --verbose --include-partial-messages`,
  parses the events as they arrive, and reports them. `POST /api/send` answers **202** with a
  send id the instant the turn is accepted and pushes its progress over the SSE channel the page
  is already on, so the composer is released in the time it takes to start a process rather than
  the time it takes the model to think. Text lands in the panel a fragment at a time under
  **what it said**, with the agent's row in a typing state and a line for each tool it picks up
  (`· Read vite.config.ts`); when the turn closes the canonical message is re-rendered as
  markdown from the transcript. A turn that fails puts your text back in the composer — and never
  over the top of something you have typed since. Every fragment reaches the screen through
  `textContent`: half a fenced block is not a fenced block, and the client still has no
  `innerHTML` at all. `docs/plan/05-GUI-UX-SPEC.md` §4.3, `docs/DEVIATIONS.md` §117.
- **A reply typed in a terminal appears in the open panel, without a poll.** The daemon watches
  the transcript of whichever session the panel has open — `fs.watch` with a one-second `stat`
  fallback, because `fs.watch` is unusable on some filesystems and is also blind to a transcript
  that does not exist yet — reads a bounded 256 KB tail through the adapter's own parser, and
  tells the page only that the conversation moved. The messages themselves still come from
  `GET /api/conversation`, so there is one parsed copy of a conversation on the wire and not two.
  The watch starts when a card opens and stops when it closes; a runtime with no transcript watch
  simply has no live tail. Reading a file changes nothing: this cannot clear a review debt and
  makes no `/api/ack` call, and there is a named `INVARIANT:` test for it.
- **Subagents are people too: juniors, standing beside the agent that spawned them.** When a
  Claude Code session sends work out to a subagent, that subagent writes its own transcript — and
  DeckHQ now reads it. A junior arrives at its parent's desk the moment it starts, is drawn at
  80% beside them in its parent's project colours and a face of its own (the same hash of the
  session id every agent gets), and walks off the floor when it finishes. The room's table grows
  to seat the whole huddle, the door plate says `4 sessions · +2 juniors`, and the panel says
  `junior of Boris` on one and `3 juniors` on the other. **A junior is never in the needs-you
  count unless it raises its own hand**: its finished turn goes to its parent, not to you, so
  counting it would put a number on the header that no keystroke of yours could discharge — but a
  permission prompt only a person can answer still counts, because a blocked junior blocks its
  parent. It owns no user-facing state either: there is no bench button, no let-go button, no
  acknowledge, and `POST /api/ack` refuses all six actions on one, so nothing about a session that
  lives for thirty seconds can be written into a store keyed by an id you will never see again.
  It also takes no MK number and no first name — it wears its parent's tag with a suffix,
  `MK1.2j1` — so a busy week does not drain a project's numbering or the name pool. All the
  parsing is in the adapter, as always. `docs/DEVIATIONS.md` §117.

- **`npm run typecheck` — `tsc --noEmit --checkJs` over the JSDoc that was already there.** Two
  projects, because the two sides of the static-file boundary do not share a platform: the root
  `tsconfig.json` covers `src/`, `scripts/`, `plugin/`, `vscode/` and `bin/` with no DOM, and
  `public/tsconfig.json` covers the browser with no `process` and no `Buffer` — so `public/`
  reaching for a Node global is a type error now rather than a code review. CI runs it on Ubuntu
  once, after lint, and `prepublishOnly` runs it too. One dev dependency, `typescript`; Node and
  the VS Code API are declared by hand in `types/` rather than installed, with the cost of that
  written at the top of the file. **Zero `@ts-ignore` in the tree.** It found thirty-two places
  where the documentation and the code had drifted apart, including the one
  `docs/plan/01-AUDIT.md` F21 named: `placement()` in `src/core/model.mjs` reads `subagent` and
  its signature did not say so, while `derivePlacement()` — its copy on the other side of the
  boundary — always did. `docs/DEVIATIONS.md` §122.
- **Floor themes, free and gating nothing.** Two beside the default: **night shift**, the same
  office after hours — cooler, dimmer, lights low — and **blueprint**, the floor as a drawing on a
  drafting table, in white line work on blue. `⌘K` → Settings → Floor → Theme, a row of swatches
  that repaints the whole window while you hover it and puts it back when you leave. A theme is a
  JSON document of eleven floor materials and eight chrome neutrals, validated by a schema in
  `src/core/themes.mjs`: allowlisted keys only, `#rrggbb` values only, no URL, no font, no
  gradient. **The seven state colours, the crimson accent and the fourteen project identities are
  not themeable, and not by policy — there is no key in the allowlist that names one.** A raised
  hand is the same amber in every theme, and red still means one thing. Every shipped theme is
  re-measured against every WCAG floor this product already held itself to — state ≥ 3:1 on its
  grounds, text ≥ 4.5:1, the focus ring ≥ 3:1 — plus a new one WP-30 had to invent: the floor's
  own line work at ≥ 4.5:1 on every surface a room plate or an agent's name is drawn on. A theme
  that fails is refused at load, not reported afterwards. The Supporter pack
  ([`03`](docs/plan/03-BUSINESS-MODEL.md) §5) sells **more** themes later; it takes none away.
  `docs/DEVIATIONS.md` §125.
- **`deckhq layout export > my-floor.json` / `deckhq layout import my-floor.json`**, and the same
  two from `⌘K`. A layout is the floor's arrangement as a file you own: the theme, the order the
  rooms are laid out in, which rooms are folded into the idle strip, and the two floor preferences
  — `goneHomeDays` and `lightsOutHour`. It carries no session, no transcript, no acknowledgement
  and no name, so it cannot touch a user-owned state. **A malformed file is refused whole**: the
  document is validated before the first write, and a bad one leaves the theme, the room order,
  the folded rooms and both preferences exactly as it found them, with one sentence naming the
  field. It carries no room COORDINATES either, and that is stated rather than omitted — the floor
  sizes and places rooms from what is in them (§96, §106), so there is no position to pin; order
  is what a layout can move. Export works with or without a daemon; import needs one, for the
  reason `ack` does. `GET`/`POST /api/layout`. `docs/DEVIATIONS.md` §125.

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
- **The WHO column, the deck's JSON and `deckhq deck open <name>` all know an agent's given name.**
  The column used to fall through to the session title because almost nobody had ever named an
  agent; now everybody has a name and it says what it was always meant to say. A given name also
  resolves an agent by name on the command line, exactly as a chosen one does.
- **`records` on `GET /api/stats` is the team's records, not a line count.** The raw count of
  ledger records it used to hold is `recordCount` now, and `computeStats()` publishes both names,
  so anything reading the count has somewhere to move to that is already there. `deckhq stats`
  reads the computation directly and is unaffected. One field, one local endpoint, recorded in
  `docs/DEVIATIONS.md` §107 as the breaking change it is.
- **A model the rate card has never heard of now has no price, instead of Opus's.** The old tier
  test matched `haiku`, then `sonnet`, then `gpt|codex|o3|o4`, and priced everything else at
  $15/$75 per million — a local model, a Codex id the tests never saw, an unrecognised Bedrock
  string, all of them. That is not a coarse estimate, it is an invented one, and it was being
  summed into project totals. `estimateCost` returns `null` now, the panel says
  `no rate for this model`, and a room nothing can price gets no cost line at all. `$0.00` is a
  claim about the money; "no rate" is the truth. `Agent.costEstimate` is `number|null`
  accordingly.
- **The project board names the rate card its figures came from, and the deny message is a
  sentence.** The whiteboard's cost line now reads `Cost is an estimate at public list prices, not
a bill · rate card 2026-09-04` — every snapshot already carried `rateCardVersion`, and a figure
  whose table nobody can name is a figure nobody can check. Separately, the string DeckHQ writes
  into a session's transcript when you press Deny is `Denied from DeckHQ.` rather than the
  lower-case fragment that shipped: it is the only sentence this product writes into somebody
  else's terminal, so it is a sentence. `docs/DEVIATIONS.md` §111, §97.
- **`POST /api/send` answers 202 with a send id instead of 200 with the whole reply.** The turn is
  no longer awaited on the socket, so the answer is "accepted", not "finished". Anything reading
  the reply out of that response now reads it off the SSE channel: `GET /api/events?stream=send`
  carries `send` events tagged with the id the 202 handed back — `accepted`, `delta`, `tool`,
  `result`, `error`, `done`. The default `GET /api/events` stream is unchanged, byte for byte;
  `?stream=send` exists so the panel's own connection does not cost a second floor snapshot on
  every scan for a listener that never reads one. A failed turn is an `error` event, never an
  HTTP status, and its message is the runtime's own. `docs/DEVIATIONS.md` §117.
- **A `claude` DeckHQ started is killed when DeckHQ closes.** Turns are spawned `detached: false`
  with stdin closed, each carries an `AbortSignal`, and the daemon's shutdown aborts every one
  before the server stops. A `SIGKILL` of the daemon itself still runs no JavaScript and leaves
  its children reparented; that case is named rather than claimed.

- **`public/render/plan.js` was 3,255 lines and is now seven modules.** `plan-units` (the shapes
  and every dimension), `plan-packing` (flow, shelf, squarify, tileRows), `plan-anchors`,
  `plan-rooms` (a project's room and the idle strip), `plan-service` (the office and the lounge)
  and `plan-nav` (walls, corridors, doors) — with `plan.js` left as the assembly step, re-exporting
  all sixteen names it exported before, so nothing outside it had to change. Not one function body
  moved a character: a verification pass found all ninety-one top-level declarations verbatim in
  exactly one module each, and the goldens moved **0 px** on all four populations.
  `docs/DEVIATIONS.md` §122.

- **`public/app.js` was 2,721 lines and is now a composition root over ten parts.** The keyboard
  map, the header, the hover card and the floor wiring — plus the notifications, the snapshot, the
  day's card, the creation dialogs, the furniture launchers and the state they share. Three rules
  made it safe: every `document` listener stayed on the line it was on, because the panel's own
  keydown handler must still run before the floor's; the shared mutable state moved to one leaf
  module as live bindings a part can read and cannot write; and no part imports the root back.
  `app.js` is 748 lines. Seven static-scan tests had their file lists updated and not one of their
  assertions. Goldens **0 px**, and the keyboard, the palette, the deck, the redaction toggle and
  the new-agent dialog were each driven in a real browser. `docs/DEVIATIONS.md` §122.

- **"Who is on the floor" is one rule in one file.** It used to be two, either side of the
  static-file boundary — `placement()` and `isGoneHome()` in `src/core/model.mjs`,
  `derivePlacement()` and `isGoneHome()` in `public/render/` — each with a comment asking the next
  person not to let them drift, and both had drifted. The boundary was never symmetrical: a
  browser genuinely cannot resolve `src/`, but Node resolves `public/` fine and has been importing
  `public/names.js` since WP-20. So the rule lives in `public/floor-rule.js`, which both sides
  import; `model.mjs` and `plan.js` re-export it, so no import anywhere had to change, and
  `derivePlacement` is now the same function object as `placement` rather than a copy of it.
  Proven on both routes: `GET /floor-rule.js` serves 200, the live page imports it and answers,
  and `GET /../src/core/model.mjs` still 404s. `docs/DEVIATIONS.md` §122.

### Fixed

- **A daemon with a browser attached can now be shut down at all.** `close()` awaits
  `server.close()`, which waits for every request to finish, and `/api/events` is a request in
  flight **forever, by design** — so one page parked on the floor meant `close()` never returned.
  Measured before: still going at 10 s, unbounded. After: **6–7 ms**. `closeAllConnections()`, the
  one call that would have ended the stream, sat after the `await` it was meant to unblock, exactly
  where the previous fix to this function had left it; it is now inside the wait, behind a 500 ms
  grace so a request that arrived in the last instant is still allowed to finish. And the streams
  are ended properly rather than cut: each gets a final `event: bye` and a real end of response, so
  a page learns the daemon is going instead of watching a socket disappear. Both Node calls stay
  optional, because the floor is Node 18 and they arrived in 18.2. This deadlocked the goldens gate
  for eight minutes a run and hung any embedder; only the demo script had a backstop, and the
  backstops stay because none of them was only about this. `docs/DEVIATIONS.md` §128.
- **Thirty-two type defects the JSDoc had been hiding.** Every one was live and invisible to 1,520
  tests: `Settings` was three keys short of `DEFAULT_SETTINGS`, `SessionSummary` never declared
  the `archived` flag the adapter stamps onto it, `public/render/plan.js`'s `Room` was missing the
  six fields the packer and the walk planner write and read, `agents.js` carried five stale copies
  of `plan.js`'s types (so `scene.js` was handing one plan to two modules that disagreed about
  what a plan is), `el.stage` was declared twice in `public/app.js`, a `@property` in
  `src/core/actions.mjs` closed with a brace instead of a bracket, and one branch in
  `roomFor()` looked for a room kind that has never existed. Every fix is a comment, a type
  annotation, one duplicate object key and one provably dead line: the goldens moved **0 px** on
  all four populations. `docs/DEVIATIONS.md` §122.
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
- **A project nothing could price read `$0.00` on its whiteboard.** The board summed each
  session's cost estimate with `|| 0`, and a session on a model the rate card has no row for
  carries `null` — so a room of unknown models produced a confident zero, which is a claim about
  the money nobody had made. It sums only what can be priced now, and a room with nothing
  priceable at all says `no rate`. A test scans every client module for the pattern, so the next
  surface that adds it fails the build. `docs/DEVIATIONS.md` §111.

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

- **Every contrast floor in the product is now measured against every shipped theme.**
  `test/unit/state-visuals.test.mjs` used to read `public/style.css`'s `:root` and nothing else,
  which is one theme's worth of proof; it is parametrised over the theme table, so adding a theme
  adds its own state, text, focus, colour-discipline and line-work assertions rather than adding
  an unmeasured floor. Two more suites beside it: `themes.test.mjs` (20) drives the schema's
  refusals — an unknown key, a `url()`, a font name, a `#fff`, a wrong version, a half-stated
  document, a theme that fails a contrast floor, and a near-miss on the reserved crimson — and
  proves the default theme is a byte-exact reset of `PALETTE` (which is what keeps its goldens at
  0 px), that a theme reaches the material tokens `backdrop.js` actually paints with, and that
  nothing that carries meaning is ever written to the root element. `layout-io.test.mjs` (21)
  refuses fourteen malformed layouts one at a time and asserts each changes nothing, drives the
  CLI's refusal path with a `post` that records whether it was ever called, and round-trips a good
  one through a real `Store` and back off disk. **The goldens gate the themes too**: one extra
  populated capture per shipped theme (`demo@night-shift`, `demo@blueprint`), taken through the
  same demo fixture with a new `--theme` flag on `scripts/demo-floor.mjs` and
  `scripts/goldens.mjs`. Six captures, all at 0 px.
- **The streamed send is proved against a recorded stream and a fake CLI that really is a
  process.** `test/fixtures/claude-stream-json.ndjson` and its error twin carry a turn of
  `--output-format stream-json`; the error one is a real run of Claude Code 2.1.231 verbatim, the
  other says on its own first line which envelopes are recorded and which are reconstructed.
  `test/fixtures/fake-claude.mjs` replays them out of a real child process, splitting every line
  mid-way so no chunk boundary is where the parser would like it, and it also refuses, crashes,
  emits rubbish and hangs on demand. Fifty-five tests across the parser (chunk sizes of 1, 7, 64
  and 997 bytes; corrupt lines; a line over the 8 MB cap), `send()` (the exact argv, a non-zero
  exit, a missing binary, a timeout that kills, and an abort that leaves no orphan pid), the
  route's 202 and its SSE sequence, the transcript watch against real filesystem events, and the
  panel's own rules — the composer released on acceptance, the text restored on failure,
  `textContent` only, and no `/api/ack` anywhere on the path. The fake is reached through a `bin`
  seam rather than `PATH`, because Node's `spawn` cannot execute a `.cmd` on Windows and the real
  `claude` here is an `.exe`: `docs/DEVIATIONS.md` §117 records that, and the live-roster probe it
  also affects.
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
- **28 tests for subagents, over fixtures shaped like the real files and containing none of
  them.** Every subagent fixture in the suite is written into a temp directory by the test that
  needs it and deleted afterwards; nothing from anybody's `~/.claude` is committed. They cover
  both on-disk layouts and the workflow journal that must never become a person, all nine
  `meta.json` key shapes counted on the reference machine, the three `SubagentStop` payload
  shapes and the fourth case where the answer is "this names no junior, so change nothing", the
  idle window that takes a junior off the floor and the parent window that stops a scan opening
  eighty directories to find nothing, the needs-you rule and its breakdown, the table growing to
  seat a huddle, and the seating that gives a junior a place to stand without taking a chair.
  Four of them run the real adapter in a child process pointed at the fixture, because
  `PROJECTS_DIR` is resolved at import time. The named one is `INVARIANT: a subagent lifecycle
changes no user-owned field on the parent` — a parent standing in the office with an unanswered
  review, three juniors arriving and leaving around it, and a deep compare of every user-owned
  field, the whole ack store and all six counts. 1,375 → 1,403. §117.
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
- **Wrapped's `PRIVACY:` test stopped asking the runner what the floor is.** It seeded a ledger for
  `/code/orbital-api` and asserted that word never reaches `GET /api/wrapped` — and `orbital-api` is
  also one of the three rooms on the actor floor, which is what a machine with no sessions is served.
  Every CI runner is such a machine, so the response carried the word from the daemon's own fiction
  and the test read it as a leak; the developer's laptop has real sessions, never saw the actors, and
  passed. The test now pins `CLAUDE_CONFIG_DIR`, `HOME` and `USERPROFILE` to a sandbox before
  importing `src/`, so the floor is decided by the test rather than by the machine, and the fixture
  project is named `wrapped-fixture-only` with a guard that fails loudly if the floor ever produces
  that name itself. The assertion also got stronger: instead of searching the response for one word,
  it now states the rule the route actually follows — every name in the card's `projects` map is a
  live floor project's name, keyed by the hash of a cwd the floor holds, and a project only the
  ledger knows gets no entry at all. `docs/DEVIATIONS.md` §121.
- **The VS Code extension's Windows launch resolves the same way on all nine matrix jobs.**
  `resolveWindowsExecutable()` — the function that names `npx.cmd` outright so `cmd.exe` cannot pick
  up the extensionless shell script beside it — was splitting an injected Windows `PATH` on the
  _host's_ `path.delimiter` and joining with the host's separator, so on Linux and macOS it found
  nothing and returned the bare name: the exact failure it exists to prevent, and four red jobs. It
  uses `path.win32` unconditionally now, and `spawnPlan()` takes the same `env` seam its sibling in
  `plugin/lib/start.mjs` was given in §114, `ComSpec` included. Three assertions that had been true
  only where they were least likely to be wrong are now exact and platform-free — the interpreter
  path, the full `cmd` command line, and the extension preference order — and a new test pins
  `PATHEXT`, which does not exist at all on six of the nine jobs. §121.
- **A closing daemon lets go of idle sockets instead of waiting out their timeouts.** `close()`
  awaited `server.close()`, which waits for every connection to end — and a pooled keep-alive
  connection with no request on it does not end — then called `closeAllConnections()` after the
  promise it was meant to unblock had already resolved. On Node 19 and later `server.close()` handles
  this itself; on Node 18 it does not, and every daemon test on those three matrix jobs spent 64–65
  seconds (`headersTimeout` plus `keepAliveTimeout`) in shutdown, eighteen of them, until the runner
  killed the job at its ten-minute guard. **A job killed by its timeout is recorded as `cancelled`,
  and one cancelled job makes the whole run `cancelled`** — which is why a run holding six genuine
  assertion failures reported as though something had superseded it. The concurrency group was never
  involved; `ci.yml` now says so where the timeout is set. §121.
- **The suite no longer has a home directory, and a canary proves it.** Eighteen files were reading
  the developer's own machine — four integration files scanned it outright through a real daemon,
  the three §121 had already pinned were still reaching `%APPDATA%\Claude` and `~/.deckhq` through
  the two fallbacks a moved home does not move, nine unit files loaded `~/.deckhq/rates.json` as
  their rate card without a line of any of them mentioning a home, and one unit test spawned the
  real `deckhq doctor`, scanned every transcript on the machine and wrote a probe file into
  `~/.deckhq`. `test/helpers/isolate.mjs`, imported first, now points `HOME`, `USERPROFILE`,
  `APPDATA`, `CLAUDE_CONFIG_DIR`, `DECKHQ_STATE_DIR` and `DECKHQ_DESKTOP_SESSIONS_DIR` at a fresh
  temp root and removes it on exit, and deletes the four variables that change behaviour rather
  than name a path. `npm test` plants an empty **canary home** for the whole run with one
  unmistakably-titled transcript on it, preloads an `fs` tripwire into every process, and **fails
  the run** if anything touches it — naming the function, the path and the frame. On a synthetic
  home of 3,000 transcripts the suite went from **199.1 s to 5.8 s**, and it is now flat: 5.8 s
  against an empty home and 5.8 s against three thousand. §124.
- **The `reviewSince` invariant asserts something now.** It used to look for a `for_review` agent on
  the host and `return` without asserting anything when it found none, so on most machines it was
  green and empty. It plants the session it needs and runs its four assertions every time. §124.3.
- **The fake `claude` no longer exits out from under its own pipe.** One test failed on
  `macos-latest, 20` and nowhere else: the recorded turn arrived truncated and `send()` correctly
  reported "no result event". `process.stdout` is synchronous for a pipe on Windows and
  **asynchronous** on POSIX, and the fixture's flush helper was checking backpressure rather than
  waiting for a flush — so `process.exit(0)` discarded whatever was still queued. The write
  callback is now the completion signal, and no path that writes calls `process.exit()` at all;
  `crash` had the same bug on stderr and had simply not lost the race yet. Pinned structurally,
  because a bug that appears on one runner image cannot be proved by running the test again.
  `docs/DEVIATIONS.md` §126.1.
- **A ledger test that passed and then failed in its own cleanup.** `fs.rm` recursive answers
  `ENOTEMPTY` on APFS for a directory whose contents were just removed, and its `maxRetries`
  defaults to 0. The retrying remove that `claude-stream.test.mjs` already had is now here too.
  The unwritable-directory test keeps its portable injection — a **file** where the directory
  should be, which the kernel refuses on every platform including for root, rather than a `chmod`
  that Windows ignores and root overrules — and gains a real-permission variant that runs only
  where a 0500 directory is _probed_ to actually reject a write, and otherwise skips with the
  reason printed. §126.2.
- **The goldens gate stopped deadlocking the daemon it was photographing.** The job never failed;
  it hung for eight minutes and was killed, which GitHub records as `cancelled`. Killing a demo
  while the browser still held its `/api/events` SSE stream open deadlocked its graceful shutdown —
  `server.close()` waits for every connection to end, and an SSE stream never does. Invisible on
  Windows, where `child.kill()` is `TerminateProcess` and no handler runs. The page is now released
  to `about:blank` before the demo is stopped, `stop()` escalates to SIGKILL and gives up, the demo
  script force-exits after a grace period, and the CDP client rejects every pending command when its
  socket closes instead of waiting forever with no output. `scripts/goldens.mjs` also names the
  stage it is in — booting, navigating, settling, screenshotting — and enforces a per-capture
  deadline and a whole-run budget inside the job's timeout, so an overrun prints **where** it was
  stuck; `--verbose` gives one timestamped line per stage. A capture that could not be taken is now
  SKIPPED rather than red, because it says nothing about the pixels; only a real mismatch exits 1.
  Windows is unchanged at **6 of 6, 0 px**. §126.3.
- **The linux captures are actually uploaded now.** `test/goldens/.out/` is a dotted directory and
  `upload-artifact` skips hidden paths by default, so every run that captured the first linux set
  wrote it to disk and then uploaded nothing. `include-hidden-files: true`. §126.4.

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
- **`docs/06-RELAY-DESIGN.md` — the relay's protocol and threat model, written before any of it is
  built.** Pairing, the envelope, what the relay can and cannot see, multi-machine, push, self-hosting,
  the five-attacker threat table, what is deliberately not built, and the WP-32/33/34 build plan with
  its acceptance criteria. Design only: no code, nothing run, every third-party claim carrying a URL
  and a retrieval date and four of them labelled unverified. `docs/DEVIATIONS.md` §127.

### Known gaps

- **The Gemini CLI adapter has never met a real Gemini CLI.** `~/.gemini` does not exist on the
  reference machine. Every field name in it was read out of the `google-gemini/gemini-cli` source on
  2026-09-04 and pinned against a synthetic fixture; none of it has been checked against a profile a
  human actually made. Two readings are flagged as guesses in `docs/DEVIATIONS.md` §123.5 and are
  the first things to check: how per-message token counts should be combined into a session total
  (`input` is taken as the largest value seen and `output` summed, because Gemini's `input` already
  contains the conversation so far and summing would multiply it), and which tool-call statuses mean
  "still running" — an unrecognised one reads as finished, so at worst a busy session looks idle for
  one poll rather than a finished one being hidden from the queue forever. It reports itself
  unavailable cleanly and degrades without throwing.
- **The OpenCode adapter has never met a real OpenCode.** Neither the binary nor
  `~/.local/share/opencode` is on the reference machine. It goes through OpenCode's own commands
  rather than its SQLite file — that file is in WAL mode, so a hand-written page reader would
  silently miss the newest sessions, which are the ones that matter — and the least certain shape in
  it is the `opencode export` envelope, which is read shape-tolerantly for that reason. Two
  narrower gaps, both deliberate: **a scan reports no last-message preview** (that text lives in a
  separate table, one row per fragment, and fetching it on the poll path would cost a query the size
  of the whole conversation; the panel fills it in the moment you open it), and the session roster is
  **cached for 60 seconds**, so a session started while it is warm can take up to a minute to appear
  — the same trade `claude agents --json` already makes. `docs/DEVIATIONS.md` §123.
- **Neither Gemini CLI nor OpenCode can report a live session**, because neither runtime offers a
  way to ask. Both list what is _stored_, not what has a process attached, and DeckHQ will not scan
  the process table to guess. Both therefore take the same recency inference Codex does.
- **DeckHQ installs no hooks for Gemini CLI or OpenCode**, so both share Codex's limitation: a
  session waiting on your permission and one that has simply stopped look the same. Gemini CLI
  genuinely has a hooks mechanism and DeckHQ says so rather than pretending it does not — it will
  not write into your `~/.gemini/settings.json` on the strength of a documentation page it has never
  been able to test. OpenCode has a plugin API instead, which means installing executable code, and
  that deserves its own consent design. OpenCode does keep the turn boundary regardless: it records
  when a turn finished, so that much is read rather than guessed.
- **The rate card has no Gemini rows**, so a Gemini CLI session shows **no rate** rather than
  `$0.00` — the same rule every unpriced model gets.
- **The streamed send has never met a live `claude` either.** The flags were read out of
  `claude --help` on 2.1.231 and the envelopes were recorded from the real binary — which got as
  far as `401 OAuth access token has expired` before it could produce a reply — so the assistant
  deltas and the tool call in the fixture are reconstructed from the event vocabulary in the
  binary itself rather than watched arriving. Everything downstream is proved against that
  recording through a real child process. The remaining step is one `claude login` and one real
  reply, and it is the same login the permission card is waiting on. `docs/DEVIATIONS.md` §117.
- **Nobody has watched a real `SubagentStop` payload.** The event fires on the parent's session
  id, so something in it has to name which junior finished if a junior is to leave the floor the
  instant it stops rather than five minutes later — and this could not be checked, because
  driving a real `Task` call needs a `claude -p` run and the reference machine's login is expired
  (the same wall §86.1 hit). The reader therefore takes an explicit `agent_id` if there is one, a
  `transcript_path` inside a `subagents/` directory if there is one, and **returns nothing rather
  than guessing** when there is neither — in which case the event does exactly what it has always
  done, and juniors still arrive and leave on their transcripts alone. Everything else about
  subagent storage was measured on disk over 1,048 real transcripts. `docs/DEVIATIONS.md` §120.
- **A junior can never raise its hand yet.** The rule that a subagent counts toward "needs you"
  when, and only when, it is `needs_input` is implemented and tested — but no signal on this
  machine can put one there, because every hook event is attributed to the parent's session id.
  It arrives with the payload above. §117.
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
  switches that can turn HTTP hooks off over DeckHQ's head — now detected and named by `doctor`
  and the hooks screen, but still without a route around them. §97.4, §115.
- **No machine with a managed policy in force has been run against.** `doctor` reads the
  `managed-settings.json` for the platform and the `managed-settings.d/` drop-ins beside it, and
  every part of DeckHQ's own side is proved against injected directories — but no Claude Code has
  been observed actually ignoring a hook because of one of those keys, because deploying a policy
  means writing into a managed settings location and this project will not. The same read cannot
  reach the other delivery mechanisms at all: MDM profiles, the Windows registry and
  server-managed settings from the claude.ai console are not files on disk, so a fleet policed
  that way still reports "installed, 0 events" with no explanation. `docs/DEVIATIONS.md` §115.1,
  §115.5.
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
