# DeckHQ — the growth plan

Plan v1 was written 2 September 2026 after a full read of the codebase, the blueprint, the
deviations log, the live product and the competitive landscape. Plan v2 was written 3 September
after re-measuring the product on the reference machine and re-checking the market, and it is now
the plan of record. v1's detailed documents remain the specs v2 builds on; where they have been
updated they say so at the top of the changed section, and the v1 orchestrator brief has been
removed because everything in it that survived is in v2.

**Start with [`08-PLAN-V2-100X.md`](08-PLAN-V2-100X.md).** Everything else implements a section
of it.

| Doc | Answers | Owner |
|---|---|---|
| [08 · Plan v2, the 100× plan](08-PLAN-V2-100X.md) | Where the product is, the thesis, standing rules, the fatal risk, the bets, marketing, money, distribution, dopamine, GUI, WP-36 to WP-58, phases, metrics, handovers, owner decisions. §0 carries a status column measured against `main` on 4 September | orchestrator |
| [01 · Audit](01-AUDIT.md) | What was wrong on 2 September, ranked, with file references; a status block gives F1–F22 one row each, read against `main` on 4 September | orchestrator |
| [02 · Market and launch](02-MARKET-AND-LAUNCH.md) | Who else exists, the gaps, positioning, launch assets, risks. Launch waves now live in `08` §4.3 | Product Manager |
| [03 · Business model](03-BUSINESS-MODEL.md) | How this earns money without ever gating the local product; timing and the BYOS tier per `08` §5 | orchestrator + Architect |
| [04 · Engagement and gamification](04-ENGAGEMENT-AND-GAMIFICATION.md) | The core loop, shareable artifacts, attachment, the interruption budget, the three mechanics we refuse to build | UI/UX |
| [05 · GUI and UX spec](05-GUI-UX-SPEC.md) | Visual identity, the three-level hierarchy, the review card, floor fixes, sound, motion, accessibility, copy | UI/UX |
| [06 · Engineering work plan](06-ENGINEERING-WORKPLAN.md) | 58 work packages with owners, dependencies, effort, acceptance criteria and what has landed | orchestrator |
| [07 · Agent handovers](07-AGENT-HANDOVERS.md) | A copy-paste brief per agent, with what remains of its packages and the rules that reject a PR | orchestrator |
| [Release checklist](RELEASE-CHECKLIST.md) | The by-hand steps for cutting a release, until WP-43 automates them | Product Manager |
| [../06-RELAY-DESIGN.md](../06-RELAY-DESIGN.md) | WP-32/33/34: the relay protocol and its eight design decisions, what it refuses to claim, what is left for the owner. Design only, in `docs/`, not this directory — it is part of what DeckHQ **is** | Architect |
| [../ADAPTERS.md](../ADAPTERS.md) | How to add a runtime: the `RuntimeAdapter` contract in practice, worked example, fixture convention, the honesty rule an adapter must state until run against real data | Writing or reviewing an adapter |

## The thesis in five lines

1. Publish today, then never let a human be the release step again.
2. The viral primitive is a number, not a picture: `npx deckhq doctor`.
3. Live where the user already lives: status line, plugin, VS Code, a floating mini-floor, a terminal list.
4. Approve from here is the keystroke that justifies everything, and the paid tier.
5. Sell storage and reach, never the floor.

> **DeckHQ is not a place to watch your agents. It is the place your agents come to find you.**

The floor earns the screenshot. The deck does the job. The number does the spreading.

## What to do first

**Updated 4 September.** More than thirty packages landed on 3 September, and none of them are
installable:
`npm view deckhq` still returns `1.2.0`, because no tag has been cut since. What is left of P0, in
order:

1. **Get a completed CI run.** The two failures that made `main` red on Ubuntu and macOS are
   fixed in the tree (`DEVIATIONS.md` §114), and **no run has finished for `HEAD`** — every push in
   the merge train cancelled the last one's, so the last completed verdict is the red one from the
   WP-10 merge. Green is a hypothesis until a run says otherwise.
2. **The trusted publisher on npmjs.com**, one time, so a tag publishes itself (`08` §13.1).
3. **One tag**, which is the only proof `publish.yml` and its release job have ever had.
4. **The repository settings** — social preview, Sponsors, Discussions, private vulnerability
   reporting (`RELEASE-CHECKLIST.md` step 13) — and **Pages → Source: GitHub Actions**, without
   which the documentation site is built, tested and reachable by nobody.

Performance work now needs a named budget in `docs/02-ARCHITECTURE.md` §8 and the measurement
showing it is breached (`08` §0.1 as amended); refactoring for its own sake is still refused.

Two things are built and must not be spoken about until they have been run: **WP-19**, answering a
permission prompt from the panel, which has never met a live session, and **WP-04**'s ten
terminals, which no Mac or Linux desktop has launched.

## Relationship to the blueprint

`docs/01-PRODUCT.md` through `docs/05-LAYOUT-REWORK.md` remain authoritative for what DeckHQ
**is**. This directory covers what happens **next**. Where they disagree, the blueprint wins on
the model and this plan wins on the interface, with one exception that outranks both:
**`docs/01-PRODUCT.md` §2, the invariant, is inviolable.**
