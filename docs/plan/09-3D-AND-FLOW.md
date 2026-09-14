# 09 — 3D, and the things a 3D picture is usually credited with

**Status:** analysis, 14 September 2026. No package in this file is approved. It exists because the
owner looked at another project's three.js office and asked a fair question:

> I do not see any 3D implementation like the other project. It is a lot of work, but it shows how
> everything flows, is controlled, managed workflow, hierarchy. Think and analyse in depth; if
> usable keep it for the future.

The reference is `agents-office`, captured and mechanism-mapped in the visual takeover memo, under
PolyForm Noncommercial: ideas only, nothing copied. `03-VISUAL-SPEC.md` §1 is binding on everything
below.

---

## 1. What the 3D scene actually communicates

The honest answer is that the picture is good and the projection is doing almost none of the work.

### 1.1 Carried by the geometry

Three things, and they are all about material rather than meaning.

**Mass.** Each department is an extruded slab with a visible 2–3 unit side face. A slab with a side
reads as a thing lying on a surface; a filled rectangle reads as ink. That is real, and it is why
the scene looks like a model on a table.

**A horizon.** The slabs have height, so the corridors between them have a floor.

**Occlusion.** A cost, not a benefit. In `ao-04` the label `CLIENT ASSETS` sits on top of
`QUALITY ASSURANCE CHECKER`, `INBOUND LEADS MANAGER` is cut in half by the Sales card, and every
character faces away from the camera, so a person's state has to be read from a pill rather than
from the person. Their own capture is the argument against their own camera.

That is the whole contribution of the third dimension. Mass, a horizon, and a problem.

### 1.2 Carried by layout, arcs, grouping and labels

Everything the owner named. Each of these is a 2D drawing over a 3D scene, and every one of them
would work unchanged on a flat floor.

**Flow** is dashed arcs with travelling dots between slabs, coloured by source department, plus a
central hub (`THE BRAIN · 35 NOTES`) every arc passes through. A graph drawn in screen space.

**Hierarchy** is a star and the word `LEAD` on a white pill, plus a seat at the head of a bench.
A label and a seating rule. Leads are not taller, not larger, not lit differently.

**Control** is the task rail on the right: rows with a percent chip, a role, a department and a
timestamp, filtered by `ALL / BACKLOG / IN PROGRESS / WAITING / DONE`. HTML beside a canvas.
`WAITING 0` is the only thing on screen that says who is blocked on whom, and it is a tab.

**Progress** is `DOING 7 · NEXT 6 · DONE 7` on a card, and a bar under each row. Two rows of text.

**Grouping** is a floor tint at five to eight per cent of the department hue, read before any
label. Also flat.

So: the scene communicates a place. The overlay communicates the work. The overlay is where the
answer is, and DeckHQ's overlay is the part that is missing.

### 1.3 What DeckHQ's floor does not do, and why that is not a camera problem

DeckHQ has the data for all four and draws none of them.

- **Hierarchy exists in the model already.** User → project → session → subagent. WP-41 seats
  juniors beside their parent, and `Your Office` is the manager's room. Nothing on the floor says
  that the desk in `Your Office` outranks the queue, or that a junior belongs to the parent beside
  it. No line, no plate, no pose.
- **Blocked-on exists.** `needs_input` and `for_review` are "blocked on the user" by definition;
  Studio adds "blocked on a review gate" and "blocked on a budget cap" (`07-STUDIO-DESIGN.md` §5.2,
  §8). The floor draws the state and never the edge to the thing being waited on.
- **Hand-off exists.** An agent entering `for_review` walks to `Your Office`. That is the one real
  hand-off in the product, drawn as a person moving with no trace of where it came from.
- **Progress exists** in the Studio board and nowhere on the floor.

No camera closes those four. Edges and labels do. That is the finding.

---

## 2. Three routes

### Route 1 — express it in the 2D canvas that exists

Five pieces, all inside the current renderer.

1. **Hand-off arcs.** One arc per real event, never a mesh: project room → `Your Office` when an
   agent enters `for_review`; parent desk → junior desk on a subagent spawn. Dash phase comes from
   the injected clock (WP-63, `DECKHQ_NOW`), so two renders at one timestamp are identical, and
   `prefers-reduced-motion` pins the phase at zero. Arcs decay so the floor accumulates no history.
2. **A hierarchy layer.** The user's desk stays the head of the office; a project's longest-lived
   session takes the head of its bench; juniors keep WP-41's seat beside the parent and gain a thin
   tether. Rank is seat, tether and plate, never size — size is WP-80's setting and cannot carry two
   meanings.
3. **Blocked-on edges.** A short spur from a blocked agent to what it waits on, with three targets
   only: the user, a review card, a budget stop. Crimson stays reserved for `for_review` (§5's
   colour discipline is not negotiable); the other two take the project's identity colour.
