# DeckHQ — Visual & Motion Specification

**Status:** approved for build · Read `01-PRODUCT.md` and `02-ARCHITECTURE.md` first.

The renderer is **Studio only**. Pixel, Isometric and Blueprint are deleted in WP0.

The reference is a photorealistic top-down architectural floor plan: real materials, real
furniture, soft shadows, warm light. Not a grid. Not a diagram.

---

## 1. Camera, units and level of detail

- **Projection:** orthographic top-down. No perspective, no isometric skew. Occlusion is the enemy
  of a monitoring surface — a raised hand must never be hidden behind a wall.
- **Unit:** `U = 14 px` at zoom 1.0. All plan geometry is expressed in whole or half units.
- **Zoom:** continuous `0.35 – 2.5`. Controls: a slider in the header, `Ctrl`/`⌘` + scroll wheel,
  and `+` / `-` keys. `0` resets to fit. Zoom persists in settings.
- Default on first run is **fit-to-window**.

### 1.1 LOD bands

The renderer picks a band from the current zoom. This is how glanceability and animation coexist.

| Band | Zoom | Characters | Animation | Furniture |
|---|---|---|---|---|
| **L0 — Overview** | < 0.7 | Simple body, state colour, state icon above head | Hand-raise pulse only. Nothing else animates. | Baked, no detail props |
| **L1 — Room** | 0.7 – 1.4 | Full rig, arms visible | Typing, coffee, thinking, walking, activity loops | Baked + prop layer (mugs, cues, paddles) |
| **L2 — Close** | > 1.4 | Full rig with hands and held props | All clips at full keyframe rate, including finger motion on keys | Full detail |

The **detail card** (selected agent, in the side panel) always renders at L2 regardless of floor
zoom. That is how the user gets the close-up without giving up the overview.

At L0 the state icon above the head is the primary signal and must be readable at 100% browser
zoom on a 1080p display: minimum 10 px tall, high contrast against the floor.

## 2. Floor plan generation

> **SUPERSEDED, 30 Aug 2026.** This section is replaced in full by `05-LAYOUT-REWORK.md` (WP13).
> The algorithm below produces a floor whose aspect ratio is an accident of room sizes rather than
> the shape of the screen, and it anchors props to room corners rather than to walls or furniture —
> measured at 9–10.8 U of empty floor around each plant. Implement WP13 instead. §1 and §3–§10 of
> this document still stand.

The plan is generated from live data, then laid out. It is not hand-authored, because project
count changes — but it must never look like a uniform grid.

### 2.1 Rooms

| Room | Rule |
|---|---|
| **The user's office** | Always present, always the top-left corner. Enclosed by real walls with one door and a swing arc. Fixed 32 × 27 U. Contains the user's desk, a rug, a plant, and the waiting area. |
| **Project room** | One per project that has at least one session. Size derived from team size (§2.2). Partial-height partitions on two sides, open on the others. Contains benches, chairs, a whiteboard, and a plant. |
| **The lounge** | Always present. One large open room combining lounge, games and kitchen. Minimum 60 × 30 U, grows with benched population. **Its height is bounded by §2.4 since WP-77.** |
| **A pinned room** | A repo nobody is in that the user pinned. One desk, nobody at it, at most a third of a live room — §5.2. |

Rooms are packed left-to-right, top-to-bottom with a 3 U circulation gap. Because project rooms
differ in size, the result is an irregular plan rather than a grid — this is intended.

### 2.2 Project room sizing

```
benches   = ceil(sessionCount / 8)          // 8 seats per bench
benchCols = min(benches, 2)
benchRows = ceil(benches / benchCols)
roomW     = 6 + benchCols * 20
roomH     = 8 + benchRows * 13
```

A 21-session project gets 3 benches (2 + 1) in a room roughly 46 × 34 U. Nothing is hidden and no
overflow marker exists.

### 2.3 Seating geometry

**Chairs sit close to the table.** The current prototype places them far away and it reads wrong.

- Bench is 8 U wide per 4 seats, 2 U deep.
- Seat centres are offset **1.6 U** from the bench edge — chair back nearly touching the desk.
- Chairs face the bench.
- Waiting-area chairs in the user's office: 3.2 U pitch, in rows of 7, facing the user's desk.

### 2.4 The lounge is sized by who is in it (WP-77)

**Added 14 September 2026.** The owner, looking at the floor after WP-72: *"The lounge is very big,
the whole bottom half."* He was right, and the measurement is worse than the sentence. On the
`three` floor at 1600 × 1000 the lounge came out **27.7 of 57.1 units — 49% of the building — with
nobody in it**, and the identical 27.7 with fifteen people in it. Its height had nothing to do with
its occupants: it was `LOUNGE_ROW_ASPECT_MAX` and `ROOM_FILL_MAX` between them, padding a room out
to keep a proportion against a row a hundred units wide.

Three terms, and the order is the rule:

1. **The contents, always.** The lounge is first the size of what it must hold — the clusters, a
   games table once there are more people than places, and one standing place for every benched or
   ended agent it draws. This is a floor the other two may not argue below: furniture outside its
   own room is the one thing the plan may never do.
2. **A floor minimum, `LOUNGE_MIN_H`.** One sofa group, the clear floor either side of it and the
   plate across the top. An empty lounge still exists and still reads as somewhere you would want
   to go; a cleared queue is the reward and an empty grey box is not much of one.
3. **And a ceiling on the PADDING above those** — `loungeShareFor(n)` of the building's height:
   **25% while five or fewer people are in it**, five points more for every five beyond that, to a
   maximum of half. A pure function of the count: no clock, no stage, no randomness.

**Where the ceiling and the minimum disagree, the minimum wins, and this is stated because the
number reads like a promise otherwise.** At `LOUNGE_MIN_H` (19.4 U) on a 48.8 U building the lounge
is 40% of the height rather than 25%. The share bites on the **padding**, which on the owner's own
floor was eight units of it; what is left is a room the size of its own furniture. The eight units
go to the working band and to the live rooms beside it.

`LOUNGE_ROW_ASPECT_MAX` rose from 3.2 to **5.4** for the same reason and in the same package. In a
row the lounge's width is the building's, so that bound is a floor on its DEPTH rather than a cap on
its width, and at 3.2 it was buying its proportion with bare carpet inside the room — §106's defect,
one room over. What row two actually is, once the lounge is the size of what is in it, is a
**promenade**: one block deep, with the sofa group, the counter, the quiet corner and a games table
strung along the bottom of the building. 5.4 is measured — the worst two-row lounge over
`floor-integrity.test.mjs`'s sixteen populations at five aspects is 5.19:1.

