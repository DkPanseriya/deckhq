# 01 — Audit: DeckHQ as it stands on 2 September 2026

**Author:** orchestrator · **Inputs:** every file in the repo, the 1395-line deviations log, 327 passing
tests, the demo floor and the real floor on the reference machine, `npm view`, `gh repo view`.

Read this before any other document in `docs/plan/`. It is the evidence the rest of the plan is
built on. Every finding names the file and line where it lives, and what "fixed" looks like.

---

## 1. Verdict

DeckHQ is an unusually well-engineered v1 with a real, defensible idea, that **nobody can install**.

The idea — *what you owe is decided by you, never by the runtime* — is correct, is the actual gap
in every competing tool, and is enforced by named tests. The engineering is honest to a degree
that is rare: measured budgets, a deviations log that records every wrong guess, a CSRF hole found
and closed before release, zero runtime dependencies, loopback only. That is the asset.

The liability is everything around it. `npx deckhq` returns 404 from the npm registry. The GitHub
repository has zero stars, zero releases, no social preview, and a README that leads with three
paragraphs of prose before the first picture. The most-shared platform for the target user, macOS,
has never run the "open in terminal" path. And on a real machine the floor — the thing that is
supposed to make people screenshot it — is 70% empty carpet with 10-pixel people on it.

The product is a 9/10 engine in a 2/10 car. The plan is to build the car.

### Status on 3 September 2026

Re-measured for plan v2 (`08-PLAN-V2-100X.md` §0). The findings below are kept as written, as
the evidence the plan was built on; this block says which have closed.

| Finding | Status |
|---|---|
| F1 package not published | **Closed 3 Sep 12:25 UTC.** `deckhq@1.2.0` on npm, published by hand; `npx deckhq@latest` verified from a clean directory. |
| F2 no release, social card, GIF | Open. Repo files landed (WP-02); GitHub Release, social preview, GIF not done. |
| F3 macOS terminal | Open. WP-04. |
| F4 package description | **Closed.** DEVIATIONS §66. |
| F5–F12 (daily habit) | Open. P1 in `08` §10. |
| F13 one runtime | Open. |
| F14 hard-coded rates | Open. WP-26. |
| F15 cold scan | **Closed.** Persistent cache §68; desktop store cached and bounded §78–79; live roster cached §77. Warm scan 8 ms. |
| F16, F17, F18 | Open. F6 and F17 are now one fix: the dynamic floor, `08` B6 (WP-50). |
| New: flaky `save() debounces` test | Fails intermittently on Windows CI; `main` red. `08` WP-51. |
| F19 repo hygiene | Mostly closed (WP-02). Stray files deliberately left, DEVIATIONS §67. |
| F20, F21, F22 | Open. |
| New: hooks port drift | Hooks on 4400, default daemon on 4317, header degrades silently. `08` WP-36. |

Test count is now 413, lint clean.

## 2. Scorecard

| Dimension | Score | Why |
|---|---|---|
| Core idea / positioning | 9 | The invariant is a genuine insight nobody else ships. "Your AI team on one floor" is a story people repeat. |
| State model & daemon | 9 | Invariant-tested, hook + poll paths, atomic persistence, port-aware hooks, archive sync. |
| Security & privacy | 8 | Loopback, CSRF guard, CSP, argv-only spawns, path confinement. No auth token (acceptable locally). |
| Test discipline | 8 | 327 tests, named `INVARIANT:` and `SECURITY:` tests, 3-OS CI. No browser e2e. |
| Renderer craft | 7 | Real materials, anchored props, nav graph, 16 clips. But everything is tiny at fit. |
| First 60 seconds | 3 | Modal wall of text, then an empty-ish floor. No wow moment. Fresh machine = nothing. |
| Review loop (the daily job) | 4 | Plain-text thread, no markdown, no diff, blocking send with no streaming, hands-up cannot be answered. |
| Retention hooks | 2 | No history, no standup, no wrapped, no tray, no sound, no mobile. The product forgets each day. |
| Distribution | 1 | Not on npm. No release. No GIF. Zero stars. |
| Platform coverage | 4 | Windows verified. macOS/Linux terminal paths unrun. Codex unverified. One runtime in practice. |
| Documentation | 8 | Blueprint + deviations are excellent. But written for builders, not users; nothing marketed. |
| Monetisable surface | 1 | None by design in v1. The daemon/API boundary keeps the door open. |

## 3. Findings, ranked

Priority: **P0** blocks growth entirely · **P1** blocks the daily habit · **P2** blocks 10× · **P3** hygiene.

