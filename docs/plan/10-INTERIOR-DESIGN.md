# 10 — The interior

**Status:** design, 14 September 2026. No package in this file is approved.
`03-VISUAL-SPEC.md` §1 is binding: orthographic top-down, `U = 14 px`, and §7's rule that a label
never covers furniture. `05-LAYOUT-REWORK.md` owns where rooms go; this file owns what they are made
of.

The owner: *"analyse and evaluate our tool in terms of design — the floor, the carpet, the colours,
the furniture, the layout, the sizing, the items, everything. Then improve thoroughly every aspect
of the interior. Make the best interior design first; the UI engineer tweaks a bit on top."*

Everything below was measured on the committed goldens and on the renderer's own modules. The
pictures in `docs/media/interior/` are **illustrations of §3, not screenshots of shipped code**:
standalone canvas-2D pages, no libraries and no assets, at the goldens' 1600 × 1000 stage.

A unit is about **0.30 m**, from the plan rather than from a preference: `CHAIR = 2 U` is a task
chair, `DOOR_WIDTH = 3.5 U` a door, `CORRIDOR = 4 U` a corridor.

---

## 1. Audit

### 1.1 The parquet is the loudest thing in the product

`paintHerringbone` lays a **46 px lattice** and the bake runs at `U_DEFAULT`, so that is 3.29 U. A
block is **4.67 U × 1.58 U — 1.40 m × 0.47 m**. A real herringbone block is 0.30–0.60 m by
0.07–0.10 m: three times too long, five times too wide, **twelve times the area**. In
`test/goldens/win32/three.png` a board is 65 px against a 24 px character.

The contrast is worse than the scale. The four tones are `shade(wood, ±0.09)` — **1.27:1 between B
and C** on the default theme, **1.43:1** on night shift, **1.40:1** on blueprint — and every block is
outlined with a **1.6 px seam at `rgba(91,76,55,0.55)`**, seven per cent of a 22 px block in
near-black. A dark zigzag over the reception and the whole lounge, first thing the eye lands on in
`three.png` and in the 2× crop of the office, carrying no information.

### 1.2 The value hierarchy is inverted

The brightest surfaces on the floor are `wall #FCFBF8`, `chairFill #FBFAF7` and the derived
`whiteboardSurface #fbfaf8`, at **2.14:1** against the office wood — the highest local contrast
inside any room, spent on a whiteboard, a sofa and a chair. In the 2× crop of `orbital-api` the
whiteboard is the brightest object in frame and the working agent is not.

Ranked by what pulls the eye in `three.png`: the herringbone zigzag, the white whiteboards, the
white sofa runs, the crimson badge, the people. The product's promise is fourth and fifth.

### 1.3 State colours do not clear the floor they are drawn on

§10 of the visual spec promises *"All state colours meet 3:1 against their floor background."* It is
not true on any theme, and nothing measures it — `assertThemeContrast` checks state colours against
the **chrome**, never the floor.

Default theme on the office parquet: `needs_input` **1.70:1**, `benched` 1.64, `stalled` 1.77,
`working` 2.23, `ended` 2.41, `for_review` 2.44; on the project carpet the mid-tones are 2.75–2.97.
Night shift on the parquet: `for_review` **1.44:1**, `ended` 1.46, `working` 1.58. Blueprint:
`for_review` 1.74. A raised hand stands in the user's office, the office is parquet, and the most
important signal in the product is drawn at 1.70:1.

Moving the floor cannot fix it: the state palette is mid-tone — `benched #7B8794` and `needs_input
#B87333` both near L\* 53 — so a floor clearing 3:1 against all of them would have to be near paper
or near black. The answer belongs on the character (§3.9).

### 1.4 Rugs are floor covering, and floor covering says nothing

`RUG_MAX_OVER_CLUSTER` is 1.6 and `RUG_MAX_OVER_COLUMN` 2.6, so a stretched room paints a rug up to
2.6× its cluster per axis. In `three.png`'s `orbital-api` that is a pale mint slab ~20 U across
holding one 6 U desk — the largest shape in the room, at 1.31:1 against the carpet under it. A rug
defines a group; this one defines the room, which the walls already did.

### 1.5 The carpet is noise, not weave

