# 00 — Requirements register and spec sheet

**Status:** living register, opened 15 September 2026 (WP-90) · **Owner:** orchestrator ·
**Sources:** the owner's own words in this project's Claude Code transcripts (30 August –
15 September 2026), `docs/01-PRODUCT.md`, `docs/plan/08-PLAN-V2-100X.md`, `docs/DEVIATIONS.md`,
`CHANGELOG.md`, and the design documents named per entry.

---

## 0. How to read this

This file is the product's **requirements register**. One entry per requirement the owner asked
for, with the owner's own words, what those words were taken to mean, why the requirement exists,
what state it is in, and what built it. It exists so that a change made in six months can be
checked against the reason the thing was built in the first place, and so that nobody has to
re-derive an intention from a diff.

**What each field means.**

- **Id** — `R-NNN`, stable forever. Numbers are never reused. A requirement that is replaced keeps
  its id and gains a `superseded by` line.
- **The owner's words** — a short verbatim quote with its date, from the transcripts. Spelling and
  grammar are the owner's. Where a requirement was restated several times, the clearest statement
  is quoted and the others are listed by date.
- **Interpretation** — what the team decided the words meant. This is the part most likely to be
  wrong, and it is written down so that it can be argued with.
- **Why** — the reason the requirement is in the product. If this cannot be written, the
  requirement should not be built.
- **Status** — `done` · `in progress` · `planned` · `declined` · `superseded`.
- **Implemented by** — WP ids, `docs/DEVIATIONS.md` § numbers, and commits where they are easy to
  name. **Every `done` in this file cites a DEVIATIONS § or a §9 row marked done.** A requirement
  with no citation is not done, whatever the code looks like.
- **Notes** — trade-offs, and what was explicitly decided against.

**The rule this file imposes on every work package.**

> **Every work package adds or updates the requirement it serves.** A package that ships without a
> row here has not finished. A package that contradicts a row here must say so in the row, not in a
> commit message.

This is the same discipline `docs/DEVIATIONS.md` applies to departures from a plan: the log records
what changed and why; this file records what was asked for and why. They are read together.

**Precedence.** `docs/01-PRODUCT.md` §2 (the invariant) outranks everything. Then
`docs/plan/08-PLAN-V2-100X.md` §1.1. Then this file. Then the design documents. Where this file and
the code disagree, the code is the defect until a DEVIATIONS entry says otherwise.

---

## 1. Product principles

The standing rules. These are not requirements that get finished; they are constraints on every
requirement below. Numbered `P-NN` so a register entry can cite them.

| id | Principle | Source | Date |
|---|---|---|---|
| P-01 | **The invariant.** `activityState` is observed; `ackState` is owned by the user. No observed event may clear a user-owned state. | `01-PRODUCT.md` §2; `08` §1.1 rule 1 | blueprint, standing |
| P-02 | **Observe, never simulate.** Everything on the floor is a real session read through an adapter. No synthetic message, no fabricated progress, no card that moves because a timer said so. Where a runtime cannot tell us something, the surface says so. | `07-STUDIO-DESIGN.md` §1; `ADAPTERS.md` §6 | 8 Sep 2026 |
| P-03 | **The honesty rule.** A claim in anyone's documentation is a hypothesis until measured on a machine. A figure with no record behind it reads `no data`, never `0`. An unverified adapter says it is unverified. | `08` §1.1 rule 11; §111; §157 | 3 Sep 2026 |
| P-04 | **Loopback only, zero egress.** 127.0.0.1, no analytics, no update checks, no CDN assets, no telemetry — ever, including after we charge. | `01-PRODUCT.md` §7; `08` §1.1 rule 2 | blueprint, standing |
| P-05 | **No runtime dependencies in the core.** Dev dependencies are fine. A runtime dependency needs written approval and a changelog line. | `08` §1.1 rule 3 | 3 Sep 2026 |
| P-06 | **Consent for writes outside the state directory.** Anything written outside `~/.deckhq/` is printed before it is written, tagged, and removable by the thing that wrote it. Hooks, shortcuts, status line, Studio's project directory. | `02-ARCHITECTURE.md`; §150 | standing |
| P-07 | **Never touch `~/.claude`.** The user's real settings and transcripts are read-only. The same for `~/.codex`. DeckHQ never writes a runtime archive flag. | orchestrator briefs, standing rules in force | 3 Sep 2026 |
| P-08 | **argv arrays, never shell strings.** Every process launch passes an argument vector. Paths that escape are refused, not clamped. Windows console launch is quoted by one shared module. | §54/WP-54, §98; `src/core/cmdline.mjs` | 3 Sep 2026 |
| P-09 | **Deterministic goldens.** Nothing ships without a screenshot. Every rendered change regenerates the golden set; every clock-dependent value comes from the injected clock (`DECKHQ_NOW`), never `Date.now()`. | `08` §1.1 rule 10; WP-21 §87; WP-63 §146 | 3–7 Sep 2026 |
| P-10 | **Reduced motion.** `prefers-reduced-motion` draws one static frame per state. Every animation package carries a golden proving it. | `03-VISUAL-SPEC.md` §9; WP-72/79 criteria | standing |
| P-11 | **Accessibility via the deck table.** The floor is a picture; the deck is the same data as a semantic table, keyboard-reachable, with every action the floor offers. Nothing is only clickable on canvas. | `05-GUI-UX-SPEC.md` §3; WP-10 §103; WP-84 §156 | standing |
| P-12 | **Cost is an estimate, never a bill** — and since WP-83, tokens are the default and money is behind a switch that ships off. | `08` §1.1 rule 7; WP-83 §157 | 3 Sep / 14 Sep 2026 |
| P-13 | **Never score the human.** Agents get names, faces, traits and records. The user never gets a streak, a level, a badge or a guilt message. A test asserts no copy addresses the user in the second person with an implication of fault. | `08` §1.1 rule 6; WP-46 | 3 Sep 2026 |
| P-14 | **All runtime-format parsing stays inside its adapter.** Nothing outside `src/adapters/` reads a transcript or shells out to a runtime CLI. | `08` §1.1 rule 8 | 3 Sep 2026 |
| P-15 | **Capture beats features.** Between a feature and every session appearing, capture wins. A session that exists on disk and never appears on the floor is a product failure. | `08` §1.1 rule 4; `01-PRODUCT.md` §6 | 3 Sep 2026 |
| P-16 | **Free core, MIT, no paywall on capture, the queue or an action.** Paid features are services you opt into. | `01-PRODUCT.md` §7; `08` §1.1 rule 2 | standing |
| P-17 | **Every deviation is numbered.** `docs/DEVIATIONS.md`, append-only, with its reason and its measurement. | `08` §1.1 rule 9 | standing |

---

## 2. Requirements register

### 2.0 Summary table

| id | Title | Area | Status |
|---|---|---|---|
| R-001 | The product is a place to run an AI workforce, not only an ack inbox | Framing | done |
| R-002 | The floor answers "is anything waiting on me" in under two seconds | Framing | done |
| R-010 | One line to install, one question to pin | Install / app mode | done |
| R-011 | Launch as an app, not a terminal plus a browser | Install / app mode | done |
| R-012 | One-line installers, and a file to download and double-click | Install / app mode | done |
| R-013 | A standalone executable for a machine with no Node | Install / app mode | planned |
| R-020 | One continuous floor, partially divided, not separate square rooms | Floor / layout | done |
| R-021 | The anchor hierarchy is literal: floor → walls + tables → chairs → agents | Floor / layout | done |
| R-022 | Tables, rooms and room count adapt to headcount | Floor / layout | done |
| R-023 | Create a new room, repo, project and agent from the GUI | Floor / layout | done |
| R-024 | Remove zoom | Floor / layout | superseded |
| R-025 | The floor uses the whole window and is not cramped | Floor / layout | done |
| R-026 | Band shares: a small service column, the majority to project rooms | Floor / layout | done |
| R-027 | One central corridor, two rows, rooms sharing walls | Floor / layout | done |
| R-028 | Rooms are room-shaped, not thin rectangles | Floor / layout | done |
| R-029 | Rooms only for active projects; no empty rooms | Floor / layout | done |
| R-030 | Pin a project room so it survives having nobody in it | Floor / layout | done |
| R-031 | Idle repos leave the floor and live in a popover | Floor / layout | done |
| R-032 | The building is the size of what is in it | Floor / layout | done |
| R-033 | The lounge does not take half the building | Floor / layout | done |
| R-040 | Agents walk on corridors and never leave the building | Occupancy | done |
| R-041 | Walking is fast enough to watch | Occupancy | done |
| R-042 | Nobody stands on the furniture they are using | Occupancy | done |
| R-043 | Nobody sits across from the manager except the one you open | Occupancy | done |
| R-044 | Only live work is in a project room; everyone else is elsewhere | Occupancy | done |
| R-045 | Benched agents rest in the lounge; archived agents are "fired" and reversible | Occupancy | done |
| R-050 | The rig faces the way it is going | Characters | done |
| R-051 | The animation set: typing, walking, drinking, thinking | Characters | done |
| R-052 | A boss avatar in a suit, bigger and professional | Characters | done |
| R-053 | Short names and MK tags instead of session names | Characters | done |
| R-054 | Per-project appearance so agents are recognisable without reading | Characters | done |
| R-055 | Agents big enough to find without hunting | Characters | done |
| R-056 | Character rework: 45°, robot, readable, never furniture | Characters | done |
| R-057 | Agent size is the user's preference, not the layout's | Characters | done |
| R-058 | One conversation is one agent | Characters | done |
| R-059 | Names never carry a numeric suffix | Characters | planned |
| R-060 | Character animations: thinking, working, running, lounge activities | Characters | done |
| R-061 | A crew animation for sub-agents and multi-agent workflows | Characters | done |
| R-070 | Design it like interior architecture, like a real office | Interior | done |
| R-071 | A lounge you recognise in a second | Interior | done |
| R-072 | A reception with sofas against the walls and room to breathe | Interior | done |
| R-073 | Light, depth and honest shadows | Interior | done |
| R-074 | A full interior pass: materials, furniture, density | Interior | in progress |
| R-075 | Text legible over the floor | Interior | done |
| R-076 | Furniture that launches the project it belongs to | Interior | done |
| R-077 | A graphics control centre with curated, mixable interior options | Interior | done |
| R-080 | A whiteboard per room with the project's numbers | Plates / numbers | done |
| R-081 | The plate's numbers are the ones that need action | Plates / numbers | done |
| R-082 | No white pop-up boxes; background only on hover | Plates / numbers | done |
| R-090 | Per-project and per-session token accounting | Tokens / cost | done |
| R-091 | Token usage, not money, because people are on subscriptions | Tokens / cost | done |
| R-100 | Every action available in the GUI | Panels / deck | done |
| R-101 | A minimal, uncluttered floor with nothing occluded | Panels / deck | done |
| R-102 | Closing the agent panel closes the panel, not the browser | Panels / deck | done |
| R-103 | "Fire", not "let go" | Panels / deck | done |
| R-104 | A way back to the floor from every full-surface view | Panels / deck | done |
| R-105 | The hooks banner disappears once hooks are installed | Panels / deck | done |
| R-106 | Resume a session in the surface the user already uses | Panels / deck | in progress |
| R-110 | OS notification and tab badge when a session needs the user | Notifications | done |
| R-111 | Sound and OS toasts ship off until the owner says otherwise | Notifications | done |
| R-120 | Claude Code and Codex, both verified | Adapters | done |
| R-121 | Gemini CLI and OpenCode, declared unverified | Adapters | done |
| R-122 | MCP servers are visible, and unknowable things are not guessed | Adapters | done |
| R-130 | Come with an idea, leave with an office | Studio | in progress |
| R-131 | Studio hires real sessions and never fakes a task feed | Studio | done |
| R-132 | A board, a handover mechanism, and tracking that stays on track | Studio | planned |
| R-140 | Approve from the phone | Relay | planned |
| R-150 | Monetise without gating the product | Supporter pack | in progress |
| R-151 | No official sponsor programme for now | Supporter pack | done |
| R-160 | A documentation site | Docs / plugin / extension | done |
| R-161 | Live where the user already lives | Docs / plugin / extension | done |
| R-162 | A landing page that explains itself in seconds | Docs / plugin / extension | done |
| R-163 | The site demonstrates features and configurability; the README stays scannable | Docs / plugin / extension | done |
| R-164 | The pages look like a product from a company that designs | Docs / plugin / extension | done |
| R-170 | Tag, then never let a human be the release step | Releases | done |
| R-171 | Commits are attributed to Darshak Panseriya | Releases | done |
| R-172 | A product icon worth the product | Releases | done |
| R-180 | This register | Owner-side | in progress |
| R-181 | Owner-side blockers, named and sequenced for a beginner | Owner-side | in progress |
| R-182 | The architecture is audited, and every invariant says where it is enforced | Owner-side | in progress |
| R-184 | One dashboard that shows the whole project — requirements, stories, features, packages | Owner-side | done |
| R-190 | A 3D renderer | Declined | declined |
| R-191 | A manager agent that assigns work down a hierarchy | Declined | declined |
| R-192 | Human streaks, leaderboards, XP, badges, guilt | Declined | declined |

