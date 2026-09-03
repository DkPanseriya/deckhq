# 05 — GUI and UX specification

**Owner:** UI/UX, with Product Engineer on the panel and Architect on the renderer
**Phases:** P1 (§3–§7), P2 (§8–§10) · **Supersedes:** nothing. Extends `docs/03-VISUAL-SPEC.md`,
which remains authoritative for the floor's materials, rig, clips and state→visual contract.

---

## 1. The design problem

The floor is the best thing in this product and it is currently doing the wrong job.

On the reference machine at fit scale: a character is about 12 px, its label about 7 px and
unreadable, a project room is mostly bare carpet, and the single most animated region of the
screen is the lounge — where by definition nothing is happening. The eye goes to the pool table.

Meanwhile the actual job — *seven things are waiting on you, deal with them* — is served by a
5 mm numeral in the top-left corner and a panel that renders plain text.

So there are two design problems, and they pull in opposite directions:

- **The glance.** Is anything waiting on me? Answerable in under two seconds, from across the
  room, ambiently, beautifully. This is what the floor is for and what gets screenshotted.
- **The work.** Discharge seven items without thinking about geography. This is a list, sorted
  oldest first, driven by the keyboard.

Trying to make one surface do both is why the floor currently does neither well. The resolution
is an explicit three-level hierarchy, §3.

## 2. Visual identity

### 2.1 What stays

`docs/03-VISUAL-SPEC.md` §5's state colours are a measured contract with `public/render/palette.js`
and with the floor's baked materials. **They do not change.** Crimson stays reserved for
`for_review` and for primary actions; if red appears decoratively, that is a bug.

| | |
|---|---|
| `working` | `#2E7D63` |
| `needs_input` | `#B87333` |
| `stalled` | `#9A7B4F` |
| `for_review` | `#C0392B` |
| `ended` | `#6E6A63` |
| `benched` | `#7B8794` |
| `let_go` | `#BDB7AA` |

The floor's own materials — herringbone wood, woven carpet, poured screed circulation, near-white
walls with ambient-occlusion bands — also stay. They are warm, they are correct, and they took
the whole of WP13–WP16 to get right.

### 2.2 The one change: the chrome goes cold

Today the chrome neutrals are *"tinted toward the accent hue (~355deg)"* — that is, warm, pink-black.
The floor is also warm: wood, carpet, warm light. Chrome and floor therefore compete, and the
floor loses its glow because it is sitting on a ground of the same temperature.

Reframe the whole window as **an architect's drawing on a lit table in a dark studio**. The plan
is warm and lit; everything around it is cool, dark and recedes. That single change makes the
floor read as *illuminated* rather than as one more brown rectangle.

Pull the chrome neutrals to a violet-blue bias, roughly 232°:

```css
:root {
  --bg:        #131419;  /* the dark studio */
  --surface:   #1A1C23;  /* panel, header */
  --surface-2: #23262F;  /* raised: cards, chips */
  --surface-3: #2D313C;  /* hover, pressed */
  --line:      #333846;
  --line-2:    #464C5E;

  --ink:       #ECEEF3;
  --ink-2:     #B8BDC9;
  --muted:     #7C8494;
}
```

**Acceptance:** every state colour and every text colour must be re-measured against the new
`--bg` and `--surface`. State colours ≥ 3:1, body text ≥ 4.5:1, and the existing rule holds —
state is never carried by colour alone, always colour *plus* an icon or dot *plus* a neutral-ink
label. If any state colour fails against the new ground, **the ground moves, not the state
colour.** Guarded by extending `test/unit/state-visuals.test.mjs`.

Light theme is explicitly out of scope. This product sits beside dark terminals at 11pm; a
single, committed dark world is the right call and `color-scheme: dark` already declares it.

### 2.3 Typography

Keep **JetBrains Mono** for every number and every piece of data. Tabular figures are the reason,
and counts that jitter as they update are a real defect.

Keep **IBM Plex Sans** for UI prose.

**Add IBM Plex Sans Condensed**, and use it for one thing: labels drawn *on the floor* — room
plates, name labels, badges. The reasons are specific rather than decorative:

