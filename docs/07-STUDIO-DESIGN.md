# 07 — Studio design

**WP-66 · WP-67 · WP-68 · WP-69 · WP-70 · WP-71**

**Date:** 8 September 2026 · **Owner:** Architect · **Status:** design of record. **WP-66 and WP-67
are built** (`docs/DEVIATIONS.md` §150, §159): the store, the three schemas, the consent, the
endpoints that need no spawn, and the planner session that writes the three artefacts. WP-68 to
WP-71 are unbuilt, and every sentence below about what a runtime does under Studio remains a
hypothesis until a machine measures it (`08` §1.1 rule 11) — including, still, what a planner
actually writes, because the reference machine's login is expired and no interview has been run.
Where this document and the code disagree, §150.2 and §159.4 name the difference and its reason.

**Binding sources, in precedence order:** `docs/01-PRODUCT.md` §2 · `docs/plan/08-PLAN-V2-100X.md`
§1.1 rules 1–11 · `docs/02-ARCHITECTURE.md` §2, §5, §9 · `docs/ADAPTERS.md` §6 ·
`docs/06-RELAY-DESIGN.md` (the format this follows).

**The name.** **Settled: Studio.** The owner approved it on 8 September 2026 with every default in
§11, before WP-66 wrote a directory name. The alternatives were **Workshop** and **Bureau**; the
name decides `.deckhq/studio/`, `/api/studio/*` and one tab, and nothing else depends on it.

---

## 1. Positioning

**The base product does not change.** DeckHQ reads the real sessions on the machine through the
adapters; the user creates agents, names roles and dispatches work themselves. Studio does not
replace that and never becomes the default.

Studio is an **opt-in mode, per project**, for the other starting point: an idea and no office yet.
It interviews the user, writes a plan they edit, proposes a roster they own, and — only on an
explicit **Hire** — spawns one real runtime session per role, Claude Code first and Codex second.
Every one is found by the ordinary scan, wears an ordinary identity, sits at an ordinary desk and
is answered from the ordinary panel. There is no second data path, so the floor keeps showing real
work and the honesty rule holds.

**Studio never fakes a task feed.** No synthetic message, no fabricated progress, no card that
moves because a timer said so: a card's state is either something the user set or something a real
session wrote to a real file. Where a runtime cannot tell us something — Codex has no hooks, and
liveness there is inferred from file mtime (`DEVIATIONS.md` §8, §137) — the card says so instead of
filling the gap. Disabled, which is the default everywhere, nothing is created.

## 2. The loop

**Idea.** One paragraph and a project directory. Reuses the new-project dialog's picker and its
create / `git init` ticks; new is the copy.

**Grill.** A real `claude` planner session interviews the user in the panel, over the streaming-send
path (`SendHub`, `POST /api/send` → 202 + SSE) and the composer; new is the planner brief and the
rule that its output is files, not transcript. §3.

**Blueprint.** `.deckhq/studio/blueprint.md` — goal, non-goals, milestones, acceptance criteria —
rendered by the panel's markdown renderer; new is the file, its consent, and an edit route.

**Roster.** Roles proposed in `roster.json`, under the store's atomic-write and corrupt-file
discipline; new is the schema and the editor.

**Hire.** One session per role in its own git worktree, through
`adapter.openNewSession(cwd, {instructions})`, `src/core/terminals.mjs` and
`queuePendingIdentity()`; new is `git worktree add`, the brief file, the role→session record. §4.

**Board.** Six columns as a tab beside the floor, on the deck's semantic-table rule and the floor's
selection model; new is `board.json`, `/api/studio/*` and the tab. §5.

**Work.** Reuses everything — the six states, thought bubbles, the permission card, the review
card, the queue strip, the ledger, juniors beside their parent — and adds nothing, which is the
point.

**Handover.** A session writes `.deckhq/studio/handovers/<cardId>.md`, watched by the transcript
watcher's file-watch plumbing; new is the directory, the watcher, the instruction in the brief. §6.

**Review.** The handover raises the existing review card in a Waiting state, with its diff and
`act()`; new is **Accept handover** and **Bounce**, whose note joins the next brief.

**Track.** Cost and time from the ledger through `records()` and `computeStats()`, priced by the
dated rate card, test counts quoted from handovers; new is a per-card fold and a burn-down. §7.

**Drift control.** A periodic planner pass over blueprint, board and handovers, surfacing flags as
review cards; new is the pass, its schedule and the budget stop. §8.