### 2.1 Product framing

**R-001 — The product is a place to run an AI workforce, not only an ack inbox**
*Owner, 2 September 2026:* "the only USP is not only the acknowledgement state in manager office
that people forget taking follow up. Rather it is a system for Entrepreneurs and Builders, who work
on multiple projects, can easily and intuitively manage their AI team seamlessly same as managing
in actual office."
**Interpretation.** The invariant is the mechanism, not the pitch. The product is the surface that
shows a whole team at once — who is working, who is blocked, who finished, who is free, and what
each project costs.
**Why.** The original problem statement was too narrow to justify the floor. The floor is justified
by the workforce, not by the inbox.
**Status:** done. **Implemented by:** the 2 September amendment in `docs/01-PRODUCT.md` §1;
`08` §1.3.
**Notes.** The invariant is not demoted by this. It is what makes the office honest.

**R-002 — The floor answers "is anything waiting on me" in under two seconds**
*Owner, 14 September 2026:* "Only live working agents are on desks in the project rooms. Everyone
else is in the lounge area, so I can clearly see which sessions are active at the moment."
**Interpretation.** Glanceability is the acceptance criterion for every layout and occupancy
decision, and it outranks completeness of display.
**Why.** `01-PRODUCT.md` §3: the user wants what a manager gets for free by walking onto a floor.
**Status:** done. **Implemented by:** WP-78 (`DEVIATIONS.md` §153), WP-50 (§96), WP-77 (§154).

### 2.2 Install and app mode

**R-010 — One line to install, one question to pin**
*Owner, 14 September 2026:* "now from user perspective, if I want to share it with someone it is
alot of friction to have this many step. make it easy to install and use."
**Interpretation.** One thing to paste, then an icon. Four steps (install Node, global install,
`deckhq app`, `deckhq shortcut --install --yes`) collapse to `npx deckhq app` plus one prompt.
**Why.** `08` §1.2: a floor nobody installed reduces nobody's watching. Install friction is the
tallest step in the funnel.
**Status:** done. **Implemented by:** WP-75 (`DEVIATIONS.md` §151); `08` §9 WP-75 row marked done;
`test/integration/tarball.test.mjs` packs, extracts and runs the tarball cold.
**Notes.** The icon offer is asked once and recorded in `~/.deckhq/installed.json`; off a TTY it
prints the command rather than hanging a login script. `state.json` keeps its one writer (P-01).

**R-011 — Launch as an app, not a terminal plus a browser**
*Owner, 6 September 2026:* "Also I sometimes do not like to deploy with terminal and open in
browser and extra steps. Can it be made like an app, directly can be launched separetely"
**Interpretation.** `deckhq app` opens the floor in a Chromium application-mode window with its own
profile, its own taskbar button, no tab strip and no address bar; Desktop and Start Menu shortcuts
under the consent discipline; optional autostart.
**Why.** `08` §14: no feature that requires a browser tab to be open is useful to a user who does
not keep one open.
**Status:** done. **Implemented by:** WP-62 (`DEVIATIONS.md` §144).
**Notes.** The browser is deliberately not spawned with `windowsHide`; that flag produced a whole
browser with no window on the reference machine (§144.1–2).

**R-012 — One-line installers, and a file to download and double-click**
*Owner, 14 September 2026:* "make some kind of installer something." *Owner, 17 September 2026:* "an
installer the user can simply download and run, no manual flows."
**Interpretation.** `install.ps1` and `install.sh` served from the docs site: check for Node 18+,
*offer* to install it, then `npm install -g deckhq@latest`, then the icon question, then
`deckhq app`. And, for the person who will not paste a line into a shell, one file per platform on
the Release page that runs the matching line and carries nothing else:
`Install-DeckHQ.cmd` and `Install-DeckHQ.command`.
**Why.** Same as R-010; "install Node first" is the step the product could stop asking for, and
"open a terminal" is the step after it.
**Status:** done. **Implemented by:** WP-75 (`DEVIATIONS.md` §151) and WP-76's cheap half
(`DEVIATIONS.md` §186); `scripts/install/`.
**Notes.** Nothing in `scripts/install/` is in the tarball and nothing in `src/` imports any of it,
so P-05 is untouched. The scripts reach winget, brew and npm and no other host; the launchers reach
the Pages origin and no other host, which `test/unit/install-scripts.test.mjs` holds (P-04). Two
caveats are printed wherever the launchers are offered: SmartScreen may warn about the unsigned
`.cmd`, and a downloaded `.command` arrives without its run bit. The second is a manual flow, and
R-013 is what would remove it.

**R-013 — A standalone executable for a machine with no Node**
*Derived from R-010/R-012*, not asked for directly.
**Interpretation.** One downloadable signed file per platform, built by the release workflow.
**Why.** Removes the last prerequisite.
**Status:** planned (WP-76), and recommended **not now**.
**Implemented by:** — **Notes.** `docs/plan/SEA-FEASIBILITY.md`: a bundler, an asset branch through
the HTTP layer, ~$300/yr of certificates and ~110 MB per platform, against a WP-75 that already
gets a stranger to an icon. Explicitly decided against for the current cycle. 1.4.0 ships the
download-and-run half of the ask without it (R-012, `DEVIATIONS.md` §186), which leaves exactly two
things a certificate would buy: no SmartScreen warning on Windows, and no `chmod +x` on macOS.

### 2.3 Floor and layout

**R-020 — One continuous floor, partially divided, not separate square rooms**
*Owner, 31 August 2026:* "The office should feel more like continuous single floor plan, partially
divided by walls, no separate square rooms… Manager office top left, lounge area lower left,
including games and kitchen."
**Interpretation.** One envelope, zones tiled inside it, walls belonging to the floor rather than
to each room.
**Why.** A grid of detached boxes reads as a diagram; a floor reads as a place.
**Status:** done. **Implemented by:** `DEVIATIONS.md` §21 (zones tile the envelope), §48 (one frame
per room), §59 (two bands).

**R-021 — The anchor hierarchy is literal: floor → walls + tables → chairs → agents**
*Owner, 31 August 2026:* "Floor is base, then you can anchor wall and tables on it. Chairs are
anchored to the table, and agents are anchored to the chairs, indoor plants are anchored to tables"
**Interpretation.** Anchors are a resolved graph (`wall`, `corner`, `attached`, `centered`, `zone`),
and seats are derived from *resolved* furniture, not from the layout frame.
**Why.** Every visible misalignment in the project's history was a thing positioned against the
wrong parent.
**Status:** done. **Implemented by:** WP-13; `DEVIATIONS.md` §23, §16 (prop coordinate convention),
§37 (seats from resolved furniture), §38 (a prop's rect is how it lies; `angle` is only which way it
faces).
**Notes.** §16 and §38 are the two conventions that cost the most to learn. They are asserted by
tests rather than left as comments.

**R-022 — Tables, rooms and room count adapt to headcount**
*Owner, 31 August 2026:* "according to project size there can be different tables, if certain
project grows up above 8 agents, we they can have 2 tables in the room. Tables can also be different
sizes, 2 people, 4 people, 6 people, etc. that adjusts dynamically. ROom size also adapts
accordingly. and number of rooms also adapts according to how many project the user is working on."
Restated 3 September: "Desk sizes are dynamic based on active agents, the desks keeps expanding and
splitting as workers increases."
**Interpretation.** `tableSizesFor(n)` returns a bill of tables; the room's footprint is the sum of
its furniture; the floor is the sum of its rooms.
**Why.** A fixed grid either wastes the screen or hides people behind a "+13".
**Status:** done. **Implemented by:** `DEVIATIONS.md` §22, §31, §51; WP-50 (§96); WP-55 (§106).

**R-023 — Create a new room, repo, project and agent from the GUI**
*Owner, 31 August 2026:* "all functionality should be in our GUI only. User should be able to start
new project, new repo, new agent in any repo, select avatar, name, type instructions, etc. But all
with minimal interface."
**Interpretation.** `/api/new-project` (create + `git init`), `/api/agent`, `/api/identity`, the `+`
button in each room, the command palette.
**Why.** A control plane that sends you back to a terminal to create things is a viewer.
**Status:** done. **Implemented by:** `DEVIATIONS.md` §25; `src/http/routes/actions.mjs`.

**R-024 — Remove zoom**
*Owner, 31 August 2026:* "Remove the Zoom feature."
**Interpretation.** At the time: the camera had a zoom multiplier that fought the fit scale and
broke LOD. Removed entirely.
**Why.** It produced states the layout was never designed for.
**Status:** superseded. **Implemented by:** `DEVIATIONS.md` §27 (removed), then §50 (restored as
*magnification only* — it cannot shrink below fit).
**Notes.** The restored form is not the thing that was removed. Recorded here because the two
entries read as a contradiction otherwise.

**R-025 — The floor uses the whole window and is not cramped**
*Owner, 6 September 2026:* "Why is UI not full screen wide and very cramped centered."
Earlier, 1 September: "The floor is not using full screen size available."
**Interpretation.** The envelope's aspect follows the window; the arrangement switches to two rows
on wide stages; the rooms fill the working side.
**Why.** The product's one picture was occupying a third of the screen it was given.
**Status:** done. **Implemented by:** WP-59a–d (`DEVIATIONS.md` §139, §140, §141, §142); WP-60
(§145).

**R-026 — Band shares: a small service column, the majority to project rooms**
*Owner, 1 September 2026:* "on far left make a vertical road, the fired employees walk on the road
up and down nothing else. hardly 5-8% of screen as street/road for fired people. Then around 30% as
manager office and lounge area. And 60% plus space for project rooms."
**Interpretation.** A service column (reception above lounge, The Departed at its foot) at roughly a
third, and the working band taking the rest.
**Why.** The project rooms are the subject of the picture; the service rooms are context.
**Status:** done. **Implemented by:** `DEVIATIONS.md` §59 (`SERVICE_SHARE` ~32%, working ~65%;
measured 25% → 62% of width, 13% → 31% of floor area), §61, §57.
**Notes.** The literal "vertical road that fired employees walk up and down" was **not** built as a
road. The Departed became a small tiled room at the foot of the service column with packing boxes,
a bench and an exit sign (§45), because an empty road is a hole in a floor plan and the room reads
as somewhere people are leaving *from*. This is a departure from the owner's words and is recorded
as one.

**R-027 — One central corridor, two rows, rooms sharing walls**
*Owner, 1 September 2026:* "keep only one shared horizontal corridor in center. So it will be 2 row
layout… rooms sharing the vertical walls side by side. No more corridor. only one more vertical
corridor between manager office - lounge area and the project areas."
**Interpretation.** Exactly two circulation lines: one vertical between the service column and the
working band, one horizontal through the working band.
**Why.** Corridors were eating the floor they were supposed to connect.
**Status:** done. **Implemented by:** `DEVIATIONS.md` §60, §61, §53 (corridors get a material of
their own), §32 (the central corridor), §33 (the nav graph the router uses).

**R-028 — Rooms are room-shaped, not thin rectangles**
*Owner, 1 September 2026:* "project rooms cannot be very thin rectangles, they are meant to be more
like rooms closer to square rectangles."
**Interpretation.** Aspect clamps on every room, and a packer that respects them.
**Why.** A 38 × 10 cell cannot hold a 5 × 5 desk cluster and reads as a corridor.
**Status:** done. **Implemented by:** `DEVIATIONS.md` §17 (treemap → bin packer), §24 (row tiling),
§62 (squarified treemap for the working band), §18, §12.