### P0 — Distribution

**F1. The package is not published.** `npm view deckhq` → `E404`. The README's only install
instruction does not work. `npm pack --dry-run` succeeds (39 files, 203 kB), so publishing is one
command away. Until this is done every other finding is academic.
*Fix:* `npm publish --access public` from a clean tag; add `publishConfig`, a `prepublishOnly`
that runs the tests, and a GitHub Release with the two screenshots attached.

**F2. No GitHub release, no social preview, no GIF.** `gh release list` is empty. The repo's
social card is the default GitHub placeholder, so every link shared on X/Slack/HN renders as a
grey box with a repo name. The README's first image is 450 words down.
*Fix:* social preview = the floor screenshot with the tagline burned in; README hero = a 6-second
GIF above the fold showing an agent walking into the office; releases on every tag.

**F3. macOS terminal integration has never run.** `src/adapters/claude-code/adapter.mjs:454-467`
writes a `.command` file and calls `open -a Terminal`. No iTerm2, Warp, Ghostty, kitty or
WezTerm support, which is what the target user actually runs. Linux tries four emulators and
gives up. The majority of Claude Code power users are on macOS; the first thing they will click
is "Resume in terminal".
*Fix:* detect `$TERM_PROGRAM`/installed apps in preference order (Ghostty, iTerm2, Warp, kitty,
WezTerm, Terminal.app) and use each one's URL scheme or AppleScript; verify on a real Mac before
release. Same for Linux (add alacritty, foot, wezterm, and honour `$TERMINAL`).

**F4. The package description undersells and warns at the same time.** `package.json` says
"(Codex adapter included but unverified)" in the one-line description that appears on npm and
in search results. Honest, but a description is not a changelog.
*Fix:* move the caveat to README "Honest limits", keep the description to the pitch.

### P1 — The daily habit

**F5. First run is a modal wall of text on top of the product.** `public/index.html:129-177` and
`public/app.js:1004-1011` open a `<dialog>` with six bullet points before the user has seen a
single agent move. On the reference machine the floor behind it is 15 rooms, most of them
collapsed strips, with 37 people in the lounge and 5 at desks. The most alive place on screen
is the one where nothing is happening.
*Fix:* no modal. Floor first. A three-step coach-mark tour anchored to real elements (the
needs-you counter → your office → one agent), dismissible, keyboard-skippable. On a machine with
no sessions, an inline "Hire your first agent" that starts one in the demo directory.

**F6. Characters are the product and they are the smallest thing on screen.** At fit scale on
1600×1000 a character is ~12 px, its label (`MK1.2`) ~7 px and unreadable, and a project room is
mostly floor. `public/render/scene.js` `MIN_SCALE = 7.5` px/unit and the treemap give rooms area
in proportion to session count, so a room with one working agent and nine benched ones gets a
big empty cell. The eye goes to the lounge because that is where the bodies are.
*Fix:* (a) weight rooms by *active* agents, not sessions; (b) floor the character scale at
16 px body / 11 px label regardless of zoom, letting rooms overlap the plate band before
letting people shrink; (c) a *focus camera* that frames the rooms with activity and parks the
lounge at the edge; (d) a "compact lounge" that renders benched agents as a crowd count past 8.

**F7. The header is a toolbar, not a headline.** Seven buttons in a mono face: Show let go,
Settle floor, New project, Hooks, Refresh, Enable notifications. "Show let go" **does nothing**
— it writes `settings.showLetGo` that no code reads (`docs/DEVIATIONS.md` §58, `public/app.js:1423`).
"Hooks" and "Refresh" are maintenance. There is no settings surface at all; stall window,
notifications and sound are only reachable through the API.
*Fix:* header = brand · needs-you hero · one primary CTA (New agent) · `⌘K`. Everything else
moves into a command palette and a settings sheet. Delete the dead toggle.

**F8. The review loop is text in, text out, and blocks.** The panel renders each message with
`textContent` and no markdown (`public/panel.js:453-479`), shows nothing about what changed on
disk, and `send()` runs `claude --resume <id> -p <text> --output-format json` to completion with
a ten-minute timeout (`src/adapters/claude-code/adapter.mjs:354-394`,
`src/http/routes/actions.mjs:33`). The composer is disabled with "Sending…" for the whole turn.
The person is asked to *review* work with none of the review material and then wait blind.
*Fix:* review-first panel. Top: the last assistant message rendered as markdown. Then: `git
diff --stat` in the session's cwd since the turn started, with a link to open the diff. Then
three big actions with number keys: **Reply**, **Approve** (send "yes, go ahead"), **Bench**.
Send via `--output-format stream-json` and stream deltas into the thread; also tail the
transcript file so replies made in a terminal appear live.

