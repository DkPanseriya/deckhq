# DeckHQ — Product Specification

**Status:** approved for build · **Version:** 1.0 · **Audience:** the delivery team

This document defines *what* is being built and *why*. Every decision in it is settled.
Nothing here is a suggestion. If an implementation question is not answered by this document
or by `02-ARCHITECTURE.md` / `03-VISUAL-SPEC.md`, treat it as a defect in the spec and raise it —
do not decide it silently.

---

## 1. The problem

A developer running many Claude Code sessions across many repositories loses sessions.

Not "loses" as in crashes. Loses as in: Claude finishes a turn, asks a question, and the
developer reads the answer, thinks *I'll come back to that*, opens another terminal, and never
returns. The session sits there. The runtime believes it is finished. The developer has no
record that anything is outstanding.

This was measured, not assumed. On the reference machine at the time of writing:

- **15 project directories**, **52 recorded sessions**, **4 sessions running concurrently**
- Oldest live session untouched for **20 hours**
- One project (`career-ops`) alone held **21 sessions**

The existing tools cannot fix this, because all of them derive their queue from runtime state.
Once the agent goes idle the item is "complete" and disappears — including in Claude Code's own
`claude agents` view, and in every third-party manager surveyed (Paseo, cmux, Conductor, CLAW3D,
Pixel Agents). Manual mark-as-unread exists in several, and in every one the derived bucket still
overrides the human flag.

> **Amendment, 2 Sep 2026 (product owner) — the problem above is stated too narrowly.**
>
> Losing a session is the sharpest symptom, and §2 is the mechanism that fixes it, but neither is
> the product. The product is **a place to run an AI workforce across many projects at once.**
>
> The user is an entrepreneur or builder with several things in flight. Their agents are spread
> over a dozen terminals in a dozen repositories, and no surface exists that shows the whole team
> at once: who is working, who is blocked, who finished and is waiting, who is idle and available,
> and what each project is costing. They manage that workforce by alt-tabbing and remembering.
>
> DeckHQ's answer is to make the workforce a *place* — rooms for projects, people for sessions —
> so that managing it uses the intuitions anyone already has about a room full of people, rather
> than a list nobody reads. Everything in §4 and §5 already serves that reading: project rooms
> that grow with headcount, per-project token plates, the lounge as visible spare capacity,
> furniture that launches the project it belongs to, dispatching new work into a room.
>
> The invariant in §2 is not demoted by this. It is what makes the office *honest* — an office
> that forgets who is waiting on you is worse than a list. It is the mechanism, not the pitch.

## 2. The invariant

> **What the user owes is decided by the user, never by the runtime.**

`activity_state` is *observed*. It changes on its own: a session starts, produces output, blocks,
goes quiet, exits.

`ack_state` is *owned by the user*. It changes only when the user acts.

The waiting area in the user's office renders `ack_state`. **No code path may allow an observed
state change to remove an item from it.** Opening a conversation does not clear it. Scrolling past
it does not clear it. Only an explicit action does.

Any implementation that violates this has rebuilt a tool that already exists and failed.

## 3. Who it is for

An entrepreneur, indie builder or solo developer with **several projects in flight at once**,
running 5–25 concurrent agent sessions across unrelated repositories on one machine. They are the
only manager their AI team has, and the constraint on how much they can ship is how much of that
team they can hold in their head at one time.

They live in terminals, and they want one surface that answers, in under two seconds:

- **Is anything waiting on me right now?** — the question §2 exists to answer honestly.
- **Who is working, and on what?**
- **Who is free to take the next job?**
- **Which project is eating my quota?**

They are not looking for a metaverse, a team presence tool, or a chat product. They are looking
for the thing a manager gets for free by walking onto a floor and looking around.

## 4. The model

The office is a metaphor with exactly one job: make agent state legible at a glance and pleasant
to look at. Every visual element maps to a real state. Nothing is decorative-only.

### 4.1 Where an agent lives

A **session** belongs to a **project**, determined by its working directory. Every session in a
project sits at that project's tables — whether it is currently running or not. A project room is
a team room.

An agent leaves its project room in exactly two ways:

1. **It finishes a turn.** It stands up, walks to the user's office, and waits there for review.
2. **The user benches it.** After review, if the user has no further work, they send it to the
   lobby to rest. It can be recalled to its desk at any time.

### 4.2 The six states

| State | What it means | How it is entered | Where the agent is | What the user sees |
|---|---|---|---|---|
| `working` | Live and producing output | Session running, output within the stall window | At its project desk | Typing, occasional coffee, thinking poses |
| `needs_input` | Live, blocked on a question or permission request | Hook fires `Notification` (permission or idle prompt) | **Stays at its desk** | **Raises a hand**, pulsing ring |
| `stalled` | Live but silent longer than the stall window | No output for N minutes (default 10) | At its desk | Slumped pose, amber marker |
| `for_review` | Finished a turn, awaiting the user | Hook fires `Stop`, or turn end detected | **Walks to the user's office** | Standing in the waiting area with a waiting-time badge |
| `benched` | Reviewed, no work assigned, available | **User action only** | Lobby / break / kitchen | Pool, table tennis, board games, arcade, coffee, eating, talking |
| `let_go` | Removed from the floor | **User action only** | Off floor | Hidden unless "Show let go" is on |

**The two "needs you" signals are deliberately different.** A raised hand at a desk means *I am
mid-task and blocked*. A person standing in your office means *I finished; review this*. Those
require different responses from the user, so they must look different and be counted separately.

