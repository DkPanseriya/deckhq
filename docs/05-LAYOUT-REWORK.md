# WP13 — Layout rework: fit the screen, anchor the furniture

**Status:** approved for execution · **Owner:** R3 (renderer) · **Estimate:** 3 days
**Supersedes:** `03-VISUAL-SPEC.md` §2 (floor plan generation) in full. §1, §3–§10 stand.

The floor currently reads as furniture scattered on a field rather than a designed office. This is
not a polish pass. The layout algorithm is wrong in three specific, measured ways and needs
replacing.

---

## 1. What is actually wrong

Measured against the live plan, not by eye.

### 1.1 The floor's aspect ratio is an accident

Rooms are fixed sizes (`OFFICE_W 32 × OFFICE_H 27`, `LOUNGE_MIN 60 × 30`, bench cells `20 × 13`)
fed to a bottom-left **skyline bin packer**. The resulting canvas is whatever shape those blocks
happen to stack into — measured at **98 × 33 units (2.97:1)** in one configuration and roughly
square in another. It is never the shape of the screen it is displayed on.

Consequences: the floor is letterboxed inside a large black field, or it overflows and the user
scrolls. Both are unacceptable. A floor plan that requires scrolling cannot answer "is anything
waiting on me" in two seconds, which is the product's entire promise.

### 1.2 Props are anchored to rooms, not to furniture

Plants are placed at fixed room-relative offsets:

```js
props.push({ kind: 'plant', x: x + spec.w - 2, y: y + spec.h - 2, ... });  // room's corner
```

A room's size is derived from its bench count plus padding, so when a room is larger than its
furniture the corner is nowhere near anything. **Measured: plants sit 9.0, 9.1 and 10.8 units from
the nearest non-plant object** — 125 to 150 px of bare floor around each one. That is the
"plants floating in blank space" defect, and the same class of error puts sofas adrift in the
lounge.

Real interiors do not work this way. Objects touch walls, or they touch each other, or they are
deliberately centred in a defined zone. Nothing floats.

### 1.3 Rooms grow but never shrink

The lounge holds a `60 × 30` minimum whether it contains twelve benched agents or **zero**. On a
first run — precisely when a new user forms their impression — a large, empty, fully furnished
lounge occupies a quarter of the floor for no reason.

---

## 2. The fix

Three changes, in dependency order. Do not start §2.2 before §2.1 is accepted.

### 2.1 Furniture defines room size — never the reverse

Invert the current direction. Today a room is sized from a formula and furniture is scattered
inside it. Instead:

1. Lay out a room's furniture in **local coordinates**, packed at real spacing.
2. Take the bounding box of that furniture.
3. The room is that bounding box plus a fixed **2 U circulation margin** on every side.

A room is therefore never larger than what it contains. Empty middles become impossible by
construction rather than by tuning. A lounge with zero benched agents shrinks to its smallest
furnished form — one sofa group and the kitchen counter — because that is all it needs to hold.

**Density is fixed at this stage and never rescaled per room.** Global fit is handled once, in
§2.2, by scaling the whole floor uniformly. Chairs must never end up nearer or further from their
desk in one room than another.

### 2.2 Pack rooms into the screen's aspect ratio with a squarified treemap

Replace the skyline packer entirely.

```
targetAspect = clamp(viewportWidth / viewportHeight, 1.60, 1.78)   // 16:10 … 16:9
```

Then:

1. Compute each room's **natural area** from §2.1.
2. Build the floor rectangle at `targetAspect`, with total area equal to the sum of room areas
   plus a 6% circulation allowance.
3. Fill it with a **squarified treemap** over the room areas. A treemap tiles a given rectangle
   exactly — no gaps, no overflow, and the "squarified" variant keeps each tile close to square,
   which is what makes rooms look like rooms rather than corridors.
4. Constrain the office to the **first tile**, so it always lands top-left as `01-PRODUCT.md` §4.3
   requires. The lounge takes the last tile.
5. Each room is then centred within its tile at its natural size; leftover tile space becomes
   circulation, which is what corridors are.

Room aspect must be clamped to `[0.6, 1.8]`; if the treemap hands a room a tile outside that
range, re-flow that room's furniture to a different bench arrangement (§2.1) and repack. Two
passes are sufficient; do not iterate further.

**The floor now always has the screen's shape, and always fits with no scrolling in either
direction.** That is the acceptance test, not an aspiration.

### 2.3 Every prop declares an anchor

No prop may carry a bare `x, y` again. Extend the prop shape:

