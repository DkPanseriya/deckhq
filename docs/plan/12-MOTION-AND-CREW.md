# 12 — Motion, and the crew

**Status:** design, 15 September 2026. Nothing here has shipped. It is the design of record for
**WP-87** (character life) and **WP-89** (the crew), opened from two owner sentences:

> Now that we have robot doodles, make also thinking cloud, working etc. animation. Also some other
> animations for playing games or drinking coffee in the lounge. And running animation.

> Many times chat sessions launch background sub-agents or multi-agent workflows. We need something
> very attractive, dopamine-inducing, like a magic show. If a chat session fires 3+ agents … the GUI
> launches all those sub-agents (smaller in size), connected by cables to the main chat session
> agent, surrounding it, sat on the floor with their own laptops, feeding data by cables.

`03-VISUAL-SPEC.md` §1, §3, §4, §5 and §10 bind everything below. The pictures in
`docs/media/motion/` — `life-sheet.png`, `lounge-activities.png`, `crew.png` and the short
`crew.gif` — are **illustrations**, drawn by the standalone canvas pages beside them over WP-79's
own exploration library. They are not renders of the product, and no number in them was measured on
a running floor.

---

## 1. Motion principles

### 1.1 Every phase comes from the injected clock — and today it does not

WP-63 pinned the daemon's clock so a golden is a photograph of a state and not of a day (§146), and
`public/clock.js` is where the browser reads it. `rigPose.idlePhase(seconds, reduced)` is the one
place time enters the figure, and `scene-draw.js` passes it `seconds: nowMs() / 1000` under a
comment saying *"`nowMs()` is the injected clock the whole scene runs on"*.

**It is not.** `scene-agent.js`'s `nowMs()` returns `performance.now()`, a tab-local counter no
fixture can pin, and `clipStartedAt` in `agents.js` comes from `Date.now()`. The goldens are stable
for a different reason entirely: `scripts/goldens.mjs` emulates `prefers-reduced-motion: reduce`,
which forces `idlePhase` to exactly `0` and `sampleClip` to a static pose. **Every committed capture
is the reduced-motion render.** That is why §162.9 could say *0 px moved at all* — and why no
animation in this document could appear in a golden as things stand.

WP-87's first task is therefore not an animation. It is **one clock and one phase**: `nowMs()` reads
`clock.js` when the daemon's clock is pinned and `performance.now()` otherwise, on the same
`nowFixed` split `clock.js` already makes; `clipStartedAt` becomes a phase offset derived from a
real timestamp on the agent (`lastActivityAt`, `spawnedAt`, `reviewSince`) rather than from when
this tab noticed, so two tabs draw the same frame and a reload does not restart a cycle; and a
`?phase=` URL option, in the `url-options.js` idiom — this tab only, never written back — pins the
phase to a value in `[0, 1)` **without** disabling motion. That last one is the seam a golden
fixture uses to capture a *moving* frame, and it is the whole of §5's golden story.

No `Math.random()` under any draw. Where a choice has to be made — which lounge activity, which idle
variation, which hold length — it is a hash of the session id and a cycle index, the way identity
has been a pure function of the session id since WP-20.

### 1.2 Reduced motion still informs

§10 and `clips.js`'s `reducedPose` already set the rule: the reduced form is *the pose that best
communicates the state*, not the first frame. Every animation here states its reduced form in §2's
table, and each is still a claim a reader can act on — a hand up, a page held, a cloud at its
current size, a cable with a count badge. Nothing reduces to nothing.

### 1.3 The budget, and the LOD tiers

The floor holds a hundred agents, and WP-79's discipline stands: **no object or array allocated per
call, no `ctx.save`/`ctx.rotate` per part, no `Path2D` per frame.** Cable routes are therefore
**baked once per plan change** — a route is a function of seat geometry and furniture, which only
move when the plan does — so a frame strokes a stored polyline rather than searching for one. Per
frame an agent costs its pose, its visor and at most one over-head element; a crew costs one lerp
per pulse, capped at **4 pulses per cable** and **12 drawn cables**.