**R-029 — Rooms only for active projects; no empty rooms**
*Owner, 3 September 2026:* "lets make dynamic project rooms. When nothing is running the floor is
just one room. When one agent starts working the whole floor is one project room. When multiple
agents starts working, the floor is divided in active project rooms. So I do not have to see empty
rooms without any interior or dead projects."
**Interpretation.** The plan is a function of active projects and active agents, not of the
repositories on disk.
**Why.** On the reference machine the old rule drew ten large empty cells across most of the working
floor for one occupied room.
**Status:** done. **Implemented by:** WP-50 (`DEVIATIONS.md` §96); `08` §3 B6; supersedes
`05-LAYOUT-REWORK.md` §6.1 and §6.3.

**R-030 — Pin a project room so it survives having nobody in it**
*Owner, 3 September 2026:* "I also want to give option to pin certain projects rooms, which I
everyday work on, which I want to see everyday." Restated 14 September: "to pin any particular
project rooms for always in room, so that room does not collapse when agents not running, maybe
downsized according to live agents."
**Interpretation.** A pinned repo keeps a room with one desk and nobody at it, at most a third of
the narrowest live room's footprint, with a `N sessions · pinned` plate. It fills out the moment a
session starts.
**Why.** R-029 is right and, applied alone, removes the repo the user is about to work in.
**Status:** done. **Implemented by:** WP-77 (`DEVIATIONS.md` §154); `08` §9 WP-77 row marked done.
**Notes.** The pin is **user-owned state** and is held to P-01: `pins[projectId]` in `state.json`,
written by `POST /api/pin` and nothing else, with an `INVARIANT:` test
(`test/unit/pins.test.mjs`). Pin and unpin from the idle popover or `⌘K`, which offers it for every
project rather than only the idle ones.

**R-031 — Idle repos leave the floor and live in a popover**
*Owner, 1 September 2026:* "give me option to archive some rooms as well… it is better to collapse
that room as well. So not to have non functional clutter. Once those agents are activated, the room
can pop up automatically." Restated 6 September: "make the idle project list in right bottom corner
as a pop up list, when hovered or clicked then only opens. So keep less clutter on screen. And
remaining project room size make it dynamic and full size for live projects."
**Interpretation.** Idle repos become a corner chip that opens a list on hover or click; the space
they leave goes to live rooms; a session starting brings the room back with no user action.
**Why.** Clutter that carries no state is the thing the floor is supposed to be better than.
**Status:** done. **Implemented by:** WP-60 (`DEVIATIONS.md` §145); earlier forms `DEVIATIONS.md`
§58, §48 (idle repos collapse to a strip).

**R-032 — The building is the size of what is in it**
*Derived, 3 September*, from R-022 and R-029.
**Interpretation.** A room's footprint comes from its occupants and their furniture, and the floor's
extent is the sum of its rooms, the service column and the corridors. What the building does not
need is ground, not carpet.
**Why.** WP-50 drew the right rooms and the treemap still stretched them to tile the window: one
active project got an 88 × 67 room for a two-seat table.
**Status:** done. **Implemented by:** WP-55 (`DEVIATIONS.md` §106). Measured: 56.8 × 54.5 units
instead of 132.4 × 76.3, one 16.7 × 22.9 room instead of 90.4 × 67.1, bodies at 42.6 px instead of
30.4.
**Notes.** This supersedes `05-LAYOUT-REWORK.md` §3.1's "no letterbox band wider than 8 px". There
is ground around the building on purpose now.

**R-033 — The lounge does not take half the building**
*Owner, 14 September 2026:* "Also now the lounge is very big whole half bottom."
**Interpretation.** The lounge is sized by its benched population, capped at 25% of stage height at
five or fewer benched, with a floor minimum below that; the space it gives back goes to live rooms.
**Why.** A room sized by its furniture rather than its people takes a share of the screen its
population has not earned.
**Status:** done. **Implemented by:** WP-77 (`DEVIATIONS.md` §154).

### 2.4 Occupancy and seating

**R-040 — Agents walk on corridors and never leave the building**
*Owner, 31 August 2026:* "I see agent leaving manager office and goes out of screen in any random
direction, and appears after few seconds on other side of screen… So bind the walking area on the
corridor that is there… they cannot just run out of screen or cross the walls anywhere."
**Interpretation.** A nav graph of corridor centrelines with a `door` and a `navEntry` per room;
routes go door → navEntry → corridors → navEntry → door, clamped to the floor.
**Why.** A character walking through a wall destroys the one thing the metaphor is for.
**Status:** done. **Implemented by:** `DEVIATIONS.md` §33, §32.

**R-041 — Walking is fast enough to watch**
*Owner, 31 August 2026:* "Make walking faster, they are taking alot of time."
**Status:** done. **Implemented by:** `DEVIATIONS.md` §39 (`WALK_SPEED` 4.5 → 13).

**R-042 — Nobody stands on the furniture they are using**
*Owner, 31 August 2026:* "Now manager office sofa are against wall but agents are siting on floor
not on the sofa."
**Interpretation.** Seats are computed from resolved props after anchoring, and a test asserts zero
unseated at every population.
**Why.** The bug was invisible to the unit suite and obvious in one screenshot — the case that made
P-09 a rule.
**Status:** done. **Implemented by:** `DEVIATIONS.md` §37, §43.

**R-043 — Nobody sits across from the manager except the one you open**
*Owner, 31 August 2026:* "nobody directly sits across the manager, only the one that is being
called, reviewed will go to manager desk and sit there." Restated 14 September: "And nobody sits by
default in front of manager, everybody is waiting on sofa. Only the agent opened, walks upto the
manager desk." Said a third time, 15 September 2026, as an instruction rather than a description:
"They all should sit on the sofa. Only the agent I open walks up to the manager desk."
**Interpretation as built (WP-93).** Every waiting session sits **on the reception sofas**, in
arrival order, oldest wait nearest the desk; whoever the runs cannot seat stands in a short queue
beside them, never at the desk. The manager's desk carries **one** visitor chair, square across it,
and it is **empty unless the user has a waiting session open** — that session walks to it, sits
facing him, and walks back when the panel closes or another is opened. A selected session that is
not waiting does not move.
**Why.** It is what he asked for, three times. The reception's job is "who is waiting on me", and a
room of people seated round its walls with one chair at the desk says that in a way a row of chairs
filled by the clock does not: the chair then means *this is the one I am dealing with*, which is a
fact only the user has.
**Status:** done. **Implemented by:** WP-93 (`DEVIATIONS.md` §169); WP-78 (§153) for the desk and
lounge halves and the `01-PRODUCT.md` §4.2 amendment of 14 September.
**Notes.** WP-78 shipped the **opposite** of the 14 September sentence for a day: it read it as a
description of the floor he was looking at, put the whole waiting queue in two or three chairs at
the desk, and left the sofas seating nobody. This row carried that departure openly, and WP-93 took
it back. What survived the correction is WP-78's own argument — oldest-first ordering is only
legible as a queue — now read off the sofa runs instead of a row of chairs. The 31 August half is
honoured exactly, and in both readings *selecting a session never changes which room it is in*:
`placement()` has no `selected` to read, and the chair is a seat inside the office chosen by an
explicit argument to `assignSeats`, which no observed event can set.

**R-044 — Only live work is in a project room; everyone else is elsewhere**
*Owner, 14 September 2026:* "Only live working agents are on desks in the project rooms. Everyone
else is in the lounge area, so I can clearly see which sessions are active at the moment."
**Interpretation.** A project room holds `working` and `stalled` and nobody else. `needs_input` and
`for_review` go to the manager's desk; `benched` and `ended` go to the lounge; idle repos are off
the floor entirely.
**Why.** R-002. A room that shows everything that has ever run answers no question.
**Status:** done. **Implemented by:** WP-78 (`DEVIATIONS.md` §153); `01-PRODUCT.md` §4.2 amendment;
`03-VISUAL-SPEC.md` §5.1.
**Notes.** `stalled` is the deliberate exception and keeps its desk, because it is live work that has
gone quiet and may resume.

**R-045 — Benched agents rest in the lounge; archived agents are "fired" and reversible**
*Owner, 1 September 2026:* "Whichever sessions had last message from the claude and are no longer
working, change their status to on bench, as they are idle, so they all should results in lounge
area chilling. All sessions which are archived are employees fired, we should make something like
funny small room where all fired employees stay, which incase if I remove from archive, are
considered as rehired."
**Interpretation.** A one-shot "settle floor" that benches every idle agent; `let_go` driven by the
desktop app's `isArchived` flag, read-only, reversible.
**Why.** A benched agent is *available capacity*, and the product should make that read as a good
thing. Archiving is the user's act and is therefore reversible by the user's act.
**Status:** done. **Implemented by:** `DEVIATIONS.md` §45 (The Departed), §46 (the app's archive
drives `let_go` and only `let_go`), §47 ("settle floor").
**Notes.** DeckHQ never *writes* the archive flag (P-07). The link between the app's store and the
transcript is `cliSessionId`, verified on 43 of 51 app records (§46).

### 2.5 Characters and identity

**R-050 — The rig faces the way it is going**
*Owner, 31 August 2026:* "the characters have hands on one side and head on other side, looks like
hands are on backside. very wrong."
**Status:** done. **Implemented by:** `DEVIATIONS.md` §26 (`facingRot = bodyAngle + π/2`; the head's
dot product with facing was exactly 0).

**R-051 — The animation set: typing, walking, drinking, thinking**
*Owner, 31 August 2026:* "Typing hands in the front. Sideways hand swinging motion while walking.
One hand mug coffee drinking. And when it is in thinking mode, then the pop up thought artifact"
Restated 31 August: "When agents are thinking while working they should have a cloud form beside
their head kind of like thinking emoji like."
**Status:** done. **Implemented by:** `DEVIATIONS.md` §40 (the thinking cue is a cloud, not three
dots); `public/render/clips.js`.
**Notes.** Superseded in form by WP-79's seven poses (§162); the list of *what* is animated is the
requirement, and it is extended by R-060.

**R-052 — A boss avatar in a suit, bigger and professional**
*Owner, 31 August 2026:* "make a boss manager avatar, the main, in Suit maybe, also bit bigger,
professional and fit"
**Status:** done. **Implemented by:** the `manager` prop painter; `DEVIATIONS.md` §34's reception.

**R-053 — Short names and MK tags instead of session names**
*Owner, 31 August 2026:* "lets give them some kind of short name or tag rather than session names,
hovering on it will display the session name and other details. Either they can have minimal names
like Marco, Dev, Tai… Or Each new project is MKx number and each new agent within is MKx.y number."
**Interpretation.** Both: an MK identity (project `MKn`, agent `MKn.m`, persisted, never reused) and
a short display name the user can choose from a pool.
**Why.** A 36-character uuid is not a person and cannot be pointed at.
**Status:** done. **Implemented by:** `DEVIATIONS.md` §29; `src/core/identity.mjs`, `public/names.js`.

**R-054 — Per-project appearance so agents are recognisable without reading**
*Owner, 31 August 2026:* "project wise they can have different colour, avatar, clothing, character,
so they are already recognisable and no need to read all data. User gets used to the appearance."
**Interpretation.** A per-project identity (hair, accent, glyph) rather than body colour, because
body colour carries state and crimson is reserved for "needs you".
**Why.** Two colour systems on one body cannot both be read.
**Status:** done, with a recorded tension. **Implemented by:** `DEVIATIONS.md` §30 (marked RAISE);
WP-20 (§105); WP-28 (§133).
**Notes.** §30 is still a RAISE: whether per-project colour should move onto the body was left open
and has not been closed. WP-79 (§162) puts the **state** colour over the whole body mass, which
settles it in practice against the owner's words.

**R-055 — Agents big enough to find without hunting**
*Owner, 1 September 2026:* "Currently Agents are too small in size and user has to really focus
where are who. Make them bigger and more recognisable." Then: "they look like fat people. Very big
round stomach with small head, make it aesthetic."
**Status:** done. **Implemented by:** the fit-scale clamp at 16–44 px of body (WP-55, §106); rig
proportions.

**R-056 — Character rework: 45°, robot, readable, never furniture**
*Owner, 14 September 2026:* "I dont like these current doodle design, make better ones, easy to have
an overview, fun to look at, and distinguishable from environment. and bit bigger maybe. how about
actual robot doodle something, but from top view all doodles will look shit. So make them side view
or 45deg something." Owner's pick, 14 September: "go for it - character letter (B recommended)".
**Interpretation.** Design first: PNG candidates judged by the owner before any rig code. Identity,
rarity and traits stay a pure function of the session id.
**Why.** The characters were being mistaken for furniture, which is the one thing the floor must not
allow.
**Status:** done. **Implemented by:** WP-79 (`DEVIATIONS.md` §162); candidates in
`docs/media/design/character/`; `08` §13.23 records the decision.
**Notes.** `BODY_HEIGHT_U` stayed 2.52 so the camera did not move; nine goldens rebaked at
0.31–2.99% of pixels.