**F9. A raised hand cannot be answered from DeckHQ.** With hooks, a permission prompt raises a
hand within milliseconds — and then the only option is "Resume in terminal". The single most
requested thing in every Claude Code community is "approve from somewhere else". DeckHQ has the
hook, the UI and the metaphor, and stops one step short.
*Fix:* for sessions DeckHQ spawns, run them through the Agent SDK / `--permission-prompt-tool`
so the permission decision is DeckHQ's to make; render the request in the panel with Allow /
Deny / Allow-for-session. For terminal-spawned sessions, offer "take over" (resume headless).
This is also the feature the phone tier sells.

**F10. The product forgets every day.** There is no timeline, no "today", no history beyond the
current snapshot. Nothing answers "what did my team do while I slept" or "how long did things
wait on me this week". The success metric in `docs/01-PRODUCT.md` §6 (median time in
`for_review`, falling week over week) is not computed anywhere.
*Fix:* an append-only event ledger in `~/.deckhq/ledger/YYYY-MM-DD.jsonl` fed by the state
machine (state entries, acks, sends, tokens). From it: the **standup card** (today), the **weekly
wrapped**, and the per-project cost trend. The ledger is also the shareable artifact engine.

**F11. Notifications need the tab open.** `public/app.js:495-520` uses the browser
`Notification` API, which only fires while the page is alive somewhere. No tray, no menu bar,
no badge when the tab is closed. The daemon keeps running; the human is not told.
*Fix:* short term, install as a PWA and use the Badging API; ship a `--notify` daemon flag that
uses `osascript`/`notify-send`/PowerShell toast without a dependency. Medium term, a small
Tauri menu-bar shell that shows the needs-you count and opens the floor.

**F12. No sound.** `settings.sound` exists (`src/core/store.mjs:49`) and is never used. The
office metaphor has an obvious audio channel — a door, a chime when someone walks into your
office — that is the cheapest dopamine in the product.
*Fix:* three sounds, all synthesised in-browser (no assets, no egress): office door on
`for_review` entry, a soft knock on `needs_input`, a two-note chime on "office cleared". Off by
default except the chime; setting in the palette.

### P2 — Ten times

**F13. One runtime in practice.** Codex is "implemented but unverified" (`docs/DEVIATIONS.md`
§8). Gemini CLI, Cursor CLI, OpenCode, Copilot CLI, Amp and Aider all write session logs to
disk and all have users who alt-tab between terminals. The registry (`src/adapters/index.mjs`)
needs one line per adapter. Each adapter is a new community to launch in.
*Fix:* verify Codex on a real install (blocking, per the tech lead); then Gemini CLI and
OpenCode (largest OSS communities); publish an `ADAPTERS.md` contract so contributors add the
rest.

**F14. Cost rates are hard-coded and stale.** `src/core/model.mjs:274-291` maps model names to
four hand-typed tiers. The models in the fixtures are Claude 5 family; the rates are guessed
from an older generation. The number is labelled "not a bill" but it drives the per-project
comparison, which is the whole point of F9 in the product spec.
*Fix:* rates in a JSON data file keyed by model id prefix, reviewed against the published
pricing page at release time, overridable in `~/.deckhq/rates.json`. Show "rate card vX" in the
whiteboard so the user knows which table produced the number.

**F15. Cold scan re-reads everything on every daemon start.** 1.3–1.7 s for 51 sessions,
CPU-bound JSON parsing of ~100 MB (`docs/DEVIATIONS.md` §11). The summary cache is in-memory
only (`src/adapters/claude-code/adapter.mjs:205`). A user with 300 sessions will see a
multi-second blank floor on every launch — precisely the moment they are deciding whether to
keep the tab.
*Fix:* persist the summary cache to `~/.deckhq/cache/claude-code.json` keyed by (path, mtime,
size); render from cache instantly and reconcile in the background.

**F16. Identity is cold.** Every agent is `MK<project>.<n>` unless named, and every body is the
same silhouette in the state colour (by design, `docs/03-VISUAL-SPEC.md` §3). Attachment — the
thing that makes someone open the tab to *see how Ada is doing* — needs persistent, distinct
people. DEVIATIONS §30 already split the channel: torso = state, hair/accent = project.
*Fix:* derive a stable appearance (hair style, skin, outfit accent, glasses) from the session id
hash; keep state on the torso and the icon. Auto-assign a first name from `names.js` on first
sight instead of on request, keep the MK tag as the sub-label.

