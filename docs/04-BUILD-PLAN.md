# DeckHQ — Build Plan

**Status:** approved for execution · **For:** the delivery orchestrator

Your job is to staff and ship this. It is not to re-plan it. Every product and design decision is
settled in `01-PRODUCT.md`, `02-ARCHITECTURE.md` and `03-VISUAL-SPEC.md`. Build exactly that.

If you hit something genuinely unspecified, **stop and raise it**. Do not decide it, and do not
build around it. A wrong guess costs more than a question.

---

## 1. Team

Six roles. One person may hold more than one; the work packages are what matter.

| Role | Owns | Must be good at |
|---|---|---|
| **R1 Runtime engineer** | `src/adapters/**` | Parsing undocumented formats defensively; child processes; Windows path handling |
| **R2 Daemon engineer** | `src/core/**`, `src/http/**` | State machines, SSE, atomic persistence, API design |
| **R3 Renderer engineer** | `public/render/**` | Canvas 2D, procedural drawing, animation, performance |
| **R4 Interface engineer** | `public/app.js`, `public/style.css`, panel, notifications | Accessible, dense product UI; keyboard interaction |
| **R5 QA engineer** | `test/**`, acceptance runs | Adversarial testing; cross-platform; performance measurement |
| **R6 Tech writer** | `README.md`, onboarding copy, hook consent copy | Explaining a model in 60 seconds without jargon |

## 2. Work packages

Dependencies are hard. Do not start a package before its dependencies are **accepted**, not merely
"mostly done".

---

### WP0 — Reset the repository · R2 · 0.5 day · no dependencies

The prototype proved the idea. It is not the foundation.

**Scope**
- Delete `public/studio.js`, `public/app.js`, `public/style.css`, `public/index.html`,
  `lib/sessions.mjs`, `server.mjs`, `state.json`.
- Move them to `reference/` for consultation. They are read-only from this point.
- Create the layout in `02-ARCHITECTURE.md` §10.
- `package.json`: `type: module`, `bin` entry, Node ≥ 18, MIT licence, no dependencies unless a
  package is explicitly approved by the orchestrator.
- ESLint + Prettier, CI running lint and tests on Windows, macOS and Linux.

**Accepted when:** `npx .` starts a daemon that serves an empty page on 127.0.0.1:4317, CI is
green on all three platforms, and no prototype file remains outside `reference/`.

---

### WP1 — Claude Code adapter · R1 · 3 days · after WP0

**Scope**
- Implement `RuntimeAdapter` (`02-ARCHITECTURE.md` §2) for Claude Code.
- `liveSessions()` from `claude agents --json`.
- `scanSessions()` over `~/.claude/projects/**/*.jsonl`: title from `custom-title`, cwd, git
  branch, model, token usage split into `tokens` (in+out) and `cacheTokens`, last role, last text.
- Bounded reads: head for the title, tail ≤ 2 MB for everything else.
- `conversation()`: text blocks only. **Tool calls, tool results and thinking blocks are excluded**
  — the panel is a conversation, not a trace.
- `send()` via `claude --resume <id> -p <text> --output-format json`, argv array, never a shell
  string, with the session's cwd.
- `openInTerminal()` per platform.
- `hooks.describe()` returning the exact JSON block for the consent screen.

**Accepted when:** on a machine with ≥ 20 real sessions, a scan returns every session with correct
titles and projects in < 1500 ms; no session is dropped; a deliberately corrupted `.jsonl` is
skipped with a log line and the scan still completes; `conversation()` output contains no
`[tool: …]` artefacts.

---

### WP2 — Codex adapter · R1 · 2.5 days · after WP1

Same interface, Codex session storage. If Codex exposes no hook mechanism, `hooks.supported` is
`false` and the daemon degrades to polling **for that runtime only** — Claude Code sessions keep
exact state.

**Accepted when:** both runtimes appear on one floor with correct per-runtime attribution; the
adapter registry needs no change to add a third; disabling either adapter leaves the other fully
working.

---

### WP3 — Core state machine and store · R2 · 3 days · after WP0 (parallel with WP1)

**Scope**
- `Agent` model and derived `placement` / `needsYou` (§3).
- State machine for both the hook path and the polling path (§4).
- Stall detection with a configurable window.
- First-run seeding, run once, recorded (§4.4).
- `state.json` with atomic writes and corruption recovery.
- Action semantics (§5.1).

**Accepted when:** a unit suite covers every transition in §4 and §5.1; **a test proves that no
observed event can clear `reviewSince`** — this is the product invariant and must have a dedicated,
named test; killing the daemon mid-write leaves a readable `state.json`.

---