**R-057 — Agent size is the user's preference, not the layout's**
*Owner, 14 September 2026:* "add some kind of customisation, the user can set preference, of sizes
of agents compared to screen. Someone working with 100 agents may want to see them smaller, someone
with only 5-10 want to have sizes bigger, so they are not lost in the space."
**Interpretation.** small / medium / large / auto, with auto derived from the live count (≤ 10
large, ≤ 40 medium, else small). **Everything a body sets scales with it and everything the building
sets does not** — seats, pitches, desk and sofa depth, the rugs, the planting and the figure's own
chrome move; the corridors, the room padding, the plate band, the parquet and every type size do
not. Rooms grow and shrink with their contents as WP-50 and WP-55 already have them.
**Why.** The right character size is a function of how many there are, and only the user knows
which regime they are in.
**Status:** done. **Implemented by:** WP-88c (`DEVIATIONS.md` §177); the law is
`docs/03-VISUAL-SPEC.md` §11 and `public/render/plan-scale.js`.
**Notes.** WP-80 is superseded and its interpretation with it. **This row contradicts what it used to
say**: WP-80's criterion was *"no plan geometry — the same population produces the same room
rectangles at all four settings"*, and that is the wrong invariant, because a 3.15 U robot at a 2.6 U
desk sits through the desk. What holds instead is that the same population puts the same people in
the same rooms in the same order at every size, while the rooms follow their contents.
`?scale=` is WP-80's own parameter, kept. Medium is the floor that shipped, byte for byte.

**R-058 — One conversation is one agent**
*Owner, 14 September 2026:* "I see southeast asia trip planning agent named Greta 2 in the room, and
for same session agent named sena 3 chilling in lounge. So Do thorough bug scans and resolve
everything."
**Interpretation.** Resume chains produce several session ids for one conversation; the registry
believed in all of them.
**Status:** done. **Implemented by:** `DEVIATIONS.md` §155; the working in
`docs/plan/BUG-DUPLICATE-AGENT.md`.

**R-059 — Names never carry a numeric suffix**
*Owner, 15 September 2026:* "I dont like names like Livia 1,2,3. Make list big enough so that we do
not run out of names."
**Interpretation.** The pool must exceed any realistic conversation count so the `"<base> N"`
fallback is never engaged, and the fallback itself should be reconsidered.
**Why.** A numbered name is the product admitting it ran out, in the one place the user reads most.
**Status:** planned (**WP-86**). **Implemented by:** partially — WP-84 (`DEVIATIONS.md` §156) raised
the pool to ≥ 200 with the original sixty frozen in place and order; it currently holds 243 names
against 92 conversations on the reference machine. The owner reported the suffix again on
15 September, so either the fallback still engages or the observation predates the merge. WP-86
owns finishing it.
**Notes.** The original sixty names and their order are frozen, because goldens paint names.

**R-060 — Character animations: thinking, working, running, lounge activities**
*Owner, 15 September 2026:* "now that we have robot doodles, make also thinking cloud, working etc
animation. Also some other animations for playing games or drinking coffee in the lounge. And
running animation."
**Interpretation.** The WP-79 robot needs the clip set the old rig had, plus a run cycle and lounge
activities (games, coffee) that make a benched agent read as available capacity rather than as
stalled work.
**Why.** `01-PRODUCT.md` §4.3: watching them enjoy themselves is a deliberate reward for having
cleared your queue.
**Status:** **done (WP-87**, `DEVIATIONS.md` §172). Twelve animations, each with a stated trigger,
frame count, period, LOD band and reduced-motion frame (`03-VISUAL-SPEC.md` §4.4): the typing
cadence, the visor flicker on a real tool call, the thought cloud, the wave, the page flip, the stall
dots, the power-down, the lounge activities, walk, run, spawn and despawn.
**Notes.** Every clip is bound by P-10 (one static frame under reduced motion, with a golden) and
P-09 (phase from the injected clock, never `Date.now()`) — and **P-09 was being broken by the floor
itself**. The animation clock was `performance.now()`, which no fixture can pin, so every committed
golden was the reduced-motion render and no animation in the product had ever appeared in one. WP-87
fixed that first: `animMs()` reads `public/clock.js`, `performance.now()` is frame pacing only, and
`?phase=` pins a frame without disabling motion. The eleventh golden, `demo@motion`, is the first
capture in this project's history with the floor moving in it.

**R-061 — A crew animation for sub-agents and multi-agent workflows**
*Owner, 15 September 2026:* "many times chat sessions do launch background task subagents, or multi
agent workflow… If a chat session fires another 3+ agents or multiagent workflows, (if that is
trackable), In our GUI, it launches all those sub agents (smaller in size) all connected by cables
to the main chat session agent, surrounding around, sat on floor, with their own laptop, feeding the
data by cables to main agent."
**Interpretation.** When a session has three or more live sub-agents, the juniors are drawn on the
floor around the parent with laptops, joined to it by cables, with data pulses along the cables
toward the parent.
**Why.** A fan-out is the most impressive thing these runtimes do and the floor currently shows it
as a number.
**Status:** done (**WP-89**, `DEVIATIONS.md` §178). **Implemented by:** WP-41 (§120) attaches
subagent transcripts to their parent and draws juniors beside it; WP-89 adds the formation. Three or
more juniors on a session AT A DESK turn it into a crew: the members at 0.65 of the parent, seated in
an arc of radius 4.2 U (twelve open to 10.3 U), a laptop each, and one axis-aligned two-bend cable
per junior to a port on the desk's front edge. Twelve are drawn and the rest are a `+N` chip. The
`wf_<id>` segment `listSubagentFiles` used to discard is kept, so a crew that is one multi-agent
workflow is known to be one. Goldens `crew` (motion on, phase 0.16) and `crew@reduced`.
**Notes.** The owner's "if that is trackable" is honoured by P-03 and is the shape of the whole
feature: a pulse runs only while a junior's transcript was observed to grow inside the minute, a
junior whose file has stopped keeps a grey cable, and a runtime that reports no growth at all —
Gemini CLI, OpenCode, Codex — draws no cable and keeps WP-41's seats. The rate is **banded from
recency rather than measured as events per second**, because a poll cannot see more than *this file
moved*; §178 records that deviation. There is no progress, no success and no failure on a junior,
because nothing reports one. Juniors are never in the needs-you count unless they raise a hand
themselves.

### 2.6 Interior

**R-070 — Design it like interior architecture, like a real office**
*Owner, 31 August 2026:* "So design like an interior design architecture and make it like real
office."
**Status:** done. **Implemented by:** `DEVIATIONS.md` §31 (furniture is a verb), §64 (project rooms
are furnished, not just occupied), §44.

**R-071 — A lounge you recognise in a second**
*Owner, 31 August 2026:* "the lounge area, give it more elements which intuitively feels like it.
Like TT table or Pool table, coffee machine, fruit bowl, etc. so looking at the room within a second
one should know what is this room."
**Status:** done. **Implemented by:** `DEVIATIONS.md` §36, §44 (a pool table has to look like a pool
table).
**Notes.** The lounge games are the one saturated accent left on the floor and the owner's decision
(§13.22e) is that they stay, muted 22–26% toward the room's own carpet.

**R-072 — A reception with sofas against the walls and room to breathe**
*Owner, 31 August 2026:* "The waiting area in the manager office is too boring, make it like a big C
section Sofa, on each wall, and then additional chairs, table, etc." and "THe manager office waiting
room is very cramped. Sofa can be against walls, so sofa can be bigger and there feels free space."
**Status:** done. **Implemented by:** `DEVIATIONS.md` §34, §35 (a sofa's rectangle is what says how
it lies), §55.
**Notes.** WP-78 (§153) briefly emptied the sofas of waiting sessions; WP-93 (§169) put them back on
them and left one chair at the desk for the session the user opens. The furniture never moved — who
sits on it did, twice.

**R-073 — Light, depth and honest shadows**
*Owner, 14 September 2026:* "the oval shadows sometimes are offset and does not make any sense."
**Interpretation.** One `LIGHT_DIR` feeds every cast; tall props cast an offset shadow and short
props and characters do not; a character's contact ellipse is within 1 px of its feet.
**Why.** WP-72 gave the floor one light and applied it to things with no height, so people read as
floating.
**Status:** done. **Implemented by:** WP-72 (`DEVIATIONS.md` §149) for the light; WP-78
(`DEVIATIONS.md` §153) for the correction, with tall/short declared per prop and a test that fails on
a prop declaring neither.