**F17. The lounge inverts the message on real machines.** 37 of 49 sessions were benched on the
reference machine. The lounge is the most animated region and the largest single room.
Spec §4.3 calls the lounge a reward for a cleared queue; on a real machine it is the default
state and reads as "most of my agents are playing pool".
*Fix:* past eight benched agents, render a crowd (dense, low-detail, slower loops) and cap the
lounge's share; surface the count on the plate. Make "benched" visually calmer than "working".

**F18. No mobile, no second machine.** Local-only is the right v1 constraint and the wrong
ceiling. Every competitor that charges money charges for "see it from my phone" or "see my other
machine". The daemon already speaks a clean HTTP+SSE API behind `src/http/`.
*Fix:* the relay tier (see `03-BUSINESS-MODEL.md`): an end-to-end encrypted outbound WebSocket
from the daemon to a relay, a phone PWA that pairs by QR, push on `needs_input`/`for_review`,
approve/reply from the phone. Free core stays egress-free; the relay is opt-in and paid.

### P3 — Hygiene

**F19. Repo hygiene.** `state.json`, `state/`, `run.log`, `run.err.log` sit in the working tree
(ignored, but confusing to a contributor). No `CONTRIBUTING.md`, `SECURITY.md`,
`CODE_OF_CONDUCT.md`, issue templates, PR template, `FUNDING.yml`, or `CITATION`. No
`engines` enforcement beyond the field. No `prepublishOnly`.

**F20. No browser-level tests.** `scripts/capture-floor.mjs` already drives Chrome over the
DevTools protocol; it is one step from a visual-regression harness (golden PNG per fixture,
pixel diff in CI). The three coordinate-convention bugs in DEVIATIONS §16, §35, §38, §52, §55
were all invisible to unit tests and visible to a screenshot.

**F21. Files are large and untyped.** `public/render/plan.js` 2533 lines, `public/app.js`
1532, `public/render/scene.js` 1432. JSDoc is thorough but unchecked. `tsc --noEmit --checkJs`
as a dev dependency would catch the drift between `derivePlacement()` in `agents.js` and
`placement()` in `model.mjs` that the comments warn about.

**F22. Docs address the wrong reader.** `docs/README.md` opens "Hand this directory to the
delivery orchestrator." The best writing in the repo (DEVIATIONS) is invisible to anyone who
did not build it. There is no user guide, no FAQ, no "why not just use `claude agents`".

## 4. What is genuinely excellent — do not touch

- **The invariant and its tests.** `test/unit/state-machine.test.mjs` `INVARIANT:` cases. This
  is the product. Every plan document defers to it.
- **Zero runtime dependencies, loopback, no egress.** A security reviewer can read the whole
  thing in an afternoon. Keep it true for the free core forever; it is the trust story.
- **Hook consent with the literal JSON, port-aware install, delivery evidence.** Nobody else
  does this. It is a screenshot in itself.
- **The deviations log.** 65 numbered entries of measured wrong turns. This is a year of
  build-in-public content already written.
- **The demo floor script.** Reproducible, drives the real hook endpoint, never touches real
  data. It is the marketing asset generator.
- **The office metaphor with a nav graph.** People walk through doors, along corridors, sit on
  actual chairs. It is the difference between a skin and a place.

## 5. A fresh user, minute by minute

A macOS developer with twelve Claude Code sessions across four repos sees a post on X.

| t | What happens today | What should happen |
|---|---|---|
| 0:00 | Clicks the repo link. Grey social card. README: three paragraphs, then a screenshot. | Social card is the floor. README hero is a GIF: an agent stands up, walks into your office, a badge starts counting. |
| 0:30 | Runs `npx deckhq`. **404.** Stops. | Runs `npx deckhq`. Floor in under two seconds from the persisted cache. |
| 0:40 | (if installed from git) A modal explains six states. Dismisses it. | The floor is already moving. Coach mark 1 of 3 points at "2 need you". |
| 1:00 | Sees four rooms, mostly floor, tiny people. Lounge is busiest. | Rooms sized by activity. Two people standing in the office, names readable, one with a hand up at a desk. |
| 1:20 | Clicks a person. Reads plain text. Wonders what changed. | Panel: last message rendered, `+142 −18 in 6 files`, three big buttons. Presses **1** to reply "ship it". Sees tokens stream. |
| 2:00 | Clicks "Resume in terminal". Terminal.app opens (not their iTerm). | Their terminal opens, in the right pane, at the session. |
| 2:30 | Closes the tab. Nothing ever tells them again. | Menu-bar count. Phone buzz at 11pm: "Ada finished the migration". Tap → approve. |
| Day 7 | Has forgotten it exists. | Monday: "Your week: 61 turns, 9.4M tokens, longest wait 26h → 2h". Shares the card. |

