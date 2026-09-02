# 06 — Engineering work plan

**Owner:** orchestrator · 34 work packages across 5 phases
**Roles:** `PE` Product Engineer · `UX` UI/UX · `AR` Architect · `AB` Agent Backend · `GR` Growth

Rules for every package, from [`00-ORCHESTRATOR-BRIEF.md`](00-ORCHESTRATOR-BRIEF.md) §7. The
short version: the invariant is inviolable, the core stays MIT/local/egress-free, no runtime
dependencies, every deviation gets a numbered entry in `docs/DEVIATIONS.md`, and nothing ships
without a screenshot.

A package is **done** when its acceptance criteria pass, its tests are green in CI on all three
platforms, and someone other than its author has reviewed it.

---

## Phase 0 — Unblock · week 1 · nothing else starts until this lands

### WP-01 · Publish to npm · `PE` · 0.5d · no deps

The README's only install instruction returns `E404`. This is the highest-value half-day in the
plan.

- `npm publish --access public` from a clean `v1.2.0` tag.
- Add `"publishConfig": { "access": "public" }` and a `prepublishOnly` that runs `npm test` and
  `npm run lint`.
- Verify the tarball has no `state.json`, no logs, no `.claude/`. (`npm pack --dry-run` currently
  gives 39 files / 203 kB — confirm that stays true.)
- Move the "(Codex adapter included but unverified)" caveat out of the `description` field and
  into the README's Honest limits. A description is not a changelog.
- Smoke test `npx deckhq@latest` on a machine that has never seen the repo.

**Accepted when:** `npx deckhq` works on a clean Windows box and a clean Mac, and the npm page
renders the README with the hero image.

### WP-02 · Repository presentation · `GR` · 0.5d · no deps

- Social preview image: a crop of the floor with the tagline burned in. The repo currently
  renders as a grey box in every link preview, everywhere, forever.
- GitHub Release for `v1.2.0` with both screenshots attached and the changelog inline.
- `CONTRIBUTING.md` (lead with the two non-negotiables: the invariant, and no egress),
  `SECURITY.md`, `CODE_OF_CONDUCT.md`, issue + PR templates, `FUNDING.yml`.
- Untrack the stray `run.log`, `run.err.log`, `state.json`, `state/` from the working tree.
- Repo description and topics reviewed against the positioning in [`02`](02-MARKET-AND-LAUNCH.md) §2.

**Accepted when:** a link to the repo pasted into Slack, X and Discord renders the floor.

### WP-03 · README rewrite and the hero GIF · `GR` + `UX` · 1d · after WP-02

The current README opens with 450 words before the first image.

- **Line 1:** the pitch. **Line 2:** `npx deckhq`. **Line 3:** the hero GIF.
- Hero GIF, 6 s, generated from `scripts/demo-floor.mjs` so it is reproducible and contains no
  real project names: agent types → stands → walks the corridor → into your office → badge
  appears and starts counting. No chrome, no cursor, no text.
- The capture-proof image (A1 in [`02`](02-MARKET-AND-LAUNCH.md) §3) directly under it.
- Then: the one rule, the six states, what it reads, what it writes, privacy, honest limits.
  All of that copy is already good — it just moves below the fold.

**Accepted when:** someone who reads only the first screen can state what it does and how to run it.

### WP-04 · macOS and Linux terminal integration · `AB` · 1.5d · no deps

`openInTerminal()` on macOS writes a `.command` file and calls `open -a Terminal`. It has never
been run, and the target audience does not use Terminal.app.

- macOS: detect and prefer, in order — Ghostty, iTerm2, Warp, kitty, WezTerm, then Terminal.app.
  Use each one's own scheme or AppleScript; keep the argv-array discipline and never interpolate
  user data into a shell string.
- Linux: add alacritty, foot, wezterm, kitty; honour `$TERMINAL` first.
- Same treatment for `openNewSession()`.
- A settings entry to pin a preferred terminal.

**Accepted when:** verified by hand on a real Mac and a real Linux desktop, with the result and
the emulator list recorded in `docs/DEVIATIONS.md` §9, which currently lists this as unverified.

### WP-05 · `deckhq doctor` and the capture proof · `AB` · 1d · after WP-01

A CLI command that prints an environment report **and** the launch asset.