**R-074 — A full interior pass: materials, furniture, density**
*Owner, 14 September 2026:* "I want you to also launch an interior designer expert, and get our tool
analysed and evaluated in terms of design, the floor, the carpet, the colours, the furniture, the
layout, the sizing, the items everything. And then improvise thoroughly every aspect of interior…
make the best interior design first, then UI engineer does the UI interface tweaks a bit only on
top, not the overhaul. The appearance and the engagement builds the positive experience."
**Interpretation.** An audit first (`docs/plan/10-INTERIOR-DESIGN.md`), then three packages:
materials and palette, the furniture set, then props/plants/density and the lounge and reception as
places. The layout is **not** in scope — WP-55, WP-13, WP-77 and WP-78 already own it.
**Why.** The audit found a herringbone block twelve times the area of a real one at 1.27–1.43:1
internal contrast, the whiteboard as the brightest object in frame, a rug up to 2.6× its own desk
cluster, four identical plants per room, a lounge three fifths bare — and one false written promise:
`03-VISUAL-SPEC.md` §10 claimed every state colour clears 3:1 against its floor, and `needs_input`
on the office parquet measured **1.70:1**.
**Status:** in progress. **Implemented by:** WP-85a done (`DEVIATIONS.md` §160) — eleven tokens per
theme, a 1.71 U herringbone at 1.08:1, a carpet weave instead of six thousand single-pixel fills,
and §10 rewritten onto the figure halo and made a test. WP-85b done (`DEVIATIONS.md` §163) — four
seat kinds at four footprints, a task rug capped at 1.35× its cluster, a whiteboard below the wall
in luminance, and a break-out corner in any room with the spare floor for one. **WP-85c planned** —
props, plants, density, and the lounge and reception as places.
**Notes.** 85a deliberately landed **before** WP-79 so the character candidates were judged on the
floor they would live on; 85b and 85c come after, because they size furniture against a 34 px robot
rather than a 22 px rig. Two things in the design were **not adopted and said so**: the wool rug's
`≤ 12 deep` clause (§57's rule binds first) and "no clear-floor patch larger than 10 U × 10 U"
(a density statement WP-85c owns).

**R-075 — Text legible over the floor**
*Owner, 31 August 2026:* "The text in the manager office and lounge area are not visible over brown
floor. so either do some shading, bold, borderline, or colour contrast something."
**Interpretation.** Diagnosed as *pattern noise*, not contrast — the ink was already 5.5–8.1:1.
Fixed with a halo stroke behind plate text, and later by WP-85a quieting the parquet.
**Status:** done. **Implemented by:** the `plateHalo` stroke in `public/render/scene.js`; WP-85a
(`DEVIATIONS.md` §160).

**R-076 — Furniture that launches the project it belongs to**
*Owner, 31 August 2026:* "there can be shelf in the room, clicking which can directly open me the
repo local folder in explorer. and most of my projects has dashboard.bat file. So there can be
something in office, clicking which will run that dashboard bat file and open dashboard for me in
browser." Placement, 31 August: "Put the shelf and the terminal box on right vertical side, below
plus button, so that the text on top left is not occluded… make the shelf and terminal box a bit
bigger and visible as like real funiture size."
**Interpretation.** `discoverActions(cwd)` finds conventional scripts (`dashboard.bat/.cmd/.ps1/.sh`)
and a `.deckhq.json` manifest; the shelf reveals the repo in the file manager; the terminal box runs
the action.
**Why.** The floor should be able to do the things the user opens a terminal for.
**Status:** done. **Implemented by:** `src/core/actions.mjs`, `src/http/routes/actions.mjs`
(`/api/reveal`, `/api/run`, `/api/open`); `DEVIATIONS.md` §28 records the CSRF vulnerability this
feature exposed and closed.
**Notes.** `isInside()` refuses a path that escapes rather than clamping it (P-08). The CSRF guard
(Origin + `Sec-Fetch-Site` on mutating routes) was added because loopback alone does not stop
another web page POSTing to `/api/open` and `/api/send`.

**R-077 — A graphics control centre with curated, mixable interior options**
*Owner, 15 September 2026:* "I still dont see any option where do I configure overall GUI graphics,
like office floor carpet and colours, Rugs, tables, chairs, sofa, plant, etc. We do not flood
everything with too many options, but interior designer carefully crafts options, which can be mixed
and matched or customised, so we give users some personlise. And same graphics control center give
also configuration options for agent sizes, (accordingly size of table, chair, sofa everything
adjusts automatically)."
**Interpretation.** One settings surface holding designer-curated sets — floor, carpet, colour
scheme, rugs, tables, chairs, sofas, plants — that combine without producing a bad floor, plus the
agent-size control from R-057, with furniture scaling to the chosen agent size automatically.
**Why.** Themes exist (WP-30, §125) and are a whole-floor diff; the owner is asking for per-element
choice within a curated set, which is a different thing.
**Status:** done (**WP-88a, 88b and 88c**). **Notes.** The options are the interior designer's, not a free
palette: `10-INTERIOR-DESIGN.md`'s material system already derives every theme's tokens from one
derivation, so a "set" is a token bundle rather than a colour picker. Every combination must still
pass `assertThemeContrast`, `assertMaterialDiscipline` and the ≥ 3:1 figure-halo guard (P-03 and
WP-85a). WP-88 **subsumes WP-80**; one setting for agent size, not two.

**WP-88a shipped the model, the derivation and the guards (`DEVIATIONS.md` §175).** The catalogue is
`public/render/look-options.js` — ten pickers, 52 options, six presets — and `DEFAULT_LOOK` is
"Studio oak", which is byte-identical to the floor that ships: it derives all 86 material tokens
exactly and emits the same plan, so no golden moved. `resolveLook(look, theme)` is the derivation and
`validateLook(look, theme)` the guards, returning `{ok, problems}` with one row per picker — a
refused combination is refused with its measured reason and never clamped. All 162 material x scheme
x theme combinations pass `assertThemeContrast` and `assertMaterialDiscipline` unmodified. It also
fixed two real failures on the shipped floor that §1.d of `11-LOOK-CONTROL-CENTRE.md` measured: the
wool rug at 1.00:1 on night shift and the task rug at 1.69:1 on blueprint, both from a constant mix
weight, both now a bisection on the ratio. `settings.look`, `GET/POST /api/look`, `?look=<preset>`
and `deckhq look export | import` carry it.

**WP-88b shipped the section the owner asked for (`DEVIATIONS.md` §176).** `⌘K` → Settings → **Look**,
between Floor and Data: six preset cards, each a real floor thumbnail painted by the floor painter
itself; a live preview that repaints on every change with the zone edges, both rug ratios and the
worst floor ink measured beneath it; and one row per picker in the catalogue, every chip a swatch of
the material it stands for. The section is built from `LOOK_PICKERS` rather than from a list of its
own, so an option the catalogue grows reaches a chip without the surface being edited. A combination
the guards refuse **shows the guard's own sentence beside the control that caused it and changes
nothing** — not the floor, not the control, and nothing is posted; the write goes to `/api/look`,
which refuses whole, rather than to `/api/settings`, which would sanitise it. Nine palette rows
(`Look: <preset>` × 6, reset, export, import), Export and Import through the browser's own file
input, and every control operable from the keyboard alone: one Tab stop per picker, arrows inside it.
`look` is in `SETTINGS_KEYS`. One new golden, `look.png`; the eleven that existed are untouched.

**WP-88c shipped agent size and the scaling law (`DEVIATIONS.md` §177), which is where R-057 is
answered.** `Agent size` is the eleventh picker — small, medium, large, auto, with the live count
beside `auto` — and four rows in the palette, so the catalogue is now **56 options over eleven
pickers**. The law is *everything a body sets scales by `s` (0.80 / 1.00 / 1.25) and everything the
building sets does not*, stated in `docs/03-VISUAL-SPEC.md` §11 and enforced by a classification
table in `public/render/plan-scale.js` that `test/unit/agent-size.test.mjs` proves is complete: a
package that adds a dimension cannot ship without saying which side of the law it is on. `auto` reads
how many people the floor actually draws, with ±2 of hysteresis around each threshold.
**This row contradicts §4 of the design on one point.** Owner decision 3 asks for `auto` as the
shipped default and decision 2 forbids a default that moves the shipped floor; `auto` on a quiet
machine is `large`, so the two cannot both hold. **The default is `medium`** and `auto` is one click
away. Two new goldens, `three@large` and `demo@small`; the twelve that existed report 0 px moved at
all.

### 2.7 Plates and numbers

**R-080 — A whiteboard per room with the project's numbers**
*Owner, 31 August 2026:* "There can be a top view of whiteboard. Hovering on it can dynamically open
the project related stats like which session used how many tokens, totals, etc."
**Status:** done. **Implemented by:** `DEVIATIONS.md` §65 (the whiteboard opens); WP-57 item 2 (the
plate's payroll line is painted).

**R-081 — The plate's numbers are the ones that need action**
*Owner, 14 September 2026:* "Make sure the calculations on the white board of the project rooms are
right and informative and not just there for the sake of it. make better UI decisions, what users
care about to see, how they want to see it, how do you make it easy to read at a glance in split
second and user does not have to spend effort to read it."
**Interpretation.** The plate says who needs you and for how long, what each agent is doing now, and
this session's tokens; type sizes rank them so the one figure that needs action is the largest; the
payroll line is off by default; every figure traces to a ledger record or a transcript field and
reads `no data` where one is absent.
**Why.** A number on a plate that nobody acts on is decoration, and `01-PRODUCT.md` §4 says nothing
on this floor is decorative-only.
**Status:** done. **Implemented by:** WP-81 (`DEVIATIONS.md` §173) — `platePlanFor` in
`public/render/scene-labels.js` and the copy in `public/render/plan-plate.js`. Four ranked slots:
`● 2 need you · oldest 1d 2h` (14 px, the largest thing on the plate), the room's name, `Elif · Bash
npm test` from `agent.currentTool`, and `today 5.8M tok · with cache` from the ledger's day tally
with the cost after it only under `settings.showCost`. The copy test in `scene-math.test.mjs` pairs
every rendered fragment with the one field it came from; `no data` stands where a figure is absent.
**Notes.** WP-74 (HUD polish) was **superseded by WP-81** (`DEVIATIONS.md` §152): making the plate a
card before deciding what is on it was the wrong order — and once decided, the card was refused
outright, because R-082 below is the owner's own words about this object. Two departures from the
work order, both recorded in §173: the state colour is a **dot** beside the hero rather than the
hero's own ink (the mid-tone state palette measures 3.27:1 as text on a plate, under the 4.5:1 this
requirement is held to), and the session count moved to the plate's **hover** rather than being
dropped.

**R-082 — No white pop-up boxes; background only on hover**
*Owner, 31 August 2026:* "do not make white background pop up box, maybe just minimal fonts without
background color." Corrected the same day: "the default names without hovering should be without
background. But when mouse hovers over it, the pop up opening should have background because it will
have many details."
**Status:** done. **Implemented by:** plate text with a halo and no plate fill; the hover card with a
surface. `DEVIATIONS.md` §63 keeps a clear strip for every room plate.

### 2.8 Token usage and cost

**R-090 — Per-project and per-session token accounting**
*Blueprint F9*, `01-PRODUCT.md` §5.1: "Which project is eating my quota" is a real, unanswered
question.
**Status:** done. **Implemented by:** WP-17/48 the event ledger (`DEVIATIONS.md` §100), WP-26 the
dated rate card (§111).
**Notes.** §7 records that token totals on very large transcripts are approximate, and §11 records
the read budgets (head ≤ 256 KB, tail ≤ 2 MB) that make them so. A tiered read was **rejected**: it
undersampled big sessions, 2.64M → 0.93M tokens, inverting F9.

**R-091 — Token usage, not money, because people are on subscriptions**
*Owner, 14 September 2026:* "maybe we do not want today cost, etc because mostly people will have
subscriptions. So they have different billing system, but it should help them track their token
usage, where are they going, how much, in which sessions, how much input, cached, output, etc so
they can make smart decision."
**Interpretation.** Cost goes behind `settings.showCost`, which ships **off**. What shows in its
place is token usage per session, per project, per model and per day, split into input, cache read,
cache write and output, with where the tokens went and the trend against the previous seven days.
Turning the setting on restores every cost surface exactly as it was.
**Why.** A dollar figure at public list prices is not a subscriber's bill and not their budget.
Tokens are what they actually spend and the thing a rate card cannot get wrong.
**Status:** done. **Implemented by:** WP-83 (`DEVIATIONS.md` §157); `01-PRODUCT.md` §5.1 F9 amended.
**Notes — P-03 in action.** The plan asserted the adapters already carried the breakdown. They did
not: every adapter computed the four counters and summed two pairs away before the `SessionSummary`
left it. WP-83 was therefore a capture change as well as a presentation one. Measured while
delivering it: Claude Code and OpenCode report all four counters; **Codex and the Gemini CLI report
no cache-write figure at all**, so a key is present only when the runtime named it, and a column
nothing named reads `no data` rather than `0`.

### 2.9 Panels, deck and navigation

**R-100 — Every action available in the GUI**
*Owner, 1 September 2026, to the UX reviewer:* "Evaluate if all basic as well as advanced
functionality are available and mapped… Like starting new project, new sessions, new agents,
changing models, checking usage, model configurations, Session states, everything. All
functionalities should be highly intuitive and easy to figure out… the easy and always needing
functionalities are not hidden under complex steps."
**Status:** done. **Implemented by:** the panel, the deck (WP-10, §103), the command palette and
settings sheet (WP-07, §94), the terminal deck (WP-42, §93) which gives every panel action a CLI
equivalent through the same `act()` path.
**Notes.** WP-42's acceptance criterion is the interesting one: *nothing in the CLI can clear a
user-owned state except an explicit ack or bench command* (P-01).

**R-101 — A minimal, uncluttered floor with nothing occluded**
*Owner, 31 August 2026:* "The main GUI floor plan should not be cluttered, rather minimal."
*Owner, 1 September 2026:* "The project white board is hidden under the top left name corner. Avoid
placing anything there for occlusion avoidance… top right corner is cluttered with plus button for
new agent, also a tree, and also the shelf. Spread the furniture properly."
**Status:** done. **Implemented by:** `DEVIATIONS.md` §63 (every room keeps a clear strip for its
plate), §15 (label priority is not label exemption), `03-VISUAL-SPEC.md` §7.

**R-102 — Closing the agent panel closes the panel, not the browser**
*Owner, 6 September 2026:* "Closing the side bar of agent is killing the chrome tab entirely, it
should just close the agent side bar."
**Status:** done. **Implemented by:** WP-61 (`DEVIATIONS.md` §143) — a stray
`closeBtn.addEventListener('click', () => close())` in `panel-dom.js` resolved to `window.close`.
A static gate now fails if any close path reaches `window.close` or a navigation.

**R-103 — "Fire", not "let go"**
*Owner, 6 September 2026:* "clicking on More for letting agent go, rename it to 'Fire', which
basically archives the chat"
**Status:** done. **Implemented by:** WP-61 (`DEVIATIONS.md` §143).

**R-104 — A way back to the floor from every full-surface view**
*Owner, 14 September 2026:* "ones user clicks the agents tab, or list of all who are waiting, there
is literally no button to close that panel or go back to floor view"
**Interpretation.** Every full-surface view carries a visible ✕ top right and a "Back to floor" top
left, both keyboard-reachable, with `Esc` printed in the view's own title; a static gate enumerates
views from the stylesheet so one added without a way off it fails.
**Status:** done. **Implemented by:** WP-84 (`DEVIATIONS.md` §156).

**R-105 — The hooks banner disappears once hooks are installed**
*Owner, 1 September 2026:* "once hooks are installed, we no longer need to continuously show that to
user. Can be removed from toolbar."
**Status:** done. **Implemented by:** the header's hooks state; WP-36 (`DEVIATIONS.md` §83) removed
the way to create the mismatch the banner existed to warn about.

**R-106 — Resume a session in the surface the user already uses**
*Owner, 31 August 2026:* "I use my claude code with windows app, is it possible that from our GUI
when I open a chat, with a button it can directly open exactly that chat session in the windows
claude code app… for continuity ideally I want to make this product as user should be able to
continue in either default preference, if he always has been using terminal, then he should be able
to quickly pick up session in terminal, if in app then in app."
**Interpretation.** A per-user default continuation surface (app or terminal), and a deep link that
resolves a *specific* session in the desktop app.
**Why.** The owner's second worry in the same message: "it seemed like loading in terminal would
consume usage, as my sessions run in the app."
**Status:** in progress. **Implemented by:** the terminal launcher (WP-04, `DEVIATIONS.md` §91 —
ten terminals, twenty-one asserted argv arrays), `/api/resume` and `/api/resume-targets`,
`src/adapters/claude-code/desktop.mjs`.
**Notes and honesty.** Whether `claude://code/continue?session=<uuid>` resolves a *specific* session
is **still unverified** and is listed as such in `DEVIATIONS.md` §9 (unverified paths). Under P-03 it
must not be claimed anywhere until a machine has confirmed it. The usage worry has not been measured
either way.

### 2.10 Notifications and sound

**R-110 — OS notification and tab badge when a session needs the user**
*Blueprint F10*: the window will be buried behind terminals.
**Status:** done. **Implemented by:** WP-16 (`DEVIATIONS.md` §101); `src/core/notify.mjs` /
`notify.ps1`.
**Notes.** §101 records the notification a closed tab cannot send and the PowerShell flag that had to
change.

**R-111 — Sound and OS toasts ship off until the owner says otherwise**
*Derived from P-06.* Sound ships off against `05-GUI-UX-SPEC.md` §8's default; `settings.osNotify`
ships off with no row in the settings sheet.
**Why.** Flipping sound would make every existing install start making noise on upgrade. Whether a
background process may raise OS toasts is a different consent from the browser's, and defaulting it
on because the browser's is on would be deciding for the owner.
**Status:** done as a default; the **default itself is an open owner decision** (`08` §13.8, §13.9).
**Implemented by:** WP-15 (`DEVIATIONS.md` §110 — three sounds measured rather than described), WP-16
(§101). The reason sound is off is pinned by a named test.

### 2.11 Adapters and runtimes

**R-120 — Claude Code and Codex, both verified**
*Blueprint §9*: two adapters, not one, because a single-adapter product is what a first-party
feature can obsolete; two also force the interface to be honest.
**Status:** done. **Implemented by:** Claude Code throughout; Codex verified against a real rollout
on 4 September (`DEVIATIONS.md` §137, with §135 the prep and §136 three defects found before there
was anything to break). §8 lists the four things about Codex that are still not verified.
**Notes.** §95 removed the last shell string in the tree (P-08). Codex liveness is inferred from file
mtime and the adapter says so (§8, §137).

**R-121 — Gemini CLI and OpenCode, declared unverified**
*Derived from the adapter interface's purpose.*
**Status:** done, **unverified**. **Implemented by:** WP-24/25 (`DEVIATIONS.md` §123 — two runtimes
read from their documentation, and the SQLite file nobody parsed).
**Notes.** `docs/ADAPTERS.md` §6 makes this a rule, not an apology: an adapter is unverified until it
has run against real data and **must say so** on every surface. This is P-03 applied to the thing
most tempting to overstate.

**R-122 — MCP servers are visible, and unknowable things are not guessed**
*Derived, 8 September*, from a tool name in a transcript reading `mcp__gmail__send`.
**Interpretation.** An MCP server is configured once and then invisible; when it stops answering the
agent quietly loses a third of its tools and the session looks identical. Make the servers sayable
in three places and the tools readable in two, and decline to say anything where the only available
answer would be a guess.
**Status:** done. **Implemented by:** WP-64 (`DEVIATIONS.md` §147).
**Notes.** Both halves started from a documented claim; one of the two hypotheses was wrong when
measured (P-03).

### 2.12 Studio — idea to office

**R-130 — Come with an idea, leave with an office**
*Owner, 8 September 2026:* "our base product is the office orchestration. Where user is still in
charge of creating agents, and defining roles and etc. But we can also have additional feature where
you define what you want to do or build, it will grill down to plan with user, and accordingly
suggest which agents or experts needed, and it will create an office, a framework, a task dashboard
with kanban and things, some handover mechanism, some tracking, some kind of control and to make
sure things always stay on track, etc. so someone can just come with idea and start building."
Approval, 8 September: "plan approved".
**Interpretation.** An **opt-in mode, per project**. Idea → Grill (a real `claude` planner
interviews the user) → Blueprint → Roster → **Hire** (one real session per role in its own git
worktree) → Board → Work → Handover → review gate → tracking → budget stop. The base product does
not change and Studio never becomes the default.
**Why.** The owner named a second starting point the product had no answer for. The constraint —
that it must not become a second data path — is what makes it safe to build.
**Status:** in progress. **Implemented by:** WP-66 done (`DEVIATIONS.md` §150 — the store, three
schemas, consent, `deckhq studio enable|disable`, the endpoints that need no spawn, four named
invariant tests including a static one that fails if a second writer of `card.column` ever appears).
WP-67 done, less the interview (`DEVIATIONS.md` §159 — the brief as a file, schemas generated from
`src/studio/schema.mjs`, `POST /api/studio/plan` starting a real `claude` through the same
`openNewSession` call `/api/new-project` makes, artefacts validated on every read). WP-68 done
(`DEVIATIONS.md` §188 — `POST /api/studio/hire`: a git worktree per role with an argv array, a brief
file the user owns, a session started in that worktree under that brief, `roster.roles[i].agentId`
recorded by the ordinary scan, a `Studio: hire <role>` palette row per unhired role, and a roster
line per role in the panel). **WP-69 to WP-71 planned.**
**Notes.** The name (Studio, over Workshop and Bureau) and eight defaults were decided by the owner
on 8 September — `08` §13.20. One acceptance criterion of WP-67 is **owed and named as owed**: the
reference machine's `claude` login is expired (§117), so no planner has run an interview and no
`blueprint.md` has been written by a model. WP-68's real run hit the same wall from the other side
(§188.1): two worktrees, two briefs and two real `claude` sessions were made, the ordinary scan
found both and wrote both ids into `roster.json`, and both sessions then answered `OAuth session
expired and could not be refreshed`. **What the two owe is one `claude login` between them.**

**R-131 — Studio hires real sessions and never fakes a task feed**
*Derived from P-02, and binding on all of WP-66 to WP-71.*
**Interpretation.** No synthetic message, no fabricated progress, no card that moves because a timer
said so. A card's column is user-owned in the way `ackState` is: an observed event may *flag* a card
and may never *move* it. Where a runtime cannot tell us something, the card says so.
**Why.** A board that invents progress is worse than no board, and it would break P-01 by analogy.
**Status:** done as a rule and as a gate. **Implemented by:** WP-66 (`DEVIATIONS.md` §150) — the
static test that fails if a second writer of `card.column` appears.

**R-132 — A board, a handover mechanism, and tracking that stays on track**
*Same owner message as R-130.*
**Interpretation.** WP-68 roster and Hire (three roles → three worktrees, three briefs, three
sessions on the floor within one scan); WP-69 the board tab and card → session, fully keyboard
reachable; WP-70 handover and the review gate (Accept is the only path from a handover to a column
change; test counts render as a quotation); WP-71 tracking, drift and the budget stop (every figure
traces to a ledger record or a handover line; a card over its cap moves only to `blocked` and kills
nothing).
**Status:** WP-68 done (`DEVIATIONS.md` §188); WP-69, WP-70, WP-71 planned — `08` §9 rows. The
board tab is the next of the four, and until it exists a Hire picks up the first unfinished card
already assigned to the role and moves nothing: `POST /api/studio/card` remains the only writer of
a column, and the static test that fails on a second one still passes.

### 2.13 Relay

**R-140 — Approve from the phone**
*Derived from `08` §1 line 4:* the one keystroke that justifies everything is *approve from here*,
and later *from the phone*.
**Interpretation.** A relay that is a router which cannot read: end-to-end encrypted, bring-your-own
storage, no DeckHQ server holding plaintext.
**Why.** It is the daily dopamine, the reason to keep the daemon up, and the paid tier — and it is
the only way the product reaches the user when no tab is open (`08` §14).
**Status:** planned, **design only**. **Implemented by:** `docs/06-RELAY-DESIGN.md`;
`DEVIATIONS.md` §127 (the eight design decisions). No code. WP-32/33/34 are gated on owner decisions
— hosting, the `relay.deckhq.dev` domain, the server licence (FSL-1.1-Apache-2.0 recommended,
BUSL-1.1 the conservative alternative, client half MIT either way), VAPID key custody, retention —
`08` §13.19.

### 2.14 Supporter pack and monetisation

**R-150 — Monetise without gating the product**
*Owner, 1 September 2026:* "should it just open source project or can we monetise it a bit"
**Interpretation.** `08` §1 line 5: sell storage and reach, never the floor. A Supporter pack of
cosmetics, and later Relay ($9) and Teams ($18/seat) on bring-your-own storage.
**Why.** vibe-kanban reached 27,900 stars and shut down for lack of a business model; every
competitor in the category is free. The answer is not a paywall on capture.
**Status:** in progress. **Implemented by:** WP-45 (`DEVIATIONS.md` §129) — a signed asset pack
loaded from `~/.deckhq/packs/`, with a test that runs the acceptance script with and without the
pack and diffs the API responses. **Two of the four planned items shipped free**: floor replay and
the rate-card editor.
**Notes — open.** Price and storefront are undecided (`08` §13.14, §13.17): keep $29 and ship more
themes, drop the price, or make it explicitly a tip jar with cosmetics attached. Nothing sells the
pack today — no purchase flow, no download page, no price anywhere. The publisher private key is
unbacked-up on the reference machine and must move to a password manager (§13.18).

**R-151 — No official sponsor programme for now**
*Owner, 6 September 2026:* "leave sponsor official track aside for while, maybe add something in
repo, if they want to support by private means, paypal or any other way to receive it. because i
dont know if I have to comply any official channels for getting sponsored officially."
**Status:** done. **Implemented by:** `package.json`'s `funding` removed and `.github/FUNDING.yml`
deleted (commit `f26e8d2`); a "Support" section in the README naming a private channel on request and
no programme.

### 2.15 Docs site, plugin, extension

**R-160 — A documentation site**
*Derived from R-010:* a stranger needs somewhere to read before they install.
**Status:** done. **Implemented by:** WP-29 (`DEVIATIONS.md` §112 — hand-written HTML, no generator,
no dependency, and the promise it has to keep). It also serves `install.ps1` and `install.sh`.
**Notes.** Pages is **gated on the owner** (`08` §13.2): `pages.yml` fails on every push because no
workflow can enable Pages for its own repository. Nothing should link to the site until it is on.
The owner reported it live on 4 September at `https://dkpanseriya.github.io/deckhq/`.

**R-161 — Live where the user already lives**
*Derived from `08` §1 line 3 and §14:* the browser tab is one surface among six, not the product.
**Status:** done. **Implemented by:** Claude Code plugin WP-37 (`DEVIATIONS.md` §102 — hooks carry
no port; the daemon publishes the one it bound to `~/.deckhq/daemon.json`); status line WP-38 (§92,
under 20 ms, no daemon); VS Code extension WP-31 (§104 — an iframe rather than a port); floating
mini-floor WP-39 (§113 — one scene, two render targets); terminal deck WP-42 (§93);
`deckhq doctor --share` WP-44 (§84).
**Notes.** Marketplace listings for the plugin and the extension are **owner-side** (`08` §13.5,
§13.6).

**R-162 — A landing page that explains itself in seconds**
*Owner, 2 September 2026:* "put some visual, so anyone landing on page can see within seconds, what
is this about"
**Status:** done. **Implemented by:** WP-03 (`DEVIATIONS.md` §88 — the hero GIF, and the fact that
the floor did not walk and there was no encoder to record it with); the README's floor image; the
1.2.0 Release page carrying the floor, the review card and the GIF.

**R-163 — The site demonstrates features and configurability; the README stays scannable**
*Owner, 15 September 2026:* "I like all the UI and vision sheets you are generating. Keep them all
aside; they could be great for the product webpage to demonstrate functions, features and
configurability. Plan this actively, for the website and also update the GitHub README. Keep the
README not bloated, easy to understand, scannable."
*Taken to mean:* the design sheets already in `docs/media/` are marketing material for the site —
**provided the site never passes one off as the product** — and the README is a front page rather
than a manual.
**Status:** done. **Implemented by:** WP-94a (`DEVIATIONS.md` §170). `docs/MEDIA.md` opens the three
asset classes (`capture`, `golden`, `illustration`) and the rule that every published image carries
its class in its caption; `site/build.mjs` fails the build when an illustration appears without the
words *design illustration*, and `test/unit/site.test.mjs` asserts both the pages and the gate. Five
pages added — Features, Look, Characters, Studio, Docs — with the `three` golden as the home hero.
The README went from 911 lines to 211 against a 250-line budget enforced by
`test/unit/readme.test.mjs`; everything cut is in `docs/GUIDE.md`, verbatim.
**Notes.** The dated pictures this row used to carry are gone: **WP-94b** (R-165 below) retook every
one of them from the running product, and the stale captures are off the pages.

**R-164 — The pages look like a product from a company that designs**
*Owner, 15 September 2026:* "Make very fancy and attractive pages. Should look like a product by
Apple, Uber, Netflix, Airbnb, Google level companies."
*Taken to mean:* not an imitation of any of those five — they do not share a look — but the thing
they do share: every page is **one system applied**, and nothing is on it that is not in the system.
**Status:** done. **Implemented by:** WP-94c (`DEVIATIONS.md` §171). One 1.333 type scale fluid with
`clamp()` (display 42–80 px, body 17–18 px, tabular numerals), an eight-pixel spacing grid, 1200 px
of content with full-bleed image bands, and one band grammar — a picture, a headline, two lines —
across Home, Features, Look, Characters and Studio. Light and dark come from one token set through
`prefers-color-scheme` plus a toggle; neither half was invented, because the dark neutrals are
`public/style.css`'s and the light ones are the other half of the mark. The accent is the amber on
the mark's antenna tip, and crimson stays what `03-VISUAL-SPEC.md` §5 says it is.
**How it is held.** `test/unit/site.test.mjs` measures eighty-one contrast pairs from the
stylesheet's own literals (worst 4.55:1), holds `style.css` under 40 KB and the scripts under 10 KB,
holds the home page's first screen under 1.5 MB, and asserts the site renders whole with JavaScript
off. `site/capture.mjs` drives a real browser: no page wider than its window at 375 or 1440, every
reveal resolving, nothing hidden under `prefers-reduced-motion`, and the six home captures in
`MEDIA.md` §4.4.
**Notes.** This requirement moved type, colour and layout. It moved nothing the site *says*: every
page, every caption class and every install command is what WP-94a left. What the site says, and
what it shows, is R-165.

**R-165 — Current pictures, a page that arrives, and no design journey**
*Owner, 26 September 2026:* "No defensive writing, remove the AI slop. The homepage visuals are
outdated; the UI changed many times. Keep the live GIFs, at higher fps. On Features I want a
zoomed-in snapshot per feature, not the whole window. Images load slowly and the Look page images do
not load. Show upcoming features nicely, but never the design journey: no options, no what was
chosen. The character looks, animation and size configuration sheets are features and stay."
*Taken to mean:* the site shows the build it is published beside, one crop per feature rather than
one window per feature, at a weight that arrives; upcoming work is shown and labelled as coming; how
anything was designed is not the product's story to tell.
**Status:** done. **Implemented by:** WP-94b (`DEVIATIONS.md` §174). `site/assets.json` declares
every picture (population, viewport, keys, crop rectangle, width) and `scripts/site-assets.mjs`
takes all fourteen from the running product on the pinned demo clock: nine feature crops, two themed
room plates, and four GIFs at 25 fps. Every image declares a role that fixes its served width and
its weight budget (`hero` 1100 px / 600 KB, `crop` 680 px / 250 KB, `gif` 2.5 MB), and a page is
capped at 2 MB on Home, 3 MB elsewhere. Features went 6.3 MB → 1.4 MB and Look 4.0 MB → 1.6 MB. The
candidate sheets, the winner band, the four-up comparison, the material board and the interior
before-and-after are off the site; the five remaining mockups carry a `Coming` tag beside their
`Design illustration` label.
**How it is held.** `site/build.mjs` refuses to publish an image or a page over budget.
`test/unit/site.test.mjs` re-measures both, forbids the slop list and the journey words in the prose
of every page, holds an em-dash budget of one per 150 words, requires a `Coming` tag on every
published mockup, and counts GIF frames so a still cannot be published as an animation.
`site/capture.mjs` walks every page before checking that its pictures loaded.
**Notes.** The brief asked for GIF frames at a stepped `DECKHQ_NOW`; the daemon reads that at boot,
so three of the four GIFs step WP-87's `?phase=` instead and the fourth records a real walk
(§174.3). Nothing has been measured over a real connection to GitHub Pages.

### 2.16 Releases

**R-170 — Tag, then never let a human be the release step**
*Derived from `08` §1 line 1.*
**Status:** done. **Implemented by:** WP-43; `publish.yml` with OIDC trusted publishing, a
tag/`package.json` guard, the nine-combination matrix, and a `release` job that re-downloads the
tarball the registry serves and checks it against `dist.integrity`. 1.3.0 released by tag on
4 September. `DEVIATIONS.md` §81 (the manifests are release assets; winget and scoop install a zip),
§138 (the release body cap — 1.3.0's notes were 20,581 characters over GitHub's limit and the job
that would have caught it ran *after* the irreversible step; now capped and pre-checked).
**Notes.** The owner completed the one-time trusted-publisher setup on 4 September: "npm publisher
done - DkPanseriya/deckhq publish.yml".

**R-171 — Commits are attributed to Darshak Panseriya**
*Owner, 1 September 2026:* "Why is all commits on vikalp panseriya name. IT should be me Darshak
Panseriya"
**Status:** done. **Implemented by:** repository git identity; recorded in the session memory so it
survives machine defaults.

**R-172 — A product icon worth the product**
*Owner, 14 September 2026:* "Make a better and nice icon worth for this product". Owner's pick,
14 September: "icon number (5 recommended)".
**Interpretation.** One SVG source in the repository; every PNG size and the `.ico` generated from it
by scripts that already exist, with no new dependency; the app window, the shortcuts, the favicon,
the site and the npm README all show that mark and no other; a test fails if a generated asset is
older than its source.
**Status:** done. **Implemented by:** WP-82 (`DEVIATIONS.md` §161 — one drawing, eleven files, and a
rasteriser instead of a screenshot); source at `docs/media/design/icon/5.svg`; decision recorded at
`08` §13.23.

### 2.17 Owner-side items

**R-180 — This register**
*Owner, 15 September 2026:* "over the history of our chats, I have talked about many requirements and
user stories or usecases. I want you to document them all, so we have a track of what has been
implemented why, and later if we change something we can refer why we did something. And also it is
nice spec sheet for our product so maintain that thoroughly and detailed."
**Status:** in progress (**WP-90** — this file). **Implemented by:** `docs/00-REQUIREMENTS.md`;
`DEVIATIONS.md` §165; the rule in §0 and its one line in `CLAUDE.md`.

**R-181 — Owner-side blockers, named and sequenced for a beginner**
*Owner, 4 September 2026:* "define what are next steps. Do we have finished finest product. Now
whetever is blocked from myside, guide me step by step what I need to do. COnsider me beginner."
**Interpretation.** A standing, ordered list of everything only the owner can do, each with the exact
clicks.
**Status:** in progress — it is `08` §13, reordered on 4 September so the things blocking a phase
gate come first. Closed since: trusted publisher, GitHub Pages source (reported live), the 1.2.0
Release. Open: social preview, Discussions, private vulnerability reporting, VS Code Marketplace
publisher and PAT, plugin marketplace listing, Homebrew tap and scoop bucket, publisher key custody,
pack price and storefront, relay decisions, `sound`/`osNotify` defaults, Mac/Linux hand verification
of the terminal launchers, and the launch posts (the owner posts; no agent posts anywhere).

**R-182 — The architecture is audited, and every invariant says where it is enforced**
_Owner, 16 September 2026:_ "analyses, evaluates, scrutinises and optimises the architecture of the
complete product, to make it clean, bug-free, extendable, modular, following good system and product
engineering… the product is finally working well, no major overhaul; each move should be confident,
proven, thought through, well implemented, clean sheet, bug free."
**Interpretation.** A measured map of the code as it actually is — the layers, the dependency graph,
every cycle, every boundary crossing, every file over the ceiling — plus a register of every product
invariant with the test or gate that holds it, and a ranked findings list whose every move can be
proved not to change a pixel or a byte of `/api/state`. Not a refactor, and not permission for one:
a package that changes behaviour needs an owner question answered first.
**Why.** The product works, and that is precisely when an audit is cheap and a rewrite is expensive.
The two defects it found are both in gates rather than in the product, which is the failure mode a
codebase this well-tested has: the tests are excellent and two of them are looking at a file list
that stopped being the file list.
**Status:** done — the audit. **in progress** — the sequence it opened.
**Implemented by:** WP-91 (`docs/DEVIATIONS.md` §179), `docs/plan/13-ARCHITECTURE-AUDIT.md` and
`docs/plan/13-audit-map.json`; `08` §9's WP-91 row and §13 item 26. **WP-92a, WP-92b and WP-92c are
done** (§180): the goldens gate reports a not-yet-baked golden instead of failing on it, the
900-line ceiling is checked over every file under `src/`, `public/`, `scripts/` and `site/` against a
dated exemption table, and the draw-path clock guard walks `public/render/` instead of naming six
files. All three changed gates only — no product code, all sixteen goldens at 0 px. **WP-92d, WP-92e,
WP-92f and WP-92g are done** (§181), and these four are the product rather than the gates: one state
palette literal in the client instead of three, `HookEvent` and `RuntimeAdapter` declared once
instead of six times each, the settings route reading the terminal catalogue from `core/` with the
orphan `src/core/mcp-tool-name.mjs` deleted, and the empty-machine snapshot carrying exactly the keys
a real one does — which also stopped the browser re-deriving the crew rule on every snapshot of every
floor. Findings A-04, A-06, A-09, A-10 and A-11 are resolved with commits. All sixteen goldens 0 px
after each, `/api/state` byte-identical on three fixtures, suite 2,450 → 2,456 by addition. **WP-92h,
WP-92i, WP-92j and WP-92k are done** (§182), and they are four different shapes rather than one:
the registry stops building a snapshot when nobody is subscribed and asks "did anything move?" with
a change key measured at 5.8× the `JSON.stringify` it replaces; the three CLI commands that offer
each other share one `offers.mjs` instead of importing in a ring; four routes that used to answer a
request naming no `runtime` as if it had said Claude Code return a 400 naming the field; and the
seven client modules nothing had ever executed are imported under a DOM stub and parsed for three
properties. Findings A-05, A-08 and A-13's first half are resolved with commits, and A-07's CLI
third. All sixteen goldens 0 px after each, no PNG changed, `/api/state` byte-identical on the three
fixtures, suite 2,456 → 2,486 by addition. **Two of the audit's own claims were false and are
corrected in place**: A-05's "zero subscribers is the normal steady state" (two internal listeners
subscribe for the life of the daemon) and A-08's "the audit found no caller that does not [send a
runtime]" (three of four in `public/` did not, and landing the refusal alone would have been an
outage). **WP-92l, WP-92m, WP-92n and WP-92o are done** (§183), and they close the sequence: the
three files the exemption table booked for a split are split — `store.mjs` 1,230 → 657 + 602,
`deck.js` 1,112 → 574 + 567, `themes.js` 1,429 → 528 + 768 + 201 — and the exemption table is down
to its five permanent rows, so I-11 is now enforced over every file in the tree with no dated debt
in it. The `deck.js` ↔ `usage.js` cycle closed with the split rather than with a `wire()`, and
`test/unit/client-graph.test.mjs` holds `public/` and `public/render/` acyclic but for the one pair
A-07 says stays. `snapshot().health` is three integers a daemon has swallowed since it started,
**omitted entirely when all of them are zero**, and `deckhq doctor` prints them as its `swallowed`
row. Findings A-12, A-14 and the rest of A-07 are resolved with commits; **WP-92 is closed.** All
sixteen goldens 0 px after each, no PNG changed, `/api/state` byte-identical on `three` and `crew`
and unchanged in every key on `demo`, suite 2,486 → 2,497 by addition.
**Notes.** The audit changed no code by design, and says so in its own header. Its refusals are
recorded with it: nothing was profiled, nothing was run against a hundred-agent machine, and the
site, the extension and the plugin were mapped but not audited in depth.