## 3. Grill, and the consent that lets it write

The planner is a real session: `claude` with the interview brief as its first prompt, argv array,
`cwd` the project directory, through the code path `/api/new-project` already uses. It stands on
the floor like anybody else; its replies stream into the panel through `SendHub` and the user
answers in the composer. It produces three files under `<project>/.deckhq/studio/`:

| File | Contents |
|---|---|
| `blueprint.md` | Goal, non-goals, milestones, acceptance criteria per milestone |
| `roster.json` | Roles: `name`, `purpose`, `systemPrompt`, `allowedTools`, `permissionPolicy`, `budget` |
| `board.json` | Cards (§5.1) |

**As built (WP-66).** `permissionPolicy` is one of `ask`, `allowlist` or `plan` — a vocabulary this
document did not give, chosen in `src/studio/schema.mjs` and **descriptive, not enforced**: §9 is
what settles that, and the permission card still governs tool use. `blueprint.md` carries no front
matter, and the validator refuses one; the reason is in `schema.mjs`'s header. An unknown value in
either file is refused with its path and its line, never coerced.

**That is outside the state directory, so it needs consent, granted once per project, exactly as
`deckhq shortcut` grants it** (`src/core/launcher.mjs`, `02-ARCHITECTURE.md` §6):

1. **Enable Studio here** prints every path it would write — the three files, `briefs/`,
   `handovers/`, `rules.md` — with what each is for, and writes nothing.
2. The user clicks **Enable**, or runs `deckhq studio enable <dir> --yes`. Without `--yes` the CLI
   prints the same list and exits.
3. The daemon writes `.deckhq/studio/README.md` carrying `TAG` on its first line, and records
   `studio.consent[projectKey] = { grantedAt, root }` in `state.json` and `installed.json`.
4. Studio may then write **inside that directory and nowhere else**; a path resolving outside is
   refused, not clamped, as `runAction()` already refuses one.
5. `deckhq studio disable <dir> --yes` removes only files still carrying the tag and names the
   rest. Consent is per project and never inferred from another.

The user edits every artefact before hiring, in the browser or through the open-in-editor
allowlist. **Nothing runs until Hire is clicked.**

## 4. Roster and Hire

Roles are the planner's suggestions and the user's property: add, remove, rename, rewrite the
prompt, change the tool list, change the cap. The planner is not consulted on an edit.

**Hire**, per role: `git worktree add <state>/worktrees/<project>-<role> -b studio/<role>`; write
`.deckhq/studio/briefs/<role>.md` (§6.1); call `openNewSession(worktreePath, { instructions })`
where `instructions` is one argv element **naming** the brief file rather than carrying it, because
a brief is long and a prompt is an argument; record `roster.roles[i].agentId` when the scan finds
the session. Identity persists through the existing mechanism — `queuePendingIdentity()` attaches
the role name and avatar to the newest session in that directory, and MK numbers and given names
are never reassigned — so a hired agent is the same character on the board, the floor and the deck.
A face is a pure function of the session id (§105), so a role fired and hired again is a new
session and a new face under the same role name; the card shows both rather than pretending.

**Codex.** `openNewSession` exists and takes argv arrays, and **no Codex terminal has ever been
opened by this project** (§8, §137), so a Codex role is marked *unverified launch*. Codex has no
`http` hook type: it cannot raise a permission card (WP-58 is the fix), cannot be told apart from
stalled when blocked, and reports liveness from file mtime. **Runtimes without a hook** — Gemini
CLI and OpenCode, both unverified against real data (§123) — are hired, degrade exactly as the
floor already does, and name on the card what cannot be known. A runtime with no `openNewSession`
is refused at Hire, never silently skipped.

## 5. The board

Six columns: **Backlog, Ready, In progress, Review, Done, Blocked.**

### 5.1 `board.json`

```jsonc
{
  "version": 1,
  "projectKey": "1f4a9c3e7b20d581", // `projectKeyFor()` — see below
  "cards": [
    {
      "id": "c7",
      "title": "Refund path returns the fee",
      "acceptance": ["a failing test first", "npm test green"],
      "milestone": "m2",
      "role": "backend",              // assignee role, or null
      "column": "in_progress",        // USER-OWNED — §5.2
      "budget": { "tokens": 400000, "minutes": 90 },
      "agentId": "claude-code:abc",   // set at hire, never guessed
      "worktree": "…/worktrees/orbital-api-backend",
      "handover": ".deckhq/studio/handovers/c7.md",
      "flags": [{ "kind": "budget", "text": "80% spent, 1/4 criteria met", "at": 178 }],
      "updatedAt": 178
    }
  ]
}
```

