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
| [08 · Plan v2, the 100× plan](08-PLAN-V2-100X.md) | Where the product is, the thesis, standing rules, the fatal risk, the bets, marketing, money, distribution, dopamine, GUI, WP-36 to WP-49, phases, metrics, handovers, owner decisions | orchestrator |
| [01 · Audit](01-AUDIT.md) | What was wrong on 2 September, ranked, with file references; a status block says what has closed since | orchestrator |
| [02 · Market and launch](02-MARKET-AND-LAUNCH.md) | Who else exists, the gaps, positioning, launch assets, risks. Launch waves now live in `08` §4.3 | Product Manager |
| [03 · Business model](03-BUSINESS-MODEL.md) | How this earns money without ever gating the local product; timing and the BYOS tier per `08` §5 | orchestrator + Architect |
| [04 · Engagement and gamification](04-ENGAGEMENT-AND-GAMIFICATION.md) | The core loop, shareable artifacts, attachment, the interruption budget, the three mechanics we refuse to build | UI/UX |
| [05 · GUI and UX spec](05-GUI-UX-SPEC.md) | Visual identity, the three-level hierarchy, the review card, floor fixes, sound, motion, accessibility, copy | UI/UX |
| [06 · Engineering work plan](06-ENGINEERING-WORKPLAN.md) | 48 work packages with owners, dependencies, effort and acceptance criteria | orchestrator |
| [07 · Agent handovers](07-AGENT-HANDOVERS.md) | A copy-paste brief per agent, with its packages and the rules that reject a PR | orchestrator |
| [Release checklist](RELEASE-CHECKLIST.md) | The by-hand steps for cutting a release, until WP-43 automates them | Product Manager |

## The thesis in five lines

1. Publish today, then never let a human be the release step again.
2. The viral primitive is a number, not a picture: `npx deckhq doctor`.
3. Live where the user already lives: status line, plugin, VS Code, a floating mini-floor, a terminal list.
4. Approve from here is the keystroke that justifies everything, and the paid tier.
5. Sell storage and reach, never the floor.

> **DeckHQ is not a place to watch your agents. It is the place your agents come to find you.**

The floor earns the screenshot. The deck does the job. The number does the spreading.

## What to do first

`npm view deckhq` returns `1.2.0` as of 3 September. What is left of P0, in order: make `main`
green (WP-51), the GitHub Release and repository settings (`RELEASE-CHECKLIST.md` steps 12–13),
the trusted publisher on npmjs.com so the next tag publishes itself, then WP-36, WP-44, WP-03,
WP-04. No performance or refactoring work until those are accepted (`08` §0.1).

## Relationship to the blueprint

`docs/01-PRODUCT.md` through `docs/05-LAYOUT-REWORK.md` remain authoritative for what DeckHQ
**is**. This directory covers what happens **next**. Where they disagree, the blueprint wins on
the model and this plan wins on the interface, with one exception that outranks both:
**`docs/01-PRODUCT.md` §2, the invariant, is inviolable.**