That table is the product plan in one page. The rest of `docs/plan/` is how.

## 6. Corrections and findings from execution

Added 2 September 2026, as work packages landed. The audit was written from reading; these are
what running it taught. Each one changed a plan document.

### C1 — The capture claim was wrong, and the corrected version is stronger

**Claimed:** that `claude agents` cannot see sessions started in other terminals, sourced from a
line in Anthropic's own documentation and repeated into the thesis, the market positioning and
WP-05.

**Measured on the reference machine:** `claude agents --json` returned all five live sessions,
every one `kind: "interactive"`, spanning four different repositories. It sees terminal sessions
perfectly well.

What is true is narrower and better: it reports what is **running**. Five of sixty-six. A session
that finishes its turn and exits leaves that view, and nothing records that it wanted something
from you. DeckHQ keeps all sixty-six and knows which are owed an answer.

The first `--capture-proof` image rendered *"DeckHQ sees 61 sessions the agent view cannot"* —
literally true, since 66 − 5 = 61, and rhetorically dishonest, because it compares all-history
against live-now and invites the reader to picture 61 hidden agents. On our single most important
launch asset. Rejected and reworked to lead with the debt count.

Corrected in [`08`](08-PLAN-V2-100X.md) §3.0, [`02`](02-MARKET-AND-LAUNCH.md) §1.4 and
§3 A1. **The general lesson, which is now a standing rule: a claim in a competitor's
documentation is a hypothesis, not a fact. Measure it before it reaches a headline.**

### C2 — The archive flag was already being written into the cache

Found while persisting the summary cache. The in-memory cache returned its stored object and the
adapter then stamped `summary.archived` onto it, writing the desktop app's archive flag *into*
the cached entry. In memory this was masked, because a fresh read re-applied the flag every poll
and only while that read kept succeeding.

Persisted, it would have written `archived: true` to disk permanently — and `archived` drives
`let_go`. An agent the user deliberately rehired would have been re-fired on every poll, for
ever. Exactly the class of failure `docs/DEVIATIONS.md` §46 was written to prevent, sitting live
in the code the whole time. Fixed by copy-out and strip-on-write, with two `INVARIANT:` tests.

### C3 — Cached summaries must not be painted before reconciliation

WP-11 as specified said paint from cache immediately, reconcile in the background. The Architect
declined, correctly.

A stale summary carries `turnEnded`, which reaches `_markForReview`, which writes `reviewSince` —
a user-owned field only `act()` may clear. The likeliest reason a transcript changed while the
daemon was down is that the user typed into it, which is precisely the case where the cached
answer says "turn ended, up for review" and the truth is "already answered". Painting that
provisionally manufactures a debt that then survives for ever, because nothing observed is
allowed to clear it.

Only provably-current entries are served. The measured second start is 59–90 ms against a 400 ms
target, so there was nothing to buy by taking the risk. **The spec was wrong; the invariant was
right.**

### C4 — The real scan bottleneck is not the transcripts · **new work**

With the cache in place, `readDesktopSessions()` is roughly **90% of every scan**: it
synchronously reads and parses 57 files totalling 8.3 MB, on every five-second poll, for ever.
Pointed at an empty directory, warm start drops from 62–94 ms to **6–8 ms** and the poll from
52–57 ms to **5–7 ms**.

This is what holds the warm scan against `docs/02-ARCHITECTURE.md` §8's < 50 ms budget instead of
sitting comfortably inside it, and it is a straight repeat of the pattern §11 already documented:
re-reading unchanging files on a timer. Now WP-35.

### C5 — Measured performance, before and after WP-11

| | before | after |
|---|---|---|
| Cold start, no cache | 838 ms | 778–868 ms |
| **Second start** | **780–854 ms** | **59–90 ms** |
| Warm poll | 64–68 ms | 63 ms |
| Cache file on disk | — | 62 KB |

66 real sessions, 307 MB of transcripts, one of them 74 MB. Cold start is unchanged within noise;
the only addition is a single 62 KB atomic write.
