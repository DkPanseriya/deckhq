# 11 — The look control centre

**Status:** design, 15 September 2026. No package here is approved; nothing under `src/`, `public/`
or `test/` was touched and no daemon was started.

`03-VISUAL-SPEC.md` §1 is binding. `10-INTERIOR-DESIGN.md` owns what the rooms are made of; **this
file owns which of those decisions the user may make.** WP-85a/b have shipped (`DEVIATIONS.md` §160,
§163), 85c is in flight, WP-79 put the robot on the floor (§162).

The owner, 15 September: *"I still don't see any option to configure the overall GUI graphics:
office floor carpet and colours, rugs, tables, chairs, sofa, plants, etc. We do not flood everything
with too many options; the interior designer carefully crafts options that can be mixed and matched
or customised... The same graphics control centre also configures agent size, and the size of table,
chair, sofa, everything adjusts automatically."*

**Everything below was measured.** The scheme transform, the nine floor materials and the six presets
were run through the shipped `materialTokensFor`, `assertThemeContrast` and
`assertMaterialDiscipline` on all three themes — 162 material × scheme × theme combinations. Where a
number is a *bar* rather than a measurement, it says so.

---

## 1. What the user may change, and what they may not

Curated, not free-form. No colour picker, no image upload, no per-prop placement: a choice is a
named thing an interior designer would name, and every one is measured before it is offered.

**Not configurable, by construction:** the seven state colours, the reserved crimson, the fourteen
project identities, the figure halo `#F6F2E9`, the character, room geometry and who sits where
(WP-55 / 77 / 78), plate content (WP-81), the camera, type sizes. The Look centre paints the
building and may never touch a signal — the same allowlist discipline `themes.js` uses, where the
option tables *are* the allowlist.

### 1.a Floor material, per zone — 20 options across four zones

Nine painters, each a pattern rule in **plan units** (so a bake at any `u` lays the same floor rather
than the same bitmap), coloured from the eleven WP-85a tokens and nothing else. Zones: **O**ffice 5,
**C**orridor 4, project **R**ooms 5, **L**ounge 6 — no broadloom in the lounge, because a lounge is a
hard floor with rugs on it.