## 3. The character rig

**Rewritten 14 September 2026 (WP-79).** One rig, drawn procedurally in canvas 2D, driven by a pose
object. No sprite sheets — the rig must scale cleanly across the whole zoom range.

The figure is **B**, the 45° three-quarter robot the owner picked from the four candidates in
`docs/media/design/character` (`README.md`, `B.png`, `in-situ.png`): a chunky barrel, a dome head
and a bright wrap visor. It replaces the top-down doodle this section used to describe — an ellipse
with stroke limbs, whose readable coloured mass was 22 px inside a 48 px box.

### 3.1 Billboarding, and what happened to `bodyAngle`

**The figure never turns.** `Pose.bodyAngle` is still carried and still means what §3.4 says it
means, and the seat, the path tangent and the clip's sway still compose into it — the rig simply
does not rotate the sprite by it. A three-quarter figure drawn on a plan has no facing to
contradict: the sprite always faces the reader, and the **contact ellipse under its feet is the only
element in the floor's own plane.** That is the convention every top-down RPG uses, and it is what
makes all six poses read from whichever direction the user is scanning.

It also deletes a class of defect. The old rig rotated every part by `bodyAngle` through a
quarter-turn correction, and getting the correction wrong put the head on one side and the hands on
the other (`docs/DEVIATIONS.md` §26). There is no correction left to get wrong.

### 3.2 Proportions

Everything is authored in **one local frame**: origin at the ground contact, y up, one local unit =
`RIG_UNIT_U` = **2 plan units**. That number is the whole size decision and it comes from the
design's own in-situ test — a 1:1 crop of `test/goldens/win32/empty.png` with the figure at **34 px**
on a floor whose fit scale is ~16.5 px per plan unit.

| part | local |
|---|---|
| barrel | 0.47 / 0.54 / 0.60 wide (identity), 0.44 × `sq` tall |
| dome | r 0.21 / 0.235 / 0.26 (identity), centred 0.60–0.86 by pose |
| visor | 1.60 × 0.80 of the dome radius, a rounded slot across the face |
| mitt | r 0.075 |
| crown accessory | six forms, 0.94–1.62 dome radii above the dome's centre |
| crown, standing | 1.26 — so `BODY_HEIGHT_U` is 2.52 plan units, unchanged |

`BODY_HEIGHT_U` landing on the old rig's number is deliberate: the fit ceiling, the floor's
px-per-unit band, the hit box and the halo pool's span are all quotients of it, and **the camera does
not move.** What changed is what fills the height.

### 3.3 State, and what carries it

**The state colour owns the whole body mass, head included.** Every shape is a tint of the state
colour (`rigTints`) — there is no second hue anywhere on the figure — so a character is one coherent
colour at 24 px rather than a grey blob with a coloured panel. Identity may not touch it.

**The visor is the state signal**, and it carries three things: the tint (a dark tint of the state
colour for the mark), the light level, and the mark itself.

| state | pose | visor | mark |
|---|---|---|---|
| `working` | at the desk, hands forward on the keys | lit | three lines of output |
| `needs_input` | hand raised high and out, clear of the dome | lit | `!` |
| `for_review` | standing, holding a page up | lit | a tick |
| `stalled` | slumped forward, squashed | dimmed 50% | an ellipsis |
| `ended` | slumped further, powered down | off | a dead bar |
| `benched` | reclined, feet out | soft (25%) | a `z` |
| walking | standing, two frames | lit | the state's own |

A lit pane with a dark mark is the design study's largest single finding: it survives 24 px, and the
inverse — a dark visor with a light mark — does not. **Three light levels rather than two**, because
"gone quiet" and "finished" are the two states a monitoring floor must never confuse.

Draw order per character: floor ring → selection ring → aura → figure halo → contact shadow → rim →
base → far arm → barrel (top plane, collar ring, chest plate, chest glyph) → held prop (behind) →
dome → visor → **near arm and mitt** → held page → crown accessory → rarity marker → prop (in front)
→ state icon → badge → name label.

The near arm goes over the dome, and that placement is load-bearing: at `needs_input` the mitt is
level with the top of the dome and just outside its edge, so an arm drawn before the head has its
forearm painted over by the head it is reaching past. **A raised hand must never be occluded**,
including by the character raising it.

### 3.4 The pose object

```ts
interface Pose {
  bodyAngle: number;        // radians, facing — carried, never drawn (§3.1)
  lean: number;             // -1 back .. 1 forward
  headTurn: number;         // -1 .. 1
  armL: { shoulder: number; elbow: number; hand: 'rest'|'key'|'grip'|'open'|'raised' };
  armR: { shoulder: number; elbow: number; hand: 'rest'|'key'|'grip'|'open'|'raised' };
  legPhase: number;         // 0..1, walk cycle; ignored when seated
  seated: boolean;
  prop: null | 'mug' | 'cue' | 'paddle' | 'controller' | 'piece' | 'plate';
  bob: number;              // vertical breathing offset in px
}
```

The clips are unchanged (§4) and still drive `bob`, `ring`, `prop` and the walk's `legPhase`. What
the clips no longer drive is the limb geometry: a state picks one of seven skeletons rather than
being solved from shoulder and elbow angles.

### 3.5 Identity slots

**Appearance is a deterministic per-session identity, not a constant.** Superseded by WP-20 on
3 September 2026 — this paragraph used to say that skin, hair and clothing detail were constant
across agents and that individuality was carried by the name label alone. Hair style, skin tone,
outfit accent, glasses and build are a hash of the session id, so the same session looks like the
same person on every machine, for ever, with nothing persisted and nothing to migrate. A small set of
accessories sits on rarity tiers — measured over 10,000 ids at 73.6% common, 20.3% uncommon, 5.3%
rare, 0.9% legendary.

WP-79 changed nothing about the hashes, the pools, the draw order or the rarity vocabulary. It
changed where the draws LAND, because B has no hair, no waistband and no face to put glasses on:

