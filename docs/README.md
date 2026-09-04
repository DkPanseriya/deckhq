# DeckHQ — Blueprint

**Command deck for every agent session on your machine.**

**This directory is written for the people building DeckHQ.** If you are here to *use* it, the
documentation site is what you want: `node site/build.mjs --serve`, or the deployed copy once the
owner has enabled Pages. It has install, the model in 60 seconds, hooks, privacy, adapters, an FAQ,
and `DEVIATIONS.md` rendered as an engineering log.

The blueprint below is complete. Read in order.

| Doc | Contains | Read it before |
|---|---|---|
| [01-PRODUCT.md](01-PRODUCT.md) | The problem (measured), the invariant, the six-state model, the feature list, what is explicitly out of scope, success criteria, commercial position | Anything |
| [02-ARCHITECTURE.md](02-ARCHITECTURE.md) | Process model, the `RuntimeAdapter` contract, data model, state determination, the full HTTP API, hook installation, persistence, performance budgets, security | Writing any code |
| [03-VISUAL-SPEC.md](03-VISUAL-SPEC.md) | Camera and LOD bands, the character rig, all 16 motion clips, state-to-visual mapping, materials, interaction, notifications, accessibility. **§2 (floor generation) is superseded by 05, and again by WP-50 and WP-55; §3's appearance rule is superseded by WP-20** — both say so in place | Writing any renderer code |
| [05-LAYOUT-REWORK.md](05-LAYOUT-REWORK.md) | WP13. Replaces the floor-plan algorithm: screen-shaped floor, furniture-derived rooms, anchored props, magnify-only zoom. **§3's first two acceptance items are superseded by WP-55** — the building is the size of its contents and no longer fills the stage | Touching `public/render/plan.js` |
| [04-BUILD-PLAN.md](04-BUILD-PLAN.md) | Team roles, 13 work packages with acceptance criteria, dependency graph, critical path, the acceptance script, standing rules | Assigning work |
| [ADAPTERS.md](ADAPTERS.md) | How to add a runtime: the `RuntimeAdapter` contract in practice, the stability rules, a worked example end to end, the fixture convention, the hooks bar, and the honesty rule — an adapter is unverified until it has run against real data and must say so | Writing or reviewing an adapter |
| [DEVIATIONS.md](DEVIATIONS.md) | 112 numbered departures from the blueprint, each with its reason and its measured numbers, plus the decision closing it. Append-only; the orchestrator numbers it | Reviewing the build, or reading a spec that the code appears to contradict |

What happens **next** — distribution, the interface redesign, retention, the business — is in
[`plan/`](plan/README.md), starting with [`plan/08-PLAN-V2-100X.md`](plan/08-PLAN-V2-100X.md).
This directory covers what DeckHQ **is**; that one covers what it becomes.

## The one rule

`activity_state` is observed. `ack_state` belongs to the user. **No code path may let an observed
event clear a user-owned state.** Opening a conversation does not clear it; only a button press
does. Everything else in these documents is detail. This is the product.

## If something is not specified

Raise it with the orchestrator. Do not decide it, and do not build around it. These documents were
written so that no implementation decisions remain; a gap is a defect in the spec, and a wrong
guess costs more than a question.

## Status of existing code

`reference/` held the working prototype that validated the idea against real data: session
discovery, transcript parsing, the ack model, and the Studio renderer. It was reference, never
foundation, and was removed from the tree when the project was opened up. It remains in git
history at tag `v1.0.0` for anyone who wants to read it.
