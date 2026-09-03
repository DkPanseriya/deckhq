# DeckHQ — Deviations from the specification

`04-BUILD-PLAN.md` §5 requires every deviation from the blueprint to be documented with its
reason. This is that record. Nothing here was decided silently.

Items marked **RAISE** are genuine gaps in the specification rather than implementation choices.
They were shipped with a defensible default because leaving them unhandled would have produced a
visibly wrong product, but they are the orchestrator's call to confirm or overturn.

---

## 1. `ended` has no row in the visual spec — **RAISE**

**Spec:** `02-ARCHITECTURE.md` §3 defines `ActivityState` as including `ended`.
`03-VISUAL-SPEC.md` §5 maps six states to colours, clips and icons. `ended` is not one of them.

**Why it matters:** placement (`§3.1`) sends an `ended` session to its **project desk** — a
session that is not running still sits at its desk, and only an explicit bench moves it. So
`ended` agents are on screen. On the reference machine they are the **commonest state by far**:
40 of 51 sessions at first run.

With no row of its own, `ended` fell through to the `working` default: 40 dead sessions rendered
in the working green, playing the `type` clip. The floor said *forty agents are producing output
right now*. That is the most misleading thing this product could show.

**Shipped:** `ended` gets its own colour `#6E6A63` (warm dark grey, 3.9:1 against the carpet,
distinct from both the benched slate and the let-go grey) and the `slump` clip — seated, still,
low energy. No icon, matching `working`; the still pose plus the colour carry the distinction.
Guarded by `test/unit/state-visuals.test.mjs`.

**Decision needed:** confirm the colour and pose, or specify a different treatment.

## 2. Hook tag is `_deckhq`, not `_agentOffice`

**Spec:** `02-ARCHITECTURE.md` §6 says hook entries are tagged `"_agentOffice": true`.

**Shipped:** `"_deckhq": true`.

**Reason:** `_agentOffice` is the product's former name; the rest of the blueprint is DeckHQ
throughout. The tag is only ever written and read by this codebase, so the name is internal. Only
one adapter writes hooks, so there is no cross-adapter mismatch. Changing it later would orphan
any block already installed under the old tag — worth deciding now rather than after release.

## 3. `for_review` is sticky through session death — **RAISE**

**Spec conflict:** `01-PRODUCT.md` §2 (and `04-BUILD-PLAN.md` rule 1) make the invariant
inviolable: no observed event may remove an item from the waiting area. But `02-ARCHITECTURE.md`
§4.1 tables `SessionEnd` → `activityState = ended` and `SessionStart` → `activityState = working`
unconditionally, and §4.2 does the same on the polling path when a session stops being live.

Read literally, a session that finished its turn, walked to your office, and then exited would
walk straight back out — which is exactly the failure this product exists to fix.

**Shipped:** the invariant wins. `SessionEnd`, `SessionStart` and a poll-detected loss of liveness
flip `live` and leave `for_review` and `reviewSince` untouched. Covered by the named test
`INVARIANT: no observed event can clear reviewSince`.

**Decision needed:** confirm that §4.1's table is subordinate to §2 here, or restate §4.1.

## 4. `UserPromptSubmit` clears `reviewSince` — as specified

Kept exactly as `02-ARCHITECTURE.md` §4.1 tables it. This is the one event that clears the
waiting state without a button press, and it is defensible: it represents the user personally
submitting a turn to that session, which is a user action observed indirectly rather than runtime
drift. It is the single documented exception to the blanket invariant test.

**Extension:** on the degraded (no-hooks) path the same clearing happens when a transcript's last
turn flips from assistant to user, which is the only signal available there that the user replied.
Without it a stale `reviewSince` would outlive the reply that answered it.

**Observed in practice:** replying to a session in a terminal removes it from the waiting area
within one poll. This is intended, but it is the one behaviour a reader of §2 alone would not
predict.

## 5. Waiting badges are suppressed at L0, and never leave the office

**Spec:** §7 says the waiting badge is shown for `for_review` agents. §1.1 describes L0 as body,
state colour and state icon only.

**Shipped:** the badge draws at L1 and above, and only when `ackState === 'active'`.

**Reasons:** at fit-to-window zoom, nine badges across a waiting area overlap into an unreadable
smear; the office room plate already carries the count (`9 waiting`), and §1.1 does not list
badges among L0's elements. Separately, `bench` changes only `ackState`, so a benched agent keeps
`activityState === 'for_review'` — without the guard its crimson badge followed it into the
lounge, putting the reserved accent on the floor where nothing was waiting on the user. §5's
colour discipline is explicit that crimson means *standing in your office*.

## 6. Camera clamping and re-fit

Not in the spec. `fitToWindow` re-runs on any viewport change until the user first zooms or pans,
and the camera is clamped so at least a quarter of the viewport always contains floor.

**Reason:** without the first, the initial fit runs against the canvas's default box and the floor
lands in a corner. Without the second, zooming about a cursor that sits off the floor carries the
whole plan off screen and leaves the user on a black canvas with no indication that Fit would
rescue them.

## 7. Token totals on very large transcripts are approximate

**Spec:** §8 caps reads at 2 MB per session. §3 defines `tokens` as input + output.

**Consequence:** a 74 MB transcript's full history cannot be summed within that budget, so usage
is summed over the bounded window only. This is stated in the README's "Honest limits" rather
than presented as an exact figure. `scanSessions` also sorts by parsed `lastActivityAt` rather
than file mtime, because mtimes on the reference machine are disturbed by unrelated tooling and
were wrong by up to 54 days.

## 8. Codex support is implemented but unverified

Codex is not installed on the reference machine (`~/.codex` does not exist). The adapter is a
real implementation written against the documented rollout-file conventions, with every field
extraction trying several key aliases, but **no part of it has run against real Codex data**.
`available()` returns `false` cleanly and every other method degrades without throwing. Its hooks
report `supported: false`, so Codex sessions use the polling path and cannot distinguish
`needs_input` from `stalled` — surfaced in the header.

## 9. Unverified paths

Honest inventory of what was not exercised on this machine:

- ~~`send()` for either runtime.~~ **Closed, 2 Sep 2026.** Exercised against a throwaway session
  created for the purpose: `claude --resume <id> -p <text> --output-format json` returns the same
  `session_id` it was given and appends both turns to the same transcript file. It does not fork a
  new session — which, had it done so, would have put a duplicate agent on the floor for every
  reply sent from the panel. Codex's `send()` remains unexercised along with the rest of that
  adapter.
- `openInTerminal()` on macOS and Linux (Windows-only machine).
- Hook install/remove against the user's real `settings.json`. It was verified against fake
  settings files in isolated processes: fresh install, no-op on double install, byte-identical
  restore, survival of unrelated hand edits, and a clean abort on malformed JSON.
- `prefers-reduced-motion` was verified by unit test and code review, not by a browser with the
  setting enabled.

## 10. Additions to `Pose` beyond `03-VISUAL-SPEC.md` §3

`ring`, `ringPhase`, `fingerPhase`, `thoughtPhase` and `speechPhase` were added. The rig receives
only a sampled `Pose` — no clock and no clip name — so every time-varying decoration must ride in
the pose. `ring`/`ringPhase` (the hand-raise pulse) and `fingerPhase` (L2 finger taps) are
required by §4.1; the other two make `think`'s thought dots and `chat`'s speech dots renderable,
without which those clips are not distinguishable at L1 as §4 requires.

## 11. Performance: measured numbers, and the one budget that is tight

`02-ARCHITECTURE.md` §8 sets the budgets. Measured on the reference machine (Windows 11, ARM64,
51 real sessions across 16 projects, one transcript at 74 MB):

| Budget | Limit | Measured |
|---|---|---|
| Idle CPU, tab visible | < 2% of one core | **1.9%** (1.67 s CPU per 90 s idle) |
| Daemon memory | < 150 MB | **71.5 MB** steady state |
| Backdrop re-bake, 12 projects | < 400 ms | **187 ms** |
| Frame budget, 25 characters at L2 | 16 ms | **1.9 ms** |
| Scan of 200 sessions | < 1500 ms | **~1.3–1.7 s for 51 sessions** — see below |

**The scan budget is not met, and this is a real deviation.** A cold scan of 51 sessions takes
1.3–1.7 s, so 200 sessions would take considerably longer than 1500 ms. The cost is CPU-bound
JSON parsing of the ~100 MB that a full 2 MB tail window across 51 transcripts amounts to, not
disk: raising read concurrency from 8 to 16 bought no wall-clock time and did raise peak memory,
so it was reverted.

Two fixes were tried and rejected:

- **A tiered tail read** (384 KB first, escalating to 2 MB only when incomplete) cut the cold scan
  to ~600 ms — but it undersampled precisely the largest sessions, dropping `career-ops` from
  2.64M to 0.93M tokens. That inverts the per-project comparison token accounting exists to
  answer (`01-PRODUCT.md` F9), so accuracy won over speed.
- **Higher read concurrency**, as above.

What *was* fixed is the far more serious problem this measurement exposed: the daemon re-read and
re-parsed every transcript on **every 5-second poll**, costing roughly 100 MB of I/O and parsing
every five seconds, and sustaining **~20% of one core and 229 MB RSS** — ten times the CPU budget,
forever. A summary cache keyed by file path and invalidated by `(mtime, size)` reduced warm scans
from ~1700 ms to **3–5 ms**, which is what brought idle CPU inside budget. Almost every session on
disk is finished and can never change again; only the live handful are re-read.

The remaining cold scan happens **once per daemon start**, and the daemon is designed to run all
day and outlive the browser tab. A persistent on-disk summary cache would remove even that, and is
the obvious next step if the session count on a real machine grows toward 200.


---

# Tech lead decisions — 30 Aug 2026

Every **RAISE** above is now closed. Where a decision changed a specification document, that
document has been amended in place and dated, so the specs remain the single source of truth.

**§1 `ended` has no visual row — APPROVED as shipped.** This was a gap in my specification, and
catching it mattered: 41 of 52 sessions on the reference machine are `ended`, so the default
inheritance would have rendered a dozen dead sessions as green typing agents. A monitoring surface
that reports work happening where none is is the worst failure available to this product. The
colour and pose are now canonical in `03-VISUAL-SPEC.md` §5.

Placement is deliberately unchanged: an `ended` session stays at its project desk. Sessions leave
a desk only by user action, and first-run seeding already sends anything older than 14 days to
`let_go`, which bounds the visible dead population.

**§2 Hook tag `_deckhq` — APPROVED.** The spec predates the rename. `02-ARCHITECTURE.md` §6 now
says `_deckhq`.

**§3 `for_review` sticky through session death — APPROVED. The specification was wrong, not the
code.** §4.1's table was written as a flat mapping and I failed to carve out the invariant, which
made two of my own documents contradict each other. The team resolved it the only defensible way.
§4.1 now carries a dated amendment making it explicitly subordinate to §2.

**§4 `UserPromptSubmit` — APPROVED, and verified deeper than reported.** The risk the note does
not name is that Claude Code records tool results as user-role turns, so the degraded path could
have discharged a debt on a tool result rather than a reply. It does not: `lastRole` flips only on
a non-empty *text* block, and sidechain traffic is excluded. That guard is load-bearing and is now
named in the §4.1 amendment so it survives future edits.

**§5 Badge suppression — APPROVED.** Correctly derived from §5's colour discipline: crimson means
*standing in your office*, so a benched agent must not carry it into the lounge.

**§6, §7 — APPROVED**, no spec change needed.

**§8 Codex unverified — BLOCKING for any release claiming Codex.** The adapter may stay. The
*claim* may not: `package.json` and the README asserted Claude Code and Codex support that cannot
be demonstrated. Both have been corrected today to describe Codex as included but unverified.
Before any public release, either exercise the adapter against a real Codex install and run the
acceptance script against it, or ship as a Claude Code tool. Do not restore the two-runtime claim
on the strength of code review alone.

**§11 Scan budget — the budget was wrong, not the implementation.** My `< 1500 ms for 200
sessions` conflated two different things. A cold scan happens once per daemon start and the daemon
is designed to outlive the browser tab; a warm scan happens every poll and is what actually
governs idle cost. §8 now sets cold < 5000 ms and warm < 50 ms, both of which are met with room
(measured warm: 3–5 ms; observed API latency ~1 ms).

Rejecting the tiered-read optimisation was the right call. It bought 700 ms by undersampling the
largest sessions, which inverted the per-project token comparison that F9 exists to answer — a
correctness regression traded for speed nobody asked for. The persistent on-disk summary cache
remains the correct follow-up and is **not** a v1 blocker.

## Findings from review, not previously reported

1. **Name labels collide with desk furniture at L1** and are truncated mid-word, so at the zoom
   where the office is meant to be readable, the one thing identifying each agent is the hardest
   thing to read. Polish defect; fix before release.
2. **The lounge does not shrink when empty.** With zero benched agents it still occupies a large
   share of the floor — most visible on first run, which is exactly when a new user forms their
   impression. §2.1 specifies a minimum size and growth but no contraction; give it a compact
   empty state.

Neither blocks the acceptance script. Both are visible in the first thirty seconds of using the
product, which is the wrong place to leave rough edges.

---

# WP13 — layout rework

## 12. The floor aspect clamp had to widen — **RAISE**

**Spec conflict.** `05-LAYOUT-REWORK.md` §2.2 sets
`targetAspect = clamp(viewportWidth / viewportHeight, 1.60, 1.78)`. §3.1 requires that at every
viewport from 1280×720 to 2560×1440 the floor **exactly fills** the stage, with "no letterbox band
wider than 8 px", and calls that "the acceptance test, not an aspiration".

These cannot both hold. Once the header is subtracted, those viewports give stage aspects of
roughly **1.85 – 1.93**, all above 1.78. Measured with the spec's clamp in place, four of the five
sizes letterboxed by **100 – 115 px**; only 1440×900 filled.

**Shipped:** the clamp is widened to `[1.20, 2.20]`. Measured after the change: letterbox is
**0 px on both axes at all five viewport sizes**, and floor aspect matches the stage exactly.

**Why this is the safe half of the conflict to give up.** The narrow clamp exists so rooms do not
become corridors — but room proportions are protected separately and independently by the
`[0.6, 1.8]` room-aspect clamp in §2.2, which is enforced during the re-flow pass and verified in
the tests. A wider *floor* cannot turn a *room* into a corridor. Giving up §3.1 instead would have
left the headline defect of the whole rework — a letterboxed floor in a black field — unfixed.

**Decision needed:** confirm the widened range, or restate §3.1's tolerance.

## 13. LOD had to be rebased on effective scale, not the zoom multiplier

§2.4 redefines zoom 1.0 as fit-to-viewport, so the user-facing zoom is now a **multiplier on a fit
scale** rather than an absolute world-to-pixel ratio. `03-VISUAL-SPEC.md` §1.1's LOD bands
(`< 0.7` → L0, `0.7–1.4` → L1, `> 1.4` → L2) were written against the old absolute ratio.

Left unchanged, the bands would have read the multiplier: L0 would have become **unreachable on
any floor**, and a large floor would have been pinned at L1 no matter how far out it was. The
Scene now derives the band from the effective pixels-per-unit, which restores exactly the
behaviour §1.1 describes.

## 14. Waiting badges are gated on fit, not on a LOD band

Deviation §5 suppressed badges at L0. Since L0 is no longer reachable by zooming out, that gate no
longer did anything, and a full waiting area again rendered a dozen overlapping crimson pills.

Badges now appear only when there is physically room for one: below ~14 px per unit, adjacent
badges over the 3.2 U office seat pitch cannot help but collide. The office room plate carries the
aggregate instead — `12 waiting · oldest 1d 18h` — so the *longest* wait, which is the number that
makes debt visible, is legible at a glance without any zooming at all.

## 15. Label priority is not label exemption

The review's finding 1 (labels colliding at L1) was fixed with a collision resolver in which
selected and needs-you labels were placed unconditionally, on the reasoning that important labels
should never be dropped.

That collapsed in the one case that matters most: **every agent in the waiting area is
`for_review`, so every one of them was exempt at once**, and the office rendered as an unreadable
band of overlapping names — the original defect, reproduced by its own fix.

Exactly one label is now truly exempt: the selected agent's. Needs-you labels keep first claim on
space but are still collision-checked, and are offset or dropped like any other. Measured on the
live floor with 12 waiting agents at a 68 px seat pitch: **12 of 12 labels placed, 0 overlaps.**

## 16. The prop coordinate convention was inconsistent — this was the misalignment

**The actual root cause of the floor looking wrong.** `backdrop.js`'s `paintProp` translated to
`(prop.x, prop.y)` and then drew every shape about that origin (`-w/2, -h/2`) — so it treated a
prop's `x, y` as its **centre**. WP13's anchor resolver computes **top-left** coordinates, like
every other rectangle in the layer (`Room`, `Zone`, the packer, the tests).

Every desk, chair, monitor, whiteboard and rug was therefore drawn offset by **half its own size,
up and to the left**. On a rug 22 U wide that is 11 U — which is why a sage slab appeared to float
in the corridor outside the office.

It survived a full green test suite because the tests measure top-left rects too: the geometry and
its tests agreed with each other, and only the painter disagreed with both. No assertion could see
it; only rendering the backdrop in isolation could.

**Shipped:** a `Prop` is a top-left rect, stated in its typedef, and `paintProp` translates to the
rect's centre before drawing. One convention across the whole layer.

## 17. The treemap was replaced by a bin packer — **RAISE**

§2.2 specifies a squarified treemap. Implemented, measured, replaced: a treemap and §2.1 are
structurally incompatible. A treemap assigns each room an **area** and lets the packing dictate its
shape; §2.1 says furniture dictates the shape and the room is its bounding box plus a margin.

Both ways of reconciling them were built and measured on the 16-project fixture:

| Approach | Floor that is room | Room that is furniture | Verdict |
|---|---|---|---|
| Room centred in its tile | 60% | 100% | Surplus becomes a **halo** around every room — the scattered-on-a-field defect, moved from props to rooms |
| Room fills its tile | 78% | 31–75% | Surplus moves **inside the walls** — the empty middles §2.1 exists to abolish |
| **Shelf packing (shipped)** | **~58%** | **100%** | Rooms are exactly their furniture; all slack is corridor |

Rooms are now packed in height order (a shelf is as tall as its tallest member, so mixing a 22 U
room with 12 U ones wastes the difference under every short room), the packing is chosen to
minimise wasted floor rather than aspect error, and the floor is sized to include an outer corridor
— without which a full row overflowed the floor edge.

**Decision needed:** confirm the packer change, or restate §2.2 in terms of the outcome it wants
rather than the algorithm.

## 18. Room proportion is now decided where shape is actually determined

With rooms at their natural size, a room's aspect is a pure consequence of how its benches are
flowed. `bestBenchColumns` therefore picks the column count that lands closest to square while
refusing any arrangement outside `[0.6, 1.8]`, which makes legality structural instead of something
a later repair pass has to fix. Verified for **every session count from 1 to 60**: all room aspects
legal, every session seated.

## 19. Circulation is a different material, not a different tint

Project rooms and the corridors between them were both painted the same woven carpet, so room
boundaries were invisible and the floor read as scattered furniture however well the props were
anchored. Circulation is now a poured screed — a different material, plus a hairline at the
boundary — because at fit zoom a 0.3 U partition is barely a pixel and cannot carry the distinction
on its own.

## 20. Off-floor agents had a position

`AgentRuntime.sync` gave every agent a record, falling back to the floor origin when it had neither
a seat nor a destination room. `let_go` agents have neither — so on the reference machine **29 of
them were stacked at (0, 0)**, a smear of bodies and labels in the top-left corner of the floor.
An off-floor agent now gets no record at all.

---

# WP14 — continuous floor plan

The user replaced the model: one continuous office floor, partially divided by
walls, instead of discrete rooms laid out on a field. `05-LAYOUT-REWORK.md` §2
is superseded in turn.

## 21. Zones tile the envelope; walls belong to the floor

The floor is a single building envelope subdivided into zones that **tile it
exactly** and share their boundaries. Measured: zone coverage is **100.0%** of
the envelope — there is no leftover floor, because leftover floor is what the
previous two models kept producing in different places.

Walls are derived from shared zone edges rather than drawn per room, so a
partition between two zones is **one** wall, not two outlines back to back.
Exterior edges become exterior walls, the user's office keeps solid walls with
a door, and everything else is a waist-height partition.

## 22. Furniture follows headcount, and tables come in sizes

A project's furniture is now derived from its team, not from a fixed bench
formula. Tables seat 2, 4, 6 or 8; a project that outgrows eight gains a
**second table** rather than a longer one, as a real office would:

`1 → [2]`, `3 → [4]`, `5 → [6]`, `9 → [8, 2]`, `12 → [8, 4]`, `21 → [8, 8, 6]`.

The zone grows to hold the tables, and the floor re-tiles. Adding a project
adds a zone; there is no fixed room count anywhere.

## 23. The anchor hierarchy is now literal

    floor
      walls        on zone boundaries
      tables       anchored in their zone
        chairs     anchored to their table edge
          agents   seated on their chair
        plants     anchored beside their table

Plants moved from room corners to table ends, which is where they are in the
reference plan and which removes the last prop whose position was a property of
the room rather than of a piece of furniture.

## 24. Cells are tiled by row, not by area — **RAISE**

A treemap subdivides by AREA and lets each cell's shape fall out of the
packing. Measured on the 16-project fixture, that produced cells like **38 × 10
for a zone whose furniture is 5 × 5**. Nothing lays out in a cell that shape, so
the fitting loop grew the whole building instead: the floor came out **154 × 86
holding furniture that covered 12.4% of it**.

Row tiling keeps every cell near the shape its contents want. Same fixture,
after the change: floor **112 × 63**, furniture coverage **23.6%**, zones still
covering 100%. A zone whose cell is still a poor fit re-flows its tables to the
cell's proportions before the building is allowed to grow at all.

**Decision needed:** confirm row tiling as the layout rule.

## 25. Starting a new project

`POST /api/new-project { cwd }` opens a terminal running a fresh session in an
existing directory, via a new `openNewSession` adapter method. A project **is**
its directory, so there is nothing else for the daemon to create — the room
appears on the floor at the next scan. The directory must already exist;
DeckHQ will not create directories on the strength of a POST body.

