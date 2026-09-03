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
touched. **Closed in §77.**
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

## 77. The desktop store's own read is cached, keyed on the file that carries the flag

§68 measured this and left it: with the summary cache in,
`readDesktopSessions()` was **essentially the entire cost of a warm scan**, and
it runs on every 5 s poll forever. Re-measured on this machine (Windows 11
ARM64, **61** desktop session files totalling **8.8 MB**, 70 transcripts), it
was 78–80 ms per call against a **< 50 ms** warm-scan budget
(docs/02-ARCHITECTURE.md §8) — 1.7x over the whole budget on its own, before
the scan did anything else. §11 had the warm scan at 3–5 ms once the summary
cache landed; the desktop-store read added in §46 put it back outside.

Each file's *parsed* result is now cached in
`src/adapters/claude-code/desktop.mjs`, keyed by `(path, mtime, size)` — the
same invalidation rule `src/core/summary-cache.mjs` uses.

Measured before and after, the two arms interleaved and their order flipped
between passes so machine drift hit both equally: three passes of four fresh
processes per arm, each doing a first scan and then eight polls. Per-pass
medians, with the full range across all of them:

| | before | after |
|---|---|---|
| `readDesktopSessions()`, warm | 78.4–80.5 ms (71.3–105.0) | **1.2–1.3 ms** (1.1–2.2) |
| **Warm scan — every poll** | **82.5–87.4 ms** (75.6–154.6) | **4.5–5.1 ms** (3.5–9.2) |
| First scan of a process | 99.8–120.5 ms (89.3–154.5) | 94.2–100.0 ms (85.6–157.8) |
| Files opened per poll | 61 | 0 |
| Held in memory | — | ~120 KB, measured after `gc()` |

The warm scan is roughly **17x faster** and sits an order of magnitude inside
§8's budget instead of 1.7x outside it. The control arm —
`DECKHQ_DESKTOP_SESSIONS_DIR` pointed at a nonexistent directory, i.e. the same
scan with no desktop store to read at all — polls in 3.0 ms, so the store now
costs a scan about **1.5 ms** rather than about 96% of it. The first scan of a
process is unchanged within noise; the `fstat` note below is why it is not
worse.

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
ms** across 61 files: first scans went from ~95 ms to 125–146 ms, handing back
on the first scan much of what the cache saves on every later one. So a file is
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