`paintCarpet` scatters up to 6000 single pixels of `rgba(255,255,255,0.55)` and
`rgba(150,140,125,0.16)`. At 1× it reads as a dirty surface, at 2× as sensor noise. A weave is
directional and low-frequency; salt is neither.

### 1.6 Forty prop kinds, one silhouette repeated

`PROP_HEIGHT` lists forty kinds. Planting is two of them and both draw the same two-lobe blob; a
project room emits three corner `plant_large` plus one per table, the reception two more. Every
project room in `three.png` shows **four identical plants** and the lounge six. Repetition at that
rate trains the eye to skip the area.

The `shelf`'s book spines are the most saturated pixels on the floor, next to a colour discipline
that reserves crimson by name. The corridor is a featureless band 60 px deep running 1580 px across
with nothing on it. Doormat, threshold, console, pinboard — every piece of furniture that tells you
a room has begun — does not exist.

### 1.7 Layout, sizing and the lounge

The layout work is done and it is good: rooms sized by their contents (WP-55), anchored props
(WP13 §2.3), a lounge sized by its population (WP-77), the right people in the right zone (WP-78).
What is missing is the **interior** of what those rules produce.

The lounge in `three.png` is 1580 × 360 px with three furniture islands in it and roughly **three
fifths bare herringbone**. §2.4 sized the lounge by who is in it; nothing sized what is inside it.
The same defect one scale down: a 296 × 446 px project room holding one desk and four plants.

The reception has the opposite problem — furnished, and none of it reads. Sofa runs draw as a row of
near-white boxes with no arms and no back. Visitor chairs are 28 px and vanish under a 24 px
character, and at `OFFICE_VISITOR_PITCH = 6.4 U` the three of them are 90 px apart, reading as three
unrelated discs rather than a row.

### 1.8 Signage and light

The plate has a `plateHalo` token but at fit scale it is text on a halo, not §7's *"small rounded
white card"*. Its second line is 9 px grey mono, the least legible text on screen, carrying a dollar
figure WP-83 is already removing.

WP-72's light is the best thing on this floor — one `LIGHT_DIR`, slab rims, honest tall/short
shadows — and it is under-used. There is no pool of light anywhere, so the key light is a shadow
direction rather than a light.

---

## 2. Principles for this office

From workplace design. **Zone by material, not by outline** — you know you have left the corridor
because the floor changed under you. **The ground is quiet so the objects can speak**: a floor lives
in a narrow luminance band, everything worth looking at outside it. **Wayfinding is thresholds** — a
doormat, a band of screed, a pool of light. **Warmth where people wait and rest, cooler and flatter
where they work.** **Biophilia is punctuation**: two plants is planting, six identical plants is
wallpaper. **Scale rhythm** — large, medium and small at roughly 4:2:1; a room of only medium pieces
reads flat.

From top-down games that solved legibility — lessons, not looks, and no assets. *RimWorld* and
*Prison Architect* keep every floor tile inside a tight **value plateau** and put every actionable
object outside it: contrast is a budget. *Don't Starve* and *Hades* read a character by
**silhouette**, with a rim that goes the opposite way from whatever ground it is on. *Stardew
Valley* drops **texture frequency as importance falls** — busy floor, simple actor is backwards.
*Into the Breach* puts **state above the tile plane**, on a disc, so the ground never carries it.

**The hierarchy, and nothing may swap places: people; the one thing that needs action; rooms;
everything else.**

---

## 3. The design

### 3.1 Eleven tokens, everything else derived

`themes.js` already has the right shape — a theme is eleven floor tokens and `materialTokensFor`
fans them out. Keep it exactly.

| token | default | night shift | blueprint |
|---|---|---|---|
| `wood` | `#DCC9AE` | `#40454D` | `#1C3D5F` |
| `carpet` | `#E7E2D7` | `#31353D` | `#173553` |
| `screed` | `#D2CDC1` | `#2A2E35` | `#132C47` |
| `ground` | `#DFDAD0` | `#22262D` | `#112941` |
| `tile` | `#E3DFD6` | `#373C44` | `#20466C` |
| `wall` | `#F4F1EA` | `#4E545D` | `#2C5885` |
| `partition` | `#E0DACD` | `#3C414A` | `#1F4265` |
| `desk` | `#C8AC84` | `#4A4F58` | `#245079` |
| `seat` | `#DCD5C6` | `#4F555F` | `#2A5580` |
| `plant` | `#6C8F63` | `#6E9E86` | `#7FB8A2` |
| `ink` | `#32281D` | `#E8EBF1` | `#F2F6FB` |