LOD follows §162's drop list rather than inventing a second one: below **30 px of figure** the rim
halo, the chest glyph and the far arm go and the visor's mark swaps to its bold form, and L0 drops
the same three at any scale — while **the visor and the raised hand are in no drop list at any
zoom**. To that this design adds: at **L0 the thought cloud, the page flip, the stall dots, the dust
and every lounge prop are dropped**, and pulses stop below `BADGE_MIN_PX_PER_UNIT`, the same 14 px
per unit the waiting badge uses, because a pulse smaller than that is a flicker and not a signal.

### 1.4 The honesty rule

*Nothing animates that is not backed by a real observed event or state.* Three classes, and the
distinction is load-bearing. **State motion** is the pose, driven by `activityState`. **Event
motion** — the visor flicker, the spawn burst, the cable pulse — is driven by a named field moving
in the snapshot; where a runtime does not carry that field the motion does not happen, and it is
never simulated. **Idle motion** — the antenna bob, the visor blink, the page flip, the lounge — is
allowed **only where it carries no meaning**, and stops the instant the state changes.

The rule is also a list of refusals: no progress bar on a junior, because there is no progress to
read; no success or failure colour on one, because no stop record says which it was; no animation at
all on `let_go`.

### 1.5 Motion never covers a raised hand or a label

§3.3's draw order and §162.6's pinned obstacles hold unchanged. **Everything in this document is
drawn before the chrome band** — cloud, pulse, cable and dust puff all sit under it — and a cable
may not be routed through a label box, which is the obstacle machinery §162.6 already uses.

---

## 2. Character life

`docs/media/motion/life-sheet.png` draws every strip below. The tick under a frame is its place in
the cycle, not its wall-clock time.

| animation | trigger (what is observed) | frames · period | LOD | reduced |
|---|---|---|---|---|
| **working · type** | `activityState = working`, no tool open | 4 · 0.90 s, loops | 2+ full, 1 bob only, 0 static | hands on the keys, no bob |
| **visor flicker** | `currentTool.since` changes — a real tool call opening | 3 · 0.24 s, once | all | the lit visor, no flash |
| **thinking · cloud** | turn open, `currentTool` null, > 2.0 s since the last event | 4 · sway 3.20 s; growth is not a loop | ≥ 1 | the cloud at its size, no sway |
| **needs_input · wave** | `activityState = needs_input` | 4 · 1.40 s, loops, with the floor ring | all | hand up, ring at half phase |
| **for_review · page flip** | idle only, while `for_review` holds | 4 · 0.50 s, once every 12 s | ≥ 1 | page held flat |
| **stalled · slump + dots** | `activityState = stalled` | 3 · 4.00 s, loops | ≥ 1 | slumped, two dots, visor 50% |
| **ended · power-down** | the session ends | 5 · 1.60 s, **once, ever** | all | frame 5 immediately |
| **benched · lounge** | `ackState = benched` | per activity, 45–90 s hold | ≥ 1 | one frame, same hash |
| **walk** | any trip that is not the one below | 2 · 0.80 s · 2.6 U/s | ≥ 1 | no trip animated |
| **run** | destination is Your Office **and** state is `needs_input` | 4 · 0.52 s · 4.6 U/s | ≥ 1 | no trip animated |
| **spawn** | an id in this snapshot that was not in the last | 3 · 0.32 s, once | all | figure simply present |
| **despawn** | an id that left the snapshot | 3 · 0.42 s, once | all | figure simply gone |

**The typing cadence is not the token rate and must not be drawn as if it were.** Nothing reports
keystrokes or tokens per second; `tokens` is a running total sampled at the poll. The four strokes
per 0.9 s are a constant. The only honest variable on a working figure is the visor flicker, which
fires on an event the adapter genuinely sees — **capped at one per 0.5 s**, because a tool loop
opening six calls in a second would otherwise strobe.