```
$ deckhq doctor
  claude          2.1.184 on PATH
  transcripts     51 sessions across 15 projects
  live now        3   (claude agents reports 3)
  on the floor    51  ← DeckHQ sees 48 sessions the agent view cannot
  codex           not installed
  hooks           installed, port 4317, 1,204 events, last 2m ago
  state           ~/.deckhq/state.json, writable
  egress          none. 0 outbound sockets since start.
```

`--capture-proof` writes a PNG of that comparison, ready to post. This is A1 in
[`02`](02-MARKET-AND-LAUNCH.md) §3, and a user-generated one is worth ten of ours.

**Accepted when:** the numbers are correct on the reference machine and the command exits
non-zero when something is genuinely misconfigured.

---

## Phase 1 — The wedge · weeks 2–4

### WP-06 · Chrome repalette and typography · `UX` · 1.5d · no deps

[`05-GUI-UX-SPEC.md`](05-GUI-UX-SPEC.md) §2. Chrome neutrals move from warm-red-tinted to a
violet-blue bias so the warm floor reads as lit. Add IBM Plex Sans Condensed, self-hosted, for
floor labels only.

**Accepted when:** every state colour re-measures ≥ 3:1 against the new `--bg` and `--surface`
and body text ≥ 4.5:1, asserted in `test/unit/state-visuals.test.mjs`; no font is fetched from
any network host; before/after screenshots in the PR.

### WP-07 · Header, command palette, settings sheet · `UX` + `PE` · 3d · after WP-06

[`05`](05-GUI-UX-SPEC.md) §5. Header reduces to brand · display numeral · breakdown · counts ·
`⌘K` · one primary action. Everything else moves into the palette. Settings sheet exists for the
first time. **Delete the dead "Show let go" toggle** and the `showLetGo` setting it writes.

**Accepted when:** every action previously in the header is reachable in ≤ 2 keystrokes from
`⌘K`; the palette is fully keyboard-operable and screen-reader-labelled; no orphaned settings
keys remain.

### WP-08 · The review card · `PE` · 4d · after WP-06

[`05`](05-GUI-UX-SPEC.md) §4. The single highest-value package in P1.

- Markdown rendering of the last assistant message. **Own implementation, ~150 lines, no
  dependency.** Parse to a token tree, build DOM with `textContent`. Never `innerHTML`, never
  regex-to-HTML.
- "What changed" section: `git diff --stat`, `git diff --cached --stat`, and commits ahead of the
  default branch, run in the session cwd, cached per scan. New endpoint `GET /api/changes?id=`.
  Heading is **"what changed in `<project>`"** — never attributed to one agent.
- Three weighted actions on `1`/`2`/`3`. `2 Approve` sends a configurable affirmative. Overflow
  behind `⋯`.
- Close-up shrinks to 44 px inline. Costs move to a single line at the bottom.

**Accepted when:** a fenced code block with a `<script>` tag inside it renders as visible text
and executes nothing (named `SECURITY:` test); the diff section is correct in a dirty repo, a
clean repo, a repo with no git, and a deleted directory; `2` discharges a review in one keystroke;
**no path in this package calls `/api/ack` except an explicit button or number key.**

### WP-09 · Streaming send and transcript tail · `AB` · 2.5d · after WP-08

`send()` blocks up to ten minutes with the composer disabled.

- `--output-format stream-json`, parsed incrementally, deltas pushed to the client over SSE.
- Watch the open session's transcript file so replies typed in a terminal appear live.
- The composer re-enables the moment the turn is accepted, not when it completes.

**Accepted when:** a reply shows the agent producing output within 1 s; killing the daemon
mid-send leaves no orphan process; a send failure still restores the composer content.

### WP-10 · Queue strip and deck view · `UX` + `PE` · 3d · after WP-07

[`05`](05-GUI-UX-SPEC.md) §3. The structural answer to "observational theater".

**Accepted when:** `Tab` toggles floor ⇄ deck with no reflow of the panel; `J`/`K`/`1`/`2`/`3`
work identically in strip, deck and floor; the deck is a real semantic grid a screen reader can
traverse in queue order; the oldest chip never scrolls out of the strip.

### WP-11 · Persistent summary cache · `AR` · 2d · no deps

Cold scan is 1.3–1.7 s for 51 sessions and the cache is in-memory only, so every daemon start
re-parses ~100 MB. A user with 300 sessions sees a blank floor for several seconds at exactly the
moment they are deciding whether to keep the tab.

Persist to `~/.deckhq/cache/<runtime>.json`, keyed by `(path, mtime, size)`. Render from cache
immediately, reconcile in the background, evict entries whose file is gone.