Four moves. **The wood goes lighter and loses chroma** (`#CBA87A` → `#DCC9AE`), lifting every state
on it: `needs_input` 1.70 → 2.35, `working` 2.23 → 3.08, `for_review` 2.44 → 3.37. **The seat leaves
the near-white band** (`#FBFAF7` → `#DCD5C6`), so chairs, sofas and the derived whiteboard stop
out-shouting the people. **The desk goes darker than the floor it stands on**, so a desk is an object
rather than a lighter patch. And **zones stop separating by value** — `wood | carpet` falls from
1.68:1 to 1.25:1, with pattern and temperature carrying the boundary instead.

Derived (the full set is on `board.png`):

| token | default | night shift | blueprint |
|---|---|---|---|
| `woodB` / `woodC` | `#d5c3a9` / `#ddcbb0` | `#3e434b` / `#464b52` | `#1b3b5c` / `#234364` |
| `rugWool` | `#b5b9b9` | `#3c4551` | `#2a4560` |
| `rugTask` | `#c2c9b4` | `#435553` | `#365c6b` |
| `sofaFrame` / `sofaCushion` | `#a7a296` / `#ddd6c7` | `#3c4148` / `#535862` | `#204161` / `#2e5883` |
| `tub` (visitor chair) | `#bab2a4` | `#676d76` | `#4a6f94` |
| `board` (whiteboard) | `#e0dacd` | `#5d636c` | `#3b638a` |
| `counter` | `#ddd4c4` | `#3b4048` | `#21486f` |
| `pot` | `#c6c0b2` | `#474d56` | `#264d73` |

**Measured by running the shipped guards unmodified.** All three pass `assertThemeContrast()` and
`assertMaterialDiscipline()`. Ink on the five grounds: default 8.93 / 11.16 / 9.09 / 10.35 / 10.84;
night shift 8.08 / 10.30 / 11.41 / 12.71 / 9.29; blueprint 10.28 / 11.58 / 13.08 / 13.65 / 8.98, all
over the 4.5 floor. Worst ink on any of the fourteen identity-washed carpets: 10.23 / 9.21 / 10.44.
Closest washed carpet to crimson: 235.2 / 136.3 / 164.7 against a bar of 60, and the closest material
of any kind is the billiard rail at **78.4**. Crimson still means one thing.

### 3.2 Floors

**Boards — reception and lounge.** Herringbone, cell **24 px (1.71 U)**, block **2.43 U × 0.82 U**
(0.73 m × 0.25 m). Tone spread `shade(wood, ±0.03)`, internal contrast **1.08:1** default and 1.13:1
on both dark themes, under a 1.14:1 ceiling. Seam **0.8 px at 0.20 alpha**, down from 1.6 at 0.55.
Still 45°, which is what makes a warm room read warm.

**Weave — project rooms.** No salt: two hairline passes at a 3 px pitch, horizontal in
`rgba(255,255,255,0.03)` and vertical in `shade(carpet,-0.5)` at 0.09. Directional, gone at fit
scale, survives a 2× crop. The 6 % identity wash (WP-72) is untouched.

**Screed — corridors and the spine.** Poured, one long soft sheen, nothing else. **Tile — the café
bay only**, 22 px grid with hairline grout, under the counter run and the eating table, never the
whole bay.

**Pools of light** are the one new device, and what turns WP-72's key light into a light: a soft
radial in `#FFE9C4` at 0.10 alpha (0.055 on dark themes) over the manager's desk, every working desk,
each lounge bay's centrepiece and each corridor threshold. Baked with the backdrop.

### 3.3 Walls, partitions, thresholds