| draw | old slot | B's slot |
|---|---|---|
| project `accent` | collar dot | chest badge + collar ring |
| project `glyph` | shoulder glyph | chest glyph |
| project `hair` | hair colour | boots |
| session `accent` | waistband | antenna tip + ear cups |
| session `skin` | skin | mitts, and the dome's size |
| session `hairStyle` (6) | hair silhouette | crown accessory (6) |
| session `build` (3) | torso scale | barrel width (3) |
| session `glasses` | lens rings | brow bar over the visor |
| rarity trait | hat/scarf/jacket/hair/crown/glow | a cap, a collar band, a shoulder yoke, a rare antenna tip, a gold crown, an aura |

Seven of those are the **identity slots** — project colour, glyph, session colour, mitt tone, barrel
width, dome size, crown accessory — and "no two of twelve look alike" is held as a measured property
over them: every pair in the demo population differs in at least two.

The old sentence's reason survives as the constraint on the new rule: **state stays readable.**
Identity may not touch the barrel's fill or the visor's tint, and every appearance colour is at least
70 in sRGB from every state colour — computed at import time rather than eyeballed, so a new accent
that reads as a state fails the build. Nothing here is earned, nothing decays, no count moves, and
none of it is a score on the human (`docs/plan/08-PLAN-V2-100X.md` §1.1 rule 6). Full reasoning and
the measurements: `docs/DEVIATIONS.md` §105 and §162.

### 3.6 Level of detail

Three things drop below **30 px of figure** — the design README's own risk note, since the rim pass
doubles the stroke work and a floor can hold a hundred agents: the **rim halo**, the **chest glyph**
and the **far arm**. L0 drops the same three at any scale. Below 30 px the visor's mark also swaps to
one bold form instead of its full drawing.

**The visor and the raised hand are in no drop list.** They are drawn at every level of detail and at
every zoom, because they are the two things the floor exists to say.

### 3.7 Motion

**Rewritten 15 September 2026 (WP-87).** This section used to say that the idle phase came "from the
injected clock (`public/clock.js`) and nothing else". It did not. `scene-agent.js`'s `nowMs()`
returned `performance.now()` — a tab-local counter no fixture can pin — and passed it to
`idlePhase()` under a comment calling it the injected clock; it was also subtracted from a
`clipStartedAt` that came from `Date.now()`, so a clip's `t` was a monotonic counter minus an epoch
instant, about −1.7 billion seconds. The goldens were stable for an unrelated reason:
`scripts/goldens.mjs` emulates `prefers-reduced-motion`, which forces the phase to exactly `0`. **The
whole committed set was the reduced-motion render**, which is why §162.9 could report *0 px moved at
all*, and why no animation in this document had ever appeared in a golden.

**There is now one clock and one phase, and they are the daemon's.**

- **`animMs()` is every phase's clock** — `public/clock.js`, which is the daemon's pinned instant
  when `DECKHQ_NOW` pins one and this machine's otherwise. Two tabs on one floor draw the same frame
  and a reload does not restart a cycle.
- **`frameMs()` is `performance.now()`, and it is frame pacing only** — the `dt` the runtime is
  stepped by, and the re-plan cross-fade. An interval is a fact about this tab; a phase is not.
- **A clip's phase offset is a real timestamp on the agent** wherever the model carries one:
  `needsInputSince` for the wave, `reviewSince` for the review, `lastActivityAt` otherwise. Not when
  this tab happened to notice.