**R-183 — The suite's verdict is a fact about the product, not about the machine that ran it**
_Standing rule, `08` §1.1 and the WP-50/WP-51 rows: a green run means **all nine combinations** —
Ubuntu, macOS and Windows × Node 18, 20 and 22 — plus the goldens job. "Green except Windows" is
not green, and neither is the reverse._
**Interpretation.** A test may not read the host for anything the product injects. Where a module
takes a platform, a clock, a home directory or an environment as a parameter, the test asserts the
answer for each of them from one process, and it asserts a literal — never a value re-derived
through the same host facility the code used, because that can only prove the two agree. Where a
test owns a temp root, it owns the shutdown too: anything with a debounced write is flushed before
the root goes.
**Why.** §121.4 recorded the first shape of this — tests that scanned the developer's real home
directory, so the suite's wall clock swung 5 s to 68 s on one commit and one test took a different
branch depending on what the laptop happened to be doing. §185 is the same shape three more times:
the path separator, a 250 ms debounce, and a photograph of a floor taken on a platform nobody can
re-photograph on. All three were green on the author's Windows and red on CI, which is the worst
direction for this failure to run in — the machine that decides is the one nobody is looking at.
**Status:** partly done. Nine test jobs green; the `goldens` job still red on the six stale linux
goldens §185.4 says to delete.
**Implemented by:** §185 — `src/core/launcher.mjs` takes its path semantics from the injected
platform, `test/helpers/store-root.mjs` flushes every store opened on a temp root before removing
it, and `test/helpers/isolate.mjs` (§124) already holds the home-directory half.
**Notes.** The rule is about the suite, not the product: none of §185's three defects was reachable
by a user, and the one production file it touched behaves identically for every caller that injects
no platform — which is all of them.

