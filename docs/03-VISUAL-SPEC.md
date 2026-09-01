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
| **The lounge** | Always present. One large open room combining lounge, games and kitchen. Minimum 60 × 30 U, grows with benched population. |

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

## 3. The character rig

One rig, drawn procedurally in canvas 2D, driven by a pose object. No sprite sheets — the rig must
scale cleanly across the whole zoom range.

```ts
interface Pose {
  bodyAngle: number;        // radians, facing
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

Draw order per character: contact shadow → legs → torso → held prop (behind) → arms → head →
hair → prop (in front) → state icon → badge.

Body colour is the **state colour**. Skin, hair and clothing detail are constant across agents —
individuality is carried by the name label, not by appearance. This keeps state readable.

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
| `chat` | 4.0 s loop | **Paired.** Two agents facing, alternating gesture, speech dots above the speaker. |
| `lounge_idle` | 5.0 s loop | On a sofa, lean back, occasional head turn. |

### 4.3 Activity rotation

A benched agent picks an activity, performs it for **45–90 s** (randomised), then walks to another.
Paired activities wait for a partner; if none is free the agent takes a solo activity. This
rotation is what makes the lounge feel alive rather than static. Rotation pauses entirely when the
tab is hidden.

## 5. State → visual mapping

This table is the contract between the model and the screen. The `ended` row was added on 30 Aug 2026: it is the commonest state on a real machine (41 of 52 at first run) and without its own row it inherited the working green, making dead sessions appear to be producing output. Every state must be distinguishable
at L0 by colour **and** icon — colour alone fails for colour-blind users.

| State | Colour | Icon (above head) | Clip | Location |
|---|---|---|---|---|
| `working` | Green `#2E7D63` | none | `type`, with `drink` / `think` / `stretch` interleaved | Project desk |
| `needs_input` | Amber `#B87333` | **Raised hand**, pulsing | `hand_raise` | Project desk |
| `stalled` | Muted amber `#9A7B4F` | Hourglass | `slump` | Project desk |
| `for_review` | Crimson `#C0392B` | Checkmark in a circle | `stand_wait` | User's office waiting area |
| `ended` | Warm dark grey `#6E6A63` | none | `slump` (seated, still) | Project desk |
| `benched` | Slate `#7B8794` | none | rotating lounge clips | Lounge |
| `let_go` | Grey `#BDB7AA` | none | none | Off floor |

Walking between locations always uses `walk`, in the colour of the destination state.

**Colour discipline:** crimson appears *only* for `for_review`. If the user sees red anywhere on
the floor, something is standing in their office. Nothing decorative may use it.

## 6. Materials and furniture

All baked into the backdrop bitmap once per layout change.

| Surface | Treatment |
|---|---|
| User's office, lounge | Herringbone wood. 46 px lattice cell, four tone variations, 1.6 px seams. |
| Project rooms, circulation | Woven carpet, warm grey, fine two-tone noise. |
| Kitchen area | Square tile with grout lines. |
| Walls | 5 px thick, near-white fill, drop shadow onto the floor, and a gradient ambient-occlusion band where wall meets floor. |
| Partitions | 0.3 U thick, waist height, no shadow — visually subordinate to real walls. |
| Doors | Gap in the wall plus a quarter-circle swing arc. Architectural convention, and it reads instantly. |

**Furniture inventory:** bench desks with centre divider, monitors with screen glow, keyboards,
task chairs with backrest and arms, the user's desk, sofas with cushions, coffee table, round
dining table, pool table with cues and balls, table-tennis table with net, board-game table,
arcade cabinet, kitchen counter with hob and sink, coffee machine, fridge, rugs (rectangular and
round, with a border inset), potted plants at three scales.

Every furniture item carries a soft contact shadow. Shadows are what make a flat render read as a
photograph rather than a diagram.

## 7. Labels and chrome

- **Room plates:** a small rounded white card at the room's top-left with the room name and one
  line of live data (`21 sessions · 2.2M tokens · 3 need you`). Never covers furniture.
- **Waiting badge:** for `for_review` agents only, a crimson pill above the head with elapsed time
  (`2d 4h`). This is the number that makes debt visible.
- **Name labels:** shown at L1 and above, below the character, truncated to 18 characters.
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

- All state colours meet 3:1 against their floor background; text meets 4.5:1.
- State is never conveyed by colour alone — every state has an icon or a distinct pose.
- `prefers-reduced-motion: reduce`: characters snap between positions, clips hold a
  representative static pose, the hand-raise pulse becomes a static ring, lounge rotation stops.
  **The product must remain fully usable and fully legible in this mode.**
- Full keyboard navigation of the queue and all actions (§8).
- The canvas carries an `aria-label` summarising the floor, and an off-screen live region
  announces state changes for screen readers.
