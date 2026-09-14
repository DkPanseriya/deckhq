# DeckHQ — five candidate marks

Hand-written SVG: no fonts, no external refs, no gradients. One accent over neutrals,
crimson reserved for marks that mean *needs you*. Both variants live in one file
(`prefers-color-scheme`, plus the `.light`/`.dark` classes the renderer sets).

`node render.mjs` writes the 40 PNGs, `node sheet.mjs` the contact sheet — headless
Chrome, no network, each size rasterised from the vector at that size.

Candidates 1 and 5 are second drafts; 2, 3 and 4 are untouched.

## The five

**1 — desk + hand up.** An agent at its desk with its hand raised: the one that needs
you. *Rebuilt.* Seven shapes, a perspective desk top and a visor slot smeared below 32 px.
Now three — arm (a 72-wide round-capped stroke whose cap is the hand), head circle,
desk bar — over a plate whose fill and rim are one rect.
**16 px: reads.** Three masses, white / crimson / grey, none touching.

**2 — floor plan, one lit.** Rooms from above, one lit amber. The most literal of the five.
**16 px: fails.** Five rects collapse into a four-pixel checker, the lit room is one
amber pixel lost in noise, and the greys dissolve on a light taskbar.

**3 — needs-you pin.** A badge whose silhouette — rounded square, one square corner —
says "unread" before any detail resolves, with a drawn "1". **16 px: best in the set.**
Solid crimson field, white numeral, no interior detail to lose.

**4 — D / door.** A D whose spine is split by the amber doorway a card moves through.
**16 px: survives, barely.** The letter holds; the door becomes one amber pixel, a nick
in the stem. The counter closes up on a light taskbar.

**5 — the agent.** Head, visor, antenna. *Rebuilt.* Head grown 360 → 424 wide, ears
dropped (1 px of nothing at 16), antenna shortened. Ink spans 83% × 82% of the box
instead of floating near 70%. **16 px: reads.** The visor slot stays open on all four
ground/variant combinations.

## Ranking

1. **3, needs-you pin.** The only mark equally itself at 512 and at 16. A favicon sits 16 px beside
   a dozen others; a solid crimson field wins that row, and it is the only candidate that
   never leans on its rim on a light taskbar. Cost: a badge, not a product mark, and it
   shouts when nothing needs you.
2. **5, the agent.** A face, so it degrades the way faces do — well. Filling the
   plate, it now holds both taskbar and tab strip. Dark variant is the stronger;
   light-on-light depends on its rim.
3. **1, desk + hand up.** Truest to the product — an office, a character, a raised hand —
   and now legible, but the story only lands at 32 px and up. Good taskbar icon, poor
   favicon.
4. **4, D / door.** Best at 512 and beside a wordmark, but the door is decoration
   below 32 px, where it reduces to a plain D.
5. **2, floor plan.** Best idea, worst icon. Keep it for a splash or an empty state at
   128 px and above.