1. It is the drafting register. Architectural plans letter their rooms in condensed technical
   gothic; nothing else reads as "this is a plan" so cheaply.
2. It buys 15–18% horizontal space per label, on a surface where label collision is a logged,
   fixed-then-regressed defect (DEVIATIONS §15) and where 12 waiting agents share a 68 px seat
   pitch.
3. It is the same superfamily, so it costs one extra weight in the same self-hosted family and
   nothing in visual coherence.

Floor labels are set in Condensed, uppercase, `letter-spacing: 0.06em`, at the sizes in §6.2.
Fonts are self-hosted in `public/fonts/` as woff2 — **no CDN, no Google Fonts request**, because
rule 2 of the plan forbids network egress and the CSP forbids it anyway.

> **Decided 3 September** (`08` §8.2): vendor the font. Two weights, SemiBold for agent labels
> and Bold for room plates, per `docs/DEVIATIONS.md` §71, which also names the two renderer
> constants that must change. About 50 KB total.

### 2.4 The needs-you numeral

The single most important element in the product is currently 13 px. It becomes the display
element of the interface: **JetBrains Mono, 44 px, `--ink`**, with the word "NEEDS YOU" beneath
it in 10 px Condensed uppercase `--muted`. At zero it drops to `--muted` and loses its weight —
a cleared queue should look calm, not like a scoreboard reading zero.

## 3. The three levels

This is the core structural decision of the redesign.

| Level | What | Always visible | Key |
|---|---|---|---|
| **1 · The floor** | Ambient, spatial, beautiful. Answers "what is my team doing" | yes | — |
| **2 · The queue strip** | A horizontal rail of chips under the header, oldest first, one per item that needs you | whenever the count > 0 | `J` / `K` |
| **3 · The deck** | Full-screen dense list. Answers "let me clear these" | on demand | `Tab` |

Plus **the panel**, which is the review surface and is present in all three.

The floor earns the screenshot. The deck does the job. The strip is the bridge: it gives the
queue's shape and length without leaving the floor, which is what makes the floor safe to keep
looking at.

### 3.1 The queue strip

Sits directly under the header, full width, only when `needsYou > 0`.

```
┌───────────────────────────────────────────────────────────────────────────┐
│ ✓ 1d 2h  Ada · orbital-api   ✋ 4h  Rune · mobile-app   ✓ 40m  Wren ·… ▸  │
└───────────────────────────────────────────────────────────────────────────┘
```

- One chip per `needsYou` item, ordered oldest first — the same order as `J`/`K` and the deck.
- Each chip: state icon, elapsed time in mono, agent name, project. Nothing else.
- The **oldest chip is always leftmost and never scrolls out**; overflow collapses on the right
  into `+4`.
- Hover reveals the last line the agent said. Click selects it and opens the panel.
- The selected chip is ringed and the corresponding person on the floor is ringed at the same
  moment, which is what teaches the mapping between the two.
- Elapsed times tick live. Past 24h they render in `--accent`.

### 3.2 The deck (`Tab`)

Replaces the floor with a full-width table. The panel stays. `Tab` returns to the floor.

```
     WAITING   WHO                 PROJECT          LAST WORD                          TOKENS
 ▸   1d 2h  ✓  Ada      MK1.1      orbital-api      Done. Tests pass and the change…    160,000
     4h 12m ✋  Rune     MK5.1      mobile-app       May I run the migration on prod?    412,000
     40m    ✓  Wren     MK2.3      checkout-flow    Refund path fixed; orphaned rows…    88,400
     7m     ✓  Juno     MK1.4      orbital-api      Opened the PR. Anything else?        31,900
     ─────────────────────────────────────────────────────────────────────────────────────────
     3h 02m ⏳  Sable    MK3.2      data-pipeline    (silent since 14:12)                220,100
```

- Ordered oldest first. `for_review` and `needs_input` above `stalled`, separated by a rule,
  because a raised hand and a finished turn need different responses (product spec §4.2) and a
  stall is not a debt in the same way.
- `J`/`K` move, `Enter` opens, `1`/`2`/`3` act on the selected row without opening it, `Tab`
  back to the floor.