## 26. The rig was drawn a quarter-turn out of true

The user's report: *"the characters have hands on one side and head on other
side, looks like hands are on backside."*

`rig.js` authors its body parts in a local frame where forward is local `-y`,
then rotated every part by `pose.bodyAngle` directly. But `bodyAngle` is
specified with **0 facing +x**, the same convention `plan.js` uses for
`Seat.angle`. The two are a quarter-turn apart, and because the wrong rotation
was applied uniformly, nothing looked obviously broken — it just looked wrong.

Proved geometrically rather than by eye: rendering real poses through a
transform-tracking fake context, the dot product of the head's displacement
with the true facing vector came out **exactly 0** for every clip at every
angle — the head was displaced along the character's *side* axis. The hands,
whose variation is mostly lateral, ended up spread along the *forward/back*
axis. Against a desk that reads precisely as a head turned sideways and arms
coming out of the back.

Fixed by composing one `facingRot = bodyAngle + π/2` and threading it through
every part. A second, smaller defect surfaced while verifying: in the `type`
clip — the commonest state on the floor — the reaching hand landed about 0.01
local units on the correct side of centre, a coin flip once floating point is
involved. The shoulder offset now leaves real margin.

`test/unit/rig-orientation.test.mjs` asserts head-forward and hand-forward
across four facings and five phases of four clips. It was proved load-bearing
by reverting the fix and confirming 4 of its 5 tests fail.

## 27. Zoom removed

The user removed the feature. The floor is always fit-to-window: no slider, no
`+`/`−`/Fit, no `Ctrl`+wheel, no drag-to-pan, and the persisted `zoom` setting
is no longer read or written. `03-VISUAL-SPEC.md` §1's zoom range and
`05-LAYOUT-REWORK.md` §2.4 are both superseded.

LOD bands survive and still key off effective pixels-per-unit, which is now
simply the fit scale — so the close-up detail in `03-VISUAL-SPEC.md` §1.1 is
reachable on a small floor and not on a large one, rather than being something
the user dials in.

Removing drag-to-pan moved the pointer handlers from the window onto the
canvas, which would have left the hover tooltip stuck after the cursor left the
floor; a `pointerleave` handler clears it.

---

# WP15 — identity, launchers, and a security fix

## 28. Cross-site request forgery — **found while adding script execution**

Binding `127.0.0.1` keeps the network out. It does **not** keep other web pages
out: any site the user visits can POST to loopback, and the browser sets a
correct `Host` header on that request, so the loopback check in `daemon.mjs`
waved it through.

That was already exploitable before this work — a page in another tab could
spawn a terminal via `/api/open` or inject a prompt into a live session via
`/api/send`. Adding "run this project's `dashboard.bat`" would have made it
critical.

Mutating requests now require an `Origin` that is loopback, and reject
`Sec-Fetch-Site: cross-site`. GETs are unaffected. Covered by two named
`SECURITY:` tests in the daemon integration suite.

`02-ARCHITECTURE.md` §9 says no authentication is required "precisely because
it is not reachable from the network". That reasoning is incomplete and the
document should say so: loopback protects against remote attackers, not
against the user's own browser.

## 29. Identity: MK tags

Session titles are the user's own sentences — too long for a floor plan and
different every time. Every agent now carries `MK<project>.<agent>`, assigned
on first sight and **persisted**, so a tag never comes to mean something else.
A number is not reused after an agent is let go: a gap in the sequence is
better than `MK3.2` meaning a different session next week. A user-chosen short
name replaces the tag on the floor; the tag stays in the hover card.

Guarded by `test/unit/identity.test.mjs`, including stability across a daemon
restart and non-reuse after removal.

## 30. Per-project appearance vs. the colour discipline — **RAISE**

The user asked for per-project colour so agents are recognisable without
reading. `03-VISUAL-SPEC.md` §3 makes body colour the STATE colour precisely so
state stays readable, and §5 reserves crimson for `for_review`.

Resolved by splitting the channels rather than overriding one: the torso keeps
the state colour, and project identity rides on hair, a clothing accent and an
avatar glyph. A test asserts no project accent is near crimson, so the reserved
accent cannot leak into decoration.

**Decision needed:** confirm the split, or say that per-project colour should
win over state colour on the body.

## 31. Furniture is a verb

The floor is a spatial launcher: a shelf opens the project's folder, a screen
runs its dashboard. Rather than hardcoding those two, projects declare actions
in an optional `.deckhq.json`, with conventional filenames auto-detected. On
the reference machine three real projects were found to have a `dashboard.bat`
with no configuration at all.

Execution safety, since this runs code:

- The browser sends an **action id**, never a command. The daemon resolves what
  that id means for that project.
- Every runnable action resolves to a file that already exists **inside** the
  project directory — the same trust the user extends by keeping it in their
  repo.
- Paths that escape the project are **refused, not clamped**; likewise `file:`
  and `javascript:` URLs. Ten tests in `test/unit/actions.test.mjs` cover the
  refusals specifically.

## 32. A central corridor

The floor now lays out a full-height spine between the office/lounge side and
the working floor, plus a corridor between each row of project rooms, so an
agent can reach the lounge or the user's office without crossing another team's
room. The walk router treats corridors as walkable rather than as obstacles.

Corridors are sized by the plan, not by contents. Omitting them from the
zone-fitting check was not optional: counting a corridor as "does not fit" grew
the building by 2.3x on **every** iteration, compounding to a floor eight times
larger than its furniture needed.

---

# WP16 — confinement, reception, lounge

## 33. Agents were escaping the building — **the router had no idea where the walls were**

Reported: agents left the manager's office in an arbitrary direction, walked
off screen, and reappeared on the far side.

Cause: `planWalk` did generic obstacle avoidance, and when a direct line was
blocked its last-resort fallback swept **around the bounding box of the
obstacles**. That box's edges lie outside the building, so leaving the floor
was a legal route in a model that contained no walls at all.

Replaced with a real navigation graph. `plan.js` now publishes `plan.nav`:
corridor centrelines, plus a `door` and a `navEntry` on every room. An agent
leaves by its own door, joins the corridor that door opens onto, travels the
network, and enters the destination the same way. A cross corridor's centreline
is deliberately extended left to meet the spine's, so the graph is connected —
the overlap lies inside the spine, which is walkable floor.

Every waypoint is additionally clamped to the floor rectangle, so even a bug in
the graph cannot put an agent outside the building.

Guarded by `WALK CONFINEMENT: a route never leaves the building and never
crosses a wall`, which routes between five room pairs and asserts no waypoint
leaves the floor and no segment midpoint lands inside a third room.

## 34. The reception is seated around the walls, and only one chair faces the desk

Two rules, both from how an office actually works:

- **Seating hugs the walls.** Runs on the west, south and east walls leave the
  middle of the room clear. The previous C-shaped group floated in the centre
  and read as cramped, because the only circulation left was the gap between
  the furniture and the wall.
- **Nobody sits across from the manager except the person being seen.** There
  is exactly one guest chair at the desk and it belongs to the front of the
  queue. Everyone else waits on the wall seating; loose chairs appear only when
  the room is genuinely full (past 19).

## 35. A sofa's rectangle is what says how it lies

The horizontal run in the reception rendered upright. `paintProp` rotates by
`angle`, but the sofa painter lays its cushions along `w` — so a correctly
horizontal `13 x 2.6` sofa, rotated by a further `-PI/2`, came out vertical and
across its own footprint.

The painter now reads the rect: wider than deep is horizontal, deeper than wide
is vertical, and it draws in a quarter-turned frame for the latter. `angle` is
left to mean which way the sofa faces, which is what it means everywhere else.
This matters beyond sofas — the layout rect is used for bounds and anchors, so
any prop whose `angle` disagreed with its rect would be mispositioned as well
as mis-drawn.

## 36. The lounge reads as a rest area within a second

Furnished whether or not anyone is in it — 23 props when empty (TV, sofas,
round rug, coffee table, bar counter and stools, coffee machine, fridge, fruit
bowls, bookshelf, plants, lamps) — growing to 30 as games appear with the
benched population: dining at 1, pool at 3, table tennis at 5, foosball at 7,
board games at 9, arcade at 11.

Also fixed: `coffee_table` had no painter and had been rendering as a grey box
since the lounge was first built.

## 37. Seats are derived from resolved furniture, not from the layout frame

Reported: the reception sofas were against the walls, but agents sat on the
floor beside them.

The sofas are **wall-anchored**, so their real coordinates are not known until
the room has been sized, tiled and had its anchors resolved. Seats were being
computed in the pre-anchor layout frame, so they described where the sofas had
been *before* anchoring. Two frames, one of them stale.

`buildOffice` now decides only how many people the room can seat (and lays out
loose chairs for any overflow); `seatOffice` runs after `resolveAnchors` and
derives every seat from the furniture's final position. Guarded by a test that
asserts every waiting agent, at 1, 5, 14 and 25, is within tolerance of an
actual sofa or chair rect.

This is the same failure as the sofa rotation and the upright monitor, in a
third guise: **two representations of the same thing, allowed to disagree.**

## 38. A prop's rect is how it lies; `angle` is only which way it faces

The desk monitors rendered on end. `w: 1.6, h: 0.5` already describes a wide,
shallow screen lying across the table edge — rotating it by the occupant's
facing on top of that stood it upright and across its own footprint.

Because the rect drives bounds, anchors and hit-testing as well as drawing,
any prop whose `angle` disagrees with its rect is mispositioned, not merely
mis-drawn. Asserted now for monitors, and the sofa painter reads its rect the
same way.

## 39. Walking speed

Raised from 4.5 to 13 units per second. Routes now go door to corridor to
door instead of cutting across the floor, so the same journey covers
considerably more ground; at the old speed a trip to the lounge read as an
agent stuck rather than walking.

## 40. The thinking cue is a cloud, not three dots

Three dots in a row read as "loading". A lobed thought cloud with a rising
trail of bubbles, in the comic-strip idiom, reads as thinking at a glance —
which is the only reason the `working` state has a visible thinking pose.

## 41. `for_review` needs an ended turn, not "the assistant spoke last"

Reported: an agent that had just started running walked to the manager's
office instead of its desk.

On the degraded/poll path the test was `lastRole === 'assistant'`. That is
true for the *whole* of a running tool call. An assistant turn that calls a
tool narrates first ("Let me check X") and emits the `tool_use` in the same
turn; the `tool_result` comes back as a `user` record carrying no text block,
and `contentToText` reads only `text` blocks — so the narration stays the last
text in the file until the tool returns. Measured against live transcripts,
two of eight recent sessions were being classed `for_review` while busy, one
of them this very session.

Asking "is a tool open" was not enough either: between a `tool_result` and the
next assistant message no call is outstanding, yet the model is generating.

The parser now reports `turnEnded`, read from the last real record in the
tail:

  - assistant, `stop_reason: "end_turn"`  -> the turn ended. Up for review.
  - assistant, `stop_reason: "tool_use"`  -> still working.
  - a `user` record (tool result or prompt) -> the model is generating.

`stop_reason` is the primary signal because a logical assistant turn is
written as SEVERAL JSONL lines, one per content block. The text block lands
before its `tool_use` block, so for an instant the newest line looks like a
finished turn — but every line of that turn already carries
`stop_reason: "tool_use"`, which closes the window. Verified on this machine:
158 `"tool_use"` against 20 `"end_turn"`.

## 42. The hook path was left alone, deliberately

The same staleness is reachable with hooks installed: `Stop` fires when a turn
ends, nothing fires when the session starts working again inside one turn, and
`UserPromptSubmit` does not fire for a message steered into a running turn. So
a session can sit in the review queue while demonstrably busy.

Reconciling that branch against the transcript was implemented and then
**reverted**. It let an observed signal walk an item out of the review queue,
which is the exact failure docs/01-PRODUCT.md §2 exists to prevent, and it
broke seven tests that encode that contract. Hooks are documented as the
authoritative path; the observed merge does not get to overrule them.

The stale state seen in practice came from hooks being installed part-way
through a session, so no `UserPromptSubmit` had fired for the turn in flight.
It clears on the next prompt. If this proves to bite in normal use, the fix
belongs in the hook contract — an event that means "this session is generating
again" — not in the observed merge second-guessing it.

## 43. Nobody stands on the furniture they are using

14 of 23 lounge spots put the agent inside the footprint of the table it was
supposedly using — all four diners in the middle of the dining table, both
table-tennis players on the table, the pool player on the baize.

Same root cause as the reception seating in #37: the spots were derived from
the game's ZONE while the furniture sits inset within it, so the two described
different places. `game()` now hands the table's own rect to the spot builder
and `atTable` positions each player just clear of a named edge, facing back
across it. Asserted at eight different lounge sizes, plus a facing check.

## 44. A pool table has to look like a pool table

Reported: "one trying to play pool on oval wooden table".

The painter filled a rounded rect with the sage `boardGameFelt` and stroked a
hairline border. At play scale on a tan wood floor that reads as an ordinary
side table — there was nothing in it that said *pool*. It now has a heavy rail
frame with a lit top edge, a cloth bed in a proper billiard green, six pockets
(four corners, two at the middle of the long rails), a racked triangle and a
cue ball. Table tennis gained painted boundary lines, a doubles line down the
length, and a net across the middle with overhanging posts.

Both read their own rect to decide which way they lie, per #38.

## 45. Let-go agents have a room instead of vanishing

`placement()` mapped `let_go` to `off_floor` — no position at all. The
renderer had to delete those records outright, because falling through to the
no-seat fallback parked every one of them at the floor origin and stacked 29
archived sessions into a single illegible smear in the top-left corner.

They now go to **The Departed**: a small tiled room at the bottom of the
service column, with packing boxes that accumulate as more sessions are
archived, a bench, and an exit sign. It is deliberately reversible — the room
reads as somewhere people are leaving *from*, not somewhere they live.

The room is built only when it is occupied. An empty room labelled "The
Departed" is a hole in the floor plan, not a feature.

## 46. The app's archive drives `let_go`, and only `let_go`

The Claude Code desktop app keeps one JSON file per session under
`%APPDATA%/Claude/claude-code-sessions/`, carrying `isArchived` and —
crucially — `cliSessionId`. The app's own `sessionId` is `local_<uuid>` and is
NOT the transcript's name; the transcript is `<cliSessionId>.jsonl`. That
field is the only usable link between the two stores. Verified: 43 of 51 app
sessions join to a transcript, 14 of those archived.

**On the invariant.** Archiving a session in the app is the user acting on
that session in the first person — the same class of signal as
`UserPromptSubmit`, which the invariant already admits as its one hook
exception. It is not passive observation, so honouring it does not weaken the
rule. Recorded here because it is a judgment call, not a silent one.

The mapping is deliberately one-dimensional:

    archived             -> let_go   ("fired")
    not archived, let_go -> active   ("rehired")
    not archived, other  -> left alone

That last line is what makes it safe. A session benched in DeckHQ is not
archived in the app, and must not be dragged back to `active` on every poll.
`archived` being *undefined* — a runtime that cannot see an archive — is never
read as "not archived", or every let-go agent on such a runtime would be
rehired on the next poll. All three cases are asserted.

Two placement details: the flag is read once per scan, not per session, and it
is applied AFTER the summary cache. Archiving does not touch the transcript,
so a cached summary would otherwise hold a stale flag until the conversation
happened to change. The read itself lives in the adapter, not in core — the
registry only ever sees `summary.archived`, so nothing outside
`src/adapters/claude-code/` knows this store exists.

## 47. "Settle floor": bench every idle agent at once

A first run against a real machine inherits the whole backlog — 57 sessions
here, nearly all finished weeks ago. Walking each to the lounge by hand is not
a reasonable ask, so `POST /api/settle` (and the header button) benches every
agent that is not live.

"Idle" is defined as **not live**: the process is gone, so it is neither
working nor able to answer. Live sessions are left exactly as they are,
whatever they are doing — those are the ones the floor exists to show.
Archived sessions are skipped; the app's archive owns that dimension.

It is an explicit user action, so it goes through `act()` like any button
press and the invariant is untouched.

## 48. One frame per room — the packing loop rewritten

