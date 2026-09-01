# DeckHQ — Blueprint

**Command deck for every agent session on your machine.**

Hand this directory to the delivery orchestrator. It is complete. Read in order.

| Doc | Contains | Read it before |
|---|---|---|
| [01-PRODUCT.md](01-PRODUCT.md) | The problem (measured), the invariant, the six-state model, the feature list, what is explicitly out of scope, success criteria, commercial position | Anything |
| [02-ARCHITECTURE.md](02-ARCHITECTURE.md) | Process model, the `RuntimeAdapter` contract, data model, state determination, the full HTTP API, hook installation, persistence, performance budgets, security | Writing any code |
| [03-VISUAL-SPEC.md](03-VISUAL-SPEC.md) | Camera and LOD bands, the character rig, all 16 motion clips, state-to-visual mapping, materials, interaction, notifications, accessibility. **§2 (floor generation) is superseded by 05.** | Writing any renderer code |
| [05-LAYOUT-REWORK.md](05-LAYOUT-REWORK.md) | WP13. Replaces the floor-plan algorithm: screen-shaped floor, furniture-derived rooms, anchored props, magnify-only zoom | Touching `public/render/plan.js` |
| [04-BUILD-PLAN.md](04-BUILD-PLAN.md) | Team roles, 13 work packages with acceptance criteria, dependency graph, critical path, the acceptance script, standing rules | Assigning work |
| [DEVIATIONS.md](DEVIATIONS.md) | Every departure from the blueprint, with its reason and measured numbers, plus the tech lead's decisions closing each one | Reviewing the build, or reading a spec that the code appears to contradict |

Overview for review and sharing:
<https://claude.ai/code/artifact/bfdd12b9-538b-47ea-b985-ffb8a6eb9da1>

## The one rule

`activity_state` is observed. `ack_state` belongs to the user. **No code path may let an observed
event clear a user-owned state.** Opening a conversation does not clear it; only a button press
does. Everything else in these documents is detail. This is the product.

## If something is not specified

Raise it with the orchestrator. Do not decide it, and do not build around it. These documents were
written so that no implementation decisions remain; a gap is a defect in the spec, and a wrong
guess costs more than a question.

## Status of existing code

`reference/` (after WP0) holds the working prototype that validated the idea against real data:
session discovery, transcript parsing, the ack model, and the Studio renderer. **It is reference,
not foundation.** Consult it freely; do not build on it.