- Row height 34 px. Waiting time in mono, right-aligned within its column, tabular.
- **Default view when `needsYou ≥ 6`.** Past six items the floor stops being the efficient
  surface, and pretending otherwise is the theater failure mode. It still *opens* on the floor —
  the aha is spatial — but a one-line hint appears: *"7 waiting · press Tab for the deck"*.

## 4. The panel: from viewer to review surface

This is where the daily work happens and it is currently the weakest screen in the product.
Today: a state chip, three number tiles, an animated close-up, seven equal-weight buttons, and
the conversation as unstyled plain text.

The person is being asked to *review work* with none of the review material, and then to press
one of seven identical grey buttons.

### 4.1 The new layout, top to bottom

```
┌──────────────────────────────────────────────────────┐
│  Ada  MK1.1                                    ✎  ✕  │   identity
│  Backfill the events table                           │   the session's own title
│  ✓ FOR REVIEW · orbital-api · main · opus-5          │
│  waiting 1d 2h                                       │   crimson, mono, live
├──────────────────────────────────────────────────────┤
│  WHAT IT SAID                                        │
│                                                      │
│  Done. Tests pass and the change is on the branch.   │   ← markdown-rendered
│  Want me to open the PR?                             │
│                                                      │
│  ```                                                 │
│  npm test  ✓ 214 passing                             │
│  ```                                                 │
├──────────────────────────────────────────────────────┤
│  WHAT CHANGED IN ORBITAL-API      +142  −18  6 files │
│  src/events/backfill.ts               +98   −4       │
│  src/events/index.ts                  +21   −8       │
│  test/backfill.test.ts                +23   −6       │
│                                    [ open the diff ] │
├──────────────────────────────────────────────────────┤
│   ┌──────────┐ ┌──────────┐ ┌──────────┐             │
│   │ 1 Reply  │ │2 Approve │ │ 3 Bench  │             │
│   └──────────┘ └──────────┘ └──────────┘             │
│                                              ⋯ more  │
├──────────────────────────────────────────────────────┤
│  Reply to Ada…                                       │
│                                              [Send]  │
├──────────────────────────────────────────────────────┤
│  160,000 tok · 1.44M cache · ≈ $7.86 list, not a bill│
│  resume in terminal · resume in app                  │
└──────────────────────────────────────────────────────┘
```

### 4.2 What changed and why

**The last message is rendered as markdown, and it is the first thing you see.** Headings, lists,
inline code, fenced blocks with a mono face and a subtle ground. The agent wrote markdown; showing
it as a wall of plain text is throwing away structure the reader needs. Rendering stays
XSS-safe: parse to a token tree and build DOM nodes with `textContent`, **never** `innerHTML`,
never a regex-to-HTML pass. No new runtime dependency — a ~150-line block-level renderer covering
headings, paragraphs, lists, fences, inline code, bold, italic and links-as-text is sufficient
and is the only responsible way to do it under rule 3.

**A diff summary, because you cannot review what you cannot see.** Run in the session's cwd:
`git diff --stat`, `git diff --cached --stat`, and the commit count ahead of the default branch.
Cheap, cached per scan, and it turns "want me to open the PR?" from a question you must go
elsewhere to answer into one you can answer here.

> **Honesty requirement.** With several agents in one repo, a working-tree diff is not
> attributable to one agent. The heading therefore says **"what changed in orbital-api"**, not
> "what Ada changed". Never imply attribution the data does not support. If the repo is clean the
> section says *"nothing uncommitted"* rather than disappearing, because "no changes" is itself
> review-relevant.

**Three actions, weighted, on number keys.** `1 Reply` focuses the composer. `2 Approve` sends a
configurable affirmative (default `"Yes, go ahead."`) and is the single most common reply in this
workflow — making it one keystroke is the largest per-day time saving in the redesign.
`3 Bench` sends them to the lounge. Everything else — mark for review, let go, rename, new agent,
recall, rehire — moves behind `⋯ more` and into the palette. Seven equal buttons is not a choice
architecture; it is an inventory.