**R-184 — One dashboard that shows the whole project**
*Owner, 17 September 2026:* "Requirements, user stories, features, all into our dashboard; I like it
in a GUI, as a list or tiles that can be opened for more detail. Work packages, architectural
blueprint, requirements, user stories, features, everything in the dashboard. Make it very
sophisticated and useful."
**Interpretation.** One page, generated from the documents that already own each fact, with a tab
per collection — requirements, user stories, features, work packages, the architecture, the decision
log, releases — a search, filters and a sort on each, and a drawer per entry carrying every parsed
field and the cross-links between them. Not a new register: a reader for the ones that exist, so
nothing can drift from its source. Not a shipped surface either — it is built on demand by a script
and served by nobody, so P-04 and P-05 are untouched.
**Why.** The register, the plan, the log and the audit are four long documents, and the question
"where is this product" is answered by reading all four. A generated page answers it in a glance
without becoming a fifth thing to maintain.
**Status:** done. **Implemented by:** `scripts/dashboard/build.mjs` (`docs/DEVIATIONS.md` §187);
`test/unit/dashboard.test.mjs`; the regeneration line in `docs/README.md`.
**Notes.** Four figures the documents do not hold — tests, goldens, CI and the published npm version
— are flags, and the page prints `not supplied` without them (P-03). Twelve pre-table work packages
whose status nothing proves read `unknown` rather than being assumed done. The page is capped at
220 KB, so long fields are truncated with an ellipsis and every entry names the document it came
from.

