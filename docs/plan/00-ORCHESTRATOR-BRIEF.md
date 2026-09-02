# 00 — Orchestrator brief

**Date:** 2 September 2026 · **Owner:** orchestrator · **Status:** the plan of record

This is the top of the tree. Every other document in `docs/plan/` implements a section of it.
If a decision below conflicts with a downstream document, this one wins; if it conflicts with
`docs/01-PRODUCT.md` §2 (the invariant), **the invariant wins and this document is wrong.**

---

## 1. Where we actually are

DeckHQ is a 9/10 engine in a 2/10 car.

The engine: a zero-dependency local daemon that reads every Claude Code transcript on disk,
merges hook events and polling into a six-state model, and enforces one rule nobody else
enforces — *what you owe is decided by you, never by the runtime*. 327 tests. Three-OS CI. A
1,395-line log of every wrong turn taken and measured. A CSRF hole found and closed before
release. No network egress at all.

The car: `npx deckhq` returns **404 from the npm registry**. Zero stars. Zero releases. Default
grey social card. The macOS terminal path has never been run. On a real machine the floor is
mostly empty carpet with 12-pixel people on it, and the busiest room is the lounge — where
nothing is happening.

Full evidence: [`01-AUDIT.md`](01-AUDIT.md).

## 2. The thesis

Every competitor is in one of two camps, and both camps have a fatal flaw.

**Orchestrators** — vibe-kanban (28.0k stars), cmux (26.6k), Conductor, Superset (13.5k),
Emdash — spawn and own the agents. They are powerful, and they **only see what they spawned**.
They are also almost all macOS-only. The category leader shut down on 10 April 2026 with 28,000
stars and 30,000 monthly actives, because "the vast majority are free users and we couldn't find
a business model."

**Visualisers** — Pixel Agents (9.0k stars, 83k VS Code installs), claude-office (507), Claw3D
(2.2k) — make agents pretty. They go viral on X and they take no actions. The critique that
stuck, in Fast Company's coverage and on Hacker News, is that they are *"observational theater"*
and that they make you watch more, not less: *"I ended up babysitting parallel agents more than
coding."*

DeckHQ is neither, and this is the whole bet:

> **DeckHQ is not a place to watch your agents. It is the place your agents come to find you.**

The office metaphor is not decoration. An office is the building where a manager's debts
accumulate whether or not the manager is looking. That is the product.

## 3. The three moats

Each is a verifiable technical fact, not a claim. Each is a demo.

### M1 — Absolute capture

Claude Code shipped its own agent view on 11 May 2026. Its documentation states the limit
plainly: *"Interactive sessions you have open in other terminals don't appear until you
background them."* The Desktop sidebar shows only sessions the app launched. Every orchestrator
in §2 sees only what it spawned.

DeckHQ reads `~/.claude/projects/**/*.jsonl` from disk. It sees **every session that has ever
existed on the machine**, whoever started it, in whatever terminal, alongside Codex, with no
opt-in and no configuration.

*The launch screenshot is this comparison, side by side.* `claude agents` showing 3. DeckHQ
showing 51, 7 of them waiting on you, oldest 26 hours.

### M2 — The invariant

Every first-party surface and every competitor derives its queue from runtime state. The moment
the process goes idle the item reads "completed" and leaves the list. Claude Code issue #36885
("no way to know which session is blocked") was closed **not planned** on 26 May 2026.