**Spec:** `05-LAYOUT-REWORK.md` §2.1 ("furniture defines room size — never the
reverse") and §2.3 ("every prop declares an anchor").

**What was wrong.** Both rules were implemented, and they contradicted each
other in the code. A room's furniture was laid out in local coordinates and
then **centred** inside a tiled cell that was usually much larger, while
`resolveAnchors` measured `wall` and `corner` anchors from the **room's own
edges**. Two frames, one room. Every wall-anchored prop resolved in one and
every zone- or attachment-anchored prop in the other.

Measured on the reception at a 53 x 31 cell: the desk, rug, magazine table,
side table, lamp and water cooler formed an island around x = 14..36, while the
three sofas sat at x = 0.4 and x = 50.2 and y = 28.2 — up to **15 units of bare
floor** between the seating and the rug it was supposed to surround. The wall
art hung in the corner rather than behind the desk.
`layout-anchors.test.mjs` §3.3 did not catch it because it measures a
wall-anchored prop's distance to the nearest *wall*, which was zero: the sofas
were flat against them.

**Shipped.** Every builder now lays its contents out in **its own room's
frame**, with (0, 0) at the room's top-left corner, so placing a room is one
translation and an anchor cannot disagree with the coordinates it was written
from. `buildOffice`, `buildLounge` and `buildDepartures` take a `fit` and are
**rebuilt at the size they are actually given** rather than centred inside it,
so a wide reception gets a longer sofa run and a bigger desk instead of the same
furniture with more space around it. A project room, which is the one room the
tiler may stretch, now has **no wall-anchored props at all**: the shelf and the
screen are `attached` to the first desk block, so they travel with the
furniture.

Guarded by `test/unit/floor-integrity.test.mjs`, which asserts every prop
resolves inside its room across seven populations and five aspect ratios.

## 49. The floor is packed for pixels per unit, not for aspect ratio

**Spec:** `05-LAYOUT-REWORK.md` §2.2 and §3.2 — build the floor at
`clamp(viewport aspect, ...)` and land within 0.02 of it.

**What was wrong.** Taken literally, this buys the ratio with void. The packer
derived a floor AREA from the room areas plus a fixed 22% allowance, then
divided it proportionally, so rooms were inflated to fill whatever shape the
ratio demanded. On the reference machine (15 projects, 57 sessions):

| | before | after |
|---|---|---|
| floor | 202.8 x 98.4 U | 142.2 x 69.0 U |
| furniture fill | 43% | 84% |
| project-room fill | 25-38% | 29-58% |
| px per unit at 1280x621 | 6.31 | 9.00 |
| floor taller than the stage | 117 px, unreachable | none |

A lounge-only floor was worse: 197.8 x 96 units to hold a 76 x 72 building —
seventy units of nothing, added solely to make a ratio come out.

**Shipped.** Three changes, none of which loosens a room:

1. **Arrangement first, padding second.** The row count for the project rooms
   and the width of the service column are searched together; both are choices
   about how the same furniture is arranged, so neither costs a room any
   density. Only the residual is padded, and padding is capped at
   `ASPECT_PAD_MAX` (25%) of the floor's own size.
2. **The objective is scale, not ratio.** A floor is drawn at
   `min(stageW / W, stageH / H)`, so the search minimises
   `max(W / targetAspect, H)`, ties broken on total area. Scoring aspect alone
   rates a 212 x 103 floor and a 125 x 61 floor as equally good — both are
   2.06:1 — and then draws every room in the first at half the size.
3. **Slack is circulation, never a bigger room.** Leftover width in a row, the
   strip under a room shorter than its row, and the lobby beside a service room
   narrower than its column are all emitted as corridor rectangles. The floor
   still tiles exactly: the backdrop paints a floor for every rectangle it is
   given, so a gap left implicit is a hole in the building.

`plan.test.mjs`'s aspect tests were rewritten to the new contract — the floor
moves toward the screen's shape, a wider screen always gives a wider floor
(monotonic), and the floor is never more corridor than building.

## 50. Zoom restored as magnification

**Spec:** `05-LAYOUT-REWORK.md` §2.4 — "Zoom 1.0 is redefined as exactly
fit-to-viewport... The range becomes 1.0 - 2.5... Zoom is retained rather than
removed because `03-VISUAL-SPEC.md` §1.1 requires L1 and L2 detail to be
reachable, and the animation work in WP7 is only visible there."

**What was wrong.** Zoom had been removed entirely and replaced with a
horizontal scroll of the working floor under a pinned office and lounge. Three
consequences, all measured on the reference machine:

- **The product sat permanently at L0.** At fit, px-per-unit was 6.31 — 0.45 in
  `lodForZoom`'s units, below the 0.7 L1 threshold. No name labels, no waiting
  badges, no clip animation beyond the hand-raise pulse. Every one of the
  sixteen clips in VISUAL-SPEC §4 was unreachable.
- **Vertical overflow was unreachable.** The scroll was horizontal only, so a
  floor 117 px taller than the stage lost 58 px off the top and 58 off the
  bottom with no way to see either.
- **The building was torn.** Two cameras and two clipped backdrop passes put a
  seam down a plan whose whole point is to read as one floor.

**Shipped.** One camera. `zoom` is magnification on top of the fit scale,
clamped to [1.0, 2.5]; 1.0 is exactly fit and is the minimum, so there is no
state in which the user can lose the floor. Pan is available whenever the floor
is larger than the stage — which includes zoom 1.0 on a floor held at
`MIN_SCALE` — by drag or by wheel, and is clamped on both axes so the viewport
can never leave the building. `Ctrl`/`Cmd` + wheel zooms about the cursor,
`+` / `-` step, `0` returns to fit. On resize a user at 1.0 stays exactly
fitted and a zoomed-in user keeps their magnification.

## 51. The plan is rebuilt for the population, not only for the project set

`scene.js`'s `planSignature` keyed the rebuild on the project set and each
project's session count. But the floor's geometry also depends on the
population: the lounge grows a games table at 3, 5, 7, 9 and 11 benched agents,
the departures room exists only while somebody is in it and is sized from how
many, and the waiting area lays out loose chairs once the sofas are full.

So benching the third agent did not produce a pool table, and archiving the
first session did not produce a departures room — which left every let-go agent
with no seat and no room, and `sync` parked them all at the floor's origin. The
signature now carries the waiting, benched and let-go counts.

Two further consequences of a rebuild were wrong and are now handled in
`agents.js`:

- **A rebuild snaps; it does not walk.** Every seat in a new plan is somewhere
  else, and a record's x/y describes a building that no longer exists. Comparing
  the old seat to the new one made the entire population path across the floor
  on every window resize. `AgentRuntime` now tracks which plan its records
  belong to and snaps on a change, so motion keeps meaning "this agent's state
  changed".
- **Nobody is assigned a place that is already taken.** `assignHashed` honours a
  spot's declared `capacity`, spreads multiple occupants along the furniture
  rather than stacking them on one point, tracks which PLACE on a spot is taken
  rather than only how many, and stands any genuine overflow in a ring around
  its nominal spot instead of exactly on top of it. The lounge and the
  departures room now size their standing room to their occupants, so overflow
  is the exception rather than the rule. A benched agent also only ever picks
  an activity this floor has the furniture for; before, an agent on a quiet
  floor would play pool with no table in front of it.

## 52. Chair backrests were ninety degrees out

`backdrop.js`'s `paintProp` rotates a prop by `prop.angle`, which is in the
plan's convention: 0 faces +x, east. The chair sprite is drawn "looking up the
page", so it needed the same quarter turn `rig.js` applies to the character
sitting in it (`facingRot = bodyAngle + PI/2`, documented in that file's FACING
CONVENTION comment). It did not get one, so every chair on the floor had its
back ninety degrees from the person leaning on it — a chair on the north side of
a desk had its back to the east.

Fixed, and the same reasoning applied to sofas: a sofa's rect says how it
**lies** and its `angle` says which way it **faces**, so the back cushion is
drawn on the far side from the facing. Before this every sofa in the building
had its back to the room and its seat to the wall. Occupants sit forward of
centre by `SOFA_SEAT_BIAS`, on the seat rather than on the back.

## 53. Corridors got a material of their own

Circulation was painted as 24 px tile with full-contrast grout. Once slack
became circulation rather than bigger rooms, corridors were a third of the
floor, and the result read as graph paper with furniture on it. Routes — the
spine and the cross corridors — now use a poured, seamless `circulation`
material with a single soft sheen along the run. A **lobby**, the open floor
beside a room narrower than its column, takes that room's own material instead,
so the reception reads as one space rather than as a room with a bright strip
stuck to its side. Tile grout was halved in contrast and its pitch loosened for
the kitchen and the departures room, which still use it.

Furniture picked up the detail the spec already asked for and the code did not
have: task chairs have arms and an upholstered seat pan (VISUAL-SPEC §6), sofas
have arms, a back and per-cushion seams, and rugs have a contact shadow, a pile
sheen and an inset border.

## 54. The render loop survives a bad frame

An exception escaping `Scene#_frame` took the next `requestAnimationFrame` with
it, so a single bad frame — an unknown clip name, a prop the painter has no case
for — froze the floor permanently, and the user's only signal was that nothing
moved any more. The frame body is now guarded, logs once, and keeps scheduling.

## 48. Idle repos collapse to a strip; archived ones leave the floor

After a settle, most repos have every agent benched — the room is desks,
chairs, a plant and nobody. On this machine that was 13 of 15 rooms.

A project room now has three states, decided by `activeCount` (agents that are
neither benched nor let go):

    active agents        -> open room, with desks and people
    none, not archived   -> collapsed to a strip: name, MK tag, "+" and count
    none, archived       -> off the floor entirely

**An active agent always wins.** That is what makes archiving a room safe: a
room the user collapsed pops back open by itself the moment somebody starts
working in that repo, rather than hiding them. The GUI only offers the archive
control on an idle repo, because on a busy one the control would be a lie.

A collapsed room is a project room with a small fixed footprint and no
furniture, so it rides the same packing, placement, door assignment and
hit-testing as every other room rather than needing a parallel path through
the layout.

Archiving is a view preference — it changes nothing about what is captured or
what any session is doing — so it lives in `store.archivedProjects`, not in
`ackState`, and never goes near the invariant.

### Measured cost

Collapsing shrinks the floor (8850 -> 8094 sq units on this machine, -9%) but
raises the corridor share from 24% to 33%, because the service column is a
fixed size and only the working band shrinks. The rooms are correctly small —
strips keep their natural 13x5 and are never stretched — so the slack is the
packer's aspect target, not a bug in the collapse. Flagged rather than tuned:
the packing search is being actively reworked and guessing at it from here
would fight that work.

## 49. Two sessions edited plan.js at once

Part-way through this work `public/render/plan.js` stopped compiling with
seven undefined constants. It was not this session: another live Claude Code
session in the same repo was applying a constant-extraction refactor and had
written the uses before the declarations.

Work was paused rather than "fixed". Declaring another agent's constants means
guessing at a refactor in flight, and reverting its `buildOffice` would have
destroyed real work — its two-pass fit protocol is better than what it
replaced. Once it landed its declarations, the suite went green at 299 and the
two-pass engine was adopted as-is.

The collapse feature was then re-applied ON TOP of that engine: its rewrite of
`buildPlan` had reverted the partition and left `buildCollapsedRoom` as dead
code. Re-applied as two lines inside its own pipeline (the `visible` filter and
the `projectRooms` map) rather than restoring the parallel `collapsedRooms`
array, so there is one packing path, not two.

Worth knowing for next time: concurrent sessions on one repo are not visible
from inside a session. This one was caught only because the file broke.

## 55. A sofa's `angle` was rotating its footprint

`paintProp` rotates every prop by `prop.angle` before its case runs. The sofa
case is written against the opposite assumption — its own comment says so:
"a sofa's RECT is the truth about how it lies... rotating the prop instead was
tried and is wrong". That held only because every sofa on the floor had
`angle: 0`.

Giving sofas a facing (#52) broke it. The reception's back run is 32 x 2.6 and
faces north, so it was drawn rotated ninety degrees about its own centre: a
2.6 x 32 band straight across the room it is supposed to sit at the back of,
through the wall and down into the lounge below. It looked like a structural
element, which is why it survived several passes of looking at the plan —
the geometry was correct the whole time, and only the painter was wrong.

Fixed by cancelling the ambient rotation in the sofa case, exactly as
`manager` already does, and using `angle` only to decide which long side gets
the back.

**And guarded, because that class of bug is invisible to every test in this
repo.** `paintProp` now clips each prop to its own axis-aligned footprint plus
`PROP_BLEED` (0.6 U, enough for foliage over a pot or the soft edge of a
shadow). A painter that strays outside its rect now simply cannot put
furniture where the plan says there is none. Note the order: the clip is set
in the prop's own un-rotated rect and the facing is applied after — clipping
after rotating cuts an unrotated drawing to a rotated box, which turned that
same 32-unit sofa run into a single cushion.

## 56. The floor was being built for a viewport that did not exist yet

`Scene#_recomputeFitScale` read the canvas box and fell back to
`this.canvas.width / dpr || 1920`. On a canvas that has not been laid out — a
hidden tab, a panel mid-transition, a host pane collapsed to zero — that box is
0 and the backing store is 1px, so the fallback produced a viewport of 1 x 1.
`computeTargetAspect` then clamped to its minimum and the whole floor was built
nearly square, for a stage that turned out to be 2:1. It stayed that way until
something happened to resize the window.

A box below `MIN_CREDIBLE_VIEW` (80px) is now ignored: the last credible
measurement is kept, or a sensible default is used if there has never been one.

## 57. Rebalancing the floor: the working rooms are the subject

The reception and the lounge were crowding out the rooms the product exists to
show. Measured on the reference machine (15 projects, 57 sessions, of which 37
benched and 17 archived), before and after:

| | before | after |
|---|---|---|
| project rooms | 13% of the floor | 24% |
| reception | 912 U² for a queue of one | 802 U², and it shrinks with the queue |
| departures | 48 U² per person | 21 U² |
| lounge | 2727 U², 20% furniture density | 2132 U², 26% |
| corridor | 30% | 26% |
| px per unit at 1280x621 | 6.31 | 10.8 |

Six changes, each addressing one cause:

1. **The reception is sized for its queue.** It was a fixed 28 x 24 whatever
   was waiting in it. It now starts at 22 x 20 and grows per waiting agent up
   to 38 x 28, and never exceeds `ROOM_ASPECT_MAX` — a 2:1 reception reads as a
   corridor with a desk at one end.
2. **The departures room keeps its own height.** Standing beside the reception
   it was being stretched to the reception's, which gave seventeen archived
   sessions forty-eight square units each to stand in. The strip below it is
   circulation instead.
3. **The lounge shelf-packs.** `flowBlocks` puts a fixed number of blocks in
   every row, which is right for a project's identical tables and wrong for a
   lounge whose blocks run from a 7 x 8 arcade to a 15 x 11 living room. The
   new `shelfPack` fills each row to a width budget, tallest first: same
   furniture, same spacing, a quarter less floor.
4. **The working floor shelf-packs too**, for the same reason — the floor now
   holds rooms of two very different sizes, and a count-based row put a
   twelve-unit working room and a five-unit collapsed one together and left a
   seven-unit strip of nothing under the short one.
5. **Corridors are sized to what they separate.** A flat four-unit cross
   corridor between two rows of five-unit-deep rooms is wider than the rooms,
   and the working floor read as stripes. `corridorBetween` scales it to the
   shallower neighbour, within `[MIN_GAP, CORRIDOR]`.
6. **A collapsed room is sized to the repo it stands for.** A fixed 13 x 5 card
   made a project with fifteen idle sessions the same size as one with a single
   session, and the working floor a stack of identical slivers.

Two rules were relaxed, both deliberately:

- **The lounge has its own aspect band** (`LOUNGE_ASPECT_MAX`, 2.6). The 1.8
  band exists so the tiler cannot hand a room a shape nothing can be laid out
  in — desks in rows need something close to square. The lounge is the widest
  thing in the service column by construction, and holding it to 1.8 cost
  fifteen units of empty floor or a re-pack that made the whole building
  taller.
- **The service column pays for the width it takes** past
  `SERVICE_SHARE_TARGET` (42%). Optimising pixels-per-unit alone is happy to
  give it two thirds of the width, because a wide column is a short one and a
  short one makes the floor fit — and the result reads as an office with a
  small bay of desks attached to it.

## 58. Archived sessions are off the floor

`45` gave let-go agents a departures room so they would stop vanishing. That
fixed the wrong half of the problem. An archived session is one the user has
explicitly put away; giving it a furnished room put a fifth of the plan into a
place where nothing happens, and took that space from the rooms the product
exists to show. On the reference machine seventeen archived sessions were
holding 816 square units — more floor than every project room combined.

A street was tried in between: a road down the far left with the let-go agents
walking up and down it. It is a better answer than a room and still the wrong
one, because it is still screen space spent on sessions that are put away.

**Shipped:** archived sessions get no room, no strip and no record. They are
still counted, still in the panel, still one un-archive away from walking back
in — they simply do not appear on the floor. `AgentRuntime#sync` drops their
records rather than keeping them seatless, because a record with no seat falls
through to the no-seat fallback and parks at the floor's origin, which is what
stacked seventeen bodies into one smear in the top-left corner.

`plan.test.mjs` now asserts the property that matters: the floor lays out
*identically* whether there are no archived sessions or fifty.

**Loose end for the orchestrator:** the header's "Show let go" toggle now
drives nothing. It writes a `showLetGo` setting that no code reads — that was
already true of the panel and the queue, and the floor was the last consumer.
Either wire it to something or take the button out.

## 59. The floor is two bands, and the shares are the design

The working rooms are the subject of the plan; the reception and the lounge are
context. That is now stated in the layout rather than left to fall out of
whatever each side's contents happened to want:

```
service   ~32%   the user's office above the lounge
working   ~65%   the project rooms
```

`SERVICE_SHARE` is the aim and `SERVICE_MAX_SHARE` the ceiling: a column that
wants more than its share pays for it in floor width, so the search sees what a
wide column really costs and a narrower one can win on its own merits. The
ceiling is bounded (`SERVICE_PAD_MAX`) and is not enforced at all below
`SERVICE_CEILING_MIN_ROOMS` project rooms — with one or two rooms nothing is
being crowded out, and reserving two thirds of the width for a single room just
buys empty circulation.

Measured on the reference machine, across the whole rework:

| | before | after |
|---|---|---|
| working band | 25% of width | 62% |
| project rooms | 13% of floor area | 31% |
| reception | 912 U² for a queue of one | 802 U², sized to the queue |
| lounge | 2727 U² | 1927 U² |
| archived sessions | 816 U² | none |
| corridor | 30% | 39% of area, but inside the reserved working band |
| px per unit at 1280x621 | 6.31 | 9.60 |

Three further changes made the bands hold their shape rather than filling with
circulation:

1. **The working floor picks the row width that best fills the height** the
   service column has already fixed, instead of always packing to the widest
   row it is allowed. It fills its band rather than sitting in the top of it.
2. **A row's leftover width goes to the ROOMS first.** A band reserved for
   project rooms and then filled with corridor is the same defect as a room
   bigger than its furniture, one level up. Each room takes its share up to
   `ROOM_ASPECT_MAX` — or `COLLAPSED_ASPECT_MAX` for a collapsed room, which is
   a plate rather than a room laid out with desks in rows and may legitimately
   be a wide strip. A widened room centres its furniture (`place`), which is
   safe here and only here because a project room carries no wall-anchored
   props.
3. **A collapsed room takes its whole cell.** It has nothing inside it to leave
   stranded, and a strip of corridor under a plate reads as a gap in the floor
   rather than as somewhere to walk.

And the lounge stops growing without limit: `LOUNGE_MAX_GAMES` caps it at five
tables. The thresholds in `03-VISUAL-SPEC.md` §4.2 were written for a handful
of benched agents; on a real machine nearly every session ends up benched, so
every threshold fires at once and the lounge becomes a games arcade — measured
at six tables and half the room.

## 60. Two rows, one corridor, and columns that stack

The working floor was being packed as shelves: as many rows as the rooms
needed, each with a corridor under it. On a real machine that meant five rows
of shallow rooms with a corridor between every pair — the corridors were wider
than the rooms were deep, and 43% of the floor was circulation.

The shape is now stated rather than derived:

- **Two rows, one corridor.** `WORKING_ROWS` is 2 once there are enough rooms
  to fill both. More rows means more corridors; fewer means one very deep row
  with nothing stacked in it.
- **A column holds a stack.** A project with two agents needs a fraction of the
  depth a twenty-one agent project does, and standing those side by side wastes
  the difference. `packColumns` fills each column to the row's depth, best-fit
  so the stacks come out tight rather than one column absorbing every small
  room in the building. This is where the depth that used to become corridor
  goes.
- **The rooms take the slack before the floor does.** A row's spare width is
  shared across its columns and a column's spare depth across the rooms stacked
  in it, so squaring the building up to the stage makes the project rooms
  bigger rather than the corridors wider. That in turn is why
  `ASPECT_PAD_MAX` could be raised from 0.08 to 0.25: the padding is no longer
  void.

Two routes exist on the working floor and both are real: the full-width
corridor between the two rows, and the **aisle** beside each column, which runs
its whole depth and is how a room in the middle of a stack reaches the floor.
`buildNavLines` reads a corridor's own shape to decide which it is, and extends
each aisle half a corridor past both ends so it actually meets the corridor's
centreline — a line that stops exactly at the corridor's edge never intersects
it, and the graph comes apart into one component per row. The gap between two
rooms stacked in the same column is floor, not a route.

## 61. One column width, and both service rooms fill it

The office was capped at `OFFICE_MAX_W` while the column was as wide as the
lounge needed, so a strip of nothing sat beside the reception — a room-shaped
piece of empty floor next to the room the user reads first, taking width the
working floor could have had. The lounge had the same strip on its other side
whenever its blocks packed narrower than the column.

The column now has ONE width. The office is built at it, the lounge is built to
it and takes it whatever its blocks packed to — open floor in a lounge is a
lounge, and the alternative is a strip of circulation beside it doing the same
job less honestly. There is no lobby anywhere in the column except below the
lounge, where the working floor made the building taller than the column
needed.

Measured across the whole rework, on the reference machine (15 projects, 57
sessions, 37 benched, 17 archived):

| | at the start | now |
|---|---|---|
| project rooms | 13% of floor area | **58%** |
| corridor | 30% | **16%** |
| service column | 58% of area, 64% of width | 26% of area, 26% of width |
| working band | 25% of width | **72%** |
| archived sessions | 816 U² | none |
| px per unit at 1280x621 | 6.31 | 8.01 |

**The cost, stated plainly:** pixels-per-unit is *lower* than the 9.6 the wider
column reached. Holding the column to the office's width makes the lounge tall
— 38 x 56 for thirty-seven benched agents and five games tables — and the
building is as tall as its tallest column. The floor is drawn at
`min(stageW / W, stageH / H)`, so that height is what now limits the scale.
The trade was made deliberately: the rooms are individually far larger even at
the smaller scale, because they are no longer sharing the floor with a column
and a corridor network twice their size.

## 62. The working floor is a squarified treemap after all

`03-VISUAL-SPEC.md` §2.2 asked for a squarified treemap and an earlier revision
of `plan.js` rejected it, on the grounds that a treemap "honours each item's
AREA and lets the aspect fall where it may". That is true of a plain
slice-and-dice treemap and is precisely what the *squarified* variant fixes: it
accumulates items into a row only while doing so makes the worst aspect in that
row better, and starts a new row the moment it would make it worse. The
original judgement was made against the wrong algorithm.

It is the right structure here for three reasons the shelf packer could not
give:

- **The cells tile their band exactly**, so adjacent rooms share a wall instead
  of being separated by a strip of circulation. The whole floor now contains
  exactly two pieces of circulation: the spine between the service column and
  the working floor, and one cross corridor between the two bands. Nothing
  else. `floor-integrity.test.mjs` asserts the count and asserts that every
  project room's left edge meets either the spine or another room's right.
- **A small project gets a small square, not a full-height splinter.** A shelf
  gives every room in a row the same depth whatever its width, so a
  one-session project beside a twenty-one session one became a sliver.
- **The floor can be told what size to be.** A treemap tiles whatever rectangle
  it is handed, so the plan sets `W = targetAspect * H` and fills the stage
  exactly — no letterbox band, no bay of leftover floor, and no padding rule to
  tune. That is what `05-LAYOUT-REWORK.md` §3.1 asked for and what every
  previous attempt bought with void.

Two guards keep it honest. `WEIGHT_MAX_RATIO` (2.5) compresses how much more
floor a large project may claim than a small one — unclamped, one big repo
beside a dozen single-session ones turns the small rooms into splinters
whatever their area says. And the two-band plan gives way to one band if two
would leave a room past `PROJECT_ASPECT_LIMIT` (2.4:1), which happens with
three rooms on a wide floor.

Rooms are rebuilt for the cell they are given — a project's tables flow to that
shape rather than being laid out square and centred in something that is not —
and the building grows until every room holds its own furniture, because a desk
outside its room is a desk in the corridor.

## 63. Every room keeps a clear strip for its plate

A room plate is live text drawn straight onto the floor — no card, no fill
(CONTRACTS-WP15.md §3) — so anything under it competes with it. Reserving the
strip in the PLAN rather than hoping the furniture misses it is the only way to
be sure: every room carries a `plateBand` at its top, its interior starts below
it, and `resolveAnchors` measures wall and corner anchors from there. A prop
against the north wall lands under the band, not under the writing.

Two consequences: the reception's art moved from the north wall to the east
one, and a project room's corner planting takes the south-west, south-east and
north-east corners but never the north-west, which is where its name is
written.

## 64. Project rooms are furnished, not just occupied

The treemap gives a project room a cell sized to its share of the floor, which
is routinely larger than its desks need. A group of desks adrift in the middle
of a room is unfinished work, so the room is furnished the way an interior
would be:

- a **rug** under the desk cluster, sized to it, which is what defines a group
  as a group;
- **planting** in the corners the plate and the wall fixtures leave free;
- the **shelf** and the **dashboard screen** on the east wall, stacked below
  the in-room "+" that sits in the corner above them;
- and the **whiteboard** on the west wall, facing the room.

Measured content fill in an occupied project room went from 29% to 94%.

## 65. The whiteboard opens

Every project room has a board on its wall, and it is the one object on the
floor drawn with any perspective at all. Straight down, a wall-mounted board is
a line — true, and useless. The floor is an orthographic top-down plan
(VISUAL-SPEC §1) and everything else on it obeys that; the board's face is
drawn foreshortened into the room, the way an architectural plan draws an
elevation of something it wants you to read. It is the only object on the floor
that carries writing, and writing you cannot see is not worth drawing.

Clicking it opens the board itself — the product's one deliberate change of
plane, from looking down at a room to standing in front of the thing on its
wall. It carries what a team keeps written up where everyone can see it:
sessions, working, hands up, in your office, benched, finished, archived,
tokens, cache tokens and estimated cost, then every session on the floor with
its state and its own token count, and the project total.

It is a modal, opened by a click and dismissed by Esc or by clicking off it.
It used to open on HOVER, which meant a panel appearing under the cursor as it
crossed the floor. And it is the one genuinely white surface in the product,
because it is a whiteboard; every other surface stays dark-tinted.

## 66. The description is not a changelog

`package.json`'s description ended with "(Codex adapter included but
unverified.)". Honest, and in the wrong place. That one line is what npm search
renders under the package name, next to a dozen competitors, and it was
spending its last forty characters warning about a secondary adapter before it
had finished making the case for the primary one. The caveat has not been
softened — it is in the README's Honest limits, where someone deciding whether
to trust the tool will read it, rather than in the sentence deciding whether
they look at all.

Three further changes went past what WP-01 asked for, all in the same file:

- `control-plane` removed from the keywords. `02-MARKET-AND-LAUNCH.md` §2 lists
  "that we orchestrate" under **what we never say**, and a control plane is
  exactly the thing we are positioned against. Turning up in that search is a
  wrong-audience impression, not a free one. `claude`, `local-first` and
  `privacy` added in its place.
- A `funding` field pointing at GitHub Sponsors, to match `.github/FUNDING.yml`.
  npm renders it on the package page; there was no reason for the two files to
  disagree.
- `.github/ISSUE_TEMPLATE/config.yml`, which WP-02 did not ask for. Without it
  GitHub keeps the "open a blank issue" escape hatch, and a security report
  filed through that escape hatch is public the moment it is filed. The chooser
  now sends those to the private advisory form instead.

`CHANGELOG.md` was **not** added to the `files` array, though it was tempting.
The tarball stays at exactly the 39 files and 203 kB `01-AUDIT.md` F1 measured,
so "confirm that stays true" has a clean answer. npm rewrites the README's
relative link to it against the `repository` field, so nothing is broken by its
absence.

## 67. The stray working files were left where they are

WP-02 asks for `run.log`, `run.err.log`, `state.json` and `state/` to be
removed from the working tree. They were not, and this is a deliberate refusal
rather than an oversight.

`.gitignore` already covers all four (`*.log`, `state.json`, `state/`), none of
them is tracked, and the `files` array keeps every one of them out of the
tarball. So the hygiene the finding actually cares about — that they never
reach git or npm — is already true. Deleting them buys a tidier `ls`.

Against that: `state/settings-backup-*.json` is a copy of the user's real
runtime settings file, taken before DeckHQ edited it to install hooks. It is a
recovery artifact. `state.json` is the pre-1.1.0 state file, holding
acknowledgements from before the move to `~/.deckhq/`; 1.1.0 copies it across
on first start and deliberately leaves the original where it is, for exactly
this reason. Deleting either is irreversible and buys cosmetics.

They also sit in the shared checkout rather than in the worktree this work was
done in, so removing them would reach outside the change under review and into
a directory other work is live in.

Left for the owner to delete by hand, whenever no daemon is running:
`rm -f run.log run.err.log state.json && rm -rf state/`.
## 68. The summary cache persists, and it deliberately does not paint stale

§11 closed with "a persistent on-disk summary cache would remove even [the cold
scan], and is the obvious next step". It is now in, at
`~/.deckhq/cache/<runtime>.json` (`DECKHQ_STATE_DIR` honoured exactly as for
`state.json` and `backups/`), keyed by `(path, mtime, size)` — the same
invalidation rule the in-memory cache already used — and carrying a schema
version that discards rather than migrates.