`2 Approve` is `--accent`-filled. It is the only filled button on the screen.

**The close-up moves.** The animated L2 character is charming and it is currently occupying the
most valuable real estate on the panel, directly under the title. It shrinks to 44 px and moves
inline beside the identity line, where it still animates and still rewards a look.

**Costs move to the bottom** as one quiet line. They are context, not the subject, and three
large number tiles at the top implied otherwise.

### 4.3 Streaming

`send()` currently runs `claude --resume <id> -p <text> --output-format json` to completion, with
a ten-minute timeout, while the composer sits disabled reading "Sending…". The user has replied
and now has no idea whether anything is happening.

Switch to `--output-format stream-json`, parse events as they arrive, and append deltas into the
thread live. The person you just replied to should start typing at their desk within a second.

Separately, **tail the transcript file for the open session** so a reply typed in a terminal
appears in the panel without a poll. Both changes are WP-09.

## 5. Header and the command palette

### 5.1 The header today

Brand · needs-you · at-desk · benched · a dead "Show let go" toggle · Settle floor · New project ·
Hooks · Refresh · Enable notifications. Ten elements, all the same weight, three of them
maintenance, one of them wired to nothing (`settings.showLetGo` is written and never read —
DEVIATIONS §58 flagged it; it gets deleted).

### 5.2 The header after

```
┌───────────────────────────────────────────────────────────────────────────┐
│ ▦ DeckHQ    7      2 ✋   1 ⏳   4 ✓         5 at desk · 37 benched        │
│           NEEDS YOU                                    ⌘K   [+ New agent] │
└───────────────────────────────────────────────────────────────────────────┘
```

Brand, the display numeral with its three-way breakdown, the floor counts as quiet context, the
palette hint, and exactly one primary action. Everything else moves to `⌘K`.

Degraded and write-error banners keep their current behaviour — they are the honest-limits
machinery and they are correct.

### 5.3 `⌘K` / `Ctrl+K`

One palette, fuzzy-matched, over everything:

- **Agents.** Every agent by name, MK tag, title or project. `Enter` selects and opens the panel.
- **Projects.** Jump to a room, filter the deck, open the whiteboard, reveal the folder, run the
  dashboard, archive the room.
- **Actions on the selection.** All six ack actions, resume, rename, new agent.
- **Commands.** Settle floor · Install hooks · Refresh · Snapshot the office · Settings ·
  Onboarding again · Notifications · Sound.

This is what lets the header become a headline instead of a toolbar, and it is what a
keyboard-first audience expects in 2026. Linear's whole interaction model is this, and its users
never asked for a toolbar back.

### 5.4 Settings

There is no settings surface at all today; stall window, notifications, sound and poll interval
are reachable only through the HTTP API. A sheet, opened from the palette:

State · stall window (2–120 min) · poll interval.
Notifications · hands-up, crashes, sounds, volume.
Resume · default target, preferred terminal.
Floor · reduced motion override, lounge crowd threshold, show let-go.
Data · state file path, ledger retention, export, rate card.
Hooks · the existing consent screen, embedded rather than a separate dialog.

## 6. The floor: making the people the subject

Four fixes, in order of impact. Renderer owns all of them.

> **§6.1 and §6.3 are superseded by the dynamic floor, `08` B6 / WP-50 (3 September).** Rooms
> exist only for active projects, desks equal the agents at them, idle projects are a directory
> strip, and the lounge is sized to the agents actually drawn. The text below is kept as the
> reasoning that led there; §6.2 and §6.4 still apply.
>
> **And by WP-55 after it (`08` §9, `docs/DEVIATIONS.md` §106):** a room's footprint comes from its
> occupants and their furniture, and the building's extent is the sum of its rooms rather than the
> shape of the window. `05-LAYOUT-REWORK.md` §3's first two acceptance items go with it — the floor
> deliberately no longer fills the stage. §6.2's minimum sizes all landed and are now enforced per
> element; they gained a **ceiling** as well, 44 px of body, because a quiet machine's small floor
> was being blown up like a poster on a large display. §6.4's focus camera is the one part of this
> section still unbuilt.

### 6.1 Rooms are weighted by activity, not by headcount