**Accepted when:** second and subsequent starts paint a populated floor in < 400 ms with 51
sessions; a corrupt cache file is discarded and rebuilt without failing startup; the cache never
changes what is displayed once reconciliation completes (assert cache-then-scan equals scan).

### WP-12 · Floor legibility · `AR` · 3d · after WP-06

[`05`](05-GUI-UX-SPEC.md) §6. Room weight by `activeCount`; character/label minimum sizes
decoupled from world scale; lounge crowd rendering past 8 benched; `F` focus camera.

**Accepted when:** on the reference machine (15 projects, 57 sessions, 37 benched) every
character is ≥ 16 px and every name label ≥ 11 px at fit; the lounge occupies < 25% of floor area;
`floor-integrity.test.mjs` still passes across all seven populations and five aspect ratios.

### WP-13 · Onboarding · `UX` · 2d · after WP-07

[`05`](05-GUI-UX-SPEC.md) §7. Delete the modal. Three coach marks on real elements. Demo actors
for an empty machine, who leave when the first real session walks in.

**Accepted when:** a person who has never seen DeckHQ can say why an agent stands in the office
rather than raising a hand, after ≤ 15 s of reading; `Escape` skips permanently; the empty-machine
path transitions to the real floor within one poll of the first session appearing.

### WP-14 · The office snapshot · `UX` + `AR` · 2d · after WP-12

[`04`](04-ENGAGEMENT-AND-GAMIFICATION.md) §3.2. `S` composites floor + stat strip to a PNG, on
the clipboard and saved to `~/.deckhq/snapshots/`. Hostname as the office name. One-key redact
that swaps project names for MK tags.

**Accepted when:** the PNG is ≥ 2× device pixel ratio and under 2 MB; redaction leaves no project
name anywhere in the image including room plates and the strip; works with the tab backgrounded.

### WP-15 · Office cleared, and sound · `UX` · 1.5d · after WP-10

[`05`](05-GUI-UX-SPEC.md) §8, §9. Three WebAudio-synthesised sounds, no asset files. The
office-cleared moment: light warms, chime, one line, gone.

**Accepted when:** no network request and no bundled audio file; sounds respect coalescing and
are silent when the tab is hidden; one keystroke from the palette mutes globally and persists;
`prefers-reduced-motion` suppresses the light change but keeps the line.

---

## Phase 2 — The habit · weeks 5–8

### WP-16 · Notifications that survive the closed tab · `AB` · 3d · after WP-10

Today notifications need the page alive, which defeats the point — the daemon outlives the tab by
design.

- PWA manifest + service worker + Badging API so an installed DeckHQ badges the dock/taskbar.
- `--notify` daemon flag using `osascript` / `notify-send` / PowerShell toast. **No dependency.**
- Interruption budget from [`04`](04-ENGAGEMENT-AND-GAMIFICATION.md) §6: only hands-up and
  unexpected death interrupt. Everything else is a badge.

**Accepted when:** entering `needs_input` with every browser window closed produces exactly one
OS notification on all three platforms; declining permission degrades silently to the badge.

### WP-17 · The event ledger · `AR` · 2.5d · no deps

Append-only `~/.deckhq/ledger/YYYY-MM-DD.jsonl`, written by the state machine: state entries,
acks, sends, token deltas, project. This is the substrate for WP-18, WP-26 and WP-27, and it is
what finally measures `docs/01-PRODUCT.md` §6's success criteria.

**Accepted when:** a day's ledger reconstructs the needs-you queue at any past timestamp; median
time-in-`for_review` is computable and exposed at `GET /api/stats`; retention is configurable and
defaults to 90 days; a write failure never blocks the state machine; **nothing in the ledger path
can mutate ack state.**

### WP-18 · The daily postcard · `PE` · 2d · after WP-17

[`04`](04-ENGAGEMENT-AND-GAMIFICATION.md) §3.3. Lights-out dimming, one card, shareable as PNG
through WP-14's compositor.

**Accepted when:** it appears once per day at most; dismissing costs one keystroke; the numbers
reconcile exactly with the ledger; the copy contains no second-person fault.

### WP-19 · Permission approval — spike, then build · `AB` · 2d spike + 4d · after WP-08

The feature that makes a raised hand answerable from DeckHQ, and the one that justifies the paid
tier.

**Spike first (2 days, blocking).** Verify against the current Claude Code release: the exact
`--permission-prompt-tool` contract, whether a daemon-hosted MCP server can serve it, what the
request and response payloads are, and what the Codex equivalent is. Write the findings into
`docs/DEVIATIONS.md` **whatever the result.**