### WP4 — HTTP API and SSE · R2 · 2 days · after WP3

**Scope**
- All endpoints in §5.
- SSE stream pushing a new snapshot on every change, with heartbeat and reconnect.
- `/api/hook` responding in < 200 ms, processing asynchronously.
- Loopback bind, path-confined static serving, argv-array process spawning.

**Accepted when:** a client receives a state push within 250 ms of a hook firing; the server
refuses to bind a non-loopback interface; a path-traversal attempt on static serving is rejected;
`/api/hook` under 100 events/second never exceeds its response budget.

---

### WP5 — Hook installation · R1 + R6 · 2 days · after WP4

**Scope**
- Consent screen showing the literal JSON and its destination file.
- Backup before write; tagged block; exact removal; malformed-settings abort (§6).
- Status surfaced in the header, with a plain-language explanation of what is lost without hooks.

**Accepted when:** install → remove returns the settings file byte-identical to its pre-install
content, including when the user edited unrelated parts in between; installing twice is a no-op;
a malformed settings file produces a clear error and no write.

---

### WP6 — Floor generation and baked backdrop · R3 · 4 days · after WP0

**Scope**
- Plan generation (§2): user's office, project rooms sized by team, one combined lounge.
- Irregular packing with circulation gaps.
- Materials: herringbone, carpet, tile, walls with shadow and ambient occlusion, door swings.
- Full furniture inventory (§6), each with a contact shadow.
- Backdrop baked to an offscreen canvas, re-baked only when the plan changes.
- Seat geometry with the corrected 1.6 U chair offset (§2.3).

**Accepted when:** a 21-session project renders three benches in one grown room with no overflow
marker; re-baking a 12-project floor takes < 400 ms; the plan does not read as a uniform grid;
zero per-frame cost is demonstrated by profiling with all characters removed.

---

### WP7 — Character rig and motion clips · R3 · 5 days · after WP6

The largest and highest-risk package. Budget accordingly.

**Scope**
- Procedural rig driven by `Pose` (§3).
- All work clips and all lounge clips (§4).
- LOD bands (§1.1), including finger motion at L2.
- Walk with path following.
- Lounge activity rotation with pairing (§4.3).
- Animation stops entirely when the tab is hidden.

**Accepted when:** every clip in §4 is implemented and visually distinguishable at L1; a paired
clip degrades gracefully to a solo clip when no partner is free; 25 animated characters hold 60 fps
on the reference ARM64 Windows machine; `prefers-reduced-motion` yields static representative poses
with the floor still fully legible.

---

### WP8 — Scene, zoom and hit-testing · R3 · 2.5 days · after WP7

**Scope**
- Frame loop, LOD selection, painter ordering.
- Zoom 0.35–2.5: slider, modifier + wheel about the cursor, keys, fit-to-window default.
- Pan by drag; hit-testing correct at every zoom and pan offset.
- State icons and waiting badges (§5, §7).

**Accepted when:** clicking a character selects that character at zoom 0.35, 1.0 and 2.5, and after
panning; fit-to-window shows the whole floor on a 1920×1080 display with 12 projects.

---

### WP9 — Interface shell and session panel · R4 · 4 days · after WP4

**Scope**
- Header: needs-you total with three-way breakdown, at-desk, benched, zoom, hook status.
- Side panel: state chip, facts, real conversation, L2 animated close-up, actions, composer.
- All six actions wired (§5.1), with optimistic update and rollback on failure.
- Send flow, including the confirmation when the target session is live.
- Keyboard map (§8). Loading skeletons. Teaching empty state.

**Accepted when:** every action round-trips and the floor reflects it within 250 ms; `J`/`K`/`A`/`B`
drive the whole queue without a mouse; a failed send restores the composer content and shows a
clear error; **no passive interaction anywhere clears `reviewSince`**.

---

### WP10 — Notifications · R4 · 1.5 days · after WP9

Per `03-VISUAL-SPEC.md` §9: permission requested from a visible button, fire on state *entry* only,
coalesced at one per 10 s, click focuses and selects, tab title always carries the count.

**Accepted when:** entering `needs_input` with the tab hidden produces exactly one notification;
a refresh with no state change produces none; denied permission degrades to the tab badge with no
console errors.

---

### WP11 — Onboarding and documentation · R6 · 2 days · after WP9

**Scope**
- First run: a ≤ 60 second explanation of the six states and the invariant, dismissible, never
  shown again.
- The hook consent screen copy.
- `README.md`: install, the model, what is read from disk, the privacy position, limitations.
- Honest limits: cost is an estimate not a bill; without hooks state is inferred; local only.

**Accepted when:** someone who has never seen the product can explain, after onboarding, why an
agent stands in the office versus raising a hand at its desk.