The treemap currently weights a room by `sessionCount`. On the reference machine that gives a
room with one working agent and nine benched ones a large cell containing one person and a lot of
carpet.

Weight instead by `activeCount` (agents that are neither benched nor let go), with a floor so a
one-agent room is still a legible room, and keep `WEIGHT_MAX_RATIO`'s compression. Benched agents
live in the lounge; they should not be sizing a room they are not in.

### 6.2 People never shrink below legibility

Today `MIN_SCALE = 7.5` px/unit governs everything uniformly, so at fit on a big floor a
character is ~12 px and its label ~7 px.

Decouple the character scale from the world scale. Below the threshold where a person would be
under **16 px of body and 11 px of label**, stop scaling people down and let them grow relative
to the plan. A slightly-too-large person in a small room is a legible floor; a correctly-scaled
6 px person is a decorative texture.

| Element | Minimum rendered size |
|---|---|
| Character body | 16 px |
| Name label (Condensed) | 11 px |
| State icon above head | 12 px |
| Waiting badge | 13 px, shown when it fits, else the room plate carries the aggregate |
| Room plate name | 12 px |

### 6.3 The lounge stops shouting

37 of 49 sessions benched on a real machine. The lounge is the largest room and the most animated
region, and the message it sends is "most of your team is playing pool".

- Past **8** benched agents, render a **crowd**: denser packing, lower detail, slower and
  desynchronised loops, no individual name labels (names on hover and in the panel).
- Cap the lounge's share of the floor and put the count on the plate: `37 benched · 5 idle games`.
- Make benched *calmer* than working: slower clip rates, lower contrast. Rest should look
  restful, not like a party.

### 6.4 The focus camera

A `F` key and a palette command that frames the rooms with activity and pushes the service column
to the edge. Not a zoom the user has to steer — a computed framing of "where the work is".
Pressing it again returns to the whole floor.

## 7. Onboarding

Delete the modal. `public/index.html:129–177` and the `showModal()` call in `app.js` both go.

Replace with **three coach marks anchored to real elements**, appearing in sequence, each
dismissible, all skippable with `Escape` forever:

1. On the needs-you numeral — *"7 sessions are waiting on you. This number is yours. The runtime
   can't clear it."*
2. On the user's office — *"They finished and walked in here. Reading a message doesn't send them
   away — only you do."*
3. On one waiting agent — *"Click anyone."*

Then get out of the way. Total reading time under 15 seconds against the target of 60.

**The empty machine** is the other half. A user with no sessions currently gets "Nothing on the
floor yet" and a `<code>claude</code>` block. Instead: run the demo floor's actors, with one line
of copy — *"These are actors. Run `claude` in any repo and a real one walks in."* — and poll. When
the first real session appears, the actors leave and it walks in alone. That is the aha, and it
is worth the engineering (WP-13).

## 8. Sound

`settings.sound` has existed since v1 and has never been wired to anything. Three sounds,
**synthesised in the browser with WebAudio** — no asset files, no fetches, nothing to bundle:

| Event | Sound | Default |
|---|---|---|
| `for_review` entry | A low wooden door-close. Two quick filtered noise bursts, 180 ms | on |
| `needs_input` entry | Two soft knocks, ~140 ms apart | on |
| Office cleared | A rising two-note chime, 400 ms | on |

Rate-limited to the notification coalescing window, silent when the tab is hidden and the OS
notification is doing the work, and globally off in one keystroke from the palette. Volume in
settings, defaulting low.

Three sounds, a handful of times a day. Any more and it becomes a thing people turn off, and a
sound that is off is worse than no sound because it took a setting to get there.

## 9. Motion

`prefers-reduced-motion` is already honoured and stays honoured — characters snap, clips hold a
representative pose, the hand-raise ring is static, lounge rotation stops. Extend it to every new
motion below.

New motion, all of it meaningful:

- **Arrival.** A person walking into your office is the product's signature moment. It already
  works; give it a subtle floor shadow that sweeps with them so the eye catches it peripherally.
- **The badge.** When a waiting badge first appears it counts up from 0 over 400 ms, then ticks
  live. It is the only number in the product that should draw the eye to itself.