**As built (WP-66).** `projectKey` is `src/core/ledger-record.mjs`'s `projectKeyFor()` — a SHA-256
of the same normalised cwd, truncated to 16 hex characters — rather than a full digest, so that a
card and a ledger record name one project with one token and §7's per-card fold has something to
join on. `docs/DEVIATIONS.md` §150.2 item 1.

### 5.2 The column is user-owned state

`card.column` obeys the discipline `ackState` obeys, for the same reason (`01-PRODUCT.md` §2).
**An observed event may flag a card and may never move it.** A session ending, a test passing, a
file appearing, a budget being spent: each writes `flags` and nothing else. A column changes on
exactly two things — the user dragging or pressing, or a handover the user has **accepted** in the
review card. No auto-advance, no complete-on-exit, no heuristic, and a static test greps
`src/studio/` for any write to `column` outside those two funnels.

### 5.3 Endpoints

Loopback only; cross-site refused by the guard already in `src/daemon.mjs` (§28). All JSON.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/studio?project=` | Consent state, blueprint, roster, board, in one snapshot |
| `POST` | `/api/studio/enable` | `{ cwd }` describes; `{ cwd, confirm:true }` writes |
| `POST` | `/api/studio/disable` | Removes tagged files only |
| `POST` | `/api/studio/plan` | Start or continue the planner session |
| `POST` | `/api/studio/roster` | Replace the roster the user edited |
| `POST` | `/api/studio/hire` | `{ role }` — worktree, brief, spawn |
| `POST` | `/api/studio/card` | Create, edit, or **move** a card. The only column writer |
| `POST` | `/api/studio/handover` | `{ cardId, decision: 'accept'\|'bounce', note }` |
| `GET` | `/api/studio/tracking?project=` | §7's numbers |

**As built (WP-66, then WP-67).** Everything above that needs no spawn exists: `GET /api/studio`,
`enable`, `disable`, `roster`, `card` and `tracking`. `plan` starts — or continues — a real planner
session (WP-67, §159); `hire` and `handover` answer **501** with one line naming the package that
adds them, so the surface is complete and honest rather than half-present. `tracking` answers `{ cards: [], note: "no data" }` and contains no digit at all
until WP-71 has a ledger fold behind it.

`POST /api/studio/card` takes `{ cwd, op, ... }` with `op` one of `create`, `edit` or `move`. A
column moves on `move` alone; an `edit` that carries a column is **refused** with the verb named,
rather than being quietly ignored (§150.2 item 7).

### 5.4 The tab

A tab beside the floor, reached by `Tab` or `⌘K`, with a real table underneath so a screen reader
gets the same cards in the same order — the deck's rule, not a new one. Clicking a card selects its
assignee and lights that desk. Dragging a card into **Ready** with an assignee spawns or continues
that role's session with the card as its brief; with no assignee it asks which role and refuses
rather than choosing.

## 6. Handover

There is no magic. The brief carries a documented instruction: *when you believe a card is done,
write `.deckhq/studio/handovers/<cardId>.md` with what changed, the tests you ran and their real
counts, open questions, and the next step.* The agent writes an ordinary file. DeckHQ watches the
directory, and on a new or changed one: the card is **flagged, never moved** (§5.2); that session
enters the existing review surface with the handover above **what it said**, beside the
working-tree diff the panel already draws for its worktree; the reviewer role — a role like any
other, or the user — presses **Accept handover** (the card moves where the user names) or
**Bounce** with a note, which joins the next brief and leaves the card where it is. A handover for
an unknown card id is shown unattached rather than dropped, and a test count is quoted, never
believed (§7).

### 6.1 The brief, as a file the user can edit

`.deckhq/studio/briefs/<role>.md`, from four parts in order: the blueprint excerpt (goal,
non-goals, current milestone), the card, the previous handover and any bounce note, and the coding
rules — `.deckhq/studio/rules.md`, created once with a two-line default and never rewritten. It is
written before the session is spawned and never regenerated under a running one; a regeneration
that would overwrite an edited brief writes `<role>.next.md` and says so.

## 7. Tracking

Per card and per milestone, and every number has a file behind it.

| Number | Source |
|---|---|
| Tokens, cost estimate | Ledger `tokens` records for that `agentId`, priced by the dated rate card, labelled `list price` |
| Time on the card | Ledger `state` and `action` records between the two column moves |
| Time in review | `reviewEpisodes()`, unchanged |
| Tests run | Quoted verbatim from the handover: *"the handover says 43 passed"* |
| Burn-down | Acceptance criteria the user has ticked, against cards left in the milestone |

Nothing is estimated, interpolated or projected. A card with no ledger records reads `no data`
rather than zero — the refusal the rate card already makes for a model it cannot price.

## 8. Drift control

A **PM pass**: on a schedule (default 30 minutes, and on demand) the planner is handed the
blueprint, the board and the handovers since the last pass, and asked for flags in a fixed shape —
`{ cardId, kind, text }`. Typically *"card 7 is outside milestone 2's scope"* or *"budget 80%
spent, 1 of 4 criteria met"*. Flags surface as review cards on the planner and as a chip on the
card. **They never act**: a flag cannot move a column, reassign a role or stop a session.

**The hard stop, and what it can honestly be.** When a card's ledger cost crosses its cap, DeckHQ
moves the card to **Blocked** — the one system write to a column, allowed because it is a stop and
not progress, and named as such in the schema — refuses to send that session further work, and
posts one message asking it to stop and write a handover. **DeckHQ does not kill the process.** A
session opened in a terminal is not the daemon's child, there is no supervisor, and promising to
stop an agent we cannot signal would be a lie. **Fire** (`let_go`) takes the role off the floor and
the board and leaves the process alone, as it already does. Reassigning is a card edit plus a hire.

## 9. Security and invariants

Reaffirmed and unrelaxed: **loopback only**, no `--host`; **zero egress from DeckHQ** — the runtime
CLI makes its own network calls as today, and DeckHQ makes none; **argv arrays**, never a shell
string with a role name, path or brief interpolated into it; **never touches `~/.claude` or
`~/.codex`** beyond the tagged hook block already consented to; **consent for every write outside
the state directory**, printed, tagged, recorded, removable; **the permission card governs tool
use** for hired agents as for any session, and a role's `allowedTools` is a line in its brief
rather than something DeckHQ enforces on the runtime — the card says which is which; **no
telemetry**.

New invariants, each with a named test. **1, 3 and 4 have theirs.** WP-66 shipped
`test/unit/studio-invariant.test.mjs`, which reads the source rather than the behaviour, so it
fails on a writer or a session list somebody adds tomorrow, and covers 1 and 4. **3 landed in
WP-67**, a package earlier than this section expected, because WP-67 writes a brief too — the
planner's; `test/unit/studio-brief.test.mjs` edits one and asserts the regeneration goes beside it
and the user's is what is returned. 2 lands with WP-68, which is the first package where a hired
session can show activity at all.

1. **A card's column is user-owned.** No observed event moves it. The single exception is §8's
   budget stop, asserted to reach `blocked` and no other column.
2. **No simulated work.** Every card showing activity names a real `agentId` and a real ledger
   record; a test asserts no code path writes a message, a token count or a progress value that
   did not come from an adapter or a file on disk.
3. **Brief files are the user's.** Studio never overwrites an edited brief; it writes beside it.
4. **Every spawn is visible on the floor.** A Studio-spawned session is an ordinary registry
   session within one scan, and a test asserts Studio keeps no private session list.

## 10. Work packages

Continuing `08` §9. The last package on `main` here is WP-63; WP-64 and WP-65 are reserved for work
in flight. Sizes are S/M/L, not days: none of this has been estimated against a running prototype.

### WP-66 · Studio store, schema, consent, endpoints · `AR` · M · P3 · depends on — · **DONE**

`src/studio/` and `src/http/routes/studio.mjs`: three schemas, the consent record, §5.3's
endpoints. No UI, no spawn, no planner.
**Accepted when:** (1) `enable` without `confirm` writes nothing and returns every path it would
write; (2) a write resolving outside `<project>/.deckhq/studio/` is refused with the offending
path, tested with `..` and a symlink; (3) `disable --yes` removes only tagged files and names the
rest; (4) a static test finds no write to `card.column` outside `/api/studio/card` and §8's stop.

**Done, 8 September 2026.** All four met, each by a named test:
`test/integration/studio-route.test.mjs` hashes the whole project tree before and after a describe
(1) and proves `disable` keeps the board, the blueprint and the handovers (3);
`test/unit/studio-store.test.mjs` covers `..`, an absolute path and a symlink (2), and
`test/unit/studio-invariant.test.mjs` reads `src/studio/` and `src/http/` and fails on a second
column writer (4). Also shipped: `deckhq studio enable|disable <dir> [--yes]`,
`state.json`'s `studio.consent[projectKey]`, a per-project `installed.json` surface, and
`blockForBudget()` as §8's funnel with no caller until WP-71. `public/` is untouched, so there are
no goldens. **Nothing runs.** Ten places where the code had to differ from this document are
recorded in `docs/DEVIATIONS.md` §150.2 with their reasons.

### WP-67 · Grill — the planner session and its artefacts · `AB` · M · P3 · after WP-66 · **DONE**

The interview brief, the planner spawn, the streamed reply, the parse into three files.
**Accepted when:** (1) a real `claude` planner runs an interview end to end on the reference
machine and the three files validate; (2) its argv is asserted element by element with no shell
anywhere; (3) malformed output is reported with the line it failed on and writes nothing; (4) the
planner appears on the floor as an ordinary session.

**Done, 14 September 2026 — three of the four met, and the fourth is owed.**
`src/studio/briefs/planner.md` (the brief, shipped in the package), `src/studio/brief.mjs` (which
fills its schemas from `schema.mjs` rather than from a hand copy), `POST /api/studio/plan`, the
three artefacts in the panel above the transcript, and `⌘K`'s `Studio: plan this project`.

(2) `test/integration/studio-plan.test.mjs` compares the launch's `command` to
`['claude', '--append-system-prompt-file', <brief>, <one fixed sentence>]` element by element;
`newSessionCommand()` in `src/adapters/claude-code/adapter-open.mjs` is the pure function it comes
from. (3) A fixture planner writes a `roster.json` with a policy the schema does not know; the
snapshot's new `problems` list names the file, the line and the reason, carries no roster, and the
file on disk is untouched. (4) **Measured against a real binary**: a real `claude` started by this
route was found by the ordinary scan and recorded by its id
(`docs/DEVIATIONS.md` §159.1). (1) **Not met.** The stored login on the reference machine is
expired — the same gap §117 and §97.5 record — so no interview has been run and no planner has
written a `blueprint.md`. What has been run is everything up to the API call: the brief renders at
8,548 bytes, the flag is accepted, the argv is what reaches the binary, and the session lands on
the floor. One `claude login` closes it.

Nine places the code differs from this document are in §159.4 with their reasons; the sharpest are
that `/plan` answers **409** rather than WP-66's 403 without consent, and that the artefact "watch"
is a re-read on every `GET /api/studio` rather than a watcher — there is no cache to go stale and,
more to the point, no watcher that could ever write a file back. §9 invariant 3 (*brief files are
the user's*) landed here rather than in WP-68, because this package writes a brief.

### WP-68 · Roster and Hire · `AB` · L · P3 · after WP-67 · **DONE**

The roster editor's server half, `git worktree add`, the brief file, the spawn, the role→`agentId`
record.
**Accepted when:** (1) hiring three roles gives three worktrees, three briefs and three sessions on
the floor within one scan, each wearing its role name; (2) `git worktree` takes an argv array and a
role name with a space, a quote or a `;` is refused rather than escaped; (3) a runtime with no
`openNewSession` is refused with a named reason; (4) firing leaves the worktree and the process
alone, and says so.

**Met:** all four, and (1), (2) and (4) against the owner's real `claude` 2.1.260 as well as against
the fake-CLI fixture. `docs/DEVIATIONS.md` §188 records the run: two worktrees, two briefs, two real
sessions, and both ids written into `roster.json` by the ordinary scan.

**Deviations, and the reason for each:**

- **The interview behind a hired role has still not been measured.** The two real sessions both
  answered `OAuth session expired and could not be refreshed` — §159.1's standing condition, and
  §117 before it. Everything up to the API call is real; what is owed is one `claude login`.
- **The roster editor is the server half only.** `POST /api/studio/roster` validates and writes with
  the path and the line of anything it refuses, and `GET /api/studio` reports every role with what
  the file cannot say — `live`, `runtime`, `unverified`, `hireable` and the refusal. There is no
  roster *screen*: the palette hires, the panel lists, and a role is edited by editing `roster.json`,
  which the panel opens in the user's editor. §4 makes roles the user's property and the file says
  DeckHQ never rewrites them, so a form over it would have been a second place a role lived.
- **`roster.json` gained no `runtime` field.** A runtime is a launch decision, not a property of a
  role, so an unhired role honestly reports `runtime: null` and a hired one reports what the
  registry says its session actually is.
- **A Hire writes no card and moves no column.** It picks up the first unfinished card already
  assigned to the role and names it in the brief. `POST /api/studio/card` is still the only writer
  of a column, and `test/unit/studio-invariant.test.mjs` still fails on a second one.
- **`POST /api/studio/hire` keeps a runtime default** — §4's contract is `{ role }` on its own —
  but every caller in `public/` names one, and WP-92j's client grep gate holds it to that.

### WP-69 · The board tab, and card → session · `PE` + `UX` · L · P3 · after WP-66

The kanban, the table beneath it, drag and keyboard moves, card selection lighting a desk.
**Accepted when:** (1) every card is reachable and every move performable from the keyboard, and a
screen reader reads the columns in board order; (2) a session ending, a hook arriving and a scan
completing move no card, as an `INVARIANT:` test; (3) drag-to-Ready with no assignee asks and never
guesses; (4) a screenshot in all three themes is in the PR.

### WP-70 · Handover and the review gate · `PE` · M · P3 · after WP-68, WP-69

The watcher, the handover in the review card, Accept and Bounce, the note in the next brief.
**Accepted when:** (1) a file written by a real hired session raises the review card within one
watch event and moves no card; (2) Accept is the only path from a handover to a column change; (3)
a handover for an unknown card id is shown unattached, not dropped; (4) test counts render as a
quotation attributed to the handover, asserted by a copy test.

### WP-71 · Tracking, drift, and the budget stop · `AR` · M · P3 · after WP-70

The per-card ledger fold, the burn-down, the PM pass, the cap.
**Accepted when:** (1) every figure traces to a ledger record or a handover line, and a card with
no records reads `no data`; (2) every cost figure carries the dated rate card and an unpriceable
model prints no number; (3) a flag produces a review card and changes no board state; (4) a card
crossing its cap moves only to `blocked`, stops further sends, posts exactly one message, and kills
nothing.

**Free or Supporter.** Owner's decision (§11.8). **Default: all of Studio is free**, consistent
with `08` §1.1 rule 2 — nothing that captures, queues or acts has been gated, and a board that
spawns real sessions is all three.

## 11. Open questions for the owner

**All eight were decided on 8 September 2026: the owner approved every recommended default, and
the name is Studio.** They are kept here with their reasoning, because the reasoning is what a
later package has to honour. `docs/plan/08-PLAN-V2-100X.md` §13.20 records the decision.

1. **The name.** Studio, Workshop or Bureau. *Default: Studio, settled before WP-66 writes a
   directory name.* **Decided: Studio.**
2. **Where worktrees live.** *Default: `<state dir>/worktrees/<project>-<role>`, so removal knows
   what it made and the user's repository gains no untracked directory.*
3. **Whether `.deckhq/studio/` is gitignored by default.** *Default: no — it is a plan a team
   should be able to commit, and writing to a `.gitignore` is a second consent.*
4. **The PM pass interval, and whether it runs with no tab open.** *Default: 30 minutes, and yes —
   it produces a review card, which already works with the tab closed.*
5. **What a budget cap counts.** *Default: tokens at the dated rate card plus wall time between
   column moves; both shown, either trips the stop.*
6. **Whether Studio may hire an unverified runtime.** *Default: yes, with the limitation on the
   card — refusing would turn the honesty rule into a gate.*
7. **How many roles one Hire may spawn at once.** *Default: 6, with a warning above it.*
8. **Free or Supporter** (§10). *Default: free.*

## 12. Prior art

- **`agents-office`** — a dispatcher over a fictional roster with simulated tasks, PolyForm
  Noncommercial. Ideas only, no code, and its simulated feed is what §1 refuses.
- **The loop-factory spec pattern** — specs moving `inbox → active → archive` behind a review
  gate. The shape §5 and §6 borrow: a file is the unit of work, and a gate is a person.
- **Codex `--full-auto`** — the opposite trade, and the reason §8's stop is honest about what it
  cannot do: an unsupervised loop is what a board with a review gate exists to replace.