If the spike passes: sessions DeckHQ starts are spawned pointed at an MCP server inside the
daemon; permission requests render in the panel with **Allow / Deny / Allow for this session**;
the decision returns to the runtime. Sessions started elsewhere keep the "resume in terminal"
escape hatch.

**Accepted when:** a permission prompt raised by a DeckHQ-started session is answered from the
panel and the session continues, verified end to end on the reference machine. **Nothing about
this feature appears in a README, a tweet or a pricing page until that has happened.**

### WP-20 · Agent identity · `AR` + `UX` · 2.5d · after WP-12

[`04`](04-ENGAGEMENT-AND-GAMIFICATION.md) §4. Stable appearance derived from the session id hash
— hair, skin tone, outfit accent, glasses, build. Auto-assign a name from `names.js` on first
sight instead of on request. Torso keeps the state colour; MK tag stays as sub-label and in the
hover card.

**Accepted when:** appearance and name are stable across daemon restarts and never reassigned
(extend `identity.test.mjs`); no project accent lands near crimson (the existing test still
passes); state remains readable at every LOD with identity applied.

### WP-21 · Visual regression harness · `PE` · 2d · no deps

The three worst bugs in this project's history — the rig a quarter-turn out of true, the sofa
drawn through a wall, chair backrests ninety degrees off — were invisible to 327 unit tests and
obvious in one screenshot.

`scripts/capture-floor.mjs` already drives Chrome over the DevTools protocol. Extend it to golden
PNGs per fixture population, with a pixel-diff gate in CI.

**Accepted when:** a deliberately reverted rig fix fails the gate; goldens regenerate with one
documented command; the job adds < 90 s to CI.

### WP-22 · Type checking and file decomposition · `AR` · 3d · no deps

`plan.js` 2,533 lines, `app.js` 1,532, `scene.js` 1,432. JSDoc is thorough and unchecked.

Add `tsc --noEmit --checkJs` as a dev dependency and a CI gate. Split `plan.js` into packing,
rooms, anchors and nav. Address the documented duplication between `derivePlacement()` in
`agents.js` and `placement()` in `model.mjs` — the comments already warn they must not drift.