Measured on this machine (Windows 11 ARM64, **66** real sessions across 14
project directories, 307 MB of transcripts, one at 74 MB), before and after,
the two arms interleaved and then re-run with their order flipped so machine
drift hit both equally. A "start" is a fresh process doing its first scan —
what a daemon start actually costs. Medians, with ranges:

| | before | after |
|---|---|---|
| Cold start, no cache file | 838 ms (737–1166) | 778–868 ms (761–1073) |
| **Second start** | **780–854 ms** | **59–90 ms** (56–90) |
| Poll — warm scan, same process | 64–68 ms | 63 ms |
| Cache file on disk | — | 62 KB |

The target was a populated floor under 400 ms on the second start with 51
sessions. Met at 66 sessions with better than 4x of headroom: **under 90 ms in
the worst run measured**, roughly twelve times faster than before. The cold
start is unchanged within noise — the only thing added to it is one 62 KB
atomic write.

**The cache deliberately does not paint stale summaries and reconcile in the
background, which is what the work package asked for.** Only entries that are
provably current — mtime *and* size unchanged, so the file cannot have changed
in any way `parseSummary` could see — are served; anything else is parsed
before it is returned.

The reason is the invariant. A stale summary's `turnEnded` feeds
`_computeAgents`, and `for_review` there calls `_markForReview`, which writes
`reviewSince` — a **user-owned** field that only `act()` can clear. The single
most likely reason a transcript's mtime moved while the daemon was down is that
the user typed into it, which is exactly the case where the cached summary says
"turn ended, up for review" and the truth is "the user already replied".
Painting that provisionally would manufacture a review debt on the floor that
then survives forever. Speed bought with a false debt is not speed; it is the
bug the product exists to prevent. The measured second start is 68 ms, so there
was nothing to buy by taking the risk.

What the cache is allowed to change is nothing at all, and that is asserted
directly: a scan served from the cache is deep-equal and `JSON.stringify`-equal
to a scan by a process that has never seen one.

**The §46 trap, which persistence sharpened.** The desktop app's `archived`
flag is stamped onto summaries *after* the cache, because archiving does not
touch the transcript. The old in-memory cache handed callers the object it was
holding, so that stamp landed *in* the cache — harmless only because the flag
was re-applied from a fresh read on every poll, and only for as long as that
read kept succeeding. Persisted, the same bug writes `archived: true` to disk
and survives restarts, and `archived` drives `let_go`: an agent the user
rehired would be re-fired on every poll, forever, with nothing on the floor to
say why. The cache now copies on the way out and strips `archived` on the way
in. Both halves are asserted, as `INVARIANT:` tests.

Stripping on `set` only covers files *this* build wrote, which is not the same
as covering the files it reads. A cache file is not a trusted input — it can be
hand-edited, restored from a backup, copied between machines, or left behind by
a build that had the copy-out bug above — so the flag is stripped at **both**
ingress points, `set` and every entry read off disk. Without the load-side
strip a planted `archived: true` is served straight back with no desktop store
present to correct it, and because the transcript is finished the entry stays a
cache hit forever, so the flag can never age out. Two more `INVARIANT:` tests
pin it, one on the cache and one through a real scan; both were confirmed to
fail with the load-side strip removed, so neither is vacuous.

Note which way the absent case goes: a summary from a cache hit carries **no**
`archived` key rather than `archived: false`. The registry reads a missing flag
as "this runtime cannot see an archive" and leaves `ackState` alone, and reads
`false` as "not archived", which rehires a let-go agent (§46). Neither of those
is a decision the cache is entitled to make.

The rest is the discipline the package asked for, all of it asserted: a
corrupt, truncated, empty, mis-shaped, foreign-runtime or wrong-version file is
discarded in silence and rebuilt — it is an optimisation, never state, so it
must never block a start and must never reach the user as an error; one
malformed *entry* is dropped without condemning the file; entries for
transcripts that no longer exist are evicted; the file is capped at 2000
entries and 8 MB, keeping the most recently active; and it is written
temp-file-then-rename like `store.mjs`. Writes are rate-limited to one per 30 s
after the first, so a live session churning on a 5 s poll cannot rewrite the
file forever.

**One thing the measurement found that is not the cache.** With the cache in, a
62–94 ms warm start is only **6–8 ms** of DeckHQ's own scan. The rest is
`readDesktopSessions()`, which `readFileSync`s and `JSON.parse`s every file in
`%APPDATA%/Claude/claude-code-sessions/` — 57 files, **8.3 MB** — synchronously,
on **every 5-second poll**. Pointing it at an empty directory drops the warm
start to 6–8 ms and the poll from 52–57 ms to 5–7 ms. It is now essentially the
entire cost of a scan, and it is what holds the warm scan against §8's < 50 ms
budget instead of comfortably inside it. Out of scope here: flagged, not
touched. **Closed in §78.**
## 69. `--muted` is one step lighter than the repalette spec proposed

**Spec:** the WP-06 chrome repalette — `docs/plan/05-GUI-UX-SPEC.md` §2.2, which lives on the
planning branch and is not in this tree — proposes `--muted: #7C8494` as part of the violet-blue
chrome ramp, with the acceptance criterion "body text ≥ 4.5:1".

**Shipped:** `--muted: #8A92A3`.