### 2.18 Declined and deferred

**R-190 — A 3D renderer**
*Owner, 14 September 2026:* "I do not see any 3d implementation that we saw in other project, ofcourse
it is alot of work, but it shows how everything flows, controlled, managed workflow, hierarchy, etc.
So think and analyse in depth there. and if usable keep it for future."
**Analysis.** `docs/plan/09-3D-AND-FLOW.md` takes the claim apart. The third dimension contributes
**mass, a horizon and an occlusion problem**. Everything the owner named is carried by the 2D
overlay: flow is dashed arcs with travelling dots, hierarchy is a star and the word `LEAD` on a pill
plus a seat, control is an HTML task rail, progress is `DOING 7 · NEXT 6 · DONE 7` on a card,
grouping is a floor tint. In the reference project's own capture, `CLIENT ASSETS` sits on top of
`QUALITY ASSURANCE CHECKER`, `INBOUND LEADS MANAGER` is cut in half by a card, and every character
faces away from the camera.
**Status:** **declined** for the free core; the isometric projection shelved; a Supporter pack is the
only door it gets, and it stays shut until route 1 ships and a pack has a storefront.
**Why declined.** `03-VISUAL-SPEC.md` §1 forbids perspective by name. A vendored `three.js` is ~600 kB
added to every install for a view most users will never open, and **a GPU-dependent renderer can have
no goldens**, which removes the one mechanism this project trusts to catch an invisible regression
(P-09). `08` §13.21 records the three sub-decisions and their recommendations.
**Notes.** The *content* the owner wanted from it — flow, hierarchy, blocked-on, progress — is not
declined. It is WP-77 to WP-83 and the arcs package after them.

**R-191 — A manager agent that assigns work down a hierarchy**
*Blueprint §5.2.* **Status:** declined. **Why.** Measured failure rates of 41–86% across seven
frameworks. The user's office is a queue, not an LLM. Studio (R-130) is not this: it proposes a
roster the user owns and spawns only on an explicit Hire.

**R-192 — Human streaks, leaderboards, XP, badges, guilt**
*`08` §14, inherited from the v1 plan and reaffirmed.* **Status:** declined (P-13). Also refused:
any telemetry, any CDN asset, any runtime dependency in the core, any paywall on capture, the queue
or an action, and any claim not measured on a machine.

---

## 3. User stories and use cases

In the owner's framing. Each links to the requirements that serve it.

**S-01 — "Someone can just come with an idea and start building."** *(8 September)*
A user with a project idea and no office opens DeckHQ, describes what they want to build, is grilled
into a plan they edit, is shown a roster of roles they own, presses Hire once, and watches real
sessions appear at real desks in real worktrees. → R-130, R-131, R-132, R-023.

**S-02 — "I want to see at a glance which sessions are active."** *(14 September)*
The user opens the floor after lunch. Project rooms hold the people who are working right now.
Everyone finished or resting is in the lounge. Everyone who needs an answer is at the manager's desk,
oldest first. The answer takes under two seconds and needs no clicking. → R-002, R-044, R-043,
R-029, R-031.

**S-03 — "Share it with a friend in one line."** *(14 September)*
The user pastes one command into a friend's chat. The friend runs it, is asked once whether they want
an icon, says yes, and has DeckHQ on their Desktop. No Node install instructions, no four-step
README. → R-010, R-011, R-012, R-013.

**S-04 — "I have 100 agents / I have 5 agents."** *(14 September)*
A user running a hundred sessions wants small figures so the floor fits; a user running five wants
big ones so they are not lost in the space. Both set it once, and the furniture follows. → R-057,
R-077, R-055, R-032.

**S-05 — "I am on a subscription, not a bill."** *(14 September)*
The user wants to know where the tokens went — which projects, which sessions, input versus cache
versus output — and does not want a dollar figure computed from list prices they are not paying.
→ R-091, R-090, P-12.

**S-06 — "I forget to follow up."** *(blueprint, the founding case)*
Claude finishes a turn and asks a question. The user reads it, thinks *I'll come back to that*, and
opens another terminal. The session is still standing in the office tomorrow morning, with a
waiting-time badge, because nothing observed can discharge it. → P-01, R-043, R-110.

**S-07 — "Open the repo, run the dashboard, without a terminal."** *(31 August)*
The user clicks the shelf in a room and their file manager opens on that repo; clicks the terminal
box and `dashboard.bat` runs and the dashboard opens in a browser. → R-076, R-100.

**S-08 — "Pick the session back up where I actually work."** *(31 August)*
The user reviews a session in the panel and then wants it in the surface they use — the Claude Code
desktop app if that is where they live, a terminal if not — without paying to reload a summary.
→ R-106, R-100.

**S-09 — "Clear the queue and enjoy watching them enjoy themselves."** *(1 September, implicit in the
bench/lounge design)*
An empty waiting area and a full lounge is the reward state. Benched agents play, drink coffee and
talk. The user is never scored for it. → R-045, R-060, R-071, P-13.

**S-10 — "Pin the repo I work in every day."** *(3 and 14 September)*
A project the user cares about keeps a room even with nothing running in it, downsized, so the floor
does not forget it between sessions. → R-030, R-029.

**S-11 — "Watch a fan-out happen."** *(15 September)*
A session spawns a crew of sub-agents. The floor shows them arriving around their parent with
laptops and cables, feeding data back, and shows them leave when they finish. → R-061.

**S-12 — "Make it mine."** *(15 September)*
The user opens a graphics control centre and chooses a floor, a carpet, a colour scheme, rugs, chairs
and plants from sets a designer put together, plus how big the people are. Nothing they can choose
produces an illegible floor. → R-077, R-057.

**S-13 — "Manage an AI workforce across many projects the way I would manage an office."**
*(2 September, the framing amendment)*
The user is an entrepreneur with several things in flight, twelve terminals in twelve repositories
and no surface that shows the whole team. → R-001, and everything under §2.3 and §2.4.

---

## 4. Open requirements — the owner's message of 15 September 2026

On record here before their packages exist. All five are **planned**.

| WP | Requirement | Register id |
|---|---|---|
| **WP-86** | Names never carry a numeric suffix — the pool is large enough that the `"<base> N"` fallback never engages | R-059 |
| **WP-87** | Character animations on the WP-79 robot: thinking cloud, working, running, and lounge activities (games, coffee) | R-060 |
| **WP-88** | A graphics control centre with designer-curated interior options — floor, carpet, colours, rugs, tables, chairs, sofa, plants — that mix and match, plus agent size with furniture scaling automatically | R-077, R-057 |
| **WP-89** | Sub-agent and multi-agent crew animation: three or more sub-agents draw smaller figures around the parent on the floor, with laptops, cables and data pulses toward the parent | R-061 |
| **WP-90** | This register | R-180 |

**Constraints that already bind them, before anyone scopes them.**

- WP-87 and WP-89 are motion, so P-10 applies: one static frame per state under
  `prefers-reduced-motion`, with a golden proving it, and every phase from the injected clock
  (`DECKHQ_NOW`), never `Date.now()` (P-09).
- WP-89 is bound by P-02 and P-03: a cable is a claim about a parent–child relationship, so where the
  link is inferred rather than observed the floor must say so rather than draw it. Juniors never
  enter the needs-you count unless they raise a hand themselves (WP-41, §120).
- WP-88 **subsumes WP-80** (R-057). One setting for agent size, not two. Every curated combination
  must pass `assertThemeContrast`, `assertMaterialDiscipline` and the ≥ 3:1 figure-halo guard that
  WP-85a made a test (§160), and changing agent size must change no plan geometry — the same
  population produces the same room rectangles at every setting.
- WP-86 must keep the original sixty names frozen in place and order, because goldens paint names
  (WP-84, §156).
- WP-90 is this file, and its acceptance is the rule in §0: a work package that ships without
  touching its row here has not finished.

---

## 5. What is not traced to a source

Named so that nobody mistakes silence for evidence.

- **The "vertical road" for fired employees** (R-026) was asked for and was not built as a road. The
  Departed is a room. Recorded as a departure in R-026's notes.
- **R-043's reception behaviour contradicts the owner's 14 September sentence.** WP-78 put the
  waiting queue at the manager's desk; the owner asked for the sofas. The reasoning is in §153 and
  the disagreement is on the record rather than resolved.
- **`DEVIATIONS.md` §30 is still a RAISE** — whether per-project colour belongs on the body was never
  closed; WP-79 settled it in practice without a decision being recorded.
- **`DEVIATIONS.md` §1 (`ended` has no row in the visual spec) and §3 (`for_review` sticky through
  session death)** both shipped with the invariant winning and are both still marked RAISE
  (`08` §13.12).
- **R-106's deep link is unverified** and must not be claimed until a machine confirms it (§9).
- **Several owner messages in the earliest sessions survive only inside conversation summaries**, not
  as raw transcript lines, because the sessions were compacted. Where a quote in this file comes from
  such a summary it is still verbatim — the summaries list the owner's messages in his own words —
  but the surrounding context is gone.