**What "thinking" is, and what it is not.** DeckHQ cannot see extended reasoning: the adapter reads
a transcript summary and a hook payload, and neither carries a thinking block. What it *can* see is
that a turn is open, no tool is running, and nothing has been written for N seconds. That is what
the cloud means. It grows in three steps — one lobe at 2 s, two at 6 s, three at 15 s — and then
stops, because a cloud that kept growing would be a claim about difficulty the data cannot support.

**`ended` latches.** The power-down runs once, keyed to the agent's own end timestamp; a re-render
afterwards draws frame 5 and nothing else. It is never the fold-away: an ended session *stays on the
floor* (§5.1's occupancy rule), and folding it away would say it had left.

**Running is a claim.** The one trip that runs is an agent going to Your Office because it needs
input. Nothing else on this floor ever runs, which is what keeps the claim readable across a room;
`for_review` walks, because it is waiting on you but is not blocked mid-turn.

**The lounge** (`lounge-activities.png`): the pool shot (4.50 s, paired, two agents alternate), the
table-tennis rally (1.60 s, paired, antiphase 0.5), the arcade lean (2.20 s, solo), coffee at the
café bay (6.00 s, one-shot, then the agent sits with the mug) and reading in the quiet corner (a
0.60 s page turn every 20 s). The activity is `BAY_ACTIVITIES[bay][hash(sessionId) % n]` and the
hold is `hash(sessionId, cycleIndex)` mapped into 45–90 s — never `Math.random`, so two tabs on one
floor show the same lounge. A paired activity with no free partner degrades to that bay's solo
activity, which `makeActivityRotation` already implements; the rotation stops when the tab is hidden
and resumes from the clock, not from where it paused.

---

## 3. The crew

### 3.1 Trackability first

**What Claude Code exposes, verified on disk (§120, WP-41).** A junior is a transcript at
`<sessionDir>/subagents/agent-<id>.jsonl`, and the directory above `subagents/` names its parent.
Beside it sits `agent-<id>.meta.json`, from which `parseSubagentMeta` reads `agentType`,
`description`, `model`, `toolUseId` (the parent's `Task` tool-use id), `spawnDepth` and
`parentAgentId`. **None is required, and the census in `parse.mjs` says so**: of 987 sidecars on the
reference machine, 607 carry `agentType` and `spawnDepth` only, 239 `agentType` alone, 50 a
`description`, 38 of those a `model`, and **4** a `parentAgentId`. A junior reliably has a *type*;
it usually has no description, no model and no second tier.

`spawnedAt` is the oldest timestamp in the head window, because **there is no spawn record**. There
is also **no stop record** — the last line of a finished transcript is an ordinary turn — so the
only honest end signal is that the file stopped moving, and `SUBAGENT_IDLE_MS` is five minutes,
measured over 28,813 consecutive-record gaps in 300 real transcripts (p99.9 253 s). A `SubagentStop`
hook would end it at once, except that **the hook fires on the parent's session id**; which junior
the payload names is the one part of WP-41 never verified on a machine, and `subagentEvent` returns
`null` rather than guessing.

**A multi-agent workflow IS trackable, and the floor throws the evidence away.** The second
transcript shape on disk is `subagents/workflows/wf_<id>/agent-<id>.jsonl`, with the workflow's own
`journal.jsonl` beside it. `listSubagentFiles` walks that path and returns `{file, subagentId,
parentSessionId}` — **the `wf_<id>` segment is in the path and is discarded.** Keeping it is one
field and no new I/O, and it gives the crew a real group: *these four juniors are one workflow*
against *these four are four independent `Task` calls*. The journal stays unread; it is the
workflow's log, not a session. Concurrency is already published as `juniorCount` on the parent and
`project.juniors` on the room plate, and a background `Agent`-tool task is not a separate surface —
it writes the same transcript in the same directory.

**What is not trackable at all.** Progress or a percentage. Whether a junior succeeded or failed.
What it returned. Why it was spawned, beyond the `description` that 5% of sidecars carry. And a
junior's true event rate: the daemon polls, so the finest honest statement is *this file moved
between two polls*, plus `currentTool` when a hook is installed.

**The other runtimes.** Gemini CLI marks a junior from `kind: 'subagent'` or from a
`chats/<parentSessionId>/<sessionId>.jsonl` path and carries **no type, no description, no spawn
time**; OpenCode sets `subagent` from `row.parentId` and carries the same nothing; both are
unverified against real data (§123). Codex exposes nothing. **The crew is a Claude Code formation,
and every other runtime keeps WP-41's seat-beside-parent** — the honesty rule applied to a whole
feature rather than to a pixel.

### 3.2 The show

`crew.png` is the formation at 1× with a 2× crop; `crew.gif` is 2.5 s of it with the pulses moving.

**Threshold: three.** Three or more juniors live at once turn the parent's desk into a crew; one or
two keep today's behaviour exactly — `juniorSpots`' alternating seats beside the parent, no cables,
no pulses. The three panels along the bottom of `crew.png` are that comparison. Three is where a row
beside a desk stops reading as *this person's helpers* and starts reading as *a queue*.

**Seats.** Juniors draw at **0.66 of the parent** — inside the brief's 0.60–0.70 band, against
today's `JUNIOR_SCALE` of 0.80 — through `characterScaleFor` like every other body, so §96's 16 px
legibility floor still binds and a crew at a tight fit stops shrinking rather than becoming texture.
They sit on the floor in an **arc in front of the desk** at a fixed angular pitch, each with a
laptop between it and the desk.

**Cables.** One per junior, laptop to a port on the desk's front edge. Routed, never straight:
axis-aligned runs with rounded corners, from a route that treats furniture footprints and label
boxes as obstacles — the fifth cable in the mockup bends around a plant rather than through it.
Ports are spread along the front edge in seat order, so no two cables cross.

**Pulses.** A pulse travels **junior → parent and never the other way**, because that is the only
direction data goes; the parent's prompt is one event at spawn, and drawing it as traffic would be a
lie told sixty times a second. It runs only while that junior's transcript is moving, at the
junior's own observed events per minute over a trailing window, **quantised to 1, 2 or 4 per loop
and capped at 4** — quantised because the underlying resolution is a poll, capped because a cable
that strobes is noise. A junior whose file has stopped gets a **grey cable and no pulses**: the
visible, honest difference between working and finished, and what the rightmost figure in the mockup
is showing.

**Arrival and departure.** A junior appearing plays §2's spawn burst and its cable draws on from the
desk outward over 0.30 s; a junior leaving retracts its cable and folds away over the same 0.30 s.
The parent's visor carries a small constant brightening while it holds a crew — the one thing the
parent gains from having one.

**Room geometry.** WP-55 and §2.2 size a room by its contents, and a crew is contents: the room's
bid gains a `crewFootprint(n)` term — the arc's bounding box plus one body's clearance — and the
existing packing does the rest, exactly as a break-out group grows a room in WP-85b. Where the room
cannot grow, the formation degrades **before** anything leaves the room: an arc that does not fit
falls back to **two rows** in front of the desk at the tighter of `JUNIOR_PACKS`' pitches, and a
pinned room (§5.2, at most a third of a live room's footprint) draws no crew at all — the parent,
the `+N` chip, nothing else. A body outside its own room stays the one thing the plan may never do.

**Labels, clicks and the deck.** Each junior carries its `agentType` as its label, through the
existing collision pass: a junior whose label cannot clear the pinned obstacles loses the label, not
the body. Clicking a junior opens its panel as clicking any agent does; clicking a cable does
nothing. The room plate keeps `· +N juniors`, and the deck shows a crew as **one expandable group
under its parent** rather than N sibling rows, so a crew of twelve does not push the floor off the
table. Under reduced motion the cables draw static with no pulses, a count badge sits on the desk,
and the grey/green distinction is kept so the still picture still says who is working.

**Cost, and the cap.** Per crew of n: n baked polylines, n figures, n laptops, n cable strokes and
at most 4n pulse draws per frame. At n = 12 that is 12 strokes and 48 small radial-gradient fills —
the gradient is the expensive part, so it is built once per crew per frame and reused. **Twelve
juniors are drawn; beyond that a `+N` chip sits beside the desk**, the rest reachable from the panel
and the deck. Four such crews is 192 pulse draws, the number to profile against
`02-ARCHITECTURE.md` §8's budget before this ships — and §162.10's admission stands until someone
does: nothing here has been looked at on a real machine with a hundred agents.

---

## 4. Sound

The setting already exists: three synthesised cues (`door`, `knock`, `chime`), a 10 s coalescing
window, and `decide()` refusing to play when muted, at zero volume, or when the OS was notified
instead. The crew adds **one** cue — `door`, once, when a crew crosses from two juniors to three.
Not per junior, not per spawn, and **never for a pulse**: a cue per pulse is an alarm clock, and a
cue per junior would fire five times inside one poll. It goes through `decide()`, so the existing
coalescing and mute both hold with no new setting.

---

## 5. Packages

### WP-87 · Character life · `UX` + `AR` · M · after WP-79

**Accepted when:** the animation clock is `public/clock.js` and `?phase=` pins a frame without
disabling motion; a golden fixture captures `demo@phase` at **phase 0.25** — where the typing
cadence is at its second stroke, the wave at its widest, the page edge-on and the power-down at
frame 2 — byte-identical across two runs; every animation in §2's table exists at the stated frame
count and period, each a pure function of (state, phase, identity); a test asserts **no
`Math.random` and no `Date.now` under any draw path**; under `prefers-reduced-motion` every clip
resolves to its stated static pose and the existing nine goldens are unchanged to the pixel; the
`ended` power-down runs at most once per agent id, asserted over a driven sequence of snapshots; the
visor flicker fires only on a `currentTool.since` change and at most once per 0.5 s; a lounge
activity is a pure function of session id, bay and cycle index; and no new draw allocates per call.

### WP-89 · The crew · `AR` + `AB` · L · after WP-87, WP-41

**Accepted when:** three or more concurrent juniors emit a crew and two or fewer emit today's seats,
asserted over a driven registry at n = 0…14; juniors draw at 0.66 through `characterScaleFor` with
the 16 px floor holding; every cable is axis-aligned, crosses no prop footprint and no drawn label
box, and no two cables of one crew intersect, over the sixteen populations
`floor-integrity.test.mjs` already runs; pulses exist only on cables whose junior's
`lastActivityAt` moved since the previous snapshot, run junior→parent only, and are capped at 4 per
cable and 12 cables with a `+N` chip beyond; the `wf_<id>` workflow id is recovered from the path
and a crew that is one workflow is labelled as one; a pinned or narrow room falls back to two rows
or to no crew and **no body is ever drawn outside its room**; the deck shows a crew as one
expandable group; under reduced motion cables draw with no pulses and a count badge; one `door` cue
at the threshold crossing and none per pulse; a golden fixture `crew@phase=0.16` captures the
pulses mid-cable, byte-identical across two runs; and a runtime carrying only a `parentSessionId`
draws today's seats, never a crew.

---

## 6. Owner decisions

1. **Is three the threshold?** Default: **yes.** One or two juniors keep the seats they have. The
   alternative is a setting, and a setting here means two floors to test and two pictures to explain.
2. **Does a junior draw at 0.66, or keep today's 0.80?** Default: **0.66**, the brief's band. The
   cost is that a lone junior beside a parent shrinks too, because one junior scale is better than
   two. Say no and the crew arc gets crowded.
3. **Does the pulse rate track the junior's real event rate, or run at one cadence?** Default: **the
   real rate, quantised to 1 / 2 / 4 and capped.** It is the only part of the show carrying
   information, and the quantisation keeps it honest at poll resolution. Say no and the cables are
   decoration, which §1.4 then forbids outright.
4. **Does `run` ship?** Default: **yes, for `needs_input` trips to Your Office only.** It is the one
   piece of motion here that is a claim rather than a state, and it is the claim the product exists
   to make. Say no and every trip walks, which costs nothing but a beat.