```ts
type Anchor =
  | { type: 'wall';     side: 'N'|'S'|'E'|'W'; along: number; inset?: number }
  | { type: 'corner';   corner: 'NE'|'NW'|'SE'|'SW'; inset?: number }
  | { type: 'attached'; to: string; edge: 'N'|'S'|'E'|'W'; along: number; gap?: number }
  | { type: 'centered'; of: string };
```

Resolution runs after room geometry is final, so a prop's absolute position is always derived from
something real.

| Prop | Anchor | Rule |
|---|---|---|
| Chair | `attached` to its desk | `gap: 0.15 U`. The chair back all but touches the desk edge. |
| Monitor | `attached` to its desk | On the desk surface, `gap: 0` |
| Plant | `corner` | `inset: 1.5 U` from **both** walls. A plant is never more than 2 U from a wall. |
| Sofa | `wall` | Back to the wall, `inset: 0.5 U` |
| Coffee table | `centered` on its sofa group | |
| Rug | `centered` on the group it serves | Sized to that group's bounding box plus 1 U |
| Pool / tennis / board table | `centered` in its activity slice | |
| Kitchen counter | `wall` | Against the lounge's longest wall |
| Whiteboard | `wall` | On the room's north wall, `inset: 0` |

**A room short of wall space carries fewer props. It never spreads the same props further apart.**
Decoration is a function of available anchors, not of floor area.

### 2.4 Zoom becomes magnification only

Zoom currently permits states in which the floor is smaller than, or outside, the viewport. Both
are defects, and both are the reason zoom feels broken.

- **Zoom 1.0 is redefined as exactly fit-to-viewport.** It is the minimum. There is no zooming out.
- The range becomes **1.0 – 2.5**. `Fit` returns to 1.0.
- Panning is only available above 1.0, and is clamped so the viewport can never leave the floor.
- On any viewport resize, the fit basis recomputes; a user sitting at 1.0 stays exactly fitted.

Zoom is retained rather than removed because `03-VISUAL-SPEC.md` §1.1 requires L1 and L2 detail to
be reachable, and the animation work in WP7 is only visible there. What is removed is every state
in which the user can lose the floor.

---

## 3. Acceptance

Each item is pass/fail on the reference machine and on a 1920×1080 external display.

> **§3.1 and §3.2 are superseded by the content-sized building, `08` WP-55 (3 September 2026).**
> The floor no longer fills the stage and no longer takes the window's aspect: a room's footprint
> comes from its occupants and their furniture, and the building's extent is the sum of its rooms,
> the service column and the corridors. There is ground around it on purpose — which is §2.2's own
> metaphor, a lit plan on a dark studio ground, and is what the drop shadow under the envelope has
> always been drawing. Filling the stage is what put 55% of the screen under pale carpet for one
> two-seat table. The fit scale is clamped at both ends instead (16–44 px of character body), which
> is the rule that now decides how much of the stage the building occupies. `docs/DEVIATIONS.md`
> §106. Items 3–9 below still apply.

1. ~~At every viewport size from 1280×720 to 2560×1440, the floor **exactly fills** the stage: no
   scrollbar in either axis, no letterbox band wider than 8 px.~~ Superseded — see above. What
   survives: no scrollbar in either axis, ever, at any viewport size.
2. ~~Floor aspect is within 0.02 of `clamp(viewport aspect, 1.60, 1.78)`.~~ Superseded — the
   envelope search now picks between honest layouts rather than stretching one, so a floor with a
   single room comes out the shape its contents are.
3. **No prop is more than 2.0 U from the nearest wall or the object it is attached to.** Assert
   this over the whole plan in a unit test — it is the objective form of "nothing floats".
4. Chair-to-desk gap is 0.15 U ± 0.05 for every chair on the floor, in every room.
5. With zero benched agents the lounge occupies **less than 12%** of floor area. With twelve it
   grows and still satisfies (1).
6. Resizing the window never produces a floor that is smaller than the stage, off-centre, or
   partly outside it.
7. Zoom cannot go below fit. Panning at 2.5 cannot move the viewport off the floor.
8. A 21-session project still shows every session, and its room's aspect stays within `[0.6, 1.8]`.
9. Room-to-room furniture density is uniform: the chair-to-desk gap and plant inset are identical
   in the smallest and largest rooms.

## 4. Why this is a rework and not a patch

The current code cannot be nudged into satisfying §3. Its packer takes room sizes as input and
produces a canvas as output — the dependency runs the wrong way for a screen-shaped floor, and no
amount of constant-tuning reverses it. Likewise, props carrying absolute room-relative coordinates
cannot be made to stop floating; the anchor has to exist in the data before it can be honoured in
the render.

`plan.js` is 765 lines and roughly 60% of it is the packer and prop placement. Expect to replace
that portion outright and keep the room/seat/activity vocabulary around it.