- **`?phase=0.25` pins every animation's phase WITHOUT disabling motion**, this tab only, never
  written back (`public/url-options.js`'s idiom). It is the seam the `demo@motion` golden is taken
  through: a photograph of a moving floor that is byte-identical across two runs.
- **No `Math.random()` under any draw.** Every choice a figure makes — which lounge activity, which
  place, how long it holds one — is a hash of the session id and a cycle index, the way identity has
  been a pure function of the session id since WP-20.

Idle micro-motion is an **antenna bob** and a **visor blink**, both from one phase in `[0, 1)`. Under
`prefers-reduced-motion` the phase is exactly `0`, so every term derived from it drops out of the
arithmetic and the figure is the static one the design sheets show (§10). Walking is **two frames**
and no blend — a chunky robot's walk is a waddle, and a waddle is a step and its mirror. Running is
**four frames** at 0.52 s, and §4.4 says which one trip ever uses it.

## 4. Motion clips

Clips are keyframe sets over `Pose`, interpolated with `ease-in-out-sine`, looping unless noted.
They are data, not code, and live in `render/clips.js`. Every clip must be usable by any character
anywhere on the floor — a clip does not know which room it is in.

### 4.1 Work clips

| Clip | Duration | Description |
|---|---|---|
| `type` | 0.9 s loop | Seated, lean +0.15. Hands alternate on the keyboard, 4 strokes per cycle. Subtle torso bob. At L2, individual finger taps. |
| `think` | 3.2 s loop | Seated, lean -0.2, head turn ±0.3, right hand to chin. Three thought dots rise and fade above the head. |
| `drink` | 2.6 s once | Seated. Right hand grips mug, raises to head, 0.6 s hold, lowers, returns to keys. Triggered occasionally during `working`. |
| `stretch` | 2.0 s once | Seated, both arms up and back, lean -0.4. Occasional idle variation. |
| `hand_raise` | 1.4 s loop | Seated, right arm fully raised, slight wave. **Pulsing ring** on the floor beneath, in the needs-input colour. The single most important animation in the product. |
| `slump` | 4.0 s loop | Seated, lean +0.35, head down, arms at rest. Used for `stalled`. Deliberately low-energy. |
| `walk` | 0.8 s loop | Standing, leg cycle, arms counter-swing, body angle follows the path tangent. |
| `run` | 0.52 s loop | **WP-87.** Standing, four frames, lean +0.28, arms swung high and tight, double bob. The one trip that uses it is §4.4's; nothing else on this floor ever runs. |
| `stand_wait` | 4.0 s loop | Standing, weight shift every 2 s, occasional head turn. Used in the user's office. |

### 4.2 Lounge clips

These exist to make a cleared queue feel like a reward. They are not filler.

| Clip | Duration | Description |
|---|---|---|
| `pool` | 4.5 s loop | Standing at the pool table, lean forward, cue draws back and strokes, ball moves. Two agents alternate turns. |
| `table_tennis` | 1.6 s loop | **Paired.** Two agents at opposite ends, paddles swing in antiphase, ball crosses the net. |
| `board_game` | 5.0 s loop | **Paired or group.** Seated, alternating reach-and-place, occasional think pose. |
| `arcade` | 2.2 s loop | Standing at the cabinet, both hands on controls, body leans with the action, screen flickers. |
| `coffee` | 6.0 s once | Walks to the machine, presses, waits 1.5 s, takes mug, `prop = mug`. Then walks to a seat. |
| `eat` | 3.4 s loop | Seated at the dining table, `prop = plate`, hand to mouth. |
| `chat` | 4.0 s loop | **Paired.** Two agents facing, alternating gesture, speech dots above the speaker. Not dealt by a bay — see §4.3. |
| `read` | 20.0 s loop | **WP-87.** In an armchair in the quiet bay, a held page and a **0.60 s page turn every 20 s**. The quiet corner was §3.7's one place with nothing to do in it. |
| `lounge_idle` | 5.0 s loop | On a sofa, lean back, occasional head turn. |

### 4.3 Activity rotation

A benched agent picks an activity, performs it for **45–90 s**, then walks to another. Paired
activities wait for a partner; if none is free the agent takes a solo activity. This rotation is what
makes the lounge feel alive rather than static. Rotation pauses entirely when the tab is hidden.

**Which activity is a HASH, not a roll (WP-87), and it is dealt by BAY.** §3.7 lays the lounge as
four bays and every lounge spot now carries the name of the one it stands in, so the rotation deals
`BAY_ACTIVITIES[bay][hash(sessionId, bay, cycleIndex) % n]` and the hold is
`hash(sessionId, cycleIndex)` mapped into 45–90 s:

| bay | deals |
|---|---|
| sitting | `lounge_idle` |
| café | `coffee`, `eat` |
| quiet | `read` |
| games | `pool`, `table_tennis`, `board_game`, `arcade` |

Two tabs on one floor therefore show the same lounge, a reload does not re-deal it, and a golden can
photograph it. A narrow lounge that gave up its games bay (§3.7's drop order) deals nobody a pool
shot, because the bay is read off the spots the plan actually laid. `chat` is in no bay: two agents
facing each other need no furniture, so there is no place to deal and dealing it anyway would put
two people gesturing across a pool table.

### 4.4 Character life (WP-87)

What a figure does beyond holding its pose. `docs/plan/12-MOTION-AND-CREW.md` §2 is the design of
record and `docs/media/motion/life-sheet.png` draws every strip; the table is `public/render/life.js`
and `test/unit/character-life.test.mjs` asserts each row against it.

| animation | trigger (what is OBSERVED) | frames · period | LOD | reduced |
|---|---|---|---|---|
| **working · type** | `activityState = working` | 4 · 0.90 s, loops | all | hands on the keys, no bob |
| **visor flicker** | `currentTool.since` MOVES — a real tool call opening | 3 · 0.24 s, once, **capped at one per 0.5 s** | all | the lit visor, no flash |
| **thinking · cloud** | turn open, `currentTool` null, > 2.0 s since the last event | 4 · sway 3.20 s; growth is not a loop | ≥ 1 | the cloud at its size, no sway |
| **needs_input · wave** | `activityState = needs_input` | 4 · 1.40 s, loops, with the floor ring | all | hand up, ring at half phase |
| **for_review · page flip** | idle only, while `for_review` holds | 4 · 0.50 s, once every 12 s | ≥ 1 | page held flat |
| **stalled · slump + dots** | `activityState = stalled` | 3 · 4.00 s, loops | ≥ 1 | slumped, two dots, visor 50% |
| **ended · power-down** | the session's own end timestamp | 5 · 1.60 s, **once, ever** | all | frame 5 immediately |
| **benched · lounge** | `ackState = benched` | per activity, 45–90 s hold (§4.3) | ≥ 1 | one frame, same hash |
| **walk** | any trip that is not the one below | 2 · 0.80 s | ≥ 1 | no trip animated |
| **run** | destination is Your Office **and** state is `needs_input` | 4 · 0.52 s | ≥ 1 | no trip animated |
| **spawn** | an id in this snapshot that was not in the last | 3 · 0.32 s, once | all | figure simply present |
| **despawn** | an id that left the snapshot | 3 · 0.42 s, once | all | figure simply gone |

**Honesty.** Nothing animates that is not backed by a real observed event or state. The typing
cadence is a constant and **is not the token rate** — nothing reports keystrokes, and `tokens` is a
running total sampled at the poll. The cloud does not mean *reasoning*: DeckHQ cannot see a thinking
block, and what it can see is that a turn is open, no tool is running and nothing has been written
for N seconds. It grows one lobe at 2 s, two at 6 s, three at 15 s, **and then stops** — a cloud that
kept growing would be a claim about difficulty the data cannot support. The visor flicker fires only
on a `currentTool.since` the adapter genuinely saw move, so a runtime that reports no tool events
never flashes. `ended` **latches**, keyed to the session's own end timestamp rather than to a flag, so
it cannot run twice across a reload or a second tab — and it is never the fold-away, because an ended
session *stays on the floor* (§5.1) and folding it away would say it had left. There is no animation
at all on `let_go`.

**Running is a claim.** The one trip that runs is an agent going to Your Office because it needs
input. `for_review` walks: it is waiting on you, but it is not blocked mid-turn. Nothing else on this
floor ever runs, which is what keeps the claim readable across a room.

**LOD.** §3.6's drop list stands unchanged; to it this adds: at **L0 the thought cloud, the page flip
and the stall dots are dropped**, and below the tier only the visor and the raised hand animate. **The
visor and the raised hand are in no drop list at any zoom.**

**Motion never covers a raised hand or a label.** The cloud and the stall dots hang in the same
above-head slot §7's chrome uses, and they are last in its precedence: a state icon wins, then the
tool bubble, then these. So a `stalled` figure on the floor shows its hourglass rather than its two
dots — the hourglass says the same thing louder — and the dots appear where the slot is free, which
is a stalled session that has been benched. The pose, the visor's dimming and the slump are the
stall signal either way.

**Budget.** Per frame an agent costs its pose, its visor and at most one over-head element; no draw
allocates per call — the character-life director fills one module-scope scratch object and hands the
same one back. Asserted as draw-call counts over a hundred figures rather than as milliseconds,
because a wall-clock assertion in a unit suite fails on a busy runner and says nothing about the
commit.

## 5. State → visual mapping

This table is the contract between the model and the screen. The `ended` row was added on 30 Aug 2026: it is the commonest state on a real machine (41 of 52 at first run) and without its own row it inherited the working green, making dead sessions appear to be producing output. Every state must be distinguishable
at L0 by colour **and** icon — colour alone fails for colour-blind users.

| State | Colour | Icon (above head) | Clip | Location |
|---|---|---|---|---|
| `working` | Green `#2E7D63` | none | `type`, with `drink` / `think` / `stretch` interleaved | Project desk |
| `needs_input` | Amber `#B87333` | **Raised hand**, pulsing | `hand_raise` | User's office, on the sofas |
| `stalled` | Muted amber `#9A7B4F` | Hourglass | `slump` | Project desk |
| `for_review` | Crimson `#C0392B` | Checkmark in a circle | `stand_wait` | User's office, on the sofas |
| `ended` | Warm dark grey `#6E6A63` | none | `slump` (seated, still) | Lounge |
| `benched` | Slate `#7B8794` | none | rotating lounge clips | Lounge |
| `let_go` | Grey `#BDB7AA` | none | none | Off floor |

Walking between locations always uses `walk`, in the colour of the destination state.

### 5.1 The occupancy rule

**Amended 14 September 2026 (WP-78), and again on 15 September (WP-93).** The Location column above
used to read *Project desk* for `needs_input`, `stalled` and `ended` alike. The owner: *"Only live
working agents are on desks in the project rooms. Everyone else is in the lounge area, so I can
clearly see which sessions are active at the moment."* A room where the session that finished three
weeks ago sits in the same pose at the same kind of desk as the one that is typing cannot answer
that, and on the reference machine it was 21 bodies over one working session.

Three zones, one question each. This is the contract; `public/floor-rule.js` is the one
implementation of it, on the side both the daemon and the browser can see.

| Zone | The question it answers | States |
|---|---|---|
| **Project desk** | Is this session *working for me* right now? | `working`, `stalled` |
| **The user's office** | Is this session *waiting on me* right now? | `needs_input`, `for_review` |
| **The lounge** | Everything else | `ended`, `benched` |

Five rules qualify it, and each one is there because the obvious reading of the table is wrong
without it:

1. **`stalled` keeps its desk, and it is the one exception.** A stalled session is `working` that
   has gone quiet past the stall window (`01-PRODUCT.md` §4.2): it is still live, and it may produce
   its next line a second from now. Walking it to the lounge would make the floor move on a *timer*
   rather than on an *event*, and it would have to walk back. It stays at its desk, slumped, with
   its stall badge.
2. **The waiting sit on the sofas.** The owner, 15 September 2026: *"They all should sit on the
   sofa. Only the agent I open walks up to the manager desk."* Every waiting session takes a place
   on one of the reception's three sofa runs, in **arrival order, oldest wait nearest the desk** —
   which fills the runs from their open ends inward, the way a real waiting room fills. The sofa
   pitch is `OFFICE_SOFA_PITCH` (5.2 U), which clears a body plus its badge plus its name on
   whichever axis the packer lays the room. **Whoever the runs cannot seat stands**, in a short
   queue inside the well the three runs enclose, also in arrival order, beside the seating and
   **never at the desk**: the well starts 2.4 U below the visitor chair, so a standing place is
   beside the sofas rather than across the manager's table.
3. **One visitor chair, and only the session you OPEN sits in it.** There is exactly one chair at
   the manager's desk, square across it, and it is **empty whenever no waiting session's panel is
   open**. Open one and that session — and only that session — gets up, walks to the chair and sits
   facing the manager; close the panel, or open another, and it walks back to its own place, which
   was held for it rather than closed up behind it. A selected session that is **not** waiting does
   not move: working stays at its desk, resting stays in the lounge. Under
   `prefers-reduced-motion` both walks are teleports (§10).
4. **Occupancy is a pure function of the population plus that one selection.** `placement()` reads
   `ackState` and `activityState` and nothing else, so the ZONE is the state's alone; the seat
   inside the office is `assignSeats(plan, agents, { selectedId })`, and `selectedId` is
   user-owned client state that is never persisted, never written back, and never set by an
   observed event. **No hook, scan or session end can put anybody in the chair**
   (`test/unit/occupancy.test.mjs`, `INVARIANT:`).
5. **A repo with no live session still earns no room, and its finished sessions are still off the
   floor** (WP-50). An `ended` session goes to the lounge only when its own project has a room. A
   project room whose only live session is waiting in the office keeps its room and draws an empty
   desk; that is the dynamic floor behaving as specified, not a defect.

The two waiting states stay visibly different wherever they are sitting — a raised hand is still a
raised hand, and a finished turn still stands and waits (`01-PRODUCT.md` §4.2: *a raised hand at a
desk means I am blocked; a person in your office means I finished*; the first half of that sentence
now means a raised hand **in your office**).

**What WP-78 got wrong, kept here so it is not re-derived.** WP-78 read the owner's sentence as a
description of the floor he was looking at rather than as the floor he wanted, and put the whole
waiting queue in a row of two or three chairs at the desk with the sofas seating nobody. It is the
one place in this product where a shipped package contradicted the owner's own words on purpose
(`00-REQUIREMENTS.md` R-043 carried that departure for a day). The argument it made — that
oldest-first is only legible as a queue — survives: the sofas are filled oldest-nearest, which is
the same ordering read off furniture instead of off a row of chairs.

### 5.2 The pinned room (WP-77)

The owner, 14 September 2026: *"Pin any particular project room so it is always in a room, so the
room does not collapse when agents are not running, maybe downsized according to live agents."*

Rule 4 above is the default and is unchanged. A **pin** is the user overriding it for one repo, and
it is the only thing on the floor that is neither observed nor derived: `pins[projectId]` in
`state.json`, written by `POST /api/pin` and by nothing else. It takes `ackState`'s discipline in
full (`08` §1.1 rule 1) — **no observed event may clear a pin.** A session ending, a process going,
a repo falling past the gone-home window: none of them touches it, and `test/unit/pins.test.mjs`
holds that as an `INVARIANT:` test.

What a pinned repo gets:

| | Rule |
|---|---|
| **Where** | A strip along the bottom of the working side, under the live rooms and above whatever open floor is left. Content goes before carpet. |
| **How big** | At most **a third of the narrowest live room's footprint** on the same floor. The depth is `PINNED_DEPTH_SHARE` of the band the live rooms asked for, and the width is then capped so the area lands under the third — depth alone would give a strip as wide as the row. |
| **What is in it** | One desk. **No chair, no monitor, nobody** — a pinned room seats nobody, because pinning keeps the room and not the people. Its sessions are still the idle list's business. |
| **The plate** | `N sessions · pinned`. No token line and no payroll meter: nothing is running in it, so those numbers cannot change, and a plate is for what can. |
| **When it fills** | The moment a session starts in that repo it is a live room again, at a live room's size. The pin is untouched by that and takes effect again when the room empties. |

**A pinned repo is a room, and therefore not a line.** WP-60's property is unchanged — *a repo with
sessions is a room or a line, never both and never neither* — so a pinned repo leaves the idle list.
The list keeps its own section for them, marked and with the toggle on the row, because a control
you can turn on in one place and off in another is two controls.

**Archiving still wins over pinning.** Both are the user speaking, and *take this off my floor* is
the more specific of the two. The interface never offers both at once.

**Colour discipline:** crimson appears *only* for `for_review`. If the user sees red anywhere on
the floor, something is standing in their office. Nothing decorative may use it.

## 6. Materials and furniture

All baked into the backdrop bitmap once per layout change.

| Surface | Treatment |
|---|---|
| User's office, lounge | Herringbone boards. 1.71 U lattice cell, four tones a thirtieth apart, 0.8 px seams at 0.20 alpha. |
| Project rooms, circulation | Woven carpet, warm grey, two hairline weave passes at a 3 px pitch. Washed 6 % toward the project's identity (§5). |
| Corridors and the spine | Poured screed, one long soft sheen, nothing else. |
| Kitchen area | Square tile with hairline grout, 22 px grid. |
| Walls | 5 px thick, drop shadow onto the floor, and a gradient ambient-occlusion band where wall meets floor. **Not near-white since WP-85a** — the wall is the top of a room's value range, not a light source. |
| Partitions | 0.3 U thick, waist height, no shadow — visually subordinate to real walls. |
| Doors | Gap in the wall plus a quarter-circle swing arc. Architectural convention, and it reads instantly. |
| Pools of light | A soft warm radial over the manager's desk, every working desk and every threshold — baked, static, and what turns §6.1's key light into a light rather than a shadow direction. |

**Furniture inventory:** bench desks with a lit edge and a darker light-away band, monitors with
screen glow, keyboards, task chairs with backrest and arms, tub chairs, armchairs, bar stools, the
user's desk with its monitor and in-tray, sofas with cushions, coffee table, round dining table,
pool table with cues and balls, table-tennis table with net, board-game table, arcade cabinet,
kitchen counter with hob and sink, coffee machine, fridge, whiteboard, shelf, pinboard, rugs
(rectangular and round, with a border inset), four planting kinds (§6.4), a screed threshold and a
doormat, and what is on a desk: a mug, a notebook, a sticky note and an in-tray.

### 6.3 The furniture set, and how big each piece is

**`docs/plan/10-INTERIOR-DESIGN.md` §3.4 is the table, and `public/render/plan-furniture.js` is that
table in code.** Nothing here restates a size, because two statements of one dimension are two
dimensions that may disagree (§16, §35, §38). What this section owns is the four rules a piece has
to satisfy whatever its size, all of them measured by `test/unit/interior.test.mjs`:

1. **A piece reads by SHAPE, not by brightness.** Nothing inside a room is brighter than that
   theme's wall (WP-85a), so a whiteboard, a sofa and a tub chair are told apart by their outlines.
2. **Every seat shows its back**, every table shows its edge — a `TABLE_EDGE_U` band of the darker
   timber on the side the light travels toward, a capped sheen on the side it comes from.
3. **No two seat kinds share a footprint.** Four kinds, four sizes: tub 2.4 U, task 2.0, stool 1.4,
   armchair 3.0.
4. **A rug defines a group and never covers a room.** A project room's task rug is its desk cluster
   plus `RUG_CLUSTER_PAD`, capped at `RUG_MAX_OVER_CLUSTER`; floor beyond that gets a **break-out
   corner** — a round rug, two tub chairs and a side table — or stays honestly bare.

Every furniture item carries a soft contact shadow. Shadows are what make a flat render read as a
photograph rather than a diagram.

### 6.4 Props, plants and density (WP-85c)

**`docs/plan/10-INTERIOR-DESIGN.md` §3.5 and §3.6 are the catalogue, and `public/render/plan-props.js`
is that catalogue in code.** As with §6.3, nothing here restates a size. What this section owns is
what a room may be decorated WITH and how much of it, and every rule below is measured over emitted
plans by `test/unit/props.test.mjs`.

1. **Decoration is a function of available anchors, not of area** (WP13 §2.3). A room answers a
   corner, a wall and a desk; it does not answer square footage.
2. **At most one free-standing prop per 9 U² of clear floor**, and **no two identical silhouettes
   within 8 U**. The second rule is about decoration, not furniture: a bench desk's four task chairs
   are four identical silhouettes 2.6 U apart and that is what a bench desk is.
3. **A clear-floor patch larger than 10 U × 10 U gets a destination, not a bigger rug** — a break-out
   corner (§6.3), a planter run, or nothing. The reception's middle and the lounge's promenade are
   clear on purpose: that is where the queue forms and where the benched stand.
4. **Nothing stands within 1.2 U of a character's footprint.** At 34 px a prop any nearer is drawn
   through the figure rather than beside it.
5. **Four planting kinds, told apart by silhouette and not by scale**: a low broad bush, an upright
   blade, one tree with a single canopy, and a planter — a trough that divides one lounge bay from
   the next. **At most two per project room and six per lounge bay, and never two of the same kind
   adjacent.** The tree is the only plant that is TALL (§6.2).
6. **What is on a desk is a pure function of the desk.** At most one object in each of the three
   free places on an occupied seat's own cell, drawn from twelve enumerated sets against the desk's
   id and its ordinal in the room, so two desks side by side can never match. Nothing on a desk
   enlarges the cluster the room is sized from.
7. **Book spines are muted** — derived from the desk timber mixed halfway to three neutrals — so a
   shelf reads as texture and never competes with an identity ring.
8. **The lounge is four bays, not one field**: sitting, café, quiet, games, each with its own ground
   (only the café's is tile), its own centrepiece and a planter run between it and the next. A lounge
   laid in one row too narrow to hold them gives them up **from the right — games first, then
   quiet** — and never below two, and never when giving one up buys no row.
9. **The reception is three zones down one room**: the head, the waiting room, and the threshold —
   a doormat inside its own door, a screed band across the doorway, and the swing arc.

### 6.0 The materials themselves

**The eleven tokens, the derivation that fans them out, and the rules the interior is held to are
`docs/plan/10-INTERIOR-DESIGN.md` §3.** That document is the design of record for what this floor is
made of; this section is what the renderer does with it.

Three things from it are load-bearing here and are measured by `test/unit/interior.test.mjs`:

- **A theme is eleven colours.** `wood, carpet, screed, ground, tile, wall, partition, desk, seat,
  plant, ink` — everything else on the floor is derived from those by `materialTokensFor()`, for the
  shipped themes and a pack's alike. The default floor is that derivation too, byte for byte
  (§3.10); it used to be a hand-tuned exception and is not one any more.
- **The ground is quiet so the objects can speak.** A herringbone board's four tones sit inside one
  value plateau — at most **1.14:1** between the extremes, asserted over the derivation — and
  **nothing inside a room may be brighter than that theme's wall**. Both are enforced where the
  material is derived rather than checked afterwards, so a theme cannot produce a floor that breaks
  them.
- **Every pattern is a size in plan units**, not in baked pixels. A unit is about 0.30 m, so the
  1.71 U herringbone cell is a claim about a real floor: a 0.73 m × 0.25 m block, against the 1.40 m
  × 0.47 m this shipped with before WP-85a.

### 6.1 Light

**One key light, in the upper left.** It is a *direction* and not a position — the camera is
orthographic (§1), so a point light would make the shadow at one end of a ninety-unit building fall
the other way from the shadow at the other end. Stated once as `LIGHT_DIR` in
`public/render/palette-colors.js`, at 45°, and read by everything that casts. Every shadow offset in
the renderer is a distance *along* that ray, never a drop down the page, so nothing on this floor
can be lit from anywhere else; `setLightShadow()` is the only place `shadowOffsetX`/`shadowOffsetY`
are written, and `test/unit/lighting.test.mjs` reads the renderer's own source to keep it so.

What casts, from the smallest thing to the largest:

| Thing | Shadow |
|---|---|
| **Furniture, tall** | The two-pass drop shadow every prop already had (3 px along the ray), plus the contact ellipse where it meets the floor (2 px). |
| **Furniture, short** | Blur and **no offset at all**, plus a shallower contact ellipse directly beneath it. See §6.2. |
| **A character** | One contact ellipse, centred **on the feet point** — which is the character's own `(x, y)`, since the rig draws the whole body about the spot the person is standing on. No offset. |
| **Full-height walls** | 2 px, blurred 7. A **partition** is waist height and still casts nothing — it stays subordinate to a real wall (§6). |
| **A room** | A room is a **slab**. A 6 px rim inside its two light-away sides (south and east), and one soft shadow — 5 px along the ray, blurred 10 — thrown outward onto the circulation between bands and across the partition it shares with the room beside it. Its own carpet is never darkened: a plate is read on it. The ambient-occlusion band where wall meets floor stays on the other two sides, so the four edges together read as a lit slab rather than as a room outlined in dark. |
| **The building** | One soft shadow onto the studio ground, 8 px along the ray, blurred 26. The ground beside it is lifted by a gentle radial falloff that fades to the page's own ground at the furthest corner of the window, so the envelope reads as a slab lying on a surface rather than as a shape cut out of the background. |

### 6.2 Tall and short

**Added 14 September 2026 (WP-78).** One light is right for a thing with height and wrong for a
thing lying on the floor. A mug, a chair and a potted plant do not throw a shadow down and to the
right of themselves; they darken the floor they are touching. So **every prop declares its height**,
and only a tall one casts along `LIGHT_DIR`.

- **Tall** — desks, whiteboards, sofas, counters, cabinets, screens, game tables, the fridge, and
  **the one tree** (§6.4): the full §6.1 treatment, unchanged. A 3.2 U canopy at head height casts
  like the bookcase beside it.
- **Short** — chairs, the other three planting kinds, rugs and the doormat, side and coffee tables,
  monitors, lamps, mugs, notebooks, sticky notes and bowls: blur
  with no offset, and a contact ellipse directly beneath at roughly half the depth. The ellipse is
  painted over the bottom of the prop rather than under it, so a deep one on a rug reads as a
  smudge below the furniture rather than as the line where it meets the floor.
- **Walls are unchanged.** A full-height wall casts along the ray; a partition is waist height and
  casts nothing (§6). So does the building onto its ground.

**Height is a declared property of the prop kind, never inferred from its size.** `PROP_HEIGHT` in
`public/render/backdrop-paint.js` is the list, a prop may override it with its own `tall` boolean,
and a kind that appears in neither is a **test failure** rather than a default:
`test/unit/lighting.test.mjs` reads every kind a real plan emits and every kind the painters answer
to. A `w * h` heuristic would call a rug tall, which is exactly backwards.

A project room's carpet also takes a **six per cent wash** toward that project's identity colour
(§5's discipline is untouched: the wash is nowhere near crimson, and it is measured rather than
asserted — `assertThemeContrast` holds the washed carpet to 4.5:1 against every theme's ink for all
fourteen identities).

All of it is baked into the backdrop with everything else in this section — once per plan change,
never per frame — and none of it moves, so `prefers-reduced-motion` (§10) is unaffected. The one
exception is the ground's falloff, which is outside the envelope the bake *is*; it is one memoised
gradient. `docs/DEVIATIONS.md` §149.

## 7. Labels and chrome

- **Room plates (WP-81):** live text at the room's top-left — **no card, no fill** (`00-REQUIREMENTS`
  R-082), lifted off the floor's pattern by a `plateHalo` stroke that is the theme's own **wall**, so
  nothing on a plate is brighter than the brightest surface a room is allowed. **Four ranks, largest
  first, and the room's own name is the second of them:**

  | rank | size / face | ink | says |
  |---|---|---|---|
  | hero | 14 px mono 700 | `plateInk` | `● 2 need you · oldest 1d 2h` — or `3 working`, or `quiet` |
  | title | 12.5 px sans 700 | `plateInkSecondary` | the room's name |
  | doing | 11 px sans 600 | `plateInkSecondary` | `Elif · Bash npm test`, at most two entries |
  | spend | 11 px mono 600 | `plateInkTertiary` | `today 5.8M tok · with cache`, the cost after it only with `showCost` |

  The **hero outranks the name** because the name says which room and the hero says whether to get
  up. It is never a zero: a room holding nobody up says what it *is* doing instead. Its state colour
  is a **dot** and never the type — the state palette is mid-tone and cannot clear 4.5:1 as text on
  both a light and a dark plate — so the dot is held to 3:1, the words beside it carry the same fact
  at 4.5:1, and colour is never the only channel (the header's own rule, `style.css`).

  Nothing is estimated: every figure traces to a ledger record, a registry counter or a transcript
  field, and a plate with no figure says `no data`. The session count and the room's lifetime tokens
  are on the plate's **hover**, not its face — they are the size of a room, not the state of it.

  **Never covers furniture, and never the `+`.** The plate lives inside `PLATE_BAND` (3.4 U), which
  the plan keeps furniture-free by construction, and stops short of `PLUS_CLEAR_U` at the band's east
  end where the in-room `+` stands. Where the band cannot hold four ranks it drops them from the
  bottom — spend, then doing — and a plate too narrow for its hero drops the `· oldest …` tail rather
  than cutting a number. All four appear at ≥ 15.9 px per unit.
- **Waiting badge:** for `for_review` agents only, a crimson pill above the head with elapsed time
  (`2d 4h`). This is the number that makes debt visible. Badges that would overlap are replaced by
  one pill at the start of the run; the waiting area's own pitch is set so that a name label and a
  badge clear their neighbours at the fit scale, on whichever axis the reception happens to be laid
  (WP-78: the room may be transposed, §2's reception is the one room the packer turns).
- **Name labels:** shown at L1 and above, below the character, truncated to 18 characters. Since
  WP-79 the label hangs **1.62 U** below the feet rather than 1.35, because it has to clear the halo's
  ground pool (1.46 U) as well as the feet — at 1.35 the name sat inside the bright disc rather than
  under it, which was invisible while a figure was 22 px of readable mass and obvious once B filled
  its height.
- **Labels yield to bodies and to badges (WP-79).** The per-frame collision pass takes the
  characters' own boxes and the waiting badges as pinned obstacles before it places a single label,
  so a name is never drawn across a face or under a crimson pill. A label that cannot clear them
  after two nudges is dropped, which is the rule the pass already had: a missing label beats an
  unreadable smear, and the panel and the queue strip still carry every name. Measured over three
  populations: zero label-on-body overlaps, at least four labels in five still drawn.
- **Header:** needs-you total with a three-way breakdown, at-desk count, benched count, zoom
  control, hooks status, refresh.

Typography: **IBM Plex Sans** for UI text, **JetBrains Mono** for all numbers and data. Numbers
use tabular figures everywhere so counts do not jitter as they update.

## 8. Interaction

| Input | Result |
|---|---|
| Hover a character | Tooltip: title, project, model, tokens, state, elapsed |
| Click a character | Opens the side panel; the agent is ringed on the floor |
| Click a room plate | Filters the panel to that project |
| `Ctrl`/`⌘` + scroll | Zoom about the cursor |
| Drag the floor | Pan |
| `Esc` | Close panel |
| `J` / `K` | Move through the needs-you queue, oldest first |
| `A` | Acknowledge the selected agent |
| `B` | Bench the selected agent |

The side panel contains: title, state chip, project, model, branch, token facts, the real
conversation, an animated L2 close-up of the agent, the action buttons, and a composer.

## 9. Notifications

- Requested once, from a visible button — never an unprompted permission prompt on load.
- Fires when an agent **enters** `needs_input` or `for_review`. Never on state refresh, never for
  agents already in that state.
- Body: session title and project. Clicking focuses the tab and selects that agent.
- Coalesced: at most one notification per 10 s; multiples become "3 sessions need you".
- Tab title always carries the count: `(3) DeckHQ`.

## 10. Accessibility and motion

**Rewritten 14 September 2026 (WP-85a).** This section used to promise that *"all state colours meet
3:1 against their floor background"*. It was not true on any theme and it could not be made true:
the state palette is mid-tone — `benched #7B8794` and `needs_input #B87333` both sit near L\* 53 —
so a floor clearing 3:1 against all six on-floor states would have to be near paper or near black.
On the default parquet `needs_input` measured **1.70:1**; on night shift `for_review` measured
**1.44:1**. Nothing measured it, because `assertThemeContrast` held state colours to the **chrome**
and never to the floor. The promise has moved onto the character, where it can be kept.

- **Every state colour meets 3:1 against the figure halo, and the halo always goes the opposite way
  from the floor.** One constant, `#F6F2E9`, not themeable and unreachable from any theme document:
  a soft ground **pool** under the feet on a light floor, whose job is uniformity — it flattens the
  boards so the silhouette sits on one tone — and a thin **rim** on the silhouette on a dark floor,
  where a pool would be a bright hole in the room. Which device applies is
  `relativeLuminance(ink) > 0.5`. Measured worst case, every theme and every theme anybody will ever
  write: `benched` at **3.28:1**. `assertFigureHaloContrast()` re-measures it at import and
  `test/unit/interior.test.mjs` prints all six.
- **Text meets 4.5:1 on every ground it lands on** — including the fourteen identity-washed carpets,
  and including a ground at a pool of light's brightest point.
- The state colours on the bare floor are measured too, and recorded as **known and accepted**
  failures rather than deleted quietly: `test/unit/interior.test.mjs` prints all ninety pairs and
  fails if a floor ever does clear the bar on its own, so the halo can be reconsidered on evidence.
- State is never conveyed by colour alone — every state has an icon or a distinct pose.
- `prefers-reduced-motion: reduce`: characters snap between positions, clips hold a
  representative static pose, the hand-raise pulse becomes a static ring, lounge rotation stops.
  **The product must remain fully usable and fully legible in this mode.**
- **The reduced form is INFORMATIVE, never absent (WP-87).** Every animation in §4.4 states its
  reduced frame and every one of them is still a claim a reader can act on: the cloud at its current
  size, the page held flat, two dots over a stall, a hand up. Nothing reduces to nothing. And nothing
  in the reduced frame carries a phase term — `test/unit/character-life.test.mjs` renders the same
  figure at two different clocks and asserts the two are byte-identical.
- Full keyboard navigation of the queue and all actions (§8).
- The canvas carries an `aria-label` summarising the floor, and an off-screen live region
  announces state changes for screen readers.