Walls keep 5 px and the WP-72 treatment but are no longer near-white. Partitions keep 0.3 U, waist
height, no shadow. Three new threshold pieces, because they are how a plan says *you are entering
something*: a **screed threshold** 4.4 U × 0.4 U across every doorway, a **doormat** 4.6 U × 1.8 U
inside the reception door only, and a **corridor light pool** of r 2.8 U on each threshold.

### 3.4 Furniture, per room type

Silhouette rules first, because they are what make a piece read at fit scale. **Every seat shows its
back** — frame band far side, cushion near, arms at 0.6 U; a rectangle with seams is a radiator.
**Every table shows its edge** — a 0.15 U darker band on the light-away side, a sheen on the lit
side. **No two seat kinds in one room share a footprint**: tub 2.4 U, task 2.0 U, stool 1.4 U,
armchair 3.0 U. **Nothing upholstered is within 1.10:1 of the floor under it.**

| room | the set, in U |
|---|---|
| **project** | bench desk 8 × 2.6 per four seats · task chair 2.0 at `CHAIR_GAP` 0.15 · monitor 1.6 × 0.5 · whiteboard 2.4 × ≥5.2, west · shelf 1.2 × ≤7 and a new **pinboard** 1.2 × 2.8 under it, east · task rug = cluster + 1.0, capped **1.35×** per axis · break-out corner: round rug r 3.2, two tub chairs, side table 1.4 |
| **reception** | user desk 8–14 × 3 with a monitor and a tray · manager behind it · three **tub chairs 2.4 at a 5.2 pitch** · sofa runs 2.6 deep on three walls · wool rug = well − 1.0 a side, ≤12 deep · coffee table 3–7 × 3 · side table 1.8 · lamp 1.6 · water cooler 1.6 · bookcase 1.2 × 8 on each long wall · art 0.4 × ≤6, east |
| **lounge** | corner sofa 20 + 9 return · armchair 3.0 · coffee table 8 × 3.6 · counter 20 × 3 · stool 1.4 at a 4 pitch · fridge 2.6 × 4 · dining table r 4 · pool 13.5 × 7 · table tennis 12 × 6 · arcade 2.6 × 2 · planter 0.9 × bay depth |

Two of those are changes rather than restatements. The **task rug** cap falls from 1.6 and 2.6 to a
single 1.35×, and where a room's clear floor still exceeds 2.2× its cluster area it gets the
**break-out corner** rather than more rug or more plants. The **visitor pitch** falls from 6.4 U to
5.2 U and the chair grows from 2.0 U to 2.4 U, so three chairs read as one row.

### 3.5 Props, density, placement

Props keep WP13's anchors and WP-78's declared heights. Four rules, all checkable on an emitted plan:
**at most one free-standing prop per 9 U² of clear floor**; **no two identical silhouettes within
8 U**; **decoration is a function of available anchors, not of area** (WP13 §2.3, unchanged); and
**a clear-floor patch larger than 10 U × 10 U gets a destination, not a bigger rug** — a break-out
corner, a planter run, or nothing. Book spines lose their saturation: `bookA/B/C` derive from the
desk timber mixed halfway to three muted neutrals, so a shelf never competes with an identity ring.

### 3.6 Plants

| kind | footprint | silhouette |
|---|---|---|
| `plant_broad` | 2.0 U | three overlapping lobes, low |
| `plant_blade` | 2.4 U | five upright blades, tall and narrow |
| `plant_tree` | 3.2 U | one canopy with two highlight masses |
| `planter` | 0.9 U × run | a trough of low planting, used as a soft partition |

**At most two per project room, six per lounge bay, and never two of the same kind adjacent.**
Planters do the dividing between bays, which is what a planting budget is for.

### 3.7 Reception, lounge, corridors

**The reception is a destination**: three zones down one room — the head (desk, manager, light pool,
art), the waiting room (rug, three tub chairs facing the desk across it, sofa runs on three walls, a
low table with something on it), and the threshold (doormat, screed band, swing arc). The middle
stays clear, because the middle is where the queue forms (§5.1 rule 3).

**The lounge is four bays, not one field** — each with its own ground, centrepiece and light pool,
divided by planter runs rather than walls.