**Why.** `#7C8494` clears the bar on the two grounds the spec names — 4.89:1 on `--bg` and
4.52:1 on `--surface` — but `--muted` is not confined to those two. It sets normal-size text on
`--surface-2` in three places: `.tooltip-line` (0.68rem, the floor tooltip's detail lines),
`.btn.is-busy` (0.72rem) and `.filter-chip::after` (the project filter's clear glyph). There it
measures **4.02:1**. The warm palette this replaces measured **4.68:1** on the same ground, so
shipping the proposed value would have been a real accessibility regression introduced by an
accessibility-motivated change — and one that a suite testing only `--bg` and `--surface` would
have called green.

`#8A92A3` measures 5.89 / 5.45 / **4.84** on `--bg` / `--surface` / `--surface-2`. It is still
comfortably the quietest ink in the set (`--ink-2` is 9.77 on `--bg`), and it stays on the same
~221° ramp as the rest of the neutrals.

The alternative was darkening `--surface-2`, which would have flattened the raised-surface step
the ramp exists to create. The spec's own instruction is that the *ground* moves when a **state**
colour fails; `--muted` is ours, so the ink moved instead.

The test now asserts the threshold rather than assuming it: it finds every rule that sets text in
`--muted`, checks whether any is below the WCAG large-text size, and only then holds the token to
4.5:1 — on all three grounds, naming the offending selector when it fails.

## 70. Error and status text left the accent colour

**Spec:** `docs/03-VISUAL-SPEC.md` §5 and §10, and `public/style.css`'s own header: state is
never carried by colour alone, and small text is never set directly in a state colour.

**Measured:** four rules were breaking that, and the repalette made each of them worse rather
than better, because the cold ground is slightly darker than the warm one it replaced:

| Rule | Size | Colour | On | Was | Now | Needs |
|---|---|---|---|---|---|---|
| `.toast.is-error` | 0.70rem | `--accent` | `--surface-3` | 2.65 | 2.39 | 4.5 |
| `.btn--danger:hover` | 0.72rem | `--accent` | `--surface-2` | 2.93 | 2.78 | 4.5 |
| `.hooks-error` | 0.82rem | `--accent` | `--surface` | 3.22 | 3.13 | 4.5 |
| `.composer-hint.is-warn` | 0.60rem | `--accent` | `--bg` | 3.39 | 3.38 | 4.5 |
| `.hooks-badge.is-installed` | 0.60rem | `--state-working` | `--surface` | 3.53 | 3.43 | 4.5 |

The toast is the worst of these and the most consequential: it is the surface that tells you a
send failed, it is on screen for a few seconds, and at 2.39:1 the sentence was close to
unreadable on the dark ground.

**Shipped:** the colour moves off the words and onto a carrier that only has to clear the 3:1
non-text floor — a 2px left rule for `.hooks-error` and `.composer-hint.is-warn`, the existing
border plus a 6px dot for `.toast.is-error`, the existing border for `.btn--danger:hover` and
`.hooks-badge.is-installed`. The message itself is now `--ink` (14.66:1 on `--surface`). This is
the pairing `.dialog-error` and `.state-chip` already used; these five were the stragglers.

The one place the accent still colours text is `.needs-you-total .stat-v`, and it survives on
size: 1.3rem at weight 700 is 20.8px bold, which WCAG counts as large text, so its floor is 3:1
and it measures 3.13 on the topbar. It is also always paired with its "NEEDS YOU" label. A test
now asserts that this is the *only* such rule, so the next `color: var(--accent)` fails the suite
rather than the user.

## 71. IBM Plex Sans Condensed was not added — **RAISE**

**Spec:** `docs/plan/05-GUI-UX-SPEC.md` §2.3 (planning branch, not in this tree) calls for adding
IBM Plex Sans Condensed, self-hosted in `public/fonts/`, for floor labels — room plates, name
labels, badges.

**Not shipped.** It requires vendoring binary woff2 files into the repository, which is the
orchestrator's decision and has not been made. WP-06 shipped the repalette only. The floor labels
remain IBM Plex Sans, so the 15–18% horizontal saving §2.3 wants for label collision
(DEVIATIONS §15) is still outstanding, and §6.2's label sizes are unaffected either way.

No web font link was added and none may be: rule 2 of the orchestrator brief forbids network
egress and the CSP in `src/http/server.mjs` forbids it independently.

If the decision is to proceed, the shape of the work is fixed by what the floor already draws.
`public/render/rig.js`'s `sansFont()` sets agent name labels at **600**, and
`public/render/scene.js:1252` sets the room-plate name at **700** — so it is two weights, SemiBold
and Bold, not one as §2.3 assumes. A basic-Latin woff2 subset runs roughly 15–25 KB per weight
(30–50 KB for the pair); the full Latin-1/2/3 coverage IBM ships is closer to 25–35 KB each. The
`@font-face` blocks go at the top of `public/style.css`, above `:root`, alongside a
`--font-condensed` token; the renderer does not read CSS variables today, so `scene.js` and
`rig.js` would each need their own font constant updated, and both are outside this package.
## 72. `deckhq doctor` cannot print the runtime's version — **RAISE**

**Spec:** `06-ENGINEERING-WORKPLAN.md` WP-05 shows the first row of the report
as `claude          2.1.184 on PATH`.

**Why it is not there:** the only way to learn a runtime's version is to ask the
runtime — `claude --version` — and that is spawning a runtime CLI. The
orchestrator brief §7.8 and `02-ARCHITECTURE.md` §2 both put that strictly
inside an adapter, and the adapter interface exposes no `version()`. The
transcript format does carry a version field, but reading it here would be
transcript parsing outside an adapter, which is the same rule. WP-05's own
package boundary excludes `src/adapters/**`, so the interface could not be
extended in this package either.

**Shipped:** the row reads `claude code     available` when the runtime is
present and `codex           not installed` when it is not. `collectRuntime()`
calls `adapter.version?.()` and renders `<version> on PATH` when it gets a
string, so the row fills itself in with no further change here on the day the
adapter interface grows the method. `test/unit/doctor.test.mjs` pins both
branches.

**The call to make:** add `version(): Promise<string|null>` to `RuntimeAdapter`,
cached for the process lifetime like `available()`. It is one `execFile` per
adapter and it makes the launch asset noticeably more concrete.

## 73. Report wording that departs from the WP-05 sample

Three small departures, all in the same direction — say only what can be
checked.

**`claude code`, not `claude`.** The row label is `adapter.label` lowercased, so
every runtime in the registry names itself and nothing here holds a table of CLI
binary names; a third adapter gets a correct row the day it is registered. The
proof card's left column reads `claude code · its own agent view` rather than
`claude agents` for the same reason, and because `claude code agents` is not a
command anyone can run.

**`live now  5   (claude code's own agent view reports 5)`.** The sample reads
`(claude agents reports 3)`. The two numbers are necessarily equal — DeckHQ's
live count *is* `liveSessions()`, which is that view — and printing both is the
point: it shows we are not inflating our side of the subtraction.

**`egress  none. no outbound sockets.`** The sample says `0 outbound sockets
since start`. `doctor` is a one-shot command with no "since start" to measure
and no socket counter to read, so it does not imply one. The claim is still
exact: every socket the command opens is to 127.0.0.1 — one TCP probe for "is
anything listening on the hooks' port", and, when there is, one read of the
running daemon's `/api/hooks` for the event counters, which exist only in that
daemon's memory.

**Measured on the reference machine:** 67 sessions across 16 projects, 5
running, 62 already finished; hooks installed on port 4400 with 37 events
delivered; exit 0. The `--capture-proof` PNG rendered at 2400×1260 in about
four seconds.

## 74. The capture proof overclaimed, and the claim has been retired

This is the most important entry in this file, because the thing it corrects
had already been written, reviewed, screenshotted and committed.

**What shipped first.** `deckhq doctor --capture-proof` headlined:

> DeckHQ sees 61 sessions the agent view cannot

**The measurement that killed it.** `claude agents --json` was run on the
reference machine. It returns **all** live sessions, every one
`kind: "interactive"`, including sessions launched from terminals in other
repositories. It is not blind to terminal sessions on this version.

So the headline was comparing **5 running** against **66 all-history** and
calling the difference invisibility. Literally true — 61 is a real subtraction
— and rhetorically dishonest. Anyone who ran `claude agents` after reading the
image would have seen their terminal sessions listed, concluded we had fudged
the number, and been right. The whole project's credibility rests on an
honest-limits discipline (this file is that discipline), and one overstated
launch image costs more than it wins.

**What is actually true.** The difference is not sight, it is **persistence**.
A view derived from live processes forgets a session the instant its process
exits. DeckHQ keeps it, and keeps whether it still owes you an answer. That is
the invariant (`01-PRODUCT.md` §2), it is the actual product, and it cannot be
disputed by running any command.

**Shipped instead.**

- The left number is labelled as what it is — *sessions running right now* —
  not "sessions it can see".
- The headline leads with the debt: `7 finished sessions are still waiting on
  you.` / `The agent view lists none of them. Oldest: 26h.` That number is
  `waitingNotRunning`: sessions that owe the user an answer **and** whose
  process is not running. A session the runtime still lists as live may be
  sitting on a permission prompt — the runtime's own view *would* show that
  one, so counting it here would repeat the original sin at smaller scale. The
  snapshot carries a per-agent `live` flag, so the intersection is exact.
- The debt is only knowable from a running daemon. With no daemon, the card
  falls back to a bare descriptive count — `62 of them have already finished.`
  — and makes **no comparative claim at all**, rather than a softened version
  of the old one.
- The words "cannot see", "invisible", "blind" and "hidden" appear nowhere.
  Where the difference is named, it is *no longer lists* or *forgets when the
  process exits*.

**Guarded by** a test named `INVARIANT OF HONESTY: nothing ever claims the
agent view cannot SEE a session`, which asserts those phrasings are absent from
both the stdout report and the card, and by a test that the no-daemon fallback
reinstates no comparative claim. The absence is tested, not just the presence.

**Measured on the reference machine after the change:** 5 running, 67 on the
floor, 62 finished, 0 genuinely waiting (all 3 waiting sessions were still
running), so the card correctly rendered the fallback headline rather than a
debt it could not substantiate.

## 75. `doctor` exits 0 when hooks are installed and DeckHQ is simply not running

**Spec:** WP-05 lists "hooks installed at a port nothing is listening on" as a
condition that must exit non-zero.

**Why that was wrong:** it is the state of most machines most of the time. The
daemon is not running, so nothing is listening, so the hooks are inert — and
they resume delivering the moment it starts. `doctor` is going to end up in
health checks and CI, and a command that fails on the normal resting state of
the product is useless there.

**Shipped:** the check now distinguishes the two cases by looking for the
daemon rather than only at the one port.

- No daemon anywhere on the loopback range: an informational `·` note, exit 0.
- A daemon running on a **different** port from the one the hooks target: exit
  1. This is the failure the check is actually for, and it is invisible in
  every other surface — the settings file is valid, the header claims exact
  state, and every event is dropped.

Detection TCP-probes the hook ports plus `4317..4326` (the range the daemon
walks when its preferred port is taken) in parallel, then speaks HTTP only to
the ports that answered, identifying a daemon by a well-formed `/api/state`.
`--port` widens the search for anyone running further out.

Exit 1 is now reserved for: state not writable, a hook/daemon port mismatch, no
runtime available at all, or an adapter that threw.

## 76. `process.exit()` turned a healthy `doctor` run into exit 127

Found by running the finished command, not by any test.

`bin/deckhq.mjs` ended the subcommand with `process.exit(await runDoctor(...))`.
Once `doctor` started reading the deck from a running daemon, every invocation
aborted **after printing a complete and correct report**:

```
Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 94
EXIT=127
```

`process.exit()` tears the event loop down immediately; the loopback socket
from the `fetch` was still closing, and libuv aborts the process rather than
touch a closing handle. Reproduced deterministically, and bisected: the probe
alone exits 0, the fetches alone exit 0, both together exit 0 — only
`process.exit()` afterwards aborts.

Fixed on both sides: the bin script sets `process.exitCode` and lets the loop
drain (measured: no delay, nothing holds it open), and `doctor` sends
`Connection: close` on its two loopback requests so no idle keep-alive socket
outlives the report in the first place.

The lesson worth keeping: **the exit code is part of the output.** 364 unit
tests all passed against a binary that could not exit successfully, because
they call `runDoctor()` and assert its return value — they never spawn the
CLI. A command's contract includes how it ends.

## 77. The live roster is cached, because asking for it booted the whole CLI

`liveSessions()` ran `claude agents --json` through `execFile` on **every**
daemon poll — `Registry._doRefresh` calls it once per refresh, and
`Registry.start` refreshes every `pollIntervalMs`, default 5000. The command
works and returns real data; nothing was failing and nothing was being
retried. It is simply the most expensive question in the product, asked
twelve times a minute, forever.

Measured on this machine (Windows 11 ARM64, 68 sessions on disk, 6 live),
with `Start-Process -PassThru -Wait` so the child's own processor time is
read rather than inferred:

| One `claude agents --json` | |
|---|---|
| Wall time | 1027–1130 ms |
| **Child CPU** | **406–984 ms, median 609 ms** |

It is booting the entire Claude Code CLI to print six lines of JSON. At one
spawn per 5 s that is **~12% of one core** (8–20% across the range), spent
out of process and therefore invisible to any measurement taken on the
daemon's own process time. §11 reports **1.9%** for this same daemon; that
figure cannot have counted the spawned CLI, or it would have read ~14%.
`docs/02-ARCHITECTURE.md` §8 allows **2%**.

This is a different failure from §11's. That one was event-loop blocking and
was fixed by not re-reading unchanged files. This one is wall time and
out-of-process CPU: the daemon's own block during a refresh is 17–55 ms, and
always was.

### What it costs to not ask

The roster is now cached for `LIVE_PROBE_TTL_MS`, and the two transitions
that matter are recovered without spawning anything:

- **A session that exits** — the common case, and the one the floor must not
  get wrong — is caught by `process.kill(pid, 0)` against the cached roster on
  every call. `agents --json` already returns a `pid`. Measured at **0.055 ms
  for a whole roster**, against 609 ms for a probe. Death is still noticed
  within one poll, exactly as before.
- **A session that comes alive** is caught by the scan, which was running
  anyway: a transcript whose `lastActivityAt` is newer than the last probe,
  belonging to a session that probe did not list, sets a flag that drags the
  next `liveSessions()` forward instead of waiting out the TTL. This is what
  keeps the degraded path (§4.2) honest, where the poll is the only liveness
  signal there is. With hooks installed `SessionStart` already reports it
  directly and authoritatively, which is why no hook-awareness was added —
  see below.

What is left stale is the single case neither covers: a session that starts
or resumes and then **writes nothing at all** — a terminal opened and left
sitting at the prompt. Its `live` flag reads false for up to the TTL. That is
the whole price, and it is bounded, self-correcting, and cannot touch
user-owned state: `live` is an observation, and `for_review` is sticky
through a liveness loss either way.

### The numbers

Same harness for both arms, each arm in its own process so the module state
is fresh, three rounds with the order flipped each round so machine drift hit
both equally. A "poll" is one `scanSessions()` + one `liveSessions()`, the
pair `_doRefresh` runs, at the daemon's real 5 s interval. The **before** arm
runs the identical spawn path, forced every poll.

Three rounds of 24 polls, a ~115 s window each:

| Per 24 polls (~115 s) | before | after |
|---|---|---|
| CLI spawns | 24, 24, 24 | **2, 2, 3** |
| `liveSessions()` median | 521–721 ms | **0.1 ms** |
| `liveSessions()` total over the window | 14.0–18.3 s | **1.0–1.5 s** |
| Share of one core (spawns × 609 ms median CPU) | 12.7% | **1.1%** |

The `after` round that spent three spawns is the arithmetic working: a 115 s
window crosses a 60 s TTL twice, plus the mandatory first probe.

Live counts drifted between arms within a round (6 vs 7 in round two) because
real sessions on this machine start and stop while a four-minute measurement
runs. That proves nothing either way, so equivalence was measured directly
instead: two module instances in one process, one on the shipped path and one
forced to probe on every poll, their rosters compared **in the same poll**.
**12 polls, 12 exact agreements, no session in one roster and not the other.**

The daemon was then run for real on port 4499: 70 agents, 8 live, 18 projects,
stable across polls, nothing on stderr.

### Why 60 s, and why the 10 s floor

`LIVE_PROBE_TTL_MS` was set against the budget, not by taste. At 609 ms of
child CPU per probe, a 30 s TTL still spends ~2% of a core at idle — the
entirety of §8's allowance, on one question. 60 s is ~1%, and the extra 30 s
of staleness lands only on the "alive and silent" case above, which the scan
trigger cannot see at any TTL.

`LIVE_PROBE_MIN_INTERVAL_MS` (10 s) is a floor on how often disk evidence may
drag a probe forward. Without it, a top-level transcript being appended to by
something the roster never lists would force a spawn on every poll — the
exact behaviour being removed. `deckhq`'s own `send()` (`claude --resume -p`)
is a plausible source of one. The worst case with the floor is one probe per
10 s, ~6% of a core, and only while such a file is actively being written —
which is not idle. A memo of ids a probe has already declined to explain
would remove even that; it was left out because it needs its own eviction
rule for a case that has not been observed.

### Options weighed and not taken

- **Skip or slow the probe when hooks are installed.** Hooks are the
  authoritative liveness path (§42, and the "accurate path" comment in
  `_computeAgents`), so this is tempting. Rejected: the registry already
  prefers `hookLive` over the poll wherever it has one, so the probe is only
  load-bearing for a session that has fired no event yet — which is precisely
  the case a hook-aware TTL could not help with. It would buy two staleness
  contracts to explain, a second code path to test, and a settings-file read
  in the adapter, for a case the scan trigger already covers.
- **Derive liveness from pid checks alone, with no probe.** Cannot discover a
  session the daemon has never seen running, and cannot survive a daemon
  restart. It is the right *refinement*, not a replacement, which is how it is
  used.

### Not fixed, and measured on the way past

The warm scan is over budget for a reason that has nothing to do with this
change. §8 sets warm < 50 ms and §11 measured 3–5 ms; it now runs **99–220 ms
(median ~150)**, of which `readDesktopSessions()` — the §46 archive join — is
**65–140 ms**. It re-reads and re-parses all 58 files in
`%APPDATA%/Claude/claude-code-sessions/` on every single scan, with no cache
of any kind, because §46 deliberately applies it *after* the summary cache so
an archive flag cannot go stale. That ordering is right; re-reading the store
to honour it is not. Left alone here because it is a separate defect with a
separate fix (an `(mtime, size)` cache on the store directory, matching the
summary cache), and folding it into this change would have made both
unmeasurable. **Fixed in §78.**

## 78. The desktop store's own read is cached, keyed on the file that carries the flag

§68 flagged this and §77 measured it on the way past without fixing it: with
the summary cache in, `readDesktopSessions()` was **essentially the entire cost
of a warm scan**, and it runs on every 5 s poll forever. §77 named the fix it
was leaving — "an `(mtime, size)` cache on the store directory, matching the
summary cache" — and this is that. §11 had the warm scan at 3–5 ms once the
summary cache landed; the desktop-store read added in §46 put it back outside
the **< 50 ms** budget in docs/02-ARCHITECTURE.md §8.

Each file's *parsed* result is now cached in
`src/adapters/claude-code/desktop.mjs`, keyed by `(path, mtime, size)` — the
same invalidation rule `src/core/summary-cache.mjs` uses.

Measured on this machine (Windows 11 ARM64, **61** desktop session files
totalling **8.8 MB**, 70 transcripts), the two arms interleaved and their order
flipped between passes so machine drift hit both equally; four fresh processes
per arm per pass, each doing a first scan and then eight polls.

It was measured twice, in two different machine conditions, because the first
window disagreed with §77's numbers and the difference turned out to be load
rather than code. Both are reported. Per-pass medians, with the full range
across every run in the window:

**Quiet machine** (three passes):

| | before | after |
|---|---|---|
| `readDesktopSessions()`, warm | 78.4–80.5 ms (71.3–105.0) | **1.2–1.3 ms** (1.1–2.2) |
| **Warm scan — every poll** | **82.5–87.4 ms** (75.6–154.6) | **4.5–5.1 ms** (3.5–9.2) |
| First scan of a process | 99.8–120.5 ms (89.3–154.5) | 94.2–100.0 ms (85.6–157.8) |

**Busy machine** (seven passes, several other agent sessions running):

| | before | after |
|---|---|---|
| `readDesktopSessions()`, warm | 82.5–169.1 ms (72.4–528.0) | **1.3–3.2 ms** (1.1–8.4) |
| **Warm scan — every poll** | **116.1–173.0 ms** (58.2–308.2) | **4.8–8.9 ms** (3.1–36.6) |

| | before | after |
|---|---|---|
| Files opened per poll | 61 | 0 |
| Held in memory | — | ~120 KB, measured after `gc()` |

The busy window is where §77's **99–220 ms** came from — it reproduces almost
exactly — so the two records agree; a quiet machine simply reads 82–87 ms. The
ratio is what is stable: the warm scan is **17–20x faster** in both windows,
and lands an order of magnitude inside §8's budget from either starting point.
The control arm — `DECKHQ_DESKTOP_SESSIONS_DIR` pointed at a nonexistent
directory, i.e. the same scan with no desktop store to read at all — polls in
3.0 ms quiet, so the store now costs a scan about **1.5 ms** instead of about
96% of it. The first scan of a process is unchanged within noise; the `fstat`
note below is why it is not worse.

**It is deliberately not folded into the summary cache, and §46's ordering is
untouched.** That cache is keyed by the *transcript's* mtime, and archiving a
session does not touch its transcript — so a flag cached there goes stale the
moment the user archives something and stays stale until the conversation
happens to change, which for a finished session is never. `archived` drives
`let_go`, so a stale `true` re-fires an agent the user rehired, on every poll,
forever (§46, §68). The flag has to stay keyed to the file that actually carries
it, and the app rewrites exactly that file when the user archives — so the flip
is still seen on the very next poll. The adapter continues to stamp `archived`
onto summaries *after* the summary cache, exactly as before; nothing about that
ordering moved.

**It never persists.** The whole point of that ordering is that this answer is
re-derived from the app's own store on every run, so a restart starts empty. An
in-memory cache is all the poll loop needs, and a persisted one would be the
§68 trap with a longer fuse.

**`fstat` off the open handle, not a second `statSync`.** The obvious shape —
stat every file, then read the ones that moved — costs a path lookup per file
that the old code never paid, and on a cold metadata cache that measured **30–50
ms** across 61 files, on a quiet machine: first scans went from ~95 ms to
125–146 ms, handing back on the first scan much of what the cache saves on
every later one. So a file is
`statSync`-ed only when there is a cached entry to compare it against; with
nothing cached it has to be opened anyway, and `readRecord` takes the stamp
from `fstatSync` on that handle. A cold run does one path lookup per file, as
it always did, which is why the first scan in the table is back at parity.

The stamp is taken **before** the read, deliberately. That direction can only
attribute new content to an old stamp, which the next poll re-reads; the
reverse attributes old content to the new stamp and pins it in the cache for
good.

**What it inherits from the summary cache, on purpose.** Copies out, never the
held object — the field a caller would be mutating is `archived`, which is the
§68 copy-out bug in the one store where that flag actually lives. A file the
app deleted loses its entry, so a daemon left running for months cannot
accumulate them; but an *empty listing* evicts nothing, because that is also
what an unreadable or momentarily missing store directory returns, and emptying
a good cache on it buys nothing but a re-read of 8.8 MB. A file that is
unreadable, corrupt, mid-write or simply not this store's shape yields no entry
and does not condemn the rest — and that verdict is cached too, so a store full
of files this adapter cannot use is not re-parsed on every poll either. No
runtime dependency was added, and every byte of format knowledge stayed inside
`src/adapters/`.

**The residual exposure, stated plainly.** `(mtime, size)` cannot see a change
that lands inside one filesystem timestamp tick *and* leaves the byte count
identical. That is the same exposure `src/core/summary-cache.mjs` already
accepts, and it is narrower here: archiving is user-paced, seconds apart at
worst, and `"isArchived":true` and `"isArchived":false` differ in length
anyway. It was not worth a content hash, which would mean reading all 8.8 MB
every poll — the exact cost being removed.

Eleven tests in `test/unit/claude-desktop-cache.test.mjs` — in-process, so they
can count the reads that did and did not happen, which `desktopSessionsDir()`
allows by reading the environment per call rather than at import — plus three
added to `test/unit/claude-scan-cache.test.mjs` for the same-process poll path
its start-to-start tests never reached. Each was confirmed to fail against a
deliberately broken build — a cache keyed on path alone, no cache at all, no
copy-out, and a cache that serves its entries when the store directory
disappears — so none of them is vacuous. One earlier draft *was*: a scan-level
copy-out test that could not fail, because the adapter mutates the summary and
never the desktop record. It was replaced rather than kept for the count.

## 79. The desktop store's read stops blocking, and stops parsing 155 KB for two fields

§78 cached this read and left two things on the table, which its own table
shows: a process's **first** scan barely moved (99.8–120.5 ms before,
94.2–100.0 ms after), because a cache miss still read and parsed a whole
~155 KB file — and it did all of it **synchronously, on the event loop**. A
cache turns "every poll" into "every change", but every change still costs
full price, and the daemon's HTTP server and SSE stream stop being served for
the duration.

Two further bounds, both in `src/adapters/claude-code/desktop.mjs`. The cache
from §78 is unchanged and so is its reasoning — including the `fstat`-on-the-
open-handle stamp, the copy-out on the way to the caller, and the empty-listing
guard on eviction.

**The reads are asynchronous.** `fsp` throughout, at the read concurrency of 8
the transcript scan uses. Results are still assembled in listing order, not
completion order, so two files claiming the same `cliSessionId` resolve the
same way on every poll — the sequential loop gave that for free and it had to
be kept deliberately.

**A miss reads a bounded head window, not the file.** 99.1% of every byte in
these files is one field, `remoteMcpServersConfig`, and `JSON.parse` was
building the whole object graph to answer two questions. A scanner walks the
JSON text instead: it records only `cliSessionId`, `isArchived` and `title`,
skips every other value without materialising it, and stops as soon as it has
all three — over an 8 KB prefix read off the handle that is already open.
Across the 57 session files measured, the last of the three sits at byte 397
(median), 507 (p95), 626 (worst), so 8 KB is thirteen times the worst case.

The scanner reads **top-level** keys only. A `cliSessionId` nested inside some
other object is not this session's id, and the app's own
`backgroundTaskSuggestions` really does carry nested session records — a regex
over the text would take the wrong one. Asserted.

Two fallbacks, because this is a store DeckHQ does not own and dropping a
session silently is worse than reading it slowly: a window that cannot answer
costs the whole file, and text the scanner cannot read still goes to
`JSON.parse`. So the scanner can be slower than what it replaced, never
blinder. Neither fires on any of the 61 files here; the `fullReads` counter on
`desktopCacheStats` counts them, and the tests assert which path ran.

Measured on this machine (Windows 11, **61** desktop session files, 60 of them
joinable, ~140 KB each), both arms in one process, interleaved and their order
flipped between passes so machine drift hit both equally: 4 passes, a first
call plus 8 warm polls each. "Longest block" is the largest gap between
consecutive event-loop turns, taken with a `setImmediate` chain — Windows'
~15.6 ms timer resolution puts a floor under any `setInterval` figure, which
is why §77 and §78 could only see this cost as wall time.

| | §78 (sync, whole-file parse) | this change |
|---|---|---|
| **First call of a process** | 116.6 ms (106.2–120.4) | **11.3 ms** (7.4–21.1) |
| First call, longest block | 116.7 ms (107.1–120.5) | **0.9 ms** (0.6–1.1) |
| Warm poll | 2.2 ms (1.4–8.3) | 2.5 ms (1.9–3.2) |
| Warm poll, longest block | 2.3 ms (1.4–8.3) | **0.8 ms** (0.5–1.0) |

And the case a running daemon actually meets — one archive flip, which
invalidates exactly one entry (synthetic store, 61 files of 220 KB, 11 flips):

| | §78 | this change |
|---|---|---|
| One changed file | 3.95 ms | **1.78 ms** |
| longest block | 4.06 ms | **0.36 ms** |

**The warm wall time did not improve, and is marginally worse** — 61
asynchronous `stat` calls cost a little more than 61 synchronous ones. That is
the honest result: §78 had already taken the warm path down to a stat per
file, and there was nothing left in it. What changed warm is the *blocking*,
2.3 ms to 0.8 ms, and what changed a great deal is everything that is not a
pure cache hit. `scanSessions` end to end on this machine: 86.2 ms first,
8.2 ms warm median (7.5–10.3), against the **< 50 ms** budget in
docs/02-ARCHITECTURE.md §8.

Behaviour is unchanged and was checked as such: over the real store both
versions return the same 60 entries, the same values, in the same order, and
all eleven of §78's own tests pass against this one untouched apart from the
`await`. §46's ordering is intact — the flag is still read once per scan and
still applied after the summary cache, and it is still keyed to the file that
carries it.

No new dependency, no network, and every byte of format knowledge is still
inside `src/adapters/claude-code/`.

## 80. WP-51: the debounce test is proved on an injected clock, not a widened window

**Spec:** WP-51 (`08-PLAN-V2-100X.md` §9) offers two remedies for the flaky
`save() debounces` test: "fake timers or a widened, explicitly documented
window."

**What actually failed.** Run 33756126370, `windows-latest`, Node 18 and 20,
the same assertion both times:

```
not ok 403 - save() debounces: no write appears before ~250ms, one appears after
  error: 'must have written after the debounce window'   false !== true
  duration_ms: 886.5 (Node 18)   1948.6 (Node 20)
```

The test slept 100 ms, looked, slept 300 ms, looked again — and at 400 ms the
file was not there. The durations say the sleeps were honoured (the test took
0.9 s and 1.9 s end to end against a 0.4 s script), so it was not only the
timer arriving late: `_writeNow()` is `mkdir` + `writeFile` + `rename`, and on
a shared Windows runner under the full matrix, 150 ms of slack for three
filesystem calls was not enough. That rules out the widened window. Any sleep
length is a guess about a machine we do not own, and the test would keep the
same shape — two looks at the disk with a wall clock in between.

**Shipped.** The store's debounce clock is injectable. `new Store(file, {
timers })` takes `{ setTimeout, clearTimeout }` in the shape of the globals and
defaults to them, so `src/daemon.mjs` constructs the store exactly as before.
`SAVE_DEBOUNCE_MS` is exported. The test hands in a clock it cranks by hand
and asserts, in order:

1. no file synchronously after `setAck()`;
2. exactly one timer scheduled, for exactly `SAVE_DEBOUNCE_MS` — the debounce
   exists and is the documented one;
3. after the event loop turns, still no file — nothing but that timer can
   reach the disk, so this cannot flake in either direction;
4. fire the timer, `await store.flush()` — the public API, which with no timer
   pending awaits only the write in flight — then the file exists with the
   expected record, and nothing was rescheduled.

The sibling "rapid successive writes coalesce" test slept 350 ms for the same
reason and now proves the stronger thing directly: three mutations inside one
window share one timer. `flush()`'s own tests were already deterministic.

**Why not `node:test`'s `mock.timers`.** It arrived in Node 20.4; `engines`
says `>=18` and CI runs 18. Mocking the globals would also have reached into
every other timer in the process, where an injected clock touches exactly the
one under test.

**Measurement.** `npm test` three times locally: 443/443, 443/443, 443/443;
the file alone three times, 13/13 each. What cannot be produced here is the
acceptance criterion itself — ten consecutive green runs on `main` across all
nine combinations — because it is CI's to produce after the merge.

## 81. WP-43: the manifests are release assets, and winget and scoop install a zip

**Spec:** WP-43 (`08-PLAN-V2-100X.md` §9) item (3): "Homebrew tap, winget and
scoop manifests from the same workflow." `07-AGENT-HANDOVERS.md`: "a tag
publishes to npm with provenance, creates the GitHub Release, and generates the
Homebrew, winget and scoop manifests." The orchestrator's brief for this
package: generate all three in the job and "upload them as release assets
(simplest correct option)".

**Shipped as briefed, with these departures from the plan text recorded.**

1. **No tap, no bucket, no winget-pkgs PR — release assets instead.** A
   Homebrew tap is a second repository (`homebrew-deckhq`), a scoop bucket is
   a third, and `winget install DkPanseriya.DeckHQ` is a reviewed pull request
   to `microsoft/winget-pkgs`. None of the three exists, and a workflow with
   `contents: write` on *this* repository can create none of them. The job
   renders the five manifest files and attaches them to the release; each is
   usable from there today (`brew install --formula ./deckhq.rb`, `winget
   install --manifest <folder>`, `scoop install <url-to-deckhq.json>`), and
   each is exactly what gets committed to the tap, bucket or PR when those
   exist. `packaging/README.md` says so, per asset. **RAISE:** whether to
   create the tap and bucket repositories, and under which account, is the
   owner's call — the workflow can push to them once they exist and a token
   with access is provided, and not before.

2. **winget and scoop install a zip, not the npm tarball.** Neither can
   install an npm package: winget's installer types are exe/msi/msix/zip/
   portable and scoop shims executables. The job unpacks the published
   tarball, adds `packaging/deckhq.cmd` — two lines, `node
   "%~dp0package\bin\deckhq.mjs" %*` — and zips the result, then both
   manifests point at that zip with Node declared as a dependency
   (`OpenJS.NodeJS.LTS`, `nodejs-lts`). The installed tool is byte-for-byte
   the registry's; the launcher is the only addition. Homebrew installs the
   registry tarball directly. The zip's sha256 is computed in the job and the
   tarball's is checked against the registry's own `dist.integrity` before it
   is used, so neither manifest can carry a digest of bytes a user will not
   receive.

3. **A changelog gate before the publish.** Not in the plan. The release
   job's notes are the `## X.Y.Z` section of `CHANGELOG.md`; finding it missing
   after `npm publish` would leave a version on the registry with no release
   page and no way back. The publish job now runs
   `scripts/release/changelog-section.mjs "$TAG"` before `npm publish` and
   stops if the section is absent. The same check is a unit test — the version
   in `package.json` must have a section — so `npm test`, and therefore
   `prepublishOnly`, fails on a bump without an entry. That is a new failure
   mode for anyone bumping the version locally; it is the intended one.

4. **`npm@^11.5.1`, asserted, instead of `npm@latest`.** Per the brief. A
   tag push should not pick up whatever npm major shipped that morning; the
   trusted-publishing floor is what matters, and a step now proves the
   installed version meets it instead of assuming it.

5. **`gh release create`, not a marketplace action.** The GitHub CLI is on
   every hosted runner and is the same command `RELEASE-CHECKLIST.md` step 12
   already documents, so the workflow and the hand procedure agree. A re-run of
   the job after a partial failure finds the release already there and
   re-uploads the assets onto it rather than failing.

6. **`Architecture: neutral`** in the winget installer manifest, because a
   Node script is. A `winget-pkgs` reviewer may ask for `x64`; the generator
   is one line to change.

7. **The workflow defaults to `contents: read`.** The `release` job's comment
   claimed it was the only job in the file that can write to the repository,
   and that was not yet true: `verify` named no permissions at all, so its
   token took whatever the organisation's default scope is, which for a
   repository created before the read-only default is read-write. A
   workflow-level `permissions: contents: read` makes the claim structural —
   `release` raises itself and nothing else can. Verified by parsing the file:
   `verify` inherits read, `publish` is `contents: read` + `id-token: write`,
   `release` is the sole `contents: write`.

8. **`*.cmd text eol=crlf` in `.gitattributes`.** `.gitattributes` sets
   `* text=auto eol=lf`, so `packaging/deckhq.cmd` left a checkout with LF
   endings — including the Linux checkout in the `release` job that zips it
   for Windows users. `cmd.exe` tolerates LF for a two-line script and stops
   tolerating it as soon as one has a label or a `goto`, which is a trap for
   whoever edits the launcher next rather than a bug today. The launcher is
   now the one file in the tree checked out with CRLF.

**Measurement.** What could be verified on this machine: `publish.yml` parses
(js-yaml) into three jobs, with `contents: read` at the workflow level and
`contents: write` on `release` alone; `scripts/release/manifests.mjs` renders
against the real `package.json` and the three winget documents parse with
js-yaml; `changelog-section.mjs 1.2.0` prints the section and exits 1 for a
version with none; the npm floor comparison accepts 11.5.1, 11.6.0 and 12.0.0
and exits 1 for 11.5.0, 11.4.9 and 10.9.4; ten unit tests over both scripts;
`npm test` (453), `npm run lint`, `npm run format:check` green.