4. **A secondary view.** A chain tab in the deck: the same tree as a real table, keyboard-reachable,
   no canvas. Hierarchy legible with no picture at all, and the version a screen reader gets.
5. **Studio's board as the managed-workflow surface.** WP-69 already ships six columns, roles,
   budgets, a blocked column and a handover gate — the "managed workflow" the reference renders as
   a task rail, and better, because a column is user-owned and a percent chip is not.

**Cost:** one M package for arcs and edges, one S for the tether and seating, the chain tab beside
the deck. The board is already scheduled.
**Risk:** the floor gets busy, and the captures show what that looks like at a hundred labels.
Mitigation is a hard rule — one arc per event — and the existing "never covers furniture" golden
check extended to edges.
**Gives:** all four things the owner named, on the surface that exists, inside the goldens, with no
new dependency and no new projection.

### Route 2 — an optional isometric 2.5D projection of the same plan

The plan is already unit-space rectangles with anchored props. A 45° elevation is an affine
transform on the existing world-to-screen conversion plus one height number per prop. No engine, no
WebGL, no GPU; goldens stay byte-deterministic because it is still canvas 2D driven by the injected
clock.

The problem is the one `03-VISUAL-SPEC.md` §1 names: *a raised hand must never be hidden behind a
wall*. Three candidate answers, and only one of them is a guarantee.

- **Sort order** (painter's algorithm by depth) produces *correct* occlusion, which is exactly the
  failure. Not a fix.
- **Transparency** — anything above waist height drops to low alpha when it overlaps a
  `needs_input` agent — needs a per-frame overlap test, flickers as agents move, and answers a
  categorical requirement with a probability.
- **Hoisted badges** are the guarantee. The state icon leaves the head and is drawn in a
  screen-space pass after everything else, at the agent's projected position plus a fixed rise.
  Nothing is drawn after it, so nothing can cover it. The test is cheap: in every golden, every
  `needs_input` icon rect is unoccluded and ≥ 10 px tall.

**Cost:** L. Every prop needs a height, `scene-hit.js` needs the inverse transform, fit-scale is
recomputed, and the golden set gains a variant per projection on both platforms.
**Risk:** it contradicts a binding spec section, so it is an owner decision rather than an agent's
judgement. Label collision gets worse before it gets better.
**Gives:** mass and a horizon, and nothing for flow, hierarchy, control or progress that route 1
does not already give. That is §1.1's whole point.

### Route 3 — a real 3D view as a second renderer over the same `/api/state`

Lazily loaded, same data, never the default. Two ways to ship it.

**Vendored `three.js` in `public/vendor/`.** No CDN and no egress, so rule 2 holds. It is a checked-in
file rather than an npm dependency, so rule 3 holds on a technicality. It adds roughly 600 kB to a
package whose whole pitch is `npx deckhq` in ten seconds, and that is a real cost paid by every
user for a view most will never open.

**A Supporter pack.** `packs/` already exists, signed, loaded from `~/.deckhq/packs/`, with a WP-45
test that asserts a pack changes no API response. A cosmetic second view is what that mechanism is
for, and it keeps the core's size and the "nothing that captures, queues or acts is gated" rule
intact at once.

Against either: **there can be no goldens.** GPU-dependent shading and shadow maps are not
reproducible across machines, so the one mechanism this project trusts to catch invisible
regressions does not apply. **Perf:** the 2D floor is cheap because the backdrop is baked once per
plan change; seventy lit meshes with shadows on a laptop is not. **Reduced motion** rules out
auto-orbit and idle sway, which is most of what a 3D scene is for. **Accessibility** is unchanged —
the deck table is the accessible surface and stays so — which also means 3D adds none.

And the honesty rule decides it. §1.2 scores every feature on one question: does it reduce the time
the user must spend looking at DeckHQ per unit of agent output? A 3D office increases dwell time by
construction and reduces nothing. It is the "observational theater" failure with a better renderer.

---

## 3. Recommendation

**Do route 1. Keep route 2 on the shelf. Do not put three.js in the free core.**

**Now.** The packages this analysis opens in `08-PLAN-V2-100X.md` §9 come first, because they are
the preconditions: WP-78 makes the manager's desk read as the manager's desk, WP-79 makes a
character legible enough that a pose can carry rank, WP-81 makes the plate say who is blocked and
for how long. After those three, one package for hand-off arcs, blocked-on edges and the chain tab.
Studio's board (WP-69) ships as the managed-workflow surface with no new picture at all.

**Later.** The isometric projection, as a second projection behind a setting, and only when two
things are true: route 1 has shipped and is demonstrably not enough, and the hoisted-badge guarantee
has a passing test on both golden platforms. Until then it is a memo, not a package.

**Never.** WebGL on the default surface. A renderer with no goldens as the primary view. A CDN asset
of any kind. If 3D ever ships it is a Supporter pack, it is a second view, and the 2D floor and the
deck table remain the surfaces every claim is tested against. That is an owner decision and it is
filed as §13.21.