| bay | min width | ground | what makes it a place |
|---|---|---|---|
| sitting | 26 U | boards + wool rug | corner sofa, coffee table, media wall |
| quiet | 16 U | boards + round rug | two armchairs, side table, bookcase, one tall plant |
| café | 22 U | **tile** | counter, four stools, machine, fridge, dining table |
| games | 20 U | boards | pool, table tennis, arcade |

A lounge below 60 U wide drops bays from the right — games first, then quiet. It never spreads three
bays across sixty units.

**Corridors** keep `CORRIDOR = 4 U` and gain one 0.15 U inlay down the spine plus a threshold band at
every door. That is all: a corridor that decorates itself stops being circulation.

### 3.8 Signage — the constraints handed to WP-81

WP-81 owns what the plate *says*. This is what it has to fit in.

- A **card**: 5 px radius, 10 × 6 px padding, on `plateHalo` at 0.93 with the short-prop shadow
  (2 px along `LIGHT_DIR`, blur 6). The halo always goes the opposite way from the ink, which keeps
  it ≥ 4.5:1 by construction on every theme.
- It lives inside `PLATE_BAND` (3.4 U) and may never leave it. The band is furniture-free by
  construction, which turns §7's "never covers furniture" into a property rather than a check.
- Maximum width **0.6 × the room's width**. Overflowing content **drops the lowest-ranked line**; the
  plate never shrinks type below 11 px and never wraps.
- **Three type sizes only**: 13 px semibold name, 12 px mono for the line that needs action, 11 px
  mono for the line that does not.
- Room names truncate at 22 characters. The in-room `+` is 2.4 U square in the north-east corner and
  is the only other chrome inside a room.

### 3.9 Characters at 34 px

WP-79's figure is a 45° chunky robot with a bright visor, 34 px on the floor. Four things around it
answer §1.3. The **contact ellipse**, unchanged from WP-78. The **ground pool on light themes** — a
radial in `#F6F2E9`, 0.34 alpha at centre, zero at 0.58 × body height; its job is not contrast but
**uniformity**, flattening the parquet under the feet so the silhouette sits on one tone. The **rim
on dark themes** — 1.1 px of `#F6F2E9` on the silhouette, measured against every on-floor state:
`working` 4.44, `for_review` 4.87, `ended` 4.81, `stalled` 3.53, `needs_input` 3.39, **`benched`
3.28**. One token, worst case over 3:1, both dark themes. And the **state icon on its own disc**,
drawn last, so state is never read off the ground.

Which device applies is `relativeLuminance(ink) > 0.5`, the switch the derivation already uses. **No
decorative prop stands within 1.2 U of a character's footprint**, so a plant can never be mistaken
for a person.

### 3.10 Three themes, one system

The same building at three hours, and it stays so because it is the same eleven tokens through the
same derivation. Two things are constant and not themeable: the seven state colours and the figure
halo `#F6F2E9`. The board spread, the seam, the weave, the rug derivation, the pools and the density
rules are written once and apply to whatever eleven colours a theme supplies — a pack's included,
which is why a pack theme gets this interior for free and cannot break it.

---

## 4. Where the UI wins

**Label legibility beats material**: if a plate, name or badge cannot be read on a surface, the
surface moves — `assertThemeContrast`'s own rule, and why the rug derivation stays tied to the carpet
even though a free choice would be prettier. **Badges beat composition**: the crimson pill and the
state disc draw last, over everything. **The deck overlay is untouched.** **Reduced motion costs
nothing** — every addition is static and the pools bake with the backdrop. **Goldens stay
deterministic**: every pattern is seeded from the existing `seededRng`. **A hundred agents beats
per-figure decoration**: the pool is one arc and the rim eight translated fills of a silhouette
already being drawn, and both drop at L0 where the state disc is the signal anyway. **Zero
dependency, no engine, no asset** — canvas 2D primitives over tokens that exist today. The one real
bend is §3.5's density rules, which need the plan to know what it has already placed: a counter per
room, not a solver.

---

## 5. Packages

### WP-85a · Materials, palette, floors, walls · `UX` · **M** · before WP-79

**Before the character rework, and that is the point.** WP-79 asks the owner to judge candidate
figures *against a floor*; if the floor changes afterwards, the judgement was made against a surface
that no longer exists. 85a touches no plan geometry, so its golden diff is paint only.