The zip step was rehearsed by hand, which is as close to the job as this
machine gets: `npm pack` produced the 42-file tarball, `tar -xzf` into a
staging directory satisfied the job's own `test -f
stage/package/bin/deckhq.mjs` guard, `packaging/deckhq.cmd` went in beside
it, and the launcher then **ran from that layout** — `deckhq.cmd --version`
printed `1.2.0` (which is also exactly what the Homebrew formula's `test do`
block asserts) and `deckhq.cmd doctor` printed a report. So the one thing in
the packaging path that is easy to get wrong and impossible to spot in YAML —
the relative path from the launcher to the bin — is proved rather than
reasoned about.

What could not: the release job itself. It has never run, and it cannot run
without a `v*` tag, which is the irreversible publish. The registry-side
retry, the `dist.integrity` cross-check, `zip` and `gh` on the runner, and
the asset upload are all written against documented behaviour and unexecuted.
WP-43's acceptance — "a `vX.Y.Z` tag produces a published package with the
provenance badge and a release page with no manual step after the tag" — is
still the owner's next tag to produce, after the one-time trusted-publisher
setup in the workflow's header.
## 82. WP-53 · The review follow-ups on the perf code: what closed, what is accepted, what was left to its owner

`08-PLAN-V2-100X.md` WP-53 lists five risks from the review of PRs #1–#4.
Four are closed here with tests; one is a documented, measured exposure rather
than a fix; one belongs to a file another agent owns and was not touched.

**(1) `pidAlive()` on Windows — verified, unchanged.** The function treats
`EPERM` as alive and everything else as dead, and the review asked whether a
vanished pid on Windows really surfaces as something other than `EPERM`. It was
measured rather than read off libuv's source, on the reference machine
(Windows 11, Node 24):

| `process.kill(pid, 0)` against | throws |
|---|---|
| a child that ran and exited | `ESRCH` |
| a pid that never existed (`0x7ffffffe`) | `ESRCH` |
| a child killed by us, handle still held by this process | `ESRCH` |
| the protected System process (pid 4) | `EPERM` |
| a live child | nothing |

So the two-way reading holds on Windows, where libuv answers signal 0 with
`OpenProcess` + `GetExitCodeProcess` rather than a signal: an exited process
whose handle someone still holds is reported by its exit code, not as alive.
4000 calls cost 53.5 ms, 13 µs each — §77's 0.055 ms per roster stands. A test
now spawns a real child, waits for it to exit, and asserts the roster retires
it within one poll and without a spawn; the existing test used only a pid that
never existed, which on Windows is a different code path.

**(1b) Pid reuse inside the 60 s TTL — accepted, bounded, measured.** The
review's case: a session exits and the OS hands its pid to another process
before the next probe, so the pid check reads the impostor as the session.

What the code already did, now pinned by a test: a pid the check has once seen
dead is *removed* from the cached roster, and nothing short of the next probe
puts a session back. So a pid reused *after* the check saw it dead cannot
resurrect anything — the roster is corrected by removal, not re-evaluated
every poll. The exposure that leaves is narrower than the review stated: the
exit **and** the reuse must both land inside one poll interval (5 s), before
any check ran. Only then does the impostor read alive, and it does so until the
TTL probe — up to 60 s.

How likely is that, on the platform that reuses pids most eagerly? Measured
here: 300 sequential `cmd /c exit` spawns in 9.7 s produced 16 reused pids; a
pid came back after a **minimum of 123 and a median of 155** further process
creations, the first reuse 4.8 s in. So the reuse half of the window needs on
the order of 25 process creations a second sustained across the 5 s the check
is blind, on top of the session exiting in that same 5 s. On Linux pids are
allocated sequentially up to `pid_max` and reuse inside 5 s needs thousands of
spawns a second; macOS is sequential to 99998.

Mechanisms weighed for closing it, and why none was taken:

- **Process start time as identity.** The right fix, and cheap only on Linux
  (`/proc/<pid>/stat`). Windows has no Node API for it; macOS needs `ps`.
  Both mean a spawn per pid per poll — the exact cost §77 removed — for a
  window that is narrowest precisely where a spawn-free check exists.
- **Force a probe when identity is uncertain.** The suggestion in the plan.
  Nothing cheap distinguishes "same pid, same process" from "same pid,
  different process", so there is no signal to trigger on. Forcing a probe
  whenever *any* roster pid died would spend a 609 ms spawn on the common
  transition the pid check handles for free, and would not help the case in
  question, which by definition no check saw.
- **Hooks.** Not a mechanism to add — it is already the answer where it
  matters. `SessionEnd` is authoritative and `_computeAgents` prefers
  `hookLive` over this roster whenever hooks are installed, so the exposure
  exists only on the degraded path. WP-36 (§83) removes the commonest way of
  ending up on that path by accident.

And what a wrong `live` costs if it happens: nothing user-owned. `live` is an
observation; `for_review` is sticky through it either way. The worst outcome is
a desk drawn occupied for up to 60 s after its session left.

So the window is accepted and stated in the code, here, and in a test that
pins its size: the impostor may read alive at TTL−5 s and must be gone the
moment the TTL probe answers. A third seam, `alive`, was added beside `probe`
and `now` so a pid can be made to die and return on cue without a real process.

**(2) and (5) The head-window scanner's cut cases.** Three tests against the
scanner directly — `_scanTopLevelFields`, exported for tests only — and three
end to end through `readDesktopSessions`, where `fullReads` proves the fallback
ran rather than the answer merely coming out right: a window cut inside a
string, one cut inside a number (five digits inside the window, five outside),
and one whose last byte is the backslash of an escaped quote — read only the
head, the string is unclosed; read naively past the backslash, the quote
looks like a close. All three answer null from the window, take the whole file,
and return the right fields. `endOfString()` on `"abc\` at end of text stays in
bounds and returns −1; the direct test also covers `\u00` cut mid-escape, an
escaped backslash then EOF, and the two complete-escape cases that must
decode. No scanner change was needed; the tests confirm the behaviour that was
there.

**(4) The desktop-cache mtime pins are proven, not assumed.** The tests pinned
mtimes in whole seconds and never checked the pin took. That let the "size
moved but mtime did not" test pass for the wrong reason on any filesystem that
rounded the timestamp — the re-read would have come from the mtime moving. The
helper now sets a millisecond value with a non-zero fraction of a second
(`…000_250`, `…000_750`), reads `mtimeMs` straight back, and asserts equality;
the size-only test additionally asserts the re-pinned value equals the first.
Round-trips exactly on NTFS here; a filesystem where it does not will now say
so instead of passing.