DeckHQ separates `activityState` (observed, the runtime's) from `ackState` (owned, yours).
Opening the conversation does not clear it. Reading it does not clear it. Only a button does.
There is a named test that fails if anyone breaks this.

This is the only thing in the product that cannot be copied by shipping a nicer list.

### M3 — Cross-runtime, cross-platform, zero-egress

cmux, Conductor, Superset, Intent and the Codex app were all Mac-first. DeckHQ was built on
Windows and CI-tested on three platforms. Windows users of Claude Code are served by tmux
wrappers under WSL and nothing else.

And on privacy: Conductor's top Hacker News complaint was *"Zero disclosure of data
practices… a show-stopper."* vibe-kanban's launch thread was dominated by default-on analytics.
DeckHQ makes **no outbound network calls of any kind** and has a CSP that forbids them. That is
a differentiator we can put in the headline, and it must survive monetisation.

## 4. The fatal risk, named

The floor is beautiful, and beauty in this category has a specific failure mode: it increases
watching. If DeckHQ becomes a thing people leave open and stare at, we have built Pixel Agents
with better rendering, and we will get the same review.

**Countermeasure, binding on every downstream document:** the product's job is to let you *stop*
watching.

- It must reach you when the tab is closed (tray badge, OS notification, later a phone push).
- When you come back, it must let you discharge one item in **one keystroke** with everything you
  need to decide already on screen.
- It must send you a daily card so that not looking is safe.
- Every feature proposal is scored against: *does this reduce the time the user must spend
  looking at DeckHQ per unit of agent output?* Features that only increase dwell time are
  rejected, however pretty.

The floor earns the screenshot. **The deck does the job.** See [`05-GUI-UX-SPEC.md`](05-GUI-UX-SPEC.md) §3.

## 5. North-star metrics

| Metric | Now | 3 months | 6 months | 12 months |
|---|---|---|---|---|
| npm weekly downloads | 0 (unpublished) | 3,000 | 12,000 | 40,000 |
| GitHub stars | 0 | 4,000 | 12,000 | 30,000 |
| Daemon D7 (opens ≥4 of 7 days) | — | 25% | 35% | 40% |
| Median time an item sits in `for_review` | unmeasured | measured | falling weekly | < 2h |
| Items sitting > 24h across all users | unmeasured | tracked | → 0 | 0 |
| Paid conversion (of monthly actives) | n/a | n/a | 1.5% | 2.5% |
| ARR | $0 | $0 | ~$15k | ~$150k |

The fourth and fifth rows are the product working. The first two are the product being found.
If stars go up and row four does not fall, we have built theater and the plan has failed.

## 6. The five phases

Full work packages in [`06-ENGINEERING-WORKPLAN.md`](06-ENGINEERING-WORKPLAN.md).
Copy-paste briefs per agent in [`07-AGENT-HANDOVERS.md`](07-AGENT-HANDOVERS.md).

| Phase | Window | Theme | Ships | Gate to next |
|---|---|---|---|---|
| **P0 Unblock** | Week 1 | It exists | npm publish, GitHub release, hero GIF, social card, macOS/Linux terminals, capture-proof command | `npx deckhq` works on a clean Mac and a clean Windows box |
| **P1 The wedge** | Weeks 2–4 | It does the job | Review card, Deck view, ⌘K palette, coach-mark onboarding, snapshot PNG, sound, floor legibility | A stranger triages 5 sessions in 60s without instruction |
| **P2 The habit** | Weeks 5–8 | It comes back to you | Event ledger, daily postcard, tray/OS notifications, permission approval in-panel, agent identity | D7 ≥ 25% on instrumented opt-in cohort |
| **P3 The spread** | Weeks 9–12 | Everyone's runtime | Codex verified, Gemini CLI + OpenCode adapters, weekly Wrapped, layout packs, docs site | 3 runtimes on one floor; 3 launch posts shipped |
| **P4 The money** | Months 4–6 | Relay | E2E relay, phone PWA, push on hands-up, paid tier live | 1.5% conversion at $9/mo |
| **P5 Teams** | Months 6–12 | Seats | Shared floor, SSO, audit, per-room budgets | First 10 paying teams |

**P0 is not optional and nothing else starts until it lands.** Every hour spent on gamification
while the package 404s is an hour wasted.

## 7. Standing rules for every agent on this plan

1. **The invariant is inviolable.** `docs/01-PRODUCT.md` §2. No observed event may clear a
   user-owned state. There are named `INVARIANT:` tests; a change that needs them relaxed is the
   wrong change. This rule outranks everything in this plan.
2. **The free core stays MIT, local, and egress-free.** No analytics, no update checks, no CDN
   assets, no telemetry — ever, including after we start charging. Paid features are *services
   you opt into*, never gates on the local UI. This is a moat, not a nicety; see §3 M3.
3. **No runtime dependencies in the core.** Dev dependencies are fine. A new runtime dependency
   needs the orchestrator's written approval and a line in the changelog explaining it.
4. **Capture beats features.** If the choice is between a feature and guaranteeing every session
   appears, capture wins.
5. **Every feature is scored against §4.** Does it reduce time-spent-looking per unit of agent
   output? If it only increases dwell time, it does not ship.
6. **Never score the human.** Agents can have traits, names and histories. The user never has a
   streak, a level, a badge or a guilt message. Rationale and evidence in
   [`04-ENGAGEMENT-AND-GAMIFICATION.md`](04-ENGAGEMENT-AND-GAMIFICATION.md) §5.
7. **Cost is an estimate, never a bill.** Labelled as such everywhere it appears.
8. **All runtime format parsing stays inside its adapter.**
9. **Every deviation from a plan document gets a numbered entry in `docs/DEVIATIONS.md`** with
   its reason and its measurement. That log is the best thing in this repository and it is also
   our content pipeline.
10. **Nothing ships without a screenshot.** The three worst bugs in the project's history
    (DEVIATIONS §16, §35, §52) were invisible to 327 unit tests and obvious in one PNG.

## 8. The one-sentence pitch, for reuse everywhere

> **DeckHQ** — every AI coding session on your machine, on one office floor. It sees the ones
> your terminal forgot, and it remembers what's waiting on you even after you've read it.
> `npx deckhq`. Local, private, MIT.

## 9. Document map

| Doc | Answers | Primary owner |
|---|---|---|
| [`01-AUDIT.md`](01-AUDIT.md) | What is wrong today, ranked, with file references | orchestrator |
| [`02-MARKET-AND-LAUNCH.md`](02-MARKET-AND-LAUNCH.md) | Who else exists, how we're positioned, how we launch and go viral | Growth |
| [`03-BUSINESS-MODEL.md`](03-BUSINESS-MODEL.md) | How this earns money without breaking rule 2 | orchestrator + Architect |
| [`04-ENGAGEMENT-AND-GAMIFICATION.md`](04-ENGAGEMENT-AND-GAMIFICATION.md) | Retention, dopamine, sharing, and the three things we refuse to build | UI/UX |
| [`05-GUI-UX-SPEC.md`](05-GUI-UX-SPEC.md) | The interface, screen by screen, with tokens and interactions | UI/UX |
| [`06-ENGINEERING-WORKPLAN.md`](06-ENGINEERING-WORKPLAN.md) | 34 work packages, dependencies, acceptance criteria | orchestrator |
| [`07-AGENT-HANDOVERS.md`](07-AGENT-HANDOVERS.md) | Copy-paste brief per agent, with its packages and its rules | orchestrator |