Accepted when: every theme's herringbone internal contrast is ≤ **1.14:1** and its block ≤ 2.6 U
long, asserted over `materialTokensFor`; the seam is ≤ 0.9 px at ≤ 0.22 alpha; `paintCarpet` emits no
1 × 1 px fills, by a source-reading test like `lighting.test.mjs`'s; no non-wall pixel inside a room
is brighter than that theme's wall in any golden; `assertThemeContrast` and
`assertMaterialDiscipline` pass unchanged on all three themes; a **new guard** asserts every state
colour ≥ 3:1 against the figure halo; and a plan-hash test proves no golden's room rectangles moved.

### WP-85b · The furniture set and room compositions · `UX` · **M** · after WP-79

After, because a tub chair has to be sized against a 34 px robot rather than a 22 px rig.

Accepted when: the task rug is ≤ 1.35× its cluster per axis in every emitted plan; the four seat
kinds have four distinct footprints (2.4 / 2.0 / 1.4 / 3.0 U); no upholstery or table token is within
1.10:1 of the ground it stands on, on any theme; the whiteboard face is below the wall in luminance
on every theme; a room whose clear floor exceeds 2.2× its cluster area emits a break-out group, and
over `floor-integrity.test.mjs`'s sixteen populations no room has a clear-floor patch larger than
10 U × 10 U; goldens rebaked once.

### WP-85c · Props, plants, density, and the lounge and reception as places · `UX` + `AR` · **L** · after 85b

Accepted when: at most two plants per project room and six per lounge bay, with no two adjacent
plants sharing a silhouette; every prop is ≤ 2.0 U from a wall or from what it is attached to (WP13
§3.3, extended to the new kinds); the lounge emits at least three named bays at any population ≥ 1,
each with its own ground and centrepiece, and its bare-floor fraction is ≤ 35 % at every one of the
sixteen populations; the reception emits a doormat, a rug under the seating group and visitor chairs
at a 5.2 U pitch, with WP-78's label-and-badge clearance check still passing; no prop stands within
1.2 U of a character's footprint; goldens rebaked.

---

## 6. Owner decisions

1. **Does 85a land before WP-79?** *Default: yes* — the character candidates should be judged on the
   floor they will live on.
2. **The reception rug's colour.** `rugWool` is the one textile on this floor with a hue of its own,
   a slate wool at `#B5B9B9` on the default theme, 191 from crimson. *Default: adopt it.* The
   alternative is a warm greige that disappears into the boards.
3. **Amend `03-VISUAL-SPEC.md` §10.** "All state colours meet 3:1 against their floor background" has
   never been true and cannot be without a paper-white or near-black floor. *Default: replace it with
   "every state colour meets 3:1 against the figure halo, and the halo always goes the opposite way
   from the floor", and make it a test.*
4. **Does a project room's spare floor get a break-out corner, or stay honestly bare?** *Default:
   break-out* — a second small destination is furniture, so the room is still the size of what is in
   it.
5. **Do the lounge games stay?** They are the one saturated accent left and the one thing that makes
   a cleared queue look like a reward. *Default: yes, muted 22–26 % toward the room's own carpet.*

---

## Mockups

Illustrations of §3 rendered as standalone canvas-2D pages in headless Chrome — no libraries, no
network, no assets — at the goldens' 1600 × 1000 stage on the `three` population. They are not
screenshots of shipped code and nothing in them is a promise about a frame.

| file | what it shows |
|---|---|
| [`mockup-default.png`](../media/interior/mockup-default.png) | the whole floor under §3, default theme |
| [`mockup-night-shift.png`](../media/interior/mockup-night-shift.png) | the same floor, night shift — the rim device at work |
| [`mockup-blueprint.png`](../media/interior/mockup-blueprint.png) | the same floor, blueprint |
| [`crop-reception@2x.png`](../media/interior/crop-reception@2x.png) | the reception at 2× — boards, plate card, tub chairs, badge |
| [`crop-project-room@2x.png`](../media/interior/crop-project-room@2x.png) | a project room at 2× — weave, task rug, break-out corner, quiet whiteboard |
| [`board.png`](../media/interior/board.png) | every material per theme, with hex and the measured guard values |