`working`, `needs_input`, `stalled` and `for_review` are **observed**. `benched` and `let_go` are
**user-owned**. `for_review` is entered automatically but can only be *left* by a user action —
this is the invariant in §2 and is the single most important behaviour in the product.

### 4.3 The floor

- **The user's office** — enclosed, top-left corner. Contains the user's desk and a waiting area
  where `for_review` agents stand, ordered oldest-first.
- **Project rooms** — one per project with sessions. Contains benches (8 seats each) and a
  whiteboard showing that project's live counts and token total. **The room grows**: a project
  with 21 sessions gets three benches and a larger room. Nothing is hidden behind a "+13" marker.
- **The lounge** — a single large open room combining lounge, games area and kitchen. This is
  where benched agents rest. It contains sofas, a coffee table and rug, a pool table, a table
  tennis table, a board-game table, an arcade cabinet, a kitchen counter with coffee machine, and
  a dining table.

The lounge is not filler. A benched agent is *available capacity*, and the product should make
that read as a good thing rather than as waste. Watching them enjoy themselves is a deliberate
reward for having cleared your queue.

## 5. Features

### 5.1 Must ship in v1

| # | Feature | Why it exists |
|---|---|---|
| F1 | Discover every Claude Code and Codex session on the machine, grouped by project | The product is worthless if any session can escape it. An inbox is worth exactly its capture rate. |
| F2 | Session names taken from the user's own chat titles | The user names sessions by task. Generated IDs are meaningless to them. |
| F3 | Six-state model with the placement rules in §4 | The core model. |
| F4 | User's office waiting area, oldest first, with waiting-time badges | The thing that stops sessions being lost. |
| F5 | Acknowledge / bench / recall / let go / mark-for-review | The user-owned half of the state model. |
| F6 | Open any session's real conversation in a side panel | You cannot triage what you cannot read. |
| F7 | Reply to a session, or dispatch new work to a benched agent | Turns a dashboard into a work surface. |
| F8 | Open a session in a real terminal | The escape hatch. Some work belongs in a terminal and the product must not pretend otherwise. |
| F9 | Per-project and per-session token accounting | "Which project is eating my quota" is a real, unanswered question. |
| F10 | OS notification + tab badge when a session starts needing the user | The window will be buried behind terminals. Without this the product does not deliver its promise. |
| F11 | Opt-in hook installation with a clear consent screen and clean removal | Exact, instant state, and the only way `stalled` and `needs_input` can be distinguished. |
| F12 | Zoom control, and an animated close-up of the selected agent | Reconciles glanceability with watching the office live. |
| F13 | Full character animation set (§3 of the visual spec) | The reason a person opens this instead of reading a list. |
| F14 | First-run onboarding explaining the state model in under 60 seconds | The model is the product. If it is not understood, nothing else matters. |

### 5.2 Explicitly out of scope for v1

Do not build these. They are listed so that nobody has to ask.

- **Deployment or CI triggering.** Highest blast radius, least standardisation.
- **A manager agent that assigns work down a hierarchy.** Measured failure rates of 41–86% across
  seven frameworks. The user's office is a queue, not an LLM.
- **Cross-project agent-to-agent handover.** Planned for v2; the plumbing exists in Claude Code
  already. Not in v1.
- **Multi-machine or remote sessions.** Local only.
- **Multi-user / team presence.** One human per install.
- **Accounts, billing, licensing, telemetry.** None. See §7.
- **Additional skins.** Studio is the only renderer. Pixel, Isometric and Blueprint are removed
  from the codebase in v1 — see `04-BUILD-PLAN.md` WP0.
- **Cloud sync or hosted history.**

## 6. Success criteria

The product works if, after two weeks of the author's own use:

| Metric | Target |
|---|---|
| Sessions sitting in `for_review` longer than 24h | **0**, sustained |
| Median time from entering `for_review` to being discharged | Falling week over week |
| Share of new sessions dispatched from the office rather than a terminal | > 40% |
| Days the office is opened without being prompted | > 5 of 7 |
| Sessions that exist on disk but never appear on the floor | **0** — capture is absolute |

If the first metric does not reach zero, the product has failed regardless of how good it looks.

## 7. Commercial position

**MIT licensed, free, no billing, no accounts, no telemetry of any kind.** Nothing phones home.

This is a deliberate decision against monetising v1: every competitor in this category is free,
and the best-known one (vibe-kanban) reached 27,900 GitHub stars and still shut down for lack of a
business model. The value of v1 is the tool itself and the demonstration of capability.

The door is kept open: the daemon and the browser client communicate only over the documented HTTP
API in `02-ARCHITECTURE.md`. A hosted or team tier could be added later behind that boundary
without a rewrite. **Do not write any commercial code in v1** — no licence checks, no analytics,
no "pro" flags.

## 8. Distribution

`npx deckhq` starts the daemon and opens the browser. That is the entire install story.

- Node 18+, no native modules, no build step required to run from source.
- Published to npm as a public package.
- Works on Windows, macOS and Linux. Windows is the primary development target because it is the
  author's machine and is the platform most tools in this category neglect.

## 9. Runtime support

v1 supports **Claude Code** and **OpenAI Codex**.

Two adapters, not one, because a single-adapter product is exactly what a first-party feature can
obsolete — there is already an open request on the Claude Code tracker for a cross-session
attention inbox. Two adapters also force the adapter interface to be honest rather than a thin
wrapper around one tool's internals.

Two, not four, because each adapter is permanent maintenance against an undocumented format.
Gemini/Antigravity and Cursor are v2 candidates and the interface must accommodate them without
modification.