- **Discharge.** On acknowledge, the ring dissolves outward and the person turns before walking.
  200 ms of feedback that the keystroke landed.
- **Office cleared.** Ambient light warms 6% over 1.2 s, the chime plays, one line of text fades
  in and out over 3 s. At most a few times a day. This is the product's one celebration.
- **The strip.** Chips slide in from the right; the departing chip collapses its width to zero
  rather than vanishing, so the queue visibly shortens.

Nothing else animates. No hover lifts, no card entrances, no page transitions. The floor is
already a moving image; chrome that also moves is noise.

## 10. Accessibility

Non-negotiable, and mostly already in place.

- Every action reachable by keyboard, with a visible focus ring (`--focus`, 2 px, offset 2).
- The deck (§3.2) is a genuine `<table>`-semantic grid with proper roles, and it is the
  accessible equivalent of the floor: a screen-reader user gets the same queue, in the same
  order, with the same actions. **The floor is never the only way to reach anything.**
- The canvas keeps its `aria-label` summary; the live region keeps announcing state changes; the
  queue strip is a `role="list"` of real buttons, not canvas.
- State never by colour alone: icon + colour + neutral-ink label, everywhere, including the new
  strip and deck.
- Contrast re-measured after §2.2. Text ≥ 4.5:1, state colours ≥ 3:1, focus ring ≥ 3:1.
- All new copy passes the rule in [`04`](04-ENGAGEMENT-AND-GAMIFICATION.md) §5: no second-person
  fault. "7 waiting", never "you've left 7 agents waiting".

## 11. Copy

The product's voice is a good colleague who is precise and does not fuss. It is already close;
the rules that keep it there:

- **Name things as the person experiences them.** "Waiting on you", not "for_review" in the UI.
  "Hands up", not "needs_input".
- **A control says what happens.** "Bench" → toast "Benched. Ada is in the lounge."
- **Errors say what to do.** *"DeckHQ can't save your acknowledgements to `~/.deckhq/state.json`
  (EACCES). They'll be lost when it restarts. Set `DECKHQ_STATE_DIR` to a writable directory and
  start it again."* — this one is already right; match it.
- **Never imply fault.** Ever. See §10.
- **Cost is always "estimate" or "list price", never a bill.** Already enforced; keep it.

## 12. Additions in plan v2 (3 September)

Specified in [`08`](08-PLAN-V2-100X.md) §8.1 and §9; listed here so this document stays the
single index of the interface.

| Surface | What | Package |
|---|---|---|
| Floating mini-floor | Office, corridor and the numeral in a Document Picture-in-Picture window, always on top; click opens the full floor at that agent; PWA badge fallback | WP-39 |
| Terminal deck | `deckhq ls`, `waiting`, `ack`, `bench`, `open` — the deck in ANSI, same order, same ids | WP-42 |
| Gone home | Benched > 7 days not drawn; lounge door carries the count; reachable in ≤ 2 keystrokes | WP-40 |
| In-panel diff | Unified diff per file as coloured `textContent`, collapsed; "open in editor" from an allowlist | WP-47 |
| Batch actions | Acknowledge a room; multi-select in the deck | with WP-10 |
| Status line | `▣ 3 waiting · 1 hand up` in every Claude Code session | WP-38 |
| Permission request in the panel | Allow / Deny / Allow for this session, for every interactive session via the `PermissionRequest` hook | WP-19 |
| Identity rarity | Deterministic traits on tiers, on the agent, state colour untouched | WP-20 |
| Thought bubble | Current tool and a ≤ 120-char action above the head at L1+, a tool icon at L0, live in the panel header; from `PreToolUse`/`PostToolUse` | WP-52 |
| Dynamic floor | Rooms only for active projects, desks equal occupants, idle projects as a directory strip, lounge sized to the drawn count | WP-50 |
| Rate card version | On the whiteboard beside every cost | WP-26 |

The refusals stand: no hover lifts, no chrome animation, no light theme, no second-person fault.
And one added: **no feature that requires the tab to be open to be useful** (`08` §14).