**Accepted when:** typecheck is green and gating; no file over 900 lines; the full suite still
passes; **no behaviour change** (WP-21's goldens are the proof).

---

## Phase 3 — The spread · weeks 9–12

### WP-23 · Verify Codex · `AB` · 2d

Blocking on any claim of Codex support, per the tech lead's own ruling in `docs/DEVIATIONS.md`
§8. Install Codex, run the acceptance script against it, fix what breaks, record the result.

**Accepted when:** both runtimes appear on one floor with correct attribution, or the claim is
removed from the README and `package.json` entirely.

### WP-24 · Gemini CLI adapter · `AB` · 3d · after WP-23
### WP-25 · OpenCode adapter · `AB` · 3d · after WP-23

One entry each in `src/adapters/index.mjs`. Each is a launch into a new community
([`02`](02-MARKET-AND-LAUNCH.md) §4 Wave 3); OpenCode alone has 203k stars and its own Discord.
Ship `docs/ADAPTERS.md` — the contract, worked example and test fixtures — so contributors can
add the rest without us.

**Accepted when:** three runtimes on one floor; disabling any one leaves the others fully
working; a contributor can add a fourth using only `ADAPTERS.md`.

### WP-26 · Rate card and the payroll meter · `PE` · 2d · after WP-17

Cost rates are four hand-typed tiers in `src/core/model.mjs`. Move to `src/data/rates.json`,
keyed by model id prefix, versioned, overridable at `~/.deckhq/rates.json`. Show "rate card vN"
wherever a cost appears. Add per-room daily spend to the room plate as a quiet line.

**Accepted when:** rates are reviewed against published pricing at release; a user override
takes effect without a restart; every cost display still says estimate.

### WP-27 · Wrapped · `PE` + `UX` · 3d · after WP-17

Weekly on Monday, annual on 1 December. Generated locally from the ledger, one click to PNG. No
email, no server, no account.

**Accepted when:** every number reconciles with the ledger; it degrades gracefully with < 7 days
of history; the PNG is shareable at 2× and passes WP-14's redaction.

### WP-28 · Agent traits · `AR` · 2d · after WP-20 · optional

Read-only, inferred from real behaviour: hand-raise frequency, tool mix, verbosity, model. One
line in the hover card, and a tendency in idle animation. **No levels, no training, no morale.**

### WP-29 · Documentation site · `GR` · 3d

`docs/` currently opens "Hand this directory to the delivery orchestrator." Ship a user-facing
site: install, the model in 60 seconds, hooks, adapters, privacy, FAQ ("why not just use
`claude agents`" — answer with the capture proof), and the deviations log as an engineering blog.
Static, no tracking.

### WP-30 · Themes and layout packs · `UX` · 2d

Floor themes and importable/exportable layouts as JSON. **Ungated** in the free product; the
Studio pack ([`03`](03-BUSINESS-MODEL.md) §5) adds more, and gates nothing that affects capture,
the queue, or any action.

### WP-31 · VS Code extension · `AB` · 3d

Pixel Agents got **9× more installs than stars** from a Marketplace listing. A thin extension
that starts the daemon and opens the floor in a panel is a distribution channel we do not have.

**Accepted when:** it installs the daemon, opens the floor, and adds no telemetry.

---

## Phase 4–5 — Relay and Teams · months 4–12

### WP-32 · Relay protocol and daemon client · `AR` · 10d
### WP-33 · Phone PWA · `UX` + `PE` · 8d · after WP-32
### WP-34 · Billing and paid launch · orchestrator · 5d · after WP-33

Design in [`03-BUSINESS-MODEL.md`](03-BUSINESS-MODEL.md) §3. Binding constraints: outbound
WebSocket only, end-to-end encrypted with a key that never reaches the relay, off until signed
in, self-hostable, and **the free product still makes zero outbound connections** — including no
check for whether a relay account exists.

Phase 5 (Teams, SSO, audit, shared floor) is scoped after the P4 gate in
[`03`](03-BUSINESS-MODEL.md) §7 passes.

---

## Dependency graph

```
P0   WP-01 ─┬─ WP-05
     WP-02 ─── WP-03
     WP-04

P1   WP-06 ─┬─ WP-07 ─┬─ WP-10 ─┬─ WP-15
            │         └─ WP-13  └─ WP-16 (P2)
            ├─ WP-08 ─┬─ WP-09
            │         └─ WP-19 (P2)
            └─ WP-12 ─┬─ WP-14
                      └─ WP-20 (P2)
     WP-11 (independent)
     WP-21, WP-22 (independent, any time)

P2   WP-17 ─┬─ WP-18
            ├─ WP-26 (P3)
            └─ WP-27 (P3)

P3   WP-23 ─┬─ WP-24
            └─ WP-25
     WP-29, WP-30, WP-31 (independent)

P4   WP-32 ── WP-33 ── WP-34
```

**Critical path:** WP-01 → WP-06 → WP-08 → WP-19 → WP-32.
WP-08 is the long pole in P1 and WP-19's spike is the long pole in P2; start each the day its
dependency is accepted.

**Parallelism:** after WP-06, `PE` (panel), `AR` (renderer, cache) and `AB` (adapters, terminals,
notifications) run concurrently. `UX` leads WP-06/07/10/13 then supports. `GR` runs P0 and P3
independently of everything.

## Effort

| Phase | Days | Calendar with 4 working in parallel |
|---|---|---|
| P0 | 4.5 | 1 week |
| P1 | 24.5 | 3 weeks |
| P2 | 21 | 4 weeks |
| P3 | 23 | 4 weeks |
| P4 | 23 | 6 weeks |

~96 person-days to the end of P4.

## The acceptance script, extended

`docs/04-BUILD-PLAN.md` §4's nineteen steps still stand and still must pass. Add:

20. `npx deckhq@latest` on a machine that has never seen the repo. Floor within 3 s.
21. `deckhq doctor` reports more sessions than `claude agents`, correctly.
22. Resume in terminal opens *the user's own* terminal on macOS and Linux.
23. A stranger triages five waiting sessions in under 60 s with no instruction.
24. Press `S`. The PNG on the clipboard is postable without cropping.
25. Close every browser window. Trigger a permission prompt. One OS notification arrives.
26. Answer that permission prompt from the panel. The session continues. *(after WP-19)*
27. A week of use produces a Wrapped whose numbers reconcile with the ledger.
28. Reduced motion: the floor, the strip and the deck are all fully legible and operable.
29. Three runtimes on one floor with correct attribution.
30. `deckhq doctor` reports zero outbound sockets after four hours of use.
