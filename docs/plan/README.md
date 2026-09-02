# DeckHQ — the growth plan

Written 2 September 2026, after a full read of the codebase, the blueprint, the 1,395-line
deviations log, 327 passing tests, the live product on a real machine, and research into the
competitive landscape, monetisation and engagement mechanics in this category.

**Start with [`00-ORCHESTRATOR-BRIEF.md`](00-ORCHESTRATOR-BRIEF.md).** It is the plan of record;
everything else implements a section of it.

| Doc | Answers | Owner |
|---|---|---|
| [00 · Orchestrator brief](00-ORCHESTRATOR-BRIEF.md) | The thesis, the three moats, the fatal risk, north-star metrics, five phases, standing rules | orchestrator |
| [01 · Audit](01-AUDIT.md) | What is wrong today — 22 findings ranked P0–P3 with file references, and a minute-by-minute walkthrough of a new user | orchestrator |
| [02 · Market and launch](02-MARKET-AND-LAUNCH.md) | Who else exists, where the four gaps are, how we position, the four launch waves, named risks | Growth |
| [03 · Business model](03-BUSINESS-MODEL.md) | How this earns money without ever gating the local product | orchestrator + Architect |
| [04 · Engagement and gamification](04-ENGAGEMENT-AND-GAMIFICATION.md) | The core loop, shareable artifacts, attachment, the interruption budget, and the three mechanics we refuse to build | UI/UX |
| [05 · GUI and UX spec](05-GUI-UX-SPEC.md) | Visual identity, the three-level hierarchy, the review card, the floor fixes, sound, motion, accessibility, copy | UI/UX |
| [06 · Engineering work plan](06-ENGINEERING-WORKPLAN.md) | 34 work packages with owners, dependencies, effort and acceptance criteria | orchestrator |
| [07 · Agent handovers](07-AGENT-HANDOVERS.md) | A copy-paste brief per agent, with its packages and the rules that reject a PR | orchestrator |

## The thesis in four lines

Competitors are either **orchestrators** that only see what they spawned (the category leader
shut down in April with 28,000 stars) or **visualisers** that look good and take no actions
(reviewed as "observational theater").

DeckHQ is neither. It reads every session from disk — including the ones Claude Code's own agent
view cannot see — and it holds a queue the runtime is not allowed to clear.

> **DeckHQ is not a place to watch your agents. It is the place your agents come to find you.**

The floor earns the screenshot. The deck does the job.

## The three moats

1. **Absolute capture.** Every first-party surface and every competitor sees only sessions it
   started. We read the disk. The launch asset is that comparison, side by side, on one machine.
2. **The invariant.** `ackState` is yours and the runtime cannot touch it. Nobody else has this,
   and it cannot be copied by shipping a nicer list.
3. **Cross-runtime, cross-platform, zero-egress.** The premium tier of this market is Mac-only
   and single-runtime, and its two loudest launch complaints were both about telemetry.

## What to do first

Nothing in this plan matters until **WP-01** lands: `npx deckhq` currently returns 404 from the
npm registry. Phase 0 is one week and unblocks everything else.

## Relationship to the existing blueprint

`docs/01-PRODUCT.md` through `docs/05-LAYOUT-REWORK.md` remain authoritative for what DeckHQ
**is** — the problem, the invariant, the six-state model, the architecture, and the floor's
materials and rig. This directory covers what happens **next**: distribution, the interface
redesign, retention, and the business.

Where they disagree, the blueprint wins on the model and this plan wins on the interface — with
one exception that outranks both: **`docs/01-PRODUCT.md` §2, the invariant, is inviolable.**