---

### WP12 — Hardening and acceptance · R5 · 3 days · after all

**Scope**
- Cross-platform runs on Windows, macOS, Linux.
- Performance measured against every budget in `02-ARCHITECTURE.md` §8.
- Adversarial: no sessions at all; 300 sessions; corrupt transcripts; runtime CLI absent;
  daemon killed mid-write; permission denied on the settings file; clock skew.
- Accessibility: keyboard-only pass, contrast audit, reduced-motion pass, screen-reader pass.
- The acceptance script in §4.

**Accepted when:** every budget is met and documented with numbers, and the §4 script passes end
to end on all three platforms.

---

### WP13 — Layout rework · R3 · 3 days · after WP12

Specified in full in `05-LAYOUT-REWORK.md`. Furniture sizes rooms; a squarified treemap packs
rooms into the screen's aspect ratio; every prop declares an anchor; zoom becomes magnification
only. Replaces `03-VISUAL-SPEC.md` §2.

**Accepted when:** the nine criteria in `05-LAYOUT-REWORK.md` §3 pass, including the objective
form of "nothing floats" — no prop further than 2.0 U from its wall or its attachment, asserted
over the whole plan in a unit test.

## 3. Sequencing

```
WP0 ─┬─ WP1 ── WP2 ─────────────┐
     │                          │
     ├─ WP3 ── WP4 ─┬─ WP5 ─────┤
     │              └─ WP9 ── WP10 ──┐
     └─ WP6 ── WP7 ── WP8 ───────────┴─ WP11 ── WP12
```

**Critical path:** WP0 → WP6 → WP7 → WP8 → WP11 → WP12 → WP13. WP7 is the long pole; start it the moment
WP6 is accepted and do not let it slip behind adapter work.

**Parallelism:** R1 (adapters), R2 (daemon) and R3 (renderer) work concurrently after WP0. R4
joins at WP4. Integration happens at WP9.

**Estimate:** ~35 person-days. With three engineers in parallel, roughly **4 calendar weeks** to
WP12.

## 4. Acceptance script

Run on each platform. Every step must pass. No step may be marked "works with a caveat".

1. `npx deckhq` on a machine with ≥ 20 real sessions across ≥ 5 projects. Floor renders
   within 3 s.
2. Every session on disk appears on the floor or under "Show let go". **Count them; zero may be
   missing.**
3. Sessions carry their chat titles.
4. A project with > 8 sessions shows multiple benches in one grown room.
5. Start a live session in a terminal. Within 5 s it appears at its project desk and types.
6. Trigger a permission prompt. The agent **raises its hand at its desk** and does not move.
7. Let a turn finish. The agent **walks to the office** and waits with a time badge.
8. Open its conversation. Read it. Close the panel. **It is still waiting.** ← the invariant
9. Acknowledge it. It walks back to its desk.
10. Bench it. It walks to the lounge and begins an activity. Watch a rotation to a second activity.
11. Recall it. It returns to its project desk.
12. Send it a message from the panel. The turn runs and the conversation updates.
13. Hide the tab. Trigger a state entry. One notification arrives; the tab title shows the count.
14. Zoom to 2.5. Typing hands are visible. Zoom to fit. State icons are readable.
15. Install hooks via the consent screen; confirm exact state. Remove them; confirm the settings
    file is byte-identical to its pre-install content.
16. Kill the daemon mid-write; restart; ack state survives.
17. Enable reduced motion. The floor is fully legible and every state distinguishable.
18. Keyboard only: traverse the queue and acknowledge, bench and recall an agent.
19. Leave it open for 4 hours. CPU below budget, no fan noise, no memory growth.

## 5. Definition of done

A work package is done when: acceptance criteria pass, tests are committed and green in CI on all
three platforms, the code has been reviewed by someone other than its author, and any deviation
from the specification is documented in the PR with its reason.

## 6. Rules for the delivery team

1. **The invariant in `01-PRODUCT.md` §2 is inviolable.** Any change that lets an observed event
   clear a user-owned state is rejected regardless of how convenient it is.
2. **No new dependencies without orchestrator approval.** This ships as a small, auditable,
   zero-egress tool.
3. **No network calls.** No analytics, no update checks, no crash reporting.
4. **All runtime format parsing stays inside its adapter.** If parsing logic appears outside
   `src/adapters/`, the PR is rejected.
5. **Capture beats features.** If a choice is between another feature and guaranteeing that every
   session is captured, capture wins every time.
6. **Do not add skins.** Studio only.
7. **Cost is never presented as money owed.** It is a list-price estimate for comparing projects
   and must be labelled as such wherever it appears.
