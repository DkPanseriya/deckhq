# Four character candidates

`A.png`–`D.png` are full sheets (sizes · states · identity · in situ). `in-situ.png` puts all four
on the same lounge crop from `test/goldens/win32/empty.png` at 1:1, 34 px tall.

## Shared across all four

- **The state colour owns the whole body mass**, head included. The old rig spent head and hair on
  identity and left a coloured waistcoat, which at 22 px reads as a grey blob. Biggest win here.
- **Face = high-contrast pane.** A and B: bright screen, dark mark. C: dark visor, bright mark.
  D: white eyes. All survive 24 px; dark-screen-with-light-mark did not. Below 34 px each glyph
  swaps to one bold form.
- **Over-head badge**, clamped to ≥10 px in screen space (§1.1), drawn last, only for `needs_input` /
  `stalled` / `for_review` (§5). Furniture can never occlude it.
- **Mixed projection** is handled by billboarding: the sprite always faces the camera, never rotates
  with `bodyAngle`, and the contact-shadow ellipse is the only element in the floor's plane — the
  top-down-RPG convention. A is the most jarring (a profile on a plan); D the least (a hovering
  capsule has no ground orientation to contradict).
- **Reduced motion**: every sheet *is* the reduced-motion render — static poses, the hand-raise pulse
  as a static ring. That is the legibility floor, and it holds.
- Pure `Path2D`, no assets, deterministic from the session id; accents reuse `palette-identity.js`.

## A — Side-view robot · cost **M** · rank 4

Optimises a graphic silhouette. Identity: chassis width, head box, chest plate + glyph, antenna
finial. States read through a strong profile (arm vertical for needs-input; head pitched forward for
stalled/ended). **But** the profile is edge-on to how you scan a floor, the screen face turns away
from the reader, and seated poses collapse into a hunched lump at 34 px — see `in-situ.png` panel A.
Risk: it fights the plan hardest, and facing direction now carries no information.

## B — 45° three-quarter robot · cost **M** · rank 1

Optimises volume and distinctness. Identity: barrel width, dome size, ear-cup accent dots, collar
ring, chest glyph, five crown accessories. Symmetric and front-facing, so all six poses read from any
scan direction; the bright visor is the most findable element on the floor. Maps cleanly onto the
existing `rig-pose.js` skeleton (shoulder/elbow/hand, lean, seated). Risk: reads "teddy" if the
accents get any louder; `benched` still reads as sitting, not lounging.

## C — 45° crew figure · cost **L** · rank 3

Optimises warmth. Identity: hood lining, backpack, boots, cuffs, crest, glyph — the widest surface of
the four, and so the one needing most discipline (the first pass looked like confetti; secondary
accents are now muted). Best `benched` of the four — genuinely reclining. Most drawing per character.
Risk: busiest at 24 px; most accent surfaces to police against crimson.

## D — Capsule bot · cost **S** · rank 2

Optimises pixels-per-read and animation cost. One capsule, two nubs, a face plate, a top light. Eyes
carry state (focus / wide / flat / happy / shut) and survive 26 px better than any glyph here.
Cheapest to animate: tilt, hover height, two nub angles. Risk: **least identity room** — the six
variants on `D.png` are nearly indistinguishable, and green `working` capsules sit very close to the
potted plants (panel D, beside the plant) — the white eyes and top light are what rescue it.

## Ranking and risks

**B > D > C > A.** B is the best balance of glanceability, charm and fit with the existing rig; D wins
on cost and small-size reading but loses on identity; C is the most likeable and the most expensive;
A is the weakest in practice despite the strongest idea.

Common risks: **every golden changes** (all of `test/goldens/**`); the rim-halo pass doubles stroke
work (~12–18 paths per character) so at 100 agents the halo, chest glyph and far limbs should drop
below ~30 px; characters are taller than 22 px, so **name labels sit lower and collide sooner** at
shared desks — worth checking `scene-labels.js` before committing to a size.