| material | zones | pattern rule | derived from |
|---|---|---|---|
| herringbone oak | O L | 1.71 U cell, block 2.43 × 0.82 U at 45°, four tones ±0.03, seam 0.8 px @ 0.20 | `wood` |
| wide ash boards | O R L | planks 9 × 1.6 U on the long axis, ends staggered a third, tones ±0.025, seam @ 0.16 | `mix(wood, tile, .35)` |
| terrazzo | O L | 220 seeded chips per 100 U², each 0.10–0.22 U, three chip tones, no grid | `screed` + chips |
| polished concrete | O C R L | one diagonal sheen, saw-cut joints on a 12 U grid @ 0.10 | `shade(screed, −.04)` |
| wool broadloom | O R | two hairline weave passes at a 0.21 U pitch (WP-85a's carpet) | `carpet` |
| loop-pile tile | C R | the same weave under a 6 U checker of alternating pile, ±0.012 | `carpet` |
| ceramic tile | C L | 1.57 U grid, hairline grout @ 0.16 | `tile` |
| poured screed | C | flat, one long sheen, speckle @ 0.13 | `screed` |
| cork | R L | flat, seeded 0.16 × 0.07 U grain flecks @ 0.14 | `shade(mix(wood, carpet, .35), −.03)` |

Measured over all 162 combinations: **worst floor ink 6.99:1** (night shift, the boards under a pool
of light) against the 4.5 bar; **max field contrast 1.134:1** against WP-85a's 1.14 ceiling; **max
speck contrast 1.93:1**, a terrazzo chip against its own ground, under a separate 2.0 ceiling because
a chip under 0.3 U is a speck the eye integrates rather than a field.

### 1.b Colour schemes — 6

A scheme is not a theme. It is a **transform over the theme's own eleven tokens**, so all three
themes still apply on top and a pack theme gets the six for free.

Each of the nine surface tokens is mixed toward an anchor hue held at that token's own lightness, its
chroma is scaled, and **the result is pushed back to the token's original relative luminance by
bisection** — the device `underWall` already uses. `ink` is untouched; `plant` takes the chroma
factor but never the hue, because foliage is not a finish.

| scheme | anchor | weight | chroma |
|---|---|---|---|
| **warm** | — | 0 | ×1.00 |
| **cool** | 205° | 0.55 | ×1.15 |
| **mono** | — (hue held) | 0 | ×0.12 |
| **forest** | 128° | 0.45 | ×1.05 |
| **clay** | 18° | 0.55 | ×1.15 |
| **ink** | 230° | 0.60 | ×0.85 |

`warm` is the identity transform: one of the six has to be the door back, and it is the one the
goldens are shot in.

**The luminance lock is the whole safety argument.** A WCAG ratio depends only on relative luminance,
so if a scheme moves none, every measurement in `assertThemeContrast` is unchanged by construction
and the option space does not have to be enumerated to be safe. Measured max ΔL over all 18 scheme ×
theme pairs: **0.00534**, the residue of a 24-step bisection. The one guard that is *not* a tautology
is the crimson bar, an sRGB distance and therefore hue-dependent: worst measured **95.5** (clay on
blueprint) against a bar of 60, so no chroma walk-back was needed anywhere. It exists anyway, for a
pack theme nobody has written yet.

Said out loud: `clay` on blueprint lands on a plum rather than a terracotta — blueprint starts far
from 18° and a scheme moves part of the way, never all of it. The swatch shows what will happen.

### 1.c Furniture sets — 3

A set swaps **silhouettes only** — radius, edge treatment, leg and arm marks, seam count. Footprints,
anchors and tokens do not move, so §3.4's sizes survive intact.

- **Scandi** (default, what ships): 0.18 × min-dimension radius, two leg pads, a 0.15 U edge band,
  seat backs as a band plus a cushion.
- **Industrial**: 0.1 U radius, a 0.2 U dark frame line on every piece, a cross-brace under desk and
  counter tops, a bent-tube chair back drawn as an open U, shelf uprights shown.
- **Soft**: 0.42 × min-dimension radius, no frame lines, rolled arms on sofa, armchair and tub chair,
  a whiteboard face that reads as felt.

Guard: a plan-hash test proves the emitted plan is byte-identical across the three. A set is paint,
exactly as WP-85a was.

### 1.d Rugs — 3 tones × 2 patterns, set per rug role

Tones **wool** (the WP-85a slate), **sage**, **sand** (`mix(carpet, wood, 0.45)`); patterns **plain**
(field + 0.4 U border) and **banded** (three 0.5 U bands at ⅙, ½, ⅚ of the short axis, ±0.02). The two
rug roles — **wool** in reception and lounge, **task** in project rooms and break-out corners — each
take one of the six.

**The guard, and a real failure it finds.** A rug must read against the floor under it and stay inside
that floor's value plateau, because a name is drawn wherever the agent stands and that is very often a
rug: **rug-on-floor ∈ [1.06, 1.45]**. Measured on the shipped floor today, no scheme applied:

| | default | night shift | blueprint |
|---|---|---|---|
| wool rug on the office boards | 1.23 | **1.00** | 1.13 |
| task rug on the project-room carpet | 1.32 | **1.56** | **1.69** |

The wool rug is invisible on night shift; the task rug is the loudest local contrast in a project
room on both dark themes. Both derive through a **constant** mix weight while the gap between `plant`
and `carpet` is not constant across themes. WP-88a's first job is to make those two weights a
bisection on the ratio — measured landing points: task rug mix toward `plant` 0.30 → 0.25 (night
shift, 1.43) and → 0.20 (blueprint, 1.44); wool rug `shade` +0.05 and +0.01 (both 1.16).

Refusals the guard produces today: *"sage on polished concrete is 1.01:1 — the rug would not read"*;
*"wool on a wool-broadloom room is 1.53:1 — the rug would be the loudest thing in the room"*.

### 1.e Plants — 3 densities × 3 families

Densities are a **ceiling, not a quota**: sparse 1 / 3 / 1, normal 2 / 6 / 2, lush 3 / 8 / 4 per
project room, lounge bay and reception. WP-85c's rules bind first — one free-standing prop per 9 U²
of clear floor, no two identical silhouettes within 8 U, nothing within 1.2 U of a character — so a
small room never reaches `lush`.

Families supply §3.6's three kinds at §3.6's footprints (2.0 / 2.4 / 3.2 U), differing in silhouette
and a ±0.06 shade of `plant`: **Leafy** (the shipped lobes), **Architectural** (upright blades, leaf
discs, a tall dracaena), **Dry** (fine canopy, grass tuft, cactus column).

### 1.f Prop density — 3

Quiet 1 per 14 U², normal 1 per 9 U² (shipped), busy 1 per 6 U². **Anchored** props — monitor, tray,
pinboard, whiteboard, shelf — are furniture, not decoration, and are unaffected. Busy never overrides
the no-two-identical-silhouettes-within-8 U rule.

### 1.g Lounge kit — which bays exist

Four checkboxes over §3.7's bays: **sitting** (always on — it is the fallback), **quiet**, **café**,
**games**; 8 legal kits. §3.7's width rule is unchanged, so a narrow lounge still drops bays from the
right and the kit is also a ceiling. Turning `games` off is how a user gets a floor with no saturated
accent on it at all.

### Mix-and-match rules

1. **No choice changes lightness.** Schemes lock luminance, floors derive from the tokens, sets are
   paint. Every contrast the theme passed, every combination passes.
2. **Zone edge ≤ 1.60:1.** Adjacent zones separate by pattern and temperature, not by value.
   Measured over the six presets × three themes: **1.02 to 1.50** (worst: Workshop on blueprint). The
   intent is under 1.35; 1.60 is where it is refused.
3. **Two adjacent zones may not use the same floor option** — *"the corridor would vanish into the
   office"* — and if they share a tone source their edge must still reach 1.04:1.
4. **Rug band [1.06, 1.45]** against every floor that rug lies on (§1.d).
5. **The wall ceiling** (`underWall`) and **the crimson bar** (≥ 60) apply to every new material.
6. **Ink ≥ 4.5:1** on every material, its pooled composite, and its fourteen identity-washed variants
   where it is a carpet.

A refused combination **changes nothing** and says why, in its own row — `validateLayout`'s
whole-or-one-error discipline applied to a picker.

---

## 2. Agent size, and the scaling law

`small` / `medium` / `large` / `auto`. Auto reads the **live** count — ≤ 10 large, ≤ 40 medium, else
small — with **±2 hysteresis** (up at 12 and 42, down at 8 and 38) and at most one re-bake per 30 s,
so a floor on a boundary does not flip every poll.

The setting is `RIG_UNIT_U` — 1.6 / 2.0 / 2.5 — giving `BODY_HEIGHT_U` 2.02 / 2.52 / 3.15 and a scale
factor **s = 0.80 / 1.00 / 1.25**. Medium is today, exactly.

**The law: everything a human body sets scales by `s`; everything the building sets does not.** A
chair is sized by a person. A corridor is sized by a plan.

| scales with the character | medium | small | large |
|---|---|---|---|
| body height | 2.52 | 2.02 | 3.15 |
| task / tub / stool / armchair | 2.0 / 2.4 / 1.4 / 3.0 | 1.60 / 1.92 / 1.12 / 2.40 | 2.50 / 3.00 / 1.75 / 3.75 |
| seat pitch · visitor pitch · queue pitch | 2.6 · 5.2 · 3.8 | 2.08 · 4.16 · 3.04 | 3.25 · 6.50 · 4.75 |
| desk / table depth · sofa depth · sofa min run | 2.6 · 2.6 · 5.2 | 2.08 · 2.08 · 4.16 | 3.25 · 3.25 · 6.50 |
| task-rug pad · break-out rug ⌀ · chair gap | 1.0 · 6.4 · 0.15 | 0.80 · 5.12 · 0.12 | 1.25 · 8.00 · 0.19 |
| plants, broad / blade / tree | 2.0 / 2.4 / 3.2 | 1.60 / 1.92 / 2.56 | 2.50 / 3.00 / 4.00 |
| desk light-pool margin · prop clearance from a body | 2.2 · 1.2 | 1.76 · 0.96 | 2.75 · 1.50 |
| the figure's own chrome bands | 2.35 / 3.05 / 3.45 | ×0.80 | ×1.25 |

| does not scale — the building sets it | U |
|---|---|
| room padding · corridor · stage margin · door width | 3.80 · 4.00 · 2.50 · 3.50 |
| plate band · minimum project room | 3.40 · 15 × 13 |
| herringbone cell · carpet weave pitch · tile cell · threshold pool | 1.71 · 0.21 · 1.57 · 2.80 |
| band depths, the building envelope, wall thickness, the fit-scale clamp | unchanged |
| **plate type (13 / 12 / 11 px) and the legibility floors (16 / 13 / 12 / 11 px)** | **UI, not units** |

A bench desk's *length* is seats × pitch, so it follows without being listed. The plate is UI and its
type never moves: a large floor gets larger people under the same labels, not larger labels.

**Why this supersedes WP-80.** WP-80's criterion was that the same population produces *the same room
rectangles* at all four settings. That is the wrong invariant — a 3.15 U robot at a 2.6 U desk sits
through the desk. What must hold instead is that **the same population puts the same people in the
same rooms in the same order** at every size, while the rooms grow and shrink with their contents,
which is what WP-55 has always done. A cluster's area moves as `s²` (0.64× / 1.56×) and the minimums
do not, so a five-agent floor at `large` feels big and a hundred-agent floor at `small` still fits
with every body above the 16 px legibility floor.

---

## 3. Presets

Six starting points, each a complete look the user may then edit —
[`presets.png`](../media/look/presets.png).

| preset | in one line | zone edges (default / night / blueprint) |
|---|---|---|
| **Studio oak** | *the default* — warm oak, wool rugs, everything on; the floor exactly as it ships | 1.02 / 1.41 / 1.27 |
| **Night lab** | polished concrete under an ink wash, industrial frames, no games bay | 1.29 / 1.26 / 1.49 |
| **Paper office** | mono over ash boards; every surface a neutral, so the only colour left is the people | 1.05 / 1.35 / 1.33 |
| **Terrazzo hall** | a civic building — terrazzo, ceramic tile, soft silhouettes, busy shelves | 1.19 / 1.22 / 1.46 |
| **Garden floor** | cork and ash under a forest wash, planted as far as the density rules allow, agents large | 1.24 / 1.27 / 1.13 |
| **Workshop** | clay over concrete, industrial frames, agents small — a hundred sessions in a shed | 1.30 / 1.27 / 1.50 |

**Studio oak is byte-identical to what ships today** — the property that keeps every existing golden
still. Editing any control marks the preset `· edited`, and `Reset to preset` puts one group, or the
whole section, back.

---

## 4. The control centre

One surface: a **Look** section inside the existing settings sheet, between Floor and Data —
[`control-centre.png`](../media/look/control-centre.png).

- **Six preset cards** on top, each a floor thumbnail painted by the real backdrop painter at ~7 px/U
  into an `OffscreenCanvas`, the current one checked.
- **A live floor preview** under them — office fragment, corridor, project room, lounge bay at ~9 px/U
  — repainted on every change, with the current combination's measured zone edges, both rug ratios and
  worst floor ink beneath it.
- **Ten grouped pickers**, every chip the same painter at 46 × 28, so a swatch cannot drift from the
  floor it stands for. **A refusal appears in its own row**, names both materials and the ratio, and
  moves nothing.
- **Persistence**: one `look` object in `state.json` through `/api/settings`, `'look'` added to
  `SETTINGS_KEYS`, `DEFAULT_SETTINGS.look` holding Studio oak literally.
- **`?look=<preset>`** paints one tab through `url-options.js` as `?theme=` does: a preset **name**
  only, never an arbitrary object — a URL that could set any look is a link a stranger could send —
  never written back, unknown value ignored.
- **Export / import** on the `layout-io` pattern: `kind: "deckhq.look"`, `version: 1`, validated
  whole-or-one-error by `src/core/look.mjs`. Unlike a layout it names no project and no path, so it is
  anonymous and can be posted.
- **Reduced motion costs nothing** — every preview is static and a change repaints in one frame — and
  every control is **keyboard**-operable: radio groups on arrow keys, checkboxes on space, preset cards
  one radio group. The deck-table rule does not apply (this is a form), and there is **no new
  full-surface view**: the sheet already carries ✕ and *Back to floor* (WP-84).

---

## 5. Packages

### WP-88a · The options model, the derivation and the guards · `AR` + `UX` · **M** · no UI

`public/render/look.js` (option tables, the scheme transform, four new painters, `derivedLookTokens`)
and `src/core/look.mjs` (schema, `validateLook`, `DEFAULT_LOOK`, export/import). Accepted when: all **162** material × scheme × theme combinations pass `assertThemeContrast` and
`assertMaterialDiscipline` unmodified, enumerated by a test rather than asserted in prose; every
material's field contrast is ≤ 1.14:1, every speck ≤ 2.0:1, none brighter than its theme's wall; no
scheme moves a token's relative luminance by more than **0.01**; the two rug derivations become
bisections and the band [1.06, 1.45] holds for both roles on all three themes, which it does **not**
today (§1.d); `validateLook` refuses an out-of-band rug pair, a same-option zone pair and a zone edge
over 1.60 with the reason, changing nothing; `DEFAULT_LOOK` reproduces today's palette and plan hashes
exactly. **No golden is rebaked here.**

### WP-88b · The Look section and the previews · `UX` · **L** · after 88a

Accepted when: the section exists with six preset cards, the live preview and ten pickers; a
source-reading test proves every swatch and preview is painted by `backdrop-floor.js`; a refusal shows
its reason in its row and leaves the control where it was; `look` round-trips through `/api/settings`
and `settings-keys.test.mjs` passes with it added; `?look=night-lab` paints one tab and writes nothing;
export | import is a fixed point and eleven bad files change nothing (`layout-io`'s shape); every
control is operable from the keyboard alone and the static view gate passes; **one new golden**, the
existing nine unchanged.

### WP-88c · Agent size and the scaling law · `AR` + `UX` · **M** · after 88b · supersedes WP-80

Accepted when: `RIG_UNIT_U` is 1.6 / 2.0 / 2.5 by setting and `auto` picks from the live count with ±2
hysteresis; every length in §2's first table scales by `s` and every length in the second is
byte-identical across all four settings, asserted by enumerating both lists against an emitted plan;
at `medium` the emitted plan is byte-identical to today's; over `floor-integrity.test.mjs`'s sixteen
populations no character overlaps the furniture it sits at at any size, and the same population puts
the same people in the same rooms in the same order at all four; at `small` on the largest population
every body clears `LEGIBILITY_MIN_PX.body` (16 px) at fit scale, and at `large` on the smallest no
room leaves the stage; `?scale=` works as WP-80 specified.

### Goldens strategy

**One composite golden**, `test/goldens/<platform>/look.png` — the six preset thumbnails, 3 × 2, at the
painter's own thumbnail scale. Not one full-stage golden per preset: eighteen files per platform that
all move whenever any paint changes, for a defect a thumbnail already shows. Plus **one** size picture,
`three@large.png`, because "the furniture grew with the figure" is exactly the class of bug (§26, §52,
§55) that passes every unit test and is obvious in one screenshot. The existing nine goldens are
**unchanged** — Studio oak at `medium` is today's floor — and a diff in any of them is this package
failing, not a rebake.

---

## 6. Owner decisions

1. **Does the Look centre ship, and free?** *Default: yes, free.* It touches no capture, no queue and
   no action, and `03-BUSINESS-MODEL.md` sells *more* themes rather than gating the ones that exist.
2. **Is `Studio oak` the default and byte-identical to today?** *Default: yes.* A default that changed
   the shipped floor would move every golden and decide for the majority who never open the section.
3. **Does `auto` ship as the default agent size?** *Default: yes.* It is the only setting right on
   both a five-agent and a hundred-agent floor; it costs one number per poll.
4. **Six schemes as a transform, or six more themes?** *Default: transform.* As themes they would be
   eighteen palettes maintained by hand and a pack theme would get none of them; as a transform the
   luminance lock makes every combination safe by construction.

---

## Mockups

Standalone canvas-2D pages rendered in headless Chrome — no libraries, no network, no assets. **They
are not screenshots of shipped code** and nothing in them is a promise about a frame. Their colours
are real: every token came from the shipped `materialTokensFor` through the transform above.

| file | what it shows |
|---|---|
| [`presets.png`](../media/look/presets.png) | §3 — the six presets over the `three` population, default theme, 3 × 2 |
| [`control-centre.png`](../media/look/control-centre.png) | §4 — the Look section in the settings sheet, with a refusal |
| [`agent-sizes.png`](../media/look/agent-sizes.png) | §2 — one project room at small / medium / large, furniture scaled, with the law as a table |