**(3) `publish.yml` — not touched.** The npm floor for trusted publishing is
another agent's file in this pass, so WP-53's fifth item and the second half of
its acceptance criterion ("`publish.yml` fails loudly on an npm below the
trusted-publishing floor") are not delivered by this package. Recorded so the
orchestrator does not accept WP-53 on the strength of this commit alone.

## 83. WP-36 · The daemon adopts the hooks' port, and refuses to start beside a DeckHQ that already has it

`08-PLAN-V2-100X.md` WP-36. Shipped as specified, with three decisions the
package description did not settle.

**The failure this removes.** Hooks are written with the port the daemon had at
install time. A daemon started later on a different port — the 4317 default
after an install on 4400, or 4318 after the `EADDRINUSE` walk — is the one
broken state that looks healthy from every surface at once: the settings file
is valid, the header claims exact state, and every hook event posts into a
void. §75 gave `doctor` the job of reporting it. This stops the daemon
creating it.

Now, with no port named: if the installed hooks post to a free port, the daemon
listens there and logs one line saying why. The header then reads `installed`
and the reinstall banner does not appear.

**Decision 1 — an explicit port is never overridden.** Adoption is a CLI
decision, passed to `startDaemon` as `adoptHooksPort` and off by default;
`--port 4400` and `DECKHQ_PORT=4400` both suppress it. Naming a port is a
request to be on that port, and the banner is the honest report of what that
costs. `DECKHQ_PORT=` (set but empty) reads as unset, because that is what a
shell wrapper clearing the variable means. Embedders and the 400-odd tests that
pass a port keep the old behaviour untouched — nothing in the suite changed.

**Decision 2 — the hooks' port held by another DeckHQ is a refusal, not a
walk.** The plan says "exit with a one-line message naming it". Starting
anyway would bind 4318 and produce precisely the degraded daemon this package
exists to prevent, with the added insult that the healthy one next door is
getting all the events. So `startDaemon` throws `DeckhqAlreadyRunningError`
**before the store is opened or anything is bound** — the refusal leaves no
trace, and a test asserts the requested port is still free afterwards — and
`bin/deckhq.mjs` prints one line with the URL and exits 0. Exit 0, not 1:
"DeckHQ is already up" is the state the user wanted. A test spawns the real
binary to assert one line of stdout and no start banner, because §76 is the
standing reminder that a command's contract includes how it ends.

**Decision 3 — a stranger on the hooks' port falls back rather than fails.**
Something else on 4400 is not ours to reason about. The daemon logs what it
found, starts on the requested port, and the header's banner offers the
reinstall as before. "Ours" is identified the way §75's `doctor` identifies a
daemon — a well-formed `/api/state` snapshot — so the two surfaces cannot
disagree about what a DeckHQ is.

**Cost, measured.** Two loopback round trips at most, once, before the server
binds: a bare TCP connect (refused immediately when the port is free; 500 ms
ceiling) and, only when something answered, one `/api/state` fetch with a
1500 ms ceiling. On the common path — hooks installed, port free — it is the
settings read plus one refused connect: **median 0.87 ms** over 20 runs on the
reference machine, min 0.28, max 9.8. Nothing is added to the poll loop, and
nothing is added to a start that names a port.

**Accepted limits.** The port is taken from the first adapter that reports one,
so a machine whose two runtimes' hooks point at different ports adopts the
first and leaves the second's banner up; there is one hook-capable adapter
today and no honest way to satisfy both. Adoption reads the settings file once
at startup, so hooks reinstalled at another port while the daemon runs are not
followed — the reinstall in the header aims at the running daemon, which is the
only way that happens in practice.

## 84. WP-44 · `doctor --share`: what the pasteable block leaves out, and the one line the PM still owns

`08-PLAN-V2-100X.md` WP-44: "prints a fenced block of the report with no
paths, no project names and the pitch line as the last line. Governed by the
same honesty tests as §74." Shipped as `deckhq doctor --share`. Four decisions
the description left open.

**Decision 1 — the block is the whole report, not a highlight.** The temptation
in a launch asset is to print the biggest number and stop. What makes this
postable is that a reader can run the same command on their own machine and
check it, so the block carries every row the report does — including
`waiting on you 0`, which on the reference machine is what it says today. A
selected highlight would make the asset unfalsifiable, which is the failure
mode §74 was written after.

**Decision 2 — what is dropped, and why each one is not a number.** Against
`renderReport`: the state **path** (its verdict, writable or not, stays — that
is the part a reader can act on); every free-text problem, note and
per-runtime error; and the hook port. The free text is where a path actually
lives in practice — an adapter error is a filesystem error and names the file
it failed on — and none of it means anything to a stranger. When the report is
not `ok`, the block says `! 2 problems — run \`deckhq doctor\` here for the
detail`: the count is the honest part, the message is the private part. The
port is dropped because a port number tells a reader nothing about whether
hooks are delivering, which is what the row is for.

**Decision 3 — the date is to the day.** A UTC timestamp to the hour would
publish when a person was at their desk, in exchange for nothing.

**Decision 4 — a redaction pass, even though nothing should reach it.** Project
names cannot leak by construction: `collectReport` turns working directories
into a distinct count and never keeps the strings, and the block is assembled
from counts and fixed phrases. Two fields are still strings this file did not
write — a runtime's `version()` and an adapter's error message — so
`redact()` runs over the assembled text and replaces the home directory and
anything hanging off it, `C:\…` and `C:/…`, `\server\share`, `~/…`, absolute
POSIX paths, and the machine's own name. It is defence in depth for a block
whose whole purpose is to be pasted somewhere public, and it is unit-tested
directly, including the two cases that made it non-obvious: the
separator-swapped home directory is a substring of the real Windows path
(`C:\Users\ada` contains `\Users\ada`, and replacing only the tail would leave
`C:[path]` behind), so home matching is anchored at the start of a token; and a
hostname shorter than three characters is indistinguishable from a word, so it
is left alone rather than shredding the text it exists to protect. A test
pins that the report's own vocabulary — `70 sessions across 18 projects`,
`127.0.0.1`, `none. no outbound sockets.` — passes through untouched.

**Flag behaviour.** `--share` prints the block and nothing else: it is meant to
be selected whole or piped into a clipboard command, and a second copy of the
same numbers above it makes both jobs harder. With `--json` the block becomes
one more field (`share`, `null` when the flag is absent), because "exactly one
JSON document on stdout" is that mode's contract. The exit code is the
report's, unchanged.

**Acceptance, checked.** Nine new tests: the fence and the pitch as its last
line inside it; the absence of the fixture's two scanned directory names
(`/Users/ada/skunkworks-alpha`, `C:/Dk/Projects/ClientAcme`) and of their
fragments; the absence of any path shape, the state path, the machine name and
the port; a problem counted rather than quoted; `redact()` directly; the three
flag surfaces (`--share`, `--share --json`, `--help`); and a machine with no
runtime and no daemon, where the block must still be honest and printable. Two
existing tests were amended: the `--json` shape test now pins `share` in the
document's key set, and the §74 honesty invariant runs against three surfaces
rather than two — the report, the proof card and this block — so the retired
overclaim cannot come back through the launch asset. 458 tests to 467.

**Left to its owner.** The pitch itself. `07-AGENT-HANDOVERS.md` gives the PM
the wording review of this asset, so the line is the named export `PITCH` in
`src/cli/doctor.mjs` rather than a string inside a template, and today it is
one line condensed from `08-PLAN-V2-100X.md` §1.3:

> DeckHQ — every AI coding session on your machine, on one office floor. npx deckhq · local, private, MIT.

§1.3's full pitch is three sentences and 40 words; a block that people paste
into a thread earns one line, and the sentence that was cut ("it sees the ones
your terminal forgot, and it remembers what's waiting on you even after you've
read it") is the one the rows above it are already demonstrating. That is a
judgement about copy, not about code, and the PM's to overrule.
## 85. WP-08's review card: seven small departures from `05` §4

The layout, the markdown rendering, the "what changed" section and the three
weighted keys all landed as specified. Seven things differ from the letter of
`docs/plan/05-GUI-UX-SPEC.md` §4 and `06-ENGINEERING-WORKPLAN.md` WP-08, none
of them a judgement call anyone should have to reconstruct from the diff.

**1. `git diff --numstat`, not `git diff --stat`.** §4.2 and WP-08 both name
`--stat`. `--stat` is the human form: it truncates long paths with `…`, pads to
the terminal width, and scales its bar graph, so parsing it back into numbers
means undoing formatting that is deliberately lossy. `--numstat` is the same
three figures, tab-separated, with paths intact and binary files reported as
`-  -`. The section renders the identical content — `+142  −18  3 files` over
per-file rows — so this is a change of source, not of what is shown.
`test/unit/changes.test.mjs` pins the parse, including a rename (which
`--numstat` gives as `old\tnew`, and the reader wants the new path) and a
binary file (which shows `bin` and no counts).

**2. `[ open the diff ]` is not there.** The §4.1 mockup ends the changes
section with that button. It is WP-47 (`05` §12, "in-panel diff and open in
editor", `2d`, `P1`, listed as *after WP-08*), so shipping it here would be
building the next package. The section ends at the file table.

**3. The renderer is 259 lines of code, not "~150".** WP-08's estimate was for
"headings, paragraphs, lists, fences, inline code, bold, italic and
links-as-text". `public/markdown.js` covers all of that plus block quotes,
thematic breaks, nested lists and ordered lists with their real start number —
because agents write those, and an unhandled block falling through to a
paragraph turns a nested list into one run-on line. The estimate was for the
narrower subset and was not wrong about it; the two-stage split it asks for
(`parseMarkdown()` touches no DOM at all; `renderMarkdown()` builds it) is what
made the wider coverage cheap and is what the `SECURITY:` test can check.

**4. The rest of the conversation is behind a disclosure the mockup does not
show.** §4.1 draws `WHAT IT SAID` and nothing beneath it, and §4.2 explains
why: the last message is "the first thing you see". But the earlier turns
cannot simply be deleted from the panel — they were reachable before this
package and reviewing a reply sometimes needs the question. They sit in a
closed `<details>`: *earlier in this conversation · 2 messages*. Closed by
default, so the reading order §4.2 wants is intact, and one click from the
material it hides.

**5. The third key is not always Bench.** §4.2 specifies `3 Bench`. Bench is
not a legal action on an agent that is already benched, and a key wired to an
illegal action either does nothing or needs an error. Slot 3 therefore carries
the state's own third action: `Bench` for anyone on the floor, `Recall` for
someone in the lounge, `Rehire` for someone let go — read off `legalActions()`,
which already existed. For every agent the review card is actually about, it is
Bench.

**6. `no-repo` is a fifth outcome.** WP-08's accepted-when names four: dirty,
clean, no git, deleted directory. A directory that exists and simply is not a
repository is none of those, and it is the common case for anyone who runs an
agent in a scratch folder — three of the six demo projects. It reads *"not a
git repository"*, distinct from *"git is not installed, so nothing here can be
read"* (`no-git`), because the two ask different things of the reader. All five
are asserted.

**7. `approveText` has no settings UI.** §4.2 requires the affirmative to be
configurable and it is — `DEFAULT_SETTINGS.approveText`, patchable over
`PATCH /api/settings`, trimmed, capped at 500 characters and falling back to
`"Yes, go ahead."` when blank, because an approve key that sent an empty string
would be a silent no-op. There is no control for it because, per §5.4, there is
no settings surface in the product at all yet; it joins stall window, poll
interval and the rest as API-only until that sheet is built. The button's
tooltip shows what it will send, so the current value is never a secret.

**The invariant, checked statically rather than trusted.** WP-08's last
accepted-when — *no path in this package calls `/api/ack` except an explicit
button or number key* — is a claim about code that no behavioural test can
make, so `test/unit/panel-invariant.test.mjs` reads the client source with
comments stripped and asserts it: `/api/ack` appears exactly once in
`public/panel.js` and nowhere else under `public/`; that one call sits inside
`performAction()`; `open`, `close`, `refresh`, `renderChrome`, `renderSaid`,
`renderThread`, `renderChanges`, `loadConversation`, `loadChanges`,
`loadResumeTargets` and `sendText` contain no call to it; `app.js` reaches it
exactly twice, both inside `handleKeydown`. It also asserts that `2 Approve`
routes to `sendText()` and never to ack — the review is discharged by the
daemon when the runtime records the user turn, never by the client guessing —
and that keys `1` and `2` reach `performAction` not at all. The same file
carries the `SECURITY:` sweep: no module under `public/` mentions `innerHTML`,
`outerHTML`, `insertAdjacentHTML`, `DOMParser` or `createContextualFragment`.

**What the screenshot proves** (`docs/media/panel-review-card.png`, rule 10).
The demo floor's `for_review` fixtures now carry markdown — a paragraph, a
bulleted list with inline code, a fenced block — and the fixture builds real
working trees under its own temp root, one of each shape the section draws: a
dirty repository, a clean one, three plain directories, and one project whose
directory does not exist. So the panel in that PNG is reading real
`git diff --numstat` output, and it reports `+142  −18  3 files` over
`src/events/backfill.ts +98 −4`, `src/events/index.ts +21 −8`,
`test/backfill.test.ts +23 −6` — §4.1's own numbers, at §4.1's own
`waiting 1d 2h`. Reproduced with
`npm run demo` and
`node scripts/capture-floor.mjs --url http://127.0.0.1:4499/ --width 1600 --height 1000 --settle 9000 --press j --out docs/media/panel-review-card.png`;
`--press` now takes a sequence of keys rather than one, so a shot can be aimed
at a chosen place in the needs-you queue.

**Two things the fixture changed that are not about the panel.** The demo's
project directories used to be `C:\code` or `~/code` — paths it never created
and only ever named. The review card reads the working tree, so they had to
become real, and they are created inside the fixture root that the demo already
removes on exit; nothing is written outside it, and a machine without `git`
still gets a floor (the repositories are skipped, and the section says so).
## 86. WP-19 spike — `PermissionRequest` is real, and its response shape is not the documented one

**Go.** The route in [`08`](plan/08-PLAN-V2-100X.md) §3.0.2 / B4 holds: a
`PermissionRequest` hook of type `http`, pointed at the daemon, can answer a
permission prompt raised by an interactive Claude Code session DeckHQ never
spawned, and silence falls back to the terminal prompt. Two things in the plan
are wrong in detail and one is wrong in kind; all three are cheap to fix and
none of them blocks the build.

Measured against **Claude Code 2.1.231 native, win32-arm64, commit
`bbff368ec698`**, the build on the reference machine on 3 September.

### 86.1 What was verified by experiment, and what was not

The end-to-end run — a live session raising a prompt, DeckHQ answering it, the
session continuing — **could not be executed.** The CLI's stored OAuth token is
expired (`claude auth status` reports `loggedIn: true`, every inference call
returns `401 OAuth access token has expired. Re-authenticate to continue.`), no
`ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` is available to a child
process, and re-authenticating is an interactive browser flow an agent must not
perform. So no tool call could be provoked, and the listener registered for the
attempt was never called.

That is the honest boundary, and by rule 11 in `08` §1.1 it means the
acceptance criterion in WP-19 — _"verified end to end on the reference
machine"_ — is **not yet met and must be met before this feature appears in a
README, a tweet or a pricing page.** What follows is verified by two weaker
methods that between them still settle every question the spike was asked,
because the second one reads the shipped implementation rather than its prose.

**Verified by experiment** (ran on this machine):

- `claude doctor` validates the `hooks` block of settings files in the working
  directory and names the failing path. A block with `"type": "https"`,
  `"url": "not a url"` and `"timeout": -5` is rejected with
  `hooks.PermissionRequest.0.hooks.0.type: Invalid input`. The same block with
  `"type": "http"`, a loopback `url`, a `timeout`, a `statusMessage` and an
  extra `"_deckhq": true` validates **clean**. So `PermissionRequest` is a
  recognised event, `http` is a legal type for it, and the tagged-entry
  discipline the existing hooks use in `src/adapters/claude-code/hooks.mjs`
  survives validation unchanged — unknown keys are tolerated, not rejected.
- `--permission-prompt-tool mcp__x__y` is still accepted by the argument parser
  on 2.1.231 (it fails later, at auth, not at parse) but it is **no longer
  listed in `claude --help`**. It is a hidden flag now. See §86.8.
- `--settings <file>` layers a settings file on top of the real scopes without
  writing to any of them. This is the safe way to run the spike, and it is what
  `scripts/spike-permission/settings.sample.json` is for. Nothing was written to
  `~/.claude/settings.json` at any point.
- The prototype in `scripts/spike-permission/holding-endpoint.mjs` holds a
  `PermissionRequest` POST open indefinitely, lists it on `GET /pending`, and on
  `POST /decide` answers the held socket with a body that matches the runtime's
  own parser schema below. Driven with a realistic payload it returned:

  ```json
  {"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow",
   "updatedPermissions":[{"type":"addRules","rules":[{"toolName":"Bash","ruleContent":"npm test:*"}],
   "behavior":"allow","destination":"session"}]}}}
  ```

**Verified by reading the installed build.** The 2.1.231 native binary embeds
its JavaScript as readable text, so the zod schemas and the permission pipeline
can be read straight out of `~/.local/share/claude/versions/2.1.231`.
Everything in §86.2–§86.5 is quoted from there. This is stronger evidence than
the documentation, and in one important case it **contradicts** it.

**Read from documentation only:** the Codex side (§86.7) and the
`--permission-prompt-tool` output contract (§86.8).

### 86.2 The request payload

Built by `executePermissionRequestHooks`:

```js
let l = { ...fg(n.session, Wt(), o, n),
          hook_event_name: "PermissionRequest",
          tool_name: e, tool_input: r, permission_suggestions: i };
```

and `fg` is the common-field builder:

```js
return { session_id: e.id, transcript_path: oH(e.id), cwd: t,
         prompt_id: PZe() ?? undefined, permission_mode: r,
         agent_id: n?.agentId, agent_type: o, effort: a };
```

So the POST body is:

```json
{
  "session_id": "bf6a1bf1-…",
  "transcript_path": "…/.claude/projects/…/….jsonl",
  "cwd": "C:\\Dk\\Projects\\1_Project_DeckHQ",
  "prompt_id": "550e8400-…",
  "permission_mode": "default",
  "agent_id": "…",
  "agent_type": "general-purpose",
  "effort": { "level": "…" },
  "hook_event_name": "PermissionRequest",
  "tool_name": "Bash",
  "tool_input": { "command": "npm test", "description": "Run test suite" },
  "tool_use_id": "toolu_01ABC…",
  "permission_suggestions": [
    {
      "type": "addRules",
      "rules": [{ "toolName": "Bash", "ruleContent": "npm test:*" }],
      "behavior": "allow",
      "destination": "localSettings"
    }
  ]
}
```

`permission_suggestions` is **not in the documentation** and it is the single
most useful field in the payload: it is the array of permission updates the
terminal prompt itself would have offered as "don't ask again for this". It
gives the panel its third button for free, with the runtime's own rule text
rather than a rule DeckHQ guessed. `tool_use_id` is the natural correlation key.
Everything DeckHQ needs to render a card — which session, which project, which
tool, the literal command — arrives in one POST.

### 86.3 The response shape. The docs are wrong here

The prose documentation at `code.claude.com/docs/en/hooks` presents

```json
{ "hookSpecificOutput": { "hookEventName": "PermissionRequest",
                          "decision": "allow" } }
```

with sibling `reason`, `updatedInput`,
`updatedPermissions: {allow, allowForSession}` and `interrupt` fields. **The
installed build accepts none of that.** Its parser is a discriminated union in
which `decision` is an **object**:

```js
be({ hookEventName: It("PermissionRequest"),
     decision: vs([
       be({ behavior: It("allow"),
            updatedInput: no(F(), oo()).optional(),
            updatedPermissions: gt(uRt()).optional() }),
       be({ behavior: It("deny"),
            message: F().optional(),
            interrupt: qt().optional() })
     ]) })
```

Three consequences:

1. `decision` is `{ "behavior": "allow" | "deny", … }`. A bare string fails
   validation, and a failed hook body is a non-blocking error — the decision is
   simply not applied and the prompt stays on screen. **A DeckHQ that emitted
   the documented shape would look like it was doing nothing at all.**
2. There is **no `"ask"` behaviour** in the hook's output union, and no `reason`
   on the allow branch. "Leave it to the terminal" is expressed by answering
   nothing, not by an `ask` decision.
3. `updatedPermissions` is an **array** of permission-update objects, not the
   documented `{allow, allowForSession}` object:

   ```js
   uRt = OE("type", [
     be({ type: It("addRules"),          rules: gt(C7o()), behavior: k7o(), destination: sMr() }),
     be({ type: It("replaceRules"),      rules: gt(C7o()), behavior: k7o(), destination: sMr() }),
     be({ type: It("removeRules"),       rules: gt(C7o()), behavior: k7o(), destination: sMr() }),
     be({ type: It("setMode"),           mode: cln(),                       destination: sMr() }),
     be({ type: It("addDirectories"),    directories: gt(F()),              destination: sMr() }),
     be({ type: It("removeDirectories"), directories: gt(F()),              destination: sMr() })
   ])
   C7o = be({ toolName: F(), ruleContent: F().optional() })
   k7o = Mr(["allow", "deny", "ask"])
   sMr = Mr(["userSettings", "projectSettings", "localSettings", "session", "cliArg"])
   ```

So the three buttons are:

| Panel                       | Response body                                                                                                              |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Allow**                   | `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}`                              |
| **Deny**                    | `…"decision":{"behavior":"deny","message":"Denied from DeckHQ."}`                                                           |
| **Allow for this session**  | `…"decision":{"behavior":"allow","updatedPermissions":[ <a suggestion from the request, `destination` rewritten to `"session"`> ]}` |

`destination: "session"` is the whole "for this session" mechanism, and it is
why §86.2's `permission_suggestions` matters: DeckHQ retargets a suggestion it
was handed rather than minting rule syntax of its own. `"userSettings"`,
`"projectSettings"` and `"localSettings"` write to the user's settings files and
**DeckHQ must never send them** — that is a permanent grant made from a web
panel, and it is not the button the panel offers.

Two further clauses in the consumer bear on the build:

- `interrupt: true` on a deny also calls `abortController.abort()`, killing the
  turn. DeckHQ's Deny must **not** set it. Denying a command is not the same as
  stopping the agent, and the two must stay separate actions.
- `if (!g.updatedInput && e.requiresUserInteraction?.()) return null` — for
  tools whose approval card _is_ the interaction surface (`AskUserQuestion`,
  `ExitPlanMode`, MCP tools flagged `anthropic/requiresUserInteraction`) a hook
  allow is discarded and the user must answer in the session. The runtime's own
  remote-control wire carries the matching flag and describes it as _"True when
  one-tap Approve/Deny must not be offered … Either way the user has to open the
  session to answer."_ The panel needs a fourth state for this: **"answer in the
  terminal"**, with no buttons. See §86.5.

### 86.4 The `http` type, its timeout, and silence

The `http` hook schema, verbatim from the build:

```js
be({ type: It("http"), url: F().url(), if: dln(),
     timeout: ct().positive().optional(),   // seconds
     headers: no(F(), F()).optional(),
     allowedEnvVars: gt(F()).optional(),
     statusMessage: F().optional(),
     once: qt().optional() })
```

- **Timeout.** `var Ng = 600000` and
  `executePermissionRequestHooks(…, a = Ng)` — the default is **600 000 ms, ten
  minutes**, per request, and `timeout` overrides it in seconds. Ten minutes is
  a genuinely useful hold. It is not the 30 s that `UserPromptSubmit` gets
  (`var AWu = 30000`).
- **The body.** `POST`, `Content-Type: application/json`, response parsed by the
  same JSON-output schema as a command hook's stdout. An empty body is _"HTTP
  hook returned empty body, treating as empty JSON object"_; a body not starting
  with `{` is _"HTTP hook must return JSON, but got non-JSON response body"_.
  Both are non-blocking errors: no decision, prompt stays.
- **Silence falls through, confirmed in code.** The consumer loops the hook
  results and returns a decision only on `behavior === "allow" | "deny"`;
  otherwise it falls out of the loop and returns `undefined`. No hook, no
  answer, a malformed answer, a refused connection, a closed daemon — all the
  same: the terminal prompt is what happens. **A closed DeckHQ cannot block a
  session.** This is the load-bearing fact for B4 and the one that was most
  worth checking.
- **The terminal prompt is shown _while_ the hook runs.** The hook is fired as a
  detached task beside the prompt UI (`if (!s) (async () => { … let x = await
t.runHooks(…); … d(x) })()`), racing the on-screen prompt and the
  remote-control watcher. Whichever answers first resolves the decision and
  cancels the others. So both surfaces are live at once and the user can answer
  in either. DeckHQ answering dismisses the terminal prompt; the user answering
  in the terminal closes our socket, which the prototype treats as a withdrawal.
- **`PermissionRequest` fires only when a prompt would otherwise appear.** The
  caller evaluates the normal rules first (`let a = s ?? await yI(…)`) and
  consults the hook only once the outcome is _ask_. This is unlike
  `PreToolUse`, which runs for every call. It is exactly the event DeckHQ wants
  — one POST per raised hand, none for the thousands of allowed calls — and it
  is worth stating because the published permission-flow diagram puts "Hooks" at
  step 1 and invites the opposite conclusion.
- **`if`** narrows a hook by permission-rule syntax (`"Bash(git *)"`), and
  `matcher` narrows by tool name. DeckHQ should register with **neither**: the
  product's claim is that every raised hand appears.
- **Two managed-settings kill switches exist**, and `doctor` and the banner must
  know about them, because from the user's side they look identical to a broken
  install: `allowedHttpHookUrls`, _"Allowlist of URL patterns that HTTP hooks
  may target … If empty array, no HTTP hooks are allowed"_, and
  `allowManagedHooksOnly`, _"only hooks from managed settings run. User, project,
  and local hooks are ignored."_ On a managed machine the `http` route can be
  switched off over DeckHQ's head. §86.6 has the fallback.

A user-scope hook applies to every session in every terminal: hook lookup reads
the merged settings sources with no session or terminal condition
(`zq(event, …)` checks managed, then user/project/local unless
`allowManagedHooksOnly`, then plugins, then session hooks), and
`~/.claude/settings.json` is documented as scope "all your projects". This is
the same mechanism the six existing DeckHQ hooks already rely on, so it is
treated as settled rather than re-measured — but it was **not** independently
re-verified for `PermissionRequest`, because that needs the end-to-end run.

### 86.5 Recommended build design

**Hook type: `http`, with a `command` fallback.** `http` is one settings entry,
no process spawn per prompt, and a real ten-minute hold. Register one entry, no
`matcher`, no `if`:

```json
{
  "type": "http",
  "url": "http://127.0.0.1:<port>/api/permission",
  "timeout": 600,
  "statusMessage": "Waiting for DeckHQ…",
  "_deckhq": true
}
```

**Endpoint: `POST /api/permission`, separate from `/api/hook`.** `/api/hook`
acknowledges in under 200 ms by contract (`src/http/routes/hooks.mjs`) and must
keep doing so. The permission endpoint does the opposite — it holds. Two
different contracts, two routes.

**Holding.** Keep the `ServerResponse` in a map keyed by `tool_use_id`, and key
the card on `(session_id, tool_use_id)`. Register `res.on('close')` and drop the
entry when the socket dies — that is the user having answered in the terminal,
or the ten minutes having elapsed. Sockets held open are the only new resource
this feature introduces; cap the map and shed the oldest rather than letting it
grow without bound.

**Timeout.** Set `timeout: 600` explicitly rather than relying on the default,
so a future change to `Ng` cannot silently shorten the hold. **DeckHQ itself
must never run a timer that answers.** If nobody answers, DeckHQ answers
nothing and the ten minutes expire into the terminal prompt, which is the
correct outcome.

**UI states**, four of them:

1. **Waiting** — the card, with Allow / Deny / Allow for this session. Allow for
   this session is offered only when the request carried an `addRules`
   suggestion; otherwise it is absent, not disabled-with-a-tooltip.
2. **Answer in the terminal** — the `requires_user_interaction` class of tools.
   The card says which session and where, and offers no buttons, because a hook
   allow would be discarded.
3. **Withdrawn** — the socket closed before we answered. The card says "answered
   in the terminal", not "expired", because that is what almost always happened.
4. **Answered** — what DeckHQ sent, and by which button, kept visible long
   enough to be read.

**What DeckHQ must never do.** Never auto-allow, in any mode, for any tool, with
any allowlist. Never answer on a timer, on a heuristic, on a classifier, or on
"the user usually allows this" — the only thing that may resolve a card is a
human clicking one of its buttons. Never send `updatedPermissions` with a
`destination` other than `"session"`: a permanent grant written into the user's
settings files is not a button this panel has. Never set `interrupt: true`.
Never touch `ackState` — a permission decision is a statement about one tool
call, not about whether the user is done with the session, and routing it into
the user-owned half of the model would let an observed event clear a user-owned
state, which is the `08` §1.1 rule 1 invariant and has named `INVARIANT:` tests.
The permission card is its own object with its own lifetime; it may sit _beside_
an agent on the floor and must not mutate it.

**Consent and removal** reuse the existing discipline in
`src/adapters/claude-code/hooks.mjs` unchanged: the literal JSON on the consent
screen, `_deckhq: true` for exact removal, the byte-exact backup, and the
port-mismatch-reads-as-not-installed rule. Verified above: the extra tag does
not fail settings validation.

### 86.6 Port discovery — the plan's third question has no clean answer yet

The plan asks how the hook finds the daemon "without a hard-coded port". For the
`http` type it **cannot**: `url` is `F().url()`, a literal, and the only
interpolation the schema allows anywhere is `$VAR` inside `headers`, gated by
`allowedEnvVars`. The `${path}` interpolation from the hook input applies to
`mcp_tool` arguments only. So an `http` hook's port is baked in at install time,
exactly like today's command hooks.

And `~/.deckhq/state.json` is **not** a discovery mechanism today: the daemon
resolves its port in `startDaemon` (walking forward from 4317) and never writes
it anywhere. `src/core/paths.mjs` and `src/core/store.mjs` have no port. So the
options, in order of preference:

1. **Bake the port in, and keep the existing staleness cure.** `installedPort`
   and `staleAtPort` in `src/http/routes/hooks.mjs` already detect a hook aimed
   at the wrong port and already offer the one-click reinstall. The permission
   hook inherits that for free and needs no new machinery. This is the
   recommendation for the build.
2. **Have the daemon write its bound port** to `~/.deckhq/` on listen, and use a
   `command` hook — a node one-liner that reads the port, POSTs, and prints the
   decision JSON to stdout — for machines where the port moves often or where
   `allowedHttpHookUrls` forbids `http`. This is a real fallback for §86.4's
   managed-settings kill switches, and it is also the only route Codex has
   (§86.7). It costs a process spawn per raised hand, which is affordable at one
   per prompt.

Writing the port out is a small change with a use beyond this package; it
belongs in WP-36, not here.

### 86.7 Codex, from documentation only

Codex has `PermissionRequest` in `~/.codex/hooks.json` (or inline in
`config.toml`), and its documented response is the **object** form, which is
independent corroboration of §86.3 against the Claude Code prose docs:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": { "behavior": "deny", "message": "Blocked by repository policy." }
  }
}
```

Payload fields named: `turn_id`, `tool_name`, `tool_input` (with
`tool_input.description` as the human-readable reason). Default timeout 600 s.
On no decision, _"Codex uses the normal approval flow"_ — the same
fall-through.

**The divergence that matters: Codex hook types are `command` and `mcp_tool`
only. There is no `http` type.** So the Codex adapter cannot reuse the endpoint
directly; it needs the §86.6 option 2 command hook. That makes option 2 worth
building for its own sake, not only as a fallback. None of this was run: Codex
is not installed on this machine, and the claim that the hook shipped in 0.150.0
on 26 August is unverified — the documentation gives no version.

### 86.8 `--permission-prompt-tool`, from documentation only

Still the right fallback for headless sessions DeckHQ spawns, with three
caveats. It must name an **MCP** tool — _"tool … must be an MCP tool"_ — so
DeckHQ would have to run an MCP server, which it does not today (that lands
with WP-37's plugin). The tool must return a **single text block** whose text is
JSON: _"Expected a single text block param with type=\"text\" and a string text
value"_, parsed to `allow` / `deny` with `updated_input` and
`updatedPermissions`. And it inherits the same exclusion as the hook — _"MCP
tool requires user interaction; not supported via --permission-prompt-tool"_. It
is also now hidden from `claude --help` while still being parsed, which makes it
the less stable of the two routes and confirms the plan's decision to lead with
the hook.

### 86.9 Go/no-go

**Go, with the acceptance criterion unchanged and unmet.** The mechanism exists,
covers interactive sessions DeckHQ never spawned, degrades to the terminal
prompt on every failure path including a closed daemon, and hands DeckHQ the
rule text for its third button. Nothing in the four days of build work depends
on a question this spike left open. The two corrections the plan needs are in
§86.3 (the response shape — the one that would have cost days of "why is
nothing happening") and §86.6 (the port is baked in, and Codex needs a `command`
hook). **The end-to-end run on the reference machine is still owed, and until it
happens this feature stays out of the README, the changelog and every tweet**,
per WP-19 and `08` §1.1 rule 11.

`scripts/spike-permission/` holds the throwaway prototype that reproduces all of
this. It is not product code, it is excluded from the published tarball by the
`files` whitelist in `package.json`, and it should be deleted when the build
lands.
## 87. WP-21 — the goldens gate, and the numbers it was calibrated with

WP-21 asks for three things: a deliberately reverted rig fix must fail the
gate, goldens must regenerate with one documented command, and the job must add
under 90 s to CI. All three, plus the part the workplan does not ask for and
the harness is worthless without — a tolerance that came from measurement
rather than from taste (`08` §1.1 rule 11).

**The gate.** `scripts/goldens.mjs`, zero dependencies: `npm run goldens` to
regenerate, `npm run goldens:check` to compare. Four populations from
`scripts/demo-floor.mjs` — `demo` (25 agents, the README floor), `empty`
(nobody), `single` (one agent), `reference` (the 70-session, 18-project
reference machine from `08` §0, the shape WP-50 exists to fix). PNG decode,
encode and the pixel diff are `scripts/lib/png.mjs` over `node:zlib`: 8-bit
non-interlaced PNG is a chunk walk, one `inflate` and five scanline filters,
which is cheaper than a dev dependency with a native build story.

**Determinism, and how it is enforced rather than hoped for.** Every fixture
value is a pure function of the population name — no clock, no random source.
The viewport is fixed at 1600x1000 at device scale 1, `prefers-reduced-motion`
is emulated so the renderer draws one static pose per state, and Chrome runs
with `--force-color-profile=srgb`, `--disable-lcd-text` and
`--font-render-hinting=none`. Then the belt: **two screenshots half a second
apart must be byte-identical before either is used.** A floor that is still
moving fails loudly instead of quietly becoming a golden that can never match
again.

### The noise floor, measured

Regenerate, then check twice against fresh captures, which is the procedure
this entry exists to record.

| | demo | empty | single | reference |
|---|---|---|---|---|
| Pixels that moved at all | 36 | 36 or 0 | 36 or 0 | 36 or 0 |
| Max channel delta | 1 | 1 | 1 | 1 |
| Bounding box | x 990–1581, y 12–13 | same | same | same |
| Pixels over a tolerance of 4 | 0 | 0 | 0 | 0 |

**36 pixels of 1,600,000, and always the same 36.** A 592x2 strip in the
header, one count on one channel, and the direction flips between runs — a
bistable rounding in a single blend, not drift. It appears in some populations
and not others on any given run, which is what says it is the blend and not the
floor. Nothing else in either image moves by even one count: the floor itself,
all 70 agents of it, is bit-exact across Chrome sessions.

### The signal, measured

Revert the one line of the §26 rig facing fix — `facingRot = pose.bodyAngle`
instead of `pose.bodyAngle + PI/2`, in `public/render/rig.js` — and check.

| Population | Over tolerance | Moved at all | Verdict |
|---|---|---|---|
| `reference` | 24,449 (1.528%) | 27,978 | **FAIL** |
| `demo` | 12,602 (0.788%) | 14,252 | **FAIL** |
| `single` | 1,181 (0.074%) | 1,295 | **FAIL** |
| `empty` | 0 | 36 | ok — correctly |

Exit 1, three of four. `empty` passing is not a hole, it is the control: there
is nobody on that floor to draw wrongly, so its capture under the reverted
build is the 36-pixel noise floor and nothing else. The line was restored and
`public/render/rig.js` verified byte-identical to before the revert; the check
is green again.

### So the numbers are

`CHANNEL_TOLERANCE = 8`. Eight times the measured noise amplitude of 1, and it
still keeps 91% of the weakest real signal (1,181 of the 1,295 pixels `single`
moves). **The first draft of this harness had 24**, picked by eye before
anything was measured; 24 keeps only 83% of that signal and, worse, would be
blind to a whole class of defect the noise gives no reason to tolerate — a
palette regression that shifted a colour by twenty counts across a large area
would have passed silently.

`MAX_DIFF_FRACTION = 0.0001` — 0.01%, 160 pixels. **The first draft had
0.0005 (800 pixels), and the measurement says that was nearly useless:** the
weakest signal is 1,181 pixels, so the old budget sat a factor of 1.5 under the
very defect this harness exists to catch. One slightly less visible bug on a
one-agent floor and the gate would have shrugged. 160 pixels sits 7.4x under
that weakest signal and 4.4x above the raw 36-pixel noise count — so the budget
holds even in the hypothetical where the tolerance stops suppressing the header
flip altogether.

What no tolerance can absorb is a Chrome or OS font update, which moves every
label at once. That is not a defect to be forgiven by a wider budget; it is a
regeneration, and the per-platform directory below is what makes that cheap.

### Goldens are per platform, and linux has no set yet — **RAISE**

Text is rasterised by the OS, so the same floor under Segoe UI/DirectWrite and
DejaVu/FreeType differs in every label. One set cannot serve three platforms;
`test/goldens/<process.platform>/` holds one set each.

**Committed here: `win32` only, 2.9 MB for four PNGs.** This is the machine
WP-21 was done on and there is no linux or macOS host in reach, so the CI job
runs on Ubuntu, finds no set, **reports SKIPPED and exits 0**, and uploads its
four fresh captures as the `goldens-linux` artifact — which is exactly how the
first linux set gets made: download, commit under `test/goldens/linux/`, and
the gate starts biting on the next push. Until somebody does that, **the CI job
proves nothing and must not be read as protection.** The harness says so in
those words rather than printing a green "all match" over an empty comparison,
which is the failure mode that would actually hurt. The local Windows gate is
real today, and is what the proof above was run against.

The 2.9 MB is accepted, with one thing checked first: re-encoding Chrome's PNGs
with paeth filtering at zlib level 9 makes all four **larger** (940 to 994, 629
to 663, 1328 to 1400, 28 to 32 KB). Chrome's encoder already wins, so the
goldens are the bytes Chrome produced, unmodified.

### CI

Ubuntu only and Node 22 only — the runner image ships Google Chrome, and the
CDP client needs the global `WebSocket` Node has unflagged only from 22.
**No install step**, because the harness is zero-dependency by design; that is
about 15 s of the budget saved. Both tooling gaps degrade to a skip with exit 0
rather than a red build — no Chrome, and no goldens for the platform — because
a gate that goes red over a missing browser is a gate people learn to ignore.
Failures upload the actual capture and a diff image (the expected floor at
quarter contrast with every differing pixel painted red) as artifacts.

**Timing: 26.1–28.6 s for all four populations, measured over six runs on the
Windows laptop**, against WP-21's budget of 90 s. Per population: `empty`
5.1–5.8 s, `single` 5.4–6.6, `demo` 5.8–6.6, `reference` 6.0–7.2. The Ubuntu
runner is unmeasured and is the one number here that is an estimate — checkout
and setup-node add roughly 5 s with nothing to install, and the job's
`timeout-minutes: 4` is a hang guard, not the budget.

### Two harness bugs found by running it repeatedly, not by reading it

Both would have shown up first as a flaky CI job, which is the way to lose a
visual gate.

**A demo that failed to boot aborted the whole run.** `startDemo` was awaited
outside the `try`, so one population failing to start took down the other three
with an unhandled rejection and a stack trace instead of printing one `FAIL`
line. It happened once in ten runs. Now inside the `try`, with one retry, and
`finally` copes with there being nothing to stop.

**The one error message that would have explained it was empty**, which is why
the cause took a second run to find: the child's exit was reported on `exit`,
which on Windows can fire before the child's stderr has been drained, so the
report arrived with the stack trace it was supposed to carry still sitting in
the pipe. Now `close`. The cause underneath was Windows holding a handle on the
fixture directory for a moment after the harness kills a population, so the
next run's `rmrf` hit EBUSY — `fs.rmSync` retries exactly those errors when
asked, and `demo-floor.mjs` now asks (`maxRetries: 20, retryDelay: 100`).

### Also landed here, and why

`--population NAME` on `scripts/demo-floor.mjs`, with its fixture directory
keyed to the name so a goldens run cannot tear down a floor somebody is looking
at in `npm run demo`; `onboarded: true` in the seeded settings, so the
first-run dialog is not something every capture script has to dismiss;
`extraArgs` on `withChrome`, for the rendering-determinism flags a README
capture has no use for; and `diffImages` now returns `differingAtAll` beside
`differing`, which is what lets `goldens:check` print its own noise floor on
every run. That last one is the guard on this whole entry: the tolerance was
measured once, and the number it was measured against is now reported
continuously, so the day the noise starts creeping is the day it becomes
visible rather than the day the tolerance is quietly widened to suit.

**Regenerated once on merge, 3 September.** WP-08 landed on `main` between this package's
capture and its merge, and its demo fixture now builds real repositories in the temp root, which
changed the project identities the carpet grain is seeded from. The check failed on three of four
populations with a uniform speckle across every project room's floor and nothing else — no
person, prop, wall or label moved, and `empty` passed. Goldens regenerated against the merged
tree; the speckle is why a fixture change must regenerate goldens, and the harness's own noise
floor (36 px) is unchanged.
## 88. WP-03's hero GIF: the floor did not walk, and there was no encoder to record it with

`02-MARKET-AND-LAUNCH.md` §3 A2 specifies the hero GIF as "an agent at a
desk types → stands → walks down the corridor → through your office door →
stands in the waiting area → a crimson badge appears and starts counting",
generated from `scripts/demo-floor.mjs` so it is reproducible and carries no
real project names. Shooting it turned up two things that had to be fixed
before there was anything to shoot, and one that had to be built.

**The floor did not walk. It teleported.** This is the important finding, and
it is a product bug, not a capture problem. `Scene.setState` rebuilds the
floor plan whenever the plan signature changes, and that signature counts who
is waiting, benched and let go — so the single most important transition in
the product, *a turn ends and the agent walks to your office*, was also a
plan rebuild. On a rebuilt plan `AgentRuntime.sync` seats everybody at their
new positions in one snap, because a rebuild normally means the geometry
changed underneath it and interpolating across two different buildings would
draw people walking through walls.

Measured on the demo floor at 10 fps, 1200×750, by counting changed pixels
per frame and tracking the bounding box of the change:

| | Before | After |
|---|---|---|
| Frames in which anything moved after the turn ended | **1** | **42** |
| Pixels changed in that frame | **431,956** | 887–1,544 per frame |
| Bounding box of the motion | whole floor | marches x=483 → x=59 |
| Walk visible to a viewer | none — one snap | **4.1 s** |

The fix is eleven lines in `public/render/scene.js` and it is a bridge rather
than a rewrite: before applying the new snapshot, seat the *previous* agent
list in the *new* building and sync that as one snap, then apply the new
snapshot. Every agent whose own state did not change is therefore already
where it belongs when the new snapshot lands and does not move; the one agent
whose state did change walks from its old seat to its new one. Nobody
interpolates across two buildings, which is the property the original snap
was protecting. All 443 tests pass unchanged.

**The floor still reflows once, and the GIF starts one frame after it.** The
office grows to fit a fifth agent in its waiting queue, which re-packs every
room by a few pixels, which moves every parquet plank — 431,956 pixels, of
which 152,009 change by more than 8 levels and 49,413 by more than 40. This
is not a bug; the floor is generated from the people on it (`08` §3 B6) and a
queue that grows has to be given room. But it is a one-frame jump, so the
GIF's first frame is the first frame *after* the reflow. Nothing is faked by
this: the agent is still at its desk in that frame, and dropping it also cut
the file from 438 KB to 241 KB, because that one frame was the only
full-frame update in the animation.

**There was no encoder.** Neither `ffmpeg` nor ImageMagick is on the machine
that cut this release (`convert.exe` on Windows is the filesystem tool, not
ImageMagick's), and a dependency — runtime or dev — for one image in a
README is a bad trade in a project whose pitch is that it has none. So
`scripts/gif-encoder.mjs` does the three things a GIF needs: decode the
captured PNGs, build one global 255-colour palette by median cut across every
frame, and write each frame as only the rectangle that changed with the
unchanged pixels transparent. It is a dev script; `scripts/` is not in the
published package, so the shipped tarball is unchanged.

Two choices inside it are worth recording because the textbook answer was
wrong here. The palette is cut at the **midpoint** of a box's widest channel,
not at its count-weighted median: the median is the standard median-cut rule,
and on this floor a crimson waiting badge is a few hundred pixels sharing a
box with acres of plant green, so a population split lands inside the green
and averages the badge into olive. A midpoint cut isolates a distinct hue
however rare it is — and the badge is the whole point of the image. And each
palette entry is the **bucket centre** rather than the bucket floor, because
6-bit quantisation otherwise biases every colour dark by up to 3/255.

**Result.** `docs/media/hero.gif`, 1200×750, 59 frames at 10 fps, 5.9 s,
**241 KB** against the 3 MB budget. Verified by parsing the encoded file
back: 59 image descriptors, a uniform 10 cs delay, a trailer at the last
byte, and sub-image origins that march x=483 → x=59 over frames 1–41 and
then hold — which is the walk, in the file's own geometry. Rendered in
Chrome to confirm the palette, the text and the frame disposal: no trail
behind the walker, no flicker.

**Capture is reproducible.** `scripts/capture-hero.mjs` drives it end to end:
it points headless Chrome at the demo floor, hides the header so only the
floor is in shot, and ends one agent's turn by posting a `Stop` event to the
real `/api/hook` endpoint — the same path Claude Code's own hook takes, so
the state change is produced by the real state machine and not staged.
Recording is a `getImageData` copy on a timer inside the page, not a
screenshot per frame over the DevTools protocol: `Page.captureScreenshot` at
this size costs ~280 ms, which caps an external loop at 3–4 fps, and the
frames are pulled out as PNGs only after the walk is over. Measured rate,
10.0 fps against 10 requested.

## 89. WP-52 — thought bubbles: what the two new hook events are allowed to touch, and what they are not

`08-PLAN-V2-100X.md` §3.5 and §9. `PreToolUse` and `PostToolUse` join the
tagged hook block; the daemon keeps a `currentTool` per session; the floor
draws it above the head and the panel header says it in words. Shipped as
specified. Six decisions the package description did not settle.

**Decision 1 — the two events touch `currentTool` and nothing else.** Not
`activityState`, not `lastOutputAt`, not `lastActivityAt`, not one field the
user owns. Two of those are worth spelling out, because both were tempting:

- _Not `activityState`._ A session with its hand up that runs a tool is still a
  session with its hand up. Moving it to `working` would take a raised hand off
  the floor without the user ever answering it — an observed event changing the
  needs-you count, which is the exact shape of the bug `docs/01-PRODUCT.md` §2
  exists to forbid.
- _Not `lastOutputAt`._ That field is the stall clock (§4.3), and `stalled` is
  one of the three states the needs-you count is made of. Letting tool traffic
  reset it would silently redefine "stalled" from "no turn boundary in ten
  minutes" to "no tool call in ten minutes" — a real product change, smuggled in
  as an implementation detail. The consequence is honest and intended: an agent
  grinding through a twenty-minute build still goes to `stalled`, and its bubble
  expires with it (decision 3).

`hookLive` IS set, for the same reason every other hook event sets it: a tool
call is proof the process is running. It cannot move a `for_review` session —
`endedOr` and `_computeAgents` already guarantee that.
`INVARIANT: a PreToolUse/PostToolUse event changes no user-owned field` in
`test/unit/state-machine.test.mjs` drives a two-agent floor — one waiting in the
office, one benched with its hand up — through six tool events and
deep-compares every user-owned field plus all six counts.

**Decision 2 — the summary is parsed in the adapter, not the route.**
`toolSummary()` lives in `src/adapters/claude-code/hooks.mjs` and is exposed as
`adapter.hooks.toolSummary`; `POST /api/hook` asks the runtime's own adapter
what its payload says. `tool_input.command`/`file_path` is Claude Code's shape,
and nothing outside `src/adapters/` may know a runtime's format
(`02-ARCHITECTURE.md` §2). A runtime with no `toolSummary` — Codex today —
simply has no bubble, and that costs it nothing else.

**Decision 3 — a bubble expires with the stall window.** `PostToolUse` is not
guaranteed: kill the runtime mid-tool, block the hook, sleep the machine, and
"Bash npm test" hangs over a head forever. `tick()` drops any `currentTool`
older than `stallWindowMs`, before its hook and liveness guards, so the expiry
also runs on the degraded path. The floor may say nothing; it may not say
something stale.

**Decision 4 — the bubble yields; it never negotiates.** Above the head is one
slot. Precedence is state icon, then bubble, then the abstract thought cloud —
so an agent with a raised hand, an hourglass, a review tick or a waiting badge
draws no bubble at all, and one that is merely working replaces its cloud with
the bubble rather than wearing both. A collision-avoidance nudge was considered
and rejected: "what it is doing" is context, and context that pushes a call to
action around the screen has been promoted past its station. At L0, and under
reduced motion at any LOD, the tool CLASS is drawn instead — a file, a shell, a
globe or a beat — which is `08` §3.5's "station per tool class, as a state icon
first". Colours stay in the cloud's neutral ink: no state colour, and above all
no crimson, which means "in your office" and nothing else.

**Decision 5 — a path outside the session's cwd keeps only its basename.** The
acceptance criterion is that the bubble "never contains project paths outside
the session's cwd". Dropping such a tool entirely would make the floor go quiet
exactly when an agent reaches out of its project, which is the moment worth
seeing; showing the path would put someone else's directory tree in a
screenshot. So `/home/me/other-client/secret/notes.md` reads `Read notes.md`. A
relative `file_path` is resolved against the SESSION's cwd, never the daemon's.
Two `SECURITY:` tests in `test/unit/hooks.test.mjs` hold this, including a
different Windows drive and a `..` escape.

**Decision 6 — every payload string is flattened before it is anything else.** A
command line is text this project did not write: it can carry newlines, ANSI
escapes, a bidi override that reverses the rest of the line, or 4 KB of one
word. `oneLine()` replaces every `\p{C}` code point with a space, collapses
whitespace, and cuts to length — 80 characters for a command, 120 for the whole
summary (`MAX_TOOL_SUMMARY`, in `model.mjs` beside `MAX_LAST_TEXT`). It reaches
the screen only through `fillText` on canvas and `textContent` in the panel;
there is no markup path, and the client still has no `innerHTML` at all.

**What did not change.** The demo floor emits no tool events, so the four
goldens are byte-identical and were not regenerated — a bubble needs a live
`PreToolUse`, which is what `docs/media/thought-bubble.png` is: `npm run demo`,
three real `POST /api/hook` calls (a `Bash`, an `Edit`, a `Read`) against three
working sessions, then `scripts/capture-floor.mjs`. `public/render/plan.js`,
`public/app.js` and the WP-08 panel layout are untouched; the panel gained one
line under the header and nothing was restructured.

**Accepted limits.** `Write`, `MultiEdit` and `Grep` show as their bare names:
the package specifies four rules (`Bash`, `Edit`, `Read`, otherwise the name)
and inventing more argument shapes is a spec change, not an implementation
detail — worth revisiting once the bubble has been watched on a real machine for
a week. A subagent's tools are attributed to whichever session id the hook
carries, which is the parent until WP-41 gives subagents their own bodies. And a
bubble can hang over a neighbouring desk in a crowded room at a tight fit scale;
it is drawn above every head, so it never covers a face, and it yields entirely
wherever it would compete with something the user has to act on.

## 90. WP-47 — the diff in the panel, and the one setting that becomes a program

WP-08 stopped at the file table and said so (§85.2): `[ open the diff ]` in
`docs/plan/05-GUI-UX-SPEC.md` §4.1 was this package. It is now there, as a
disclosure on every row rather than one button under the table, and six things
about it are decisions rather than transcription.

**1. Two routes, not one.** `08` §8.1 describes the diff and "open in editor"
as one addition. They are `GET /api/diff?id=&file=` and
`POST /api/open-in-editor {id, file, line}`, in one module
(`src/http/routes/diff.mjs`) because they share the confinement rule, and the
confinement rule is the security-relevant part of both. `/api/diff` is
`/api/changes` one level deeper and copies it exactly: `git diff` and
`git diff --cached` for the one file, argv arrays, run in the session's cwd,
cached per scan, five outcomes as a `status` rather than an error, and it never
touches ack state.

**2. The repository's top level defines "inside", not the session's cwd.** A
session's cwd is often a subdirectory of its repository, and
`git diff --numstat` — which is what WP-08's rows are built from — reports
paths relative to the **top level** regardless of where it is run. So a path
that is perfectly valid on a row (`src/events/backfill.ts`) does not resolve
against the cwd. The route asks `git rev-parse --show-toplevel` and confines
against that, with `path.relative` rather than a prefix comparison, because
drive letters and case-insensitivity make prefix comparison unsafe on Windows —
the same rule `serveStatic` uses. A path that lands outside is a 400, not a
clamp. `git rev-parse --show-toplevel` was checked on git 2.55: it returns
forward slashes on Windows, and an absolute forward-slash pathspec after `--`
resolves from any cwd inside the repository, which is what the route passes.

**3. `--no-ext-diff --no-textconv`, which the plan does not mention.** Both
`diff.external` and a `textconv` attribute let a repository's own config name a
program that git runs while producing a diff. This diff is produced because a
browser asked for it, on a repository an agent has been writing to. Both are
turned off.

**4. The cap is 200 KB per diff, cut on a line boundary, and it is reported.**
A diff is unbounded — a regenerated lockfile is megabytes — and this one is
being rendered into a side panel. Past the cap the response carries
`truncated: true` and the real byte count, and the panel says *"the rest of this
diff is too large to show here"* rather than showing half a file as though it
were the whole one.

**5. The rows are stacked blocks now, not one `display: contents` grid.** WP-08
drew the file table as a three-column grid whose rows were `display: contents`.
A row that expands has to own a diff element beneath it and be a `<button>` —
`display: contents` is ignored on interactive elements, and a keydown handler
reimplementing Enter, Space, focus and `aria-expanded` for a fake button is
strictly worse than the real one. So each row is a block with its own
three-column head, and the numeric columns hold their alignment on a fixed
`5ch` track instead of `auto`. Same content, same figures, same reading.
Expansion state is kept per file in the panel, not in the DOM, because a new
scan re-renders the whole table every few seconds and a diff the user opened
must not close itself.

**6. Three new colour tokens, and why they do not break the stylesheet's own
rule.** `--diff-add`, `--diff-del` and `--diff-hunk` are the first tokens in
this project that set small text in a colour. The rule they look like they
break is about **state** colours and the **accent**: several of those sit
between 3:1 and 4.5:1 and, more importantly, crimson means "in your office" and
green means "working" — a removed line means neither. These three are their own
tokens, they name nothing on the floor, and they are held to the full 4.5:1
text floor on `--surface-2` (the diff's ground) and on both chrome grounds:
measured 8.08, 5.88 and 7.16 on `--surface-2`. `test/unit/diff-view.test.mjs`
recomputes all nine ratios from the stylesheet and also asserts that none of
the three is a state colour or the accent. And colour is never the carrier: a
unified diff already begins every added line with `+` and every removed one
with `-`.

### 90.1 "Open in editor": the allowlist, and what Windows costs

The client sends `{id, file, line}`. It never sends a command. Which program
that means is a lookup in a frozen table of five — `code`, `cursor`, `zed`,
`idea`, `subl` — and everything else is refused at three separate points: the
settings route rejects the value with a 400, the store refuses to persist it,
and `core/editor.mjs` refuses to resolve it. `$EDITOR` is consulted only to
*choose between* members of that set; an `$EDITOR` of `rm -rf /` selects
nothing and the PATH order decides instead. `subl` is on the list beyond `08`
§9's four because Sublime takes the same `file:line` form and leaving it out
would only push that user to a shell.

`editor: ''` is the default and means "decide for me". Guessing at install time
and freezing the answer into `state.json` would be wrong on the first machine
that installs a different editor.

**The Windows problem, and the measurement.** `code` on Windows is `code.cmd`.
Node refuses to spawn a `.cmd` without a shell (CVE-2024-27980; `spawn EINVAL`,
reproduced on Node 24.19 with the real `code.cmd` on the reference machine),
and `shell: true` with an args array concatenates without escaping — Node
deprecated exactly that as a vulnerability (DEP0190, and it was reproduced
here: `x&calc.ts` ran `calc.ts` as a command). So a batch launcher goes through
`cmd.exe /d /s /c` with `windowsVerbatimArguments` and a command line this
project quotes itself. Three things were checked against a real `cmd.exe`
rather than reasoned about:

| | Result |
|---|---|
| `"exe" "arg"` after `/s /c` | fails — `/s` strips the outer pair, so the line needs its own: `""exe" "arg""` |
| `&`, `\|`, `<`, `>`, `^` inside the quotes | literal. `ARG1=["C:/a b/x&whoami.ts:12"]` |
| `"` and `%` inside the quotes | escape. A path containing either is **refused**, with a message pointing at the editor |

An `.exe` launcher, and every non-Windows platform, take the straight argv path
with no shell at all. `test/unit/editor.test.mjs` asserts the exact argv for
both, including the doubled quotes, without starting a program: `resolveEditor`
takes a fake PATH and a fake "is this a file" predicate, and `editorArgv`
returns the `[command, argv, options]` a launch would use.

**What is not covered.** Only `code` exists on the reference machine, so
`cursor`, `zed`, `idea` and `subl` are unit-tested for their argv and have
never been launched. The argv forms are from each editor's own documented CLI
(`-g file:line` for the two VS Code builds, `file:line` for Zed and Sublime,
`--line N file` for IntelliJ); the first of the four to be tried on a real
machine is the one that will say whether that is enough.

### 90.2 What the screenshot proves

`docs/media/panel-diff.png` (rule 10), the demo floor at 1600x1000 with the
panel open on the `for_review` session in `orbital-api` and
`src/events/backfill.ts` expanded. The heading still reads **"what changed in
orbital-api"** — `05` §4.2's honesty requirement is untouched by this package —
over `+142 −18 3 files`, and under the expanded row are the real `git diff`
lines for that working tree: the `diff --git` and `index` headers in muted
ink, two `@@` hunk headers, four removals, context, and the run of additions,
each line a `textContent` node. Reproduced with `npm run demo` and:

```
node scripts/capture-floor.mjs --url http://127.0.0.1:4499/ --width 1600 --height 1000 \
  --settle 9000 --press j --click ".review-file-head" \
  --scroll ".review-changes .review-heading-row, .review-heading-row" \
  --out docs/media/panel-diff.png
```

`--click` and `--scroll` are new on `scripts/capture-floor.mjs`: `--press` walks
the needs-you queue, but a file row is a button inside the panel with no
keyboard route of its own, and once a diff is open the part worth photographing
is below the fold.

**The goldens are untouched.** `npm run goldens:check` passes on all four
populations with 0 pixels over tolerance, because the panel is closed in every
one of them and nothing in this package changes the floor.
